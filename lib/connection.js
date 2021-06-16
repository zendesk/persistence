const Redis = require('ioredis')
const Tracker = require('callback_tracker')
const logging = require('minilog')('connection')

const propagateError = function (callback, error) {
  if (callback) {
    callback(error)
  } else {
    if (error instanceof Error) {
      throw error
    } else {
      throw new Error(error)
    }
  }
}

function Connection (name, config) {
  this.name = name
  this.config = {
    ...config,
    enableReadyCheck: true
  }
  this.client = null
  this.subscriber = null
  this.readyListeners = []
  this.teardownListeners = []
}

Connection.prototype.selectMethod = function () {
  return (this.config.id || this.config.sentinels) ? 'sentinel' : 'redis'
}

Connection.prototype.establishDone = function () {
  const readyListeners = this.readyListeners
  this.readyListeners = []

  readyListeners.forEach(function (listener) {
    if (listener) listener()
  })
}

Connection.prototype.teardownDone = function () {
  const teardownListeners = this.teardownListeners
  this.teardownListeners = []

  teardownListeners.forEach(function (listener) {
    if (listener) listener()
  })
}

Connection.prototype.isReady = function () {
  return this.client &&
    this.client.status === 'ready' &&
    this.subscriber &&
    this.subscriber.status === 'ready'
}

Connection.prototype.connectMethod = function (config, callback) {
  if (this.selectMethod() === 'redis') {
    this.connectRedis(config, callback)
  } else {
    this.connectSentinel(config, callback)
  }
}

Connection.prototype.establish = function (ready) {
  ready = ready || function () {}
  const self = this

  this.readyListeners.push(ready)
  if (this.isReady()) {
    return this.establishDone()
  }

  if (this.readyListeners.length === 1) {
    const tracker = Tracker.create('establish :' + this.name, function () {
      self.establishDone()
    })

    // create a client (read/write)
    this.connectMethod(this.config, tracker('client ready :' + this.name, function (error, client) {
      if (error) {
        throw (error instanceof Error) ? error : new Error(error)
      }

      logging.info('Created new read/write client.')
      self.client = client
    }))

    // create a pubsub client
    this.connectMethod(this.config, tracker('subscriber ready :' + this.name, function (error, subscriber) {
      if (error) {
        throw (error instanceof Error) ? error : new Error(error)
      }

      logging.info('Created new pub/sub client.')
      self.subscriber = subscriber
    }))
  }
}

Connection.prototype.teardown = function (callback) {
  const self = this
  callback = callback || function () {}

  this.teardownListeners.push(callback)

  if (this.teardownListeners.length === 1) {
    const tracker = Tracker.create('teardown: ' + this.name, function () {
      self.teardownDone()
    })

    if (this.client) {
      if (this.client.connected) {
        this.client.quit(tracker('quit client :' + this.name))
      }
      this.client = null
    }

    if (this.subscriber) {
      if (this.subscriber.connected) {
        this.subscriber.quit(tracker('quit subscriber :' + this.name))
      }
      this.subscriber = null
    }

    tracker('client && subscriber checked')()
  }
}

Connection.prototype.connectRedis = function (config, callback) {
  const client = new Redis({
    port: config.port,
    host: config.host,
    enableReadyCheck: true,
    showFriendlyErrorStack: true
  })
  if (config.redis_auth) {
    client.auth(config.redis_auth)
  }

  client.on('ready', function () {
    logging.info('Redis client "ready" event.')
    callback(null, client)
  })

  client.on('error', function (error) {
    logging.info({ message: `Redis client error: ${error.message}` })
  })
}

Connection.prototype.connectSentinel = function (config, callback) {
  const options = { role: 'sentinel' }
  const sentinelMaster = config.id
  const sentinels = config.sentinels

  if (!sentinels || !sentinels.length || !sentinelMaster) {
    propagateError(callback, new Error('Provide a valid sentinel cluster configuration '))
    return
  }

  if (config.redis_auth) {
    options.auth_pass = config.redis_auth
  }

  const sentinel = new Redis({
    sentinels,
    name: sentinelMaster,
    sentinelPassword: options.auth_pass,
    enableReadyCheck: true,
    showFriendlyErrorStack: true
  })

  sentinel.on('ready', function () {
    logging.info('Sentinel client "ready" event.')
    callback(null, sentinel)
  })

  sentinel.on('error', function (error) {
    logging.info({ message: `Sentinel client error: ${error.message}` })
  })
}

module.exports = Connection
