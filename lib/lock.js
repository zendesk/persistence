var Persistence = require('./persistence.js');

var DEFAULT_TIMEOUT_SEC = 10;
function Lock(scope, timeout) {
  this.scope = 'persistence_lock:/'+scope;
  this.timeout = timeout || DEFAULT_TIMEOUT_SEC;
}

require('util').inherits(Lock, require('events').EventEmitter);

Lock.prototype.acquire = function(callback) {
  var redis = Persistence.redis(),
      lock = this;

  this.cleanupExpiry();
  redis.set(this.scope, 'locked', 'EX', this.timeout, 'NX', function(error, val) {
    if(val != 'OK') {
      lock.setupExpiry();
    }
    callback(error, (val === 'OK'));
  });
};

Lock.prototype.setupExpiry = function() {
  this.timer = this.timer || setTimeout(function() {
    delete this.timer;
    this.emit('expired');
  }, this.timeout*1000);
};

Lock.prototype.cleanupExpiry = function() {
  if(this.timer) {
    clearTimeout(this.timer);
    delete this.timer;
  }
};

Lock.prototype.release = function() {
  Persistence.redis().del(this.scope);
  this.cleanupExpiry();
  this.emit('released');
};

module.exports = Lock;