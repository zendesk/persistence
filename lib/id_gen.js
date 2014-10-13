var Persistence = require('./persistence.js'),
    Lock = require('./lock.js');

function IdGen(scope, expiry) {
  this.scope = scope;
  this.lock = new Lock('persistence_lock:/'+scope);
  this.listeners = [];
  this.processing = false;
  this.expiry = expiry;
  this.lock.on('expired', this.unblock.bind(this));
  this.lock.on('released', this.unblock.bind(this));
}

var processListener = function(idgen) {

  if(idgen.processing || idgen.listeners.length === 0) return;

  idgen.processing = true;
  idgen.lock.acquire(function(error, success) {
    if(error) {
      idgen.processing = false;
      throw new Error(error);
    }

    if(success) {
      var multi = Persistence.redis().multi();
      multi.incr(idgen.scope, function(error, value) {
        if(error) {
          idgen.processing = false;
          // attempt to release the lock
          idgen.lock.release();
          throw new Error(error);
        }
        var callback = idgen.listeners.shift();
        if(callback) callback(null, value);
        idgen.processing = false;
        idgen.lock.release();
      });
      if(idgen.expiry) {
        multi.expire(idgen.scope, idgen.expiry);
      }
      multi.exec();
    } else { //not locked
      idgen.processing = false;
    }
  });
};

IdGen.prototype.alloc = function(callback) {
  if(callback) {
    this.listeners.push(callback);
  }
  this.unblock();
};

IdGen.prototype.unblock = function() {
  processListener(this);
};

module.exports = IdGen;
