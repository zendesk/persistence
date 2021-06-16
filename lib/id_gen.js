const Persistence = require('./persistence.js')
const Lock = require('./lock.js')

function IdGen (scope, expiry) {
  this.scope = scope
  this.lock = new Lock('persistence_lock:/' + scope)
  this.listeners = []
  this.expiry = expiry
  this.lock.on('expired', this.unblock.bind(this))
  this.lock.on('released', this.unblock.bind(this))
}

IdGen.prototype.alloc = function (callback) {
  this.listeners.push(callback)
  this.unblock()
}

IdGen.prototype.unblock = function () {
  const self = this
  if (this.processing || this.listeners.length === 0) return

  this.processing = true
  this.lock.acquire(function (error, success) {
    if (error || !success) {
      self.processing = false
      if (error) {
        throw new Error(error)
      }
      return
    }

    // success
    const multi = Persistence.redis().multi()
    multi.incr(self.scope)

    if (self.expiry) {
      multi.expire(self.scope, self.expiry)
    }
    multi.exec(function (error, reply) {
      if (error) {
        self.processing = false
        self.lock.release()
        throw new Error(error)
      }
      const callback = self.listeners.shift()
      if (callback) {
        callback(null, reply[0][1])
      };
      self.processing = false
      self.lock.release()
    })
  })
}

module.exports = IdGen
