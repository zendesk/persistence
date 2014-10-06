var Persistence = require('./persistence.js'),
    logging = require('minilog')('radar:stream');

// Get start, end and size of  a list
Persistence.listInfo = function(name, callback) {
  var start, end, size;
  var multi = Persistence.redis().multi();

  multi.lrange(name, 0, 0, function(error, values) {
    if(error) throw new Error(error);

    if(values.length == 1) {
      start = JSON.parse(values[0]).id;
    }
  });

  multi.lrange(name, -1, -1, function(error, values) {
    if(error) throw new Error(error);

    if(values.length == 1) {
      end = JSON.parse(values[0]).id;
    }
  });

  multi.llen(name, function(error, value) {
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
    // buffer for any newly added members in queue
    startOffset = -1 - (end - from) - 100;
  }
  return startOffset;
};

//Adjust and read from a given entry id to the end for a list
Persistence.listRead = function(name, from, start, end, size, callback) {
  var redis = Persistence.redis();
  var startOffset = calculateStartOffset(from, start, end, size);

  if(startOffset === null) {
    callback('sync-error');
    return;
  }

  redis.lrange(name, startOffset, -1, function(error, entries) {
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

//push an entry into a list; with expiration, trimming etc set
Persistence.listPush = function(name, entry, maxLength, expiry, callback) {
  var multi = Persistence.redis().multi();

  var logError = function(error) {
    if(error) {
      logging.error(error);
    }
  };

  multi.publish(name, JSON.stringify(entry), logError);

  if(maxLength > 0) {
    multi.rpush(name, JSON.stringify(entry), logError);
  }

  if(expiry) {
    multi.expire(this.name, expiry, logError);
  } else {
    logging.warn('resource created without ttl :', name);
    logging.warn('resource expiry policy was :', expiry);
  }

  if(maxLength) {
    multi.ltrim(name, -maxLength, -1, logError);
  }

  multi.exec(callback);
};
