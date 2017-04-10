var redisLib = require('redis'),
    ioRedisLib = require('ioredis'),
    Tracker = require('callback_tracker'),
    sentinelLib = require('redis-sentinel'),
    logging = require('minilog')('connection');

var propagateError = function(callback, error) {
  if (callback) {
    callback(error);
  } else {
    if (error instanceof Error) {
      throw error;
    } else {
      throw new Error(error);
    }
  }
};

function Connection(name, config) {
  this.name = name;
  this.config = config;
  this.client = null;
  this.subscriber = null;
  this.readyListeners = [];
  this.teardownListeners = [];
}

Connection.prototype.selectMethod = function() {
  return (this.config.id || this.config.sentinels) ? 'sentinel' : 'redis';
};

Connection.prototype.establishDone = function() {
  var readyListeners = this.readyListeners;
  this.readyListeners = [];

  readyListeners.forEach(function(listener) {
    if(listener) listener();
  });
};

Connection.prototype.teardownDone = function() {
  var teardownListeners = this.teardownListeners;
  this.teardownListeners = [];

  teardownListeners.forEach(function(listener) {
    if(listener) listener();
  });
};

Connection.prototype.isReady = function() {
  return (this.client && this.client.connected &&
          this.subscriber && this.subscriber.connected);
};

Connection.prototype.connectMethod = function(config, callback) {
  console.log("About to connectmethod");
  console.log(this.selectMethod());
  if ('redis' === this.selectMethod()) {
    this.connectRedis(config, callback);
  }
  else {
    this.connectSentinel(config, callback);
  }
};

Connection.prototype.establish = function(ready) {
  ready = ready || function() {};
  var self = this;

  this.readyListeners.push(ready);

  if (this.isReady()) {
    return this.establishDone();
  }

  if (this.readyListeners.length == 1) {
    var tracker = Tracker.create('establish :' + this.name , function() {
      self.establishDone();
    });

    //create a client (read/write)
    this.connectMethod(this.config, tracker('client ready :' + this.name, function(error, client) {
      if (error) {
        throw (error instanceof Error)? error : new Error(error);
      }

      logging.info('Created new read/write client.');
      self.client = client;
    }));

    //create a pubsub client
    this.connectMethod(this.config, tracker('subscriber ready :'+ this.name, function(error, subscriber) {
      if (error) {
        throw (error instanceof Error)? error : new Error(error);
      }

      logging.info('Created new pub/sub client.');
      self.subscriber = subscriber;
    }));
  }
};

Connection.prototype.teardown = function (callback) {
  var self = this;
  callback = callback || function() {};

  this.teardownListeners.push(callback);

  if (this.teardownListeners.length == 1) {
    var tracker = Tracker.create('teardown: ' + this.name , function() {
      self.teardownDone();
    });

    if (this.client) {
      if (this.client.connected) {
        this.client.quit(tracker('quit client :'+ this.name));
      }
      this.client = null;
    }

    if (this.subscriber) {
      if (this.subscriber.connected) {
        this.subscriber.quit(tracker('quit subscriber :'+ this.name));
      }
      this.subscriber = null;
    }

    tracker('client && subscriber checked')();
  }
};


Connection.prototype.connectRedis = function (config, callback) {
  var client = new ioRedisLib({
    sentinels: config.sentinels,
    name: config.name
  });
  // redisLib.createClient(config.port, config.host);
  if (config.redis_auth) {
    client.auth(config.redis_auth);
  }

  client.once('ready', function() {
    logging.info('Redis client "ready" event.');
    callback(null, client);
  });
};


Connection.prototype.connectSentinel = function (config, callback) {
  var sentinel,
      options = { role: 'sentinel' },
      sentinelMaster = config.id,
      sentinels = config.sentinels,
      self = this;

  if (!sentinels || !sentinels.length || !sentinelMaster) {
    propagateError(callback, new Error('Provide a valid sentinel cluster configuration '));
    return;
  }

  if (config.redis_auth) {
    options.auth_pass = config.redis_auth;
  }

  sentinel = sentinelLib.createClient(sentinels, sentinelMaster, options);

  sentinel.send_command('SENTINEL', ['get-master-addr-by-name', sentinelMaster], function(error, master) {
    sentinel.quit();

    if (error) {
      callback(error);
    }

    if (!master || master.length != 2) {
      propagateError(callback, new Error("Unknown master " + sentinelMaster));
      return;
    }

    var newConfig = { host: master[0],
                    port: master[1],
                    redis_auth: config.redis_auth };

    self.connectRedis(newConfig, callback);
  });
};

module.exports = Connection;
