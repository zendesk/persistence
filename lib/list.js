var Persistence = require('./persistence.js'),
    IdGen = require('./id_gen.js'),
    logging = require('minilog')('persistence:list');

// Define a list abstraction:
// 1. Autoincrementing ID when pushed
// 2. Expiry option for removal after usage
// 3. Trim older values after maxLength
function List(name, expiry, maxLength) {
  this.name = name;
  this.expiry = expiry;
  this.maxLength = maxLength;
  this.idGen = new IdGen('id_gen:/'+name);
}

// Get start, end and size of  a list
List.prototype.info = function(callback) {
  var start, end, size;
  var multi = Persistence.redis().multi();

  multi.lrange(this.name, 0, 0, function(error, values) {
    if(error) throw new Error(error);

    if(values.length == 1) {
      start = JSON.parse(values[0]).id;
    }
  });

  multi.lrange(this.name, -1, -1, function(error, values) {
    if(error) throw new Error(error);

    if(values.length == 1) {
      end = JSON.parse(values[0]).id;
    }
  });

  multi.llen(this.name, function(error, value) {
    if(error) throw new Error(error);

    size = value;
  });

  multi.exec(function(error) {
    if(callback) callback(error, start, end, size);
  });
};

var calculateStartOffset = function(start, end, size, from) {
  var startOffset = 0; //default is to read the whole list

  // if from is not provided, it is an attempt to read the whole list
  if(!from && from !== 0) return 0;

  if(size === 0 || from < start || from > end) {
    return null;
  }
  // buffer for any newly added members in queue; hence -100.
  // -ve values are based on offset from the end.
  // -1 - (end - from) will cover any skipped ids and over-read.
  startOffset = -1 - (end - from) - 100;
  return startOffset;
};

//Adjust and read from a given entry id to the end for a list
List.prototype.read = function(from, start, end, size, callback) {
  var redis = Persistence.redis();
  var startOffset = calculateStartOffset(start, end, size, from);

  if(startOffset === null) {
    if(callback) callback('sync-error');
    return;
  }

  redis.lrange(this.name, startOffset, -1, function(error, entries) {
    if(error) throw error;

    var parsed = [];
    entries = entries || [];
    entries.forEach(function(reply) {
      var entry = JSON.parse(reply);
      if(from >= 0 && entry.id <= from) {
        return; //filter out
      }
      parsed.push(entry);
    });

    if(callback) callback(null, parsed);
  });
};

// push an entry into a list; with expiration, trimming etc set
// stamps an auto incrementing id (blocks if id is not available
// - some one else is pushing)
// Also publish to redis pubsub
List.prototype.push = function(e, callback) {
  var multi = Persistence.redis().multi();
  var entry = JSON.parse(JSON.stringify(e));
  var list = this;

  this.idGen.alloc(function(err, value) {
    entry.id = value;
    multi.publish(list.name, JSON.stringify(entry), Persistence.handler);

    if(list.maxLength > 0) {
      multi.rpush(list.name, JSON.stringify(entry), Persistence.handler);
    }

    if(list.expiry) {
      multi.expire(list.name, list.expiry, Persistence.handler);
    } else {
      logging.warn('resource created without ttl :', list.name);
      logging.warn('resource expiry policy was :', list.expiry);
    }

    if(list.maxLength) {
      multi.ltrim(list.name, -list.maxLength, -1, Persistence.handler);
    }

    multi.exec(function(err) {
      if(callback) callback(err, entry);
    });
  });
};

List.prototype.unblock = function() {
  this.idGen.unblock();
};

module.exports = List;
