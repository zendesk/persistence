var logging = require('minilog')('persistence'),
    ConnectionHelper = require('./connection_helper.js'),
    // defaults
    connection = {},
    connected = false,
    connecting = false,
    configuration = {};

var Persistence = { }

Persistence.connect = function(done) {
  if (!connected) {
    if (!connecting) {
      connecting = true;
      connection = ConnectionHelper.connection(configuration);
      connection.establish(function() {
        connected = true;
        connecting = false;
        if (done) {
          done();
        }
      });
    } else {
      connection.readyListeners.push(done);
    }
  } else if (done) {
    done();
  }
};

Persistence.redis = function(value) {
  if (value) {
    connection.client = value;
  }
  if(!connection.client || connection.subscriber.status !== 'ready') {
    throw new Error('Client: Not connected to redis');
  }
  return connection.client;
};

Persistence.pubsub = function(value) {
  if(value) {
    connection.subscriber = value;
  }
  if(!connection.subscriber || connection.subscriber.status !== 'ready') {
    throw new Error('Pubsub: Not connected to redis');
  }
  return connection.subscriber;
};

Persistence.setConfig = function(config) {
  configuration = config;
  if(config && config.use_connection && config.connection_settings) {
    connectionName = config.use_connection;
  }
};

Persistence.applyPolicy = function (multi, key, policy) {
  if(policy.maxCount) {
    multi.zremrangebyrank(key, 0, -policy.maxCount-1, function(err, res) {
      logging.debug('Enforce max count: '+(0-policy.maxCount-1)+' removed '+res);
      if(err) throw new Error(err);
    });
  }

  if(policy.maxAgeSeconds) {
    var maxScore = Date.now()-policy.maxAgeSeconds * 1000;
    multi.zremrangebyscore(key, 0, maxScore, function(err, res) {
      logging.debug('Enforce max age ('+key+'): '+new Date(maxScore).toUTCString()+' removed '+res);
      if(err) throw new Error(err);
    });
  }
};

Persistence.readOrderedWithScores = function(key, policy, callback) {
  var multi = Persistence.redis().multi();
  switch(arguments.length) {
    case 3:
      if (policy) Persistence.applyPolicy(multi, key, policy);
      break;
    case 2:
      callback = policy; // policy is optional
  }

  // sync up to 100 messages, starting from the newest
  multi.zrange(key, -100, -1, 'WITHSCORES');

  multi.exec(function(err, replies) {
    if(err) throw new Error(err);
    callback(replies[0][1]);
  });
};

Persistence.persistOrdered = function(key, value, callback) {
  Persistence.redis().zadd(key, Date.now(), JSON.stringify(value), callback);
};

Persistence.delWildCard = function(expr, callback) {
  Persistence.redis().keys(expr, function(err, results) {
    if(err) throw new Error(err);
    var counter = 0;
    if(!results.length) {
      return callback();
    }
    results.forEach(function(key) {
      Persistence.del(key, function() {
        counter++;
        if (counter == results.length) {
          callback();
        }
      });
    });
  });
};

Persistence.del = function(key, callback) {
  logging.info('deleting', key);
  Persistence.redis().del(key, callback);
};

// Return the value associated with key that is stored in the hash *hash*
Persistence.readHashValue = function (hash, key, callback) {
  logging.debug('readHashValue:', hash, key);
  Persistence.redis().hget(hash, key, function(err, reply) {
    if (err) throw new Error(err);
    callback(JSON.parse(reply));
  });
};

Persistence.readHashAll = function(hash, callback) {
  Persistence.redis().hgetall(hash, function (err, replies) {
    if(err) throw new Error(err);
    if(replies) {
      Object.keys(replies).forEach(function(attr) {
        try {
          replies[attr] = JSON.parse(replies[attr]);
        } catch(parseError) {
          logging.error('Corrupted key value in redis [' + hash + '][' + attr + ']. ' + parseError.message + ': '+ parseError.stack);
          delete replies[attr];
        }
      });
    }
    callback(replies);
  });
};

// Return the value associated with the key *key* (no associated hash)
Persistence.readKey = function (key, callback, expireTTL) {
  var multi = Persistence.redis().multi();

  logging.debug('readKey:', key);
  multi.get(key);

  if (expireTTL) {
    multi.expire(key, expireTTL);
  }

  multi.exec(function (err, replies) {
    if (err || replies[0][0]) throw new Error(err);
    callback(JSON.parse(replies[0][1]))
  });
};

Persistence.persistKey = function (key, value, expireTTL) {
  return new Promise(function (resolve, reject) {
    var multi = Persistence.redis().multi();

    logging.debug('persistKey:', key, value);
    multi.set(key, JSON.stringify(value));
    if (expireTTL) {
      multi.expire(key, expireTTL);
    }

    multi.exec(function (err, replies) {
      if (err || replies[0][0]) reject(err)
      resolve(replies[0][1])
    });
  })
};

Persistence.persistHash = function(hash, key, value) {
  return new Promise(function (resolve, reject) {
    logging.debug('persistHash:', hash, key, value);
    Persistence.redis().hset(hash, key, JSON.stringify(value), function (err, reply) {
      if (err || !reply) reject(err)
      resolve(reply)
    });
  })
};

Persistence.expire = function(key, seconds) {
  return new Promise(function (resolve, reject) {
    logging.debug('expire', key, seconds);
    Persistence.redis().expire(key, seconds, function (err, reply) {
      if (err || !reply) reject(err)
      resolve(reply)
    });
  })
};

Persistence.ttl = function(key, callback) {
  Persistence.redis().ttl(key, callback);
};

Persistence.deleteHash = function(hash, key) {
  return new Promise(function (resolve, reject) {
    logging.debug('deleteHash:', hash, key);
    Persistence.redis().hdel(hash, key, function (err, reply) {
      if (err || !reply) reject(err)
      resolve(reply)
    });
  })
};

Persistence.publish = function(key, value, callback) {
  logging.debug('Redis pub:', key, value);
  Persistence.redis().publish(key, JSON.stringify(value), callback || Persistence.handler);
};

Persistence.disconnect = function(callback) {
  connected = false;
  if(connection && (connection.client || connection.subscriber)) {
    connection.teardown(callback);
  } else {
    if(callback) {
      callback();
    }
  }
};

Persistence.keys = function(key, callback) {
  Persistence.redis().keys(key, callback);
};

Persistence.handler = function(err) {
  if (err) {
    if (!(err instanceof Error)) {
      err = new Error(err);
    }
    logging.error(err);
  }
};

Persistence.incrby = function(key, incr) {
  return new Promise(function (resolve, reject) {
    Persistence.redis().incrby(key, incr, function (err, reply) {
      if (err || !reply) reject(err)
      resolve(reply)
    });
  })
};

Persistence.select = function(index) {
  return new Promise(function (resolve, reject) {
    Persistence.redis().select(index, function (err, reply) {
      if (err || !reply) reject(err)
      resolve(reply)
    });
  })
};

Persistence.isConnectionReady = () => Persistence.redis() && Persistence.pubsub();

module.exports = Persistence;
