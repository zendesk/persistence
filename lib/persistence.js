var logging = require('minilog')('persistence'),
    ConnectionHelper = require('./connection_helper.js'),
    // defaults
    connectionName = 'default',
    connection = {},
    connected = false,
    connecting = false,
    configuration = {};

function Persistence() { }

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

      var timeout = process.env.CONNECT_TIMEOUT || 10000;
      setTimeout(function () {
        if (!connection.isReady()) {
          logging.error('connection not ready after waiting', timeout/1000, 'seconds');
          throw new Error('connection not ready');
        }
      }, timeout);

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
  if(!connection.client || !connection.client.connected) {
    throw new Error('Client: Not connected to redis');
  }
  return connection.client;
};

Persistence.pubsub = function(value) {
  if(value) {
    connection.subscriber = value;
  }
  if(!connection.subscriber || !connection.subscriber.connected) {
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

Persistence.applyPolicy = function(multi, key, policy) {
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
  multi.zrange(key, -100, -1, 'WITHSCORES', function (err, replies) {
    if(err) throw new Error(err);
    logging.debug(key+' '+ (replies.length /2) + ' items to sync');

    // (nherment) TODO: deserialize the result here because it is being serialized in persistOrdered()
    // The problem is that radar_client currently deserializes the response.
    // We need to make the client not deserialize the response so that we can deserialize it here.

    callback(replies);
  });

  multi.exec();
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
  multi.get(key, function (err, reply) {
    if (err) throw new Error(err);
    callback(JSON.parse(reply));
  });

  if (expireTTL) {
    multi.expire(key, expireTTL);
  }

  multi.exec();
};

Persistence.persistKey = function (key, value, expireTTL) {
  var multi = Persistence.redis().multi();

  logging.debug('persistKey:', key, value);
  multi.set(key, JSON.stringify(value), Persistence.handler);
  if (expireTTL) {
    multi.expire(key, expireTTL);
  }

  multi.exec();
};

Persistence.persistHash = function(hash, key, value) {
  logging.debug('persistHash:', hash, key, value);
  Persistence.redis().hset(hash, key, JSON.stringify(value), Persistence.handler);
};

Persistence.expire = function(key, seconds) {
  logging.debug('expire', key, seconds);
  Persistence.redis().expire(key, seconds, Persistence.handler);
};

Persistence.ttl = function(key, callback) {
  Persistence.redis().ttl(key, callback);
};

Persistence.deleteHash = function(hash, key) {
  logging.debug('deleteHash:', hash, key);
  Persistence.redis().hdel(hash, key, Persistence.handler);
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

    if (/READONLY/.test(String(err))) {
      logging.debug('Failover happened, about to reconnect.');

      Persistence.reconnect(function () {
        if (connection.isReady()) {
          logging.debug('Connected successfully after failover happened.');
        } else {
          throw new Error('Failed to reconnect to redis after failover happened.')
        }
      });
    } else {
      logging.error(err);
    }
  }
};

Persistence.incrby = function(key, incr) {
  Persistence.redis().incrby(key, incr, Persistence.handler);
};

Persistence.select = function(index) {
  Persistence.redis().select(index, Persistence.handler);
};

Persistence.reconnect = function (callback) {
  Persistence.disconnect(function() {
    ConnectionHelper.destroyConnection(configuration, function () {
      Persistence.connect(callback);
    })
  })
}

Persistence.isConnectionReady = function () {
  return connection.isReady();
}

module.exports = Persistence;
