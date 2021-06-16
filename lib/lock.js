const Persistence = require('./persistence.js')
const logging = require('minilog')('lock')

const DEFAULT_TIMEOUT_SEC = 10
function Lock (scope, timeout) {
  this.scope = scope
  this.timeout = timeout || DEFAULT_TIMEOUT_SEC
}

require('util').inherits(Lock, require('events').EventEmitter)

Lock.prototype.acquire = function (callback) {
  const redis = Persistence.redis()
  const lock = this

  this.cleanupExpiry()
  redis.set(this.scope, 'locked', 'EX', this.timeout, 'NX', function (error, val) {
    if (val !== 'OK') {
      lock.setupExpiry()
    }
    if (callback) callback(error, (val === 'OK'))
  })
}

Lock.prototype.setupExpiry = function () {
  this.timer = this.timer || setTimeout(function () {
    delete this.timer
    this.emit('expired')
  }, this.timeout * 1000)
}

Lock.prototype.cleanupExpiry = function () {
  if (this.timer) {
    clearTimeout(this.timer)
    delete this.timer
  }
}

Lock.prototype.release = function () {
  Persistence
    .redis()
    .del(this.scope)
    .then(function () {
      this.cleanupExpiry()
      this.emit('released')
    }.bind(this))
    .catch((err) => logging.error(err))
}

module.exports = Lock
