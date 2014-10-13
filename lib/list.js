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

var calculateStartOffset = function(from, start, end, size) {
  var startOffset = 0; //default is from the start
  if(from >= 0) {
    if(size === 0 || from < start || from > end) {
      return null;
    }
    // buffer for any newly added members in queue; hence -100.
    // -ve values based on offset from the end.
    startOffset = -1 - (end - from) - 100;
  }
  return startOffset;
};

//Adjust and read from a given entry id to the end for a list
List.prototype.read = function(from, start, end, size, callback) {
  var redis = Persistence.redis();
  var startOffset = calculateStartOffset(from, start, end, size);

  if(startOffset === null) {
    callback('sync-error');
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

    callback(null, parsed);
  });
};

var logError = function(error) {
  if(error) {
    logging.error(error);
  }
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
    multi.publish(list.name, JSON.stringify(entry), logError);

    if(list.maxLength > 0) {
      multi.rpush(list.name, JSON.stringify(entry), logError);
    }

    if(list.expiry) {
      multi.expire(list.name, list.expiry, logError);
    } else {
      logging.warn('resource created without ttl :', list.name);
      logging.warn('resource expiry policy was :', expiry);
    }

    if(list.maxLength) {
      multi.ltrim(list.name, -list.maxLength, -1, logError);
    }

    multi.exec(function(err) {
      callback(err, entry);
    });
  });
};

//If blocked, continue
List.prototype.unblock = function() {
  this.idGen.unblock();
};

module.exports = List;
