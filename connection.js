var redisLib = require('redis'),
    Tracker = require('callback_tracker'),
    sentinelLib = require('redis-sentinel'),
    logging = require('minilog')('connection');

var connectionMethods = {
  redis: function (config, callback) {
    var client = redisLib.createClient(config.port, config.host);
    if (config.redis_auth) {
      client.auth(config.redis_auth);
    }

    logging.info('Created a new Redis client.');
    client.once('ready', function() {
      callback(null, client);
    });
  },

  sentinel: function (config, callback) {
    var sentinel, options = { role: 'master' },
    redisAuth = config.redis_auth,
    sentinelMaster = config.id,
    sentinels = config.sentinels;

    if(!sentinels || !sentinels.length || !sentinelMaster) {
      throw new Error('Provide a valid sentinel cluster configuration ');
    }

    if(redisAuth) {
      options.auth_pass = redisAuth;
    }
    sentinel = sentinelLib.createClient(sentinels, sentinelMaster, options);

    sentinel.once('ready', function() {
      logging.info('Created a new Sentinel client.');
      callback(null, sentinel);
    });
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
  var method = 'redis';
  if(this.config.id || this.config.sentinels) {
    method = 'sentinel';
  }
  return method;
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

Connection.prototype.establish = function(ready) {
  ready = ready || function() {};
  var self = this;

  this.readyListeners.push(ready);

  if(this.isReady()) {
    return this.establishDone();
  }

  if(this.readyListeners.length == 1) {
    var tracker = Tracker.create('establish :' + this.name , function() {
      self.establishDone();
    });

    var method = connectionMethods[this.selectMethod()];

    //create a client (read/write)
    method(this.config, tracker('client ready :' + this.name, function(error, client) {
      logging.info('Created a new client.');
      self.client = client;
    }));

    //create a pubsub client
    method(this.config, tracker('subscriber ready :'+ this.name, function(error, subscriber) {
      logging.info('Created a new subscriber.');
      self.subscriber = subscriber;
    }));
  }
};

Connection.prototype.teardown = function(callback) {
  var self = this;
  callback = callback || function() {};

  this.teardownListeners.push(callback);

  if(this.teardownListeners.length == 1) {
    var tracker = Tracker.create('teardown: ' + this.name , function() {
      self.teardownDone();
    });

    if(this.client) {
      if(this.client.connected) {
        this.client.quit(tracker('quit client :'+ this.name));
      }
      this.client = null;
    }

    if(this.subscriber) {
      if(this.subscriber.connected) {
        this.subscriber.quit(tracker('quit subscriber :'+ this.name));
      }
      this.subscriber = null;
    }

    tracker('client && subscriber checked')();
  }
};

module.exports = Connection;
