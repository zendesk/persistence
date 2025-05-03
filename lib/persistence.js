const logging = require('minilog')('persistence')
const ConnectionHelper = require('./connection_helper.js')
// defaults
let connection = {}
let connected = false
let connecting = false
let configuration = {}

const Persistence = { }

Persistence.connect = function (done) {
  if (!connected) {
    if (!connecting) {
      connecting = true
      connection = ConnectionHelper.connection(configuration)

      connection.establish(function () {
        connected = true
        connecting = false
        if (done) {
          done()
        }
      })
    } else {
      connection.readyListeners.push(done)
    }
  } else if (done) {
    done()
  }
}

Persistence.redis = function (value) {
  if (value) {
    connection.client = value
  }
  if (!connection.client || connection.subscriber.status !== 'ready') {
    logging.error('Client: Not connected to redis')
  }

  return connection.client
}

Persistence.redisReplica = function (value) {
  if (value) {
    connection.replicaClient = value
  }
  if (!connection.replicaClient) {
    logging.error('Replica Client: Not connected to redis')
  }
  return connection.replicaClient
}

Persistence.pubsub = function (value) {
  if (value) {
    connection.subscriber = value
  }
  if (!connection.subscriber || connection.subscriber.status !== 'ready') {
    logging.error('Pubsub: Not connected to redis')
  }
  return connection.subscriber
}

Persistence.setConfig = function (config) {
  configuration = config
}

Persistence.applyPolicy = function (multi, key, policy) {
  if (policy.maxCount) {
    multi.zremrangebyrank(key, 0, -policy.maxCount - 1)
  }

  if (policy.maxAgeSeconds) {
    const maxScore = Date.now() - policy.maxAgeSeconds * 1000
    multi.zremrangebyscore(key, 0, maxScore)
  }
}

Persistence.readOrderedWithScores = function (key, policy, callback) {
  const multi = Persistence.redis().multi()
  let multiReplica = null

  if (process.env.RADAR_MIGRATION_ENABLED === 'true') {
    multiReplica = Persistence.redisReplica().multi()
  }

  let replyCount = 0
  switch (arguments.length) {
    case 3:
      if (policy) {
        if (policy.maxCount) replyCount++
        if (policy.maxAgeSeconds) replyCount++
        Persistence.applyPolicy(multi, key, policy)

        if (process.env.RADAR_MIGRATION_ENABLED === 'true') {
          Persistence.applyPolicy(multiReplica, key, policy)
        }
      }
      break
    case 2:
      callback = policy // policy is optional
  }

  // sync up to 100 messages, starting from the newest
  multi.zrange(key, -100, -1, 'WITHSCORES')

  multi.exec(function (err, replies) {
    if (err) throw new Error(err)
    callback(replies[replyCount][1])
  })

  if (process.env.RADAR_MIGRATION_ENABLED === 'true') {
    multiReplica.zrange(key, -100, -1, 'WITHSCORES')

    multiReplica.exec(function (err, replies) {
      if (err) throw new Error(err)
      callback(replies[replyCount][1])
    })
  }
}

Persistence.persistOrdered = function (key, value, callback) {
  Persistence
    .redis()
    .zadd(key, Date.now(), JSON.stringify(value))
    .then(() => {
      if (callback) callback()
    }, (err) => {
      if (callback) callback(err)
    })

  if (process.env.RADAR_MIGRATION_ENABLED === 'true') {
    Persistence
      .redisReplica()
      .zadd(key, Date.now(), JSON.stringify(value))
  }
}

Persistence.delWildCard = function (expr, callback) {
  Persistence.getReaderClientDuringMigration().keys(expr, function (err, results) {
    if (err) throw new Error(err)
    let counter = 0
    if (!results.length) {
      return callback()
    }
    results.forEach(function (key) {
      Persistence.del(key, function () {
        counter++
        if (counter === results.length) {
          callback()
        }
      })
    })
  })
}

Persistence.del = function (key, callback) {
  logging.info('deleting', key)
  Persistence.redis().del(key, callback)

  if (process.env.RADAR_MIGRATION_ENABLED === 'true') {
    Persistence.redisReplica().del(key, callback)
  }
}

// Return the value associated with key that is stored in the hash *hash*
Persistence.readHashValue = function (hash, key, callback) {
  logging.debug('readHashValue:', hash, key)
  Persistence.getReaderClientDuringMigration()
    .hget(hash, key)
    .then((reply) => {
      callback(JSON.parse(reply))
    }, (err) => {
      if (err) throw new Error(err)
    })
}

Persistence.readHashAll = function (hash, callback) {
  Persistence.getReaderClientDuringMigration()
    .hgetall(hash)
    .then((replies) => {
      if (replies) {
        Object.keys(replies).forEach(function (attr) {
          try {
            replies[attr] = JSON.parse(replies[attr])
          } catch (parseError) {
            logging.error('Corrupted key value in redis [' + hash + '][' + attr + ']. ' + parseError.message + ': ' + parseError.stack)
            delete replies[attr]
          }
        })
      }
      callback(replies)
    }, (err) => {
      if (err) throw new Error(err)
    })
}

// Return the value associated with the key *key* (no associated hash)
Persistence.readKey = function (key, callback, expireTTL) {
  const multi = Persistence.redis().multi()
  let multiReplica = null
  if (process.env.RADAR_MIGRATION_ENABLED === 'true') {
    multiReplica = Persistence.redisReplica().multi()
  }

  logging.debug('readKey:', key)
  if (Persistence.readFromReplica()) {
    multiReplica.get(key)
  } else {
    multi.get(key)
  }

  if (expireTTL && process.env.RADAR_MIGRATION_ENABLED === 'true') {
    multi.expire(key, expireTTL)
    multiReplica.expire(key, expireTTL)
  } else if (expireTTL) {
    multi.expire(key, expireTTL)
  }

  if (Persistence.readFromReplica()) {
    multiReplica.exec(function (err, replies) {
      if (err || replies[0][0]) throw new Error(err)
      callback(JSON.parse(replies[0][1]))
    })
    multi.exec()
  } else if (process.env.RADAR_MIGRATION_ENABLED === 'true') {
    multi.exec(function (err, replies) {
      if (err || replies[0][0]) throw new Error(err)
      callback(JSON.parse(replies[0][1]))
    })
    multiReplica.exec()
  } else {
    multi.exec(function (err, replies) {
      if (err || replies[0][0]) throw new Error(err)
      callback(JSON.parse(replies[0][1]))
    })
  }
}

Persistence.persistKey = function (key, value, expireTTL) {
  const multi = Persistence.redis().multi()

  logging.debug('persistKey:', key, value)
  multi.set(key, JSON.stringify(value))
  if (expireTTL) {
    multi.expire(key, expireTTL)
  }

  multi.exec()

  if (process.env.RADAR_MIGRATION_ENABLED === 'true') {
    const multiReplica = Persistence.redisReplica().multi()
    logging.debug('persistKey replica:', key, value)
    multiReplica.set(key, JSON.stringify(value))
    if (expireTTL) {
      multiReplica.expire(key, expireTTL)
    }

    multiReplica.exec()
  }
}

Persistence.persistHash = function (hash, key, value) {
  logging.debug('persistHash:', hash, key, value)
  Persistence.redis().hset(hash, key, JSON.stringify(value), Persistence.handler)

  if (process.env.RADAR_MIGRATION_ENABLED === 'true') {
    logging.debug('persistHash replica:', hash, key, value)
    Persistence.redisReplica().hset(hash, key, JSON.stringify(value), Persistence.handler)
  }
}

Persistence.expire = function (key, seconds) {
  logging.debug('expire', key, seconds)
  Persistence.redis().expire(key, seconds, Persistence.handler)

  if (process.env.RADAR_MIGRATION_ENABLED === 'true') {
    Persistence.redisReplica().expire(key, seconds, Persistence.handler)
  }
}

Persistence.ttl = function (key, callback) {
  Persistence.redis().ttl(key, callback)

  if (process.env.RADAR_MIGRATION_ENABLED === 'true') {
    Persistence.redisReplica().ttl(key, callback)
  }
}

Persistence.deleteHash = function (hash, key) {
  logging.debug('deleteHash:', hash, key)
  Persistence.redis().hdel(hash, key, Persistence.handler)

  if (process.env.RADAR_MIGRATION_ENABLED === 'true') {
    Persistence.redisReplica().hdel(hash, key, Persistence.handler)
  }
}

Persistence.publish = function (key, value, callback) {
  logging.debug('Redis pub:', key, value)

  Persistence.getReaderClientDuringMigration().publish(key, JSON.stringify(value), callback || Persistence.handler)
}

Persistence.disconnect = function (callback) {
  connected = false
  if (connection && (connection.client || connection.subscriber)) {
    connection.teardown(callback)
  } else {
    if (callback) {
      callback()
    }
  }
}

Persistence.keys = function (key, callback) {
  Persistence.getReaderClientDuringMigration().keys(key, callback)
}

Persistence.handler = function (err) {
  if (err) {
    if (!(err instanceof Error)) {
      err = new Error(err)
    }
    logging.error(err)
  }
}

Persistence.incrby = function (key, incr) {
  Persistence.redis().incrby(key, incr, Persistence.handler)

  if (process.env.RADAR_MIGRATION_ENABLED === 'true') {
    Persistence.redisReplica().incrby(key, incr, Persistence.handler)
  }
}

Persistence.select = function (index) {
  Persistence.getReaderClientDuringMigration().select(index, Persistence.handler)
}

Persistence.readFromReplica = function () {
  return process.env.RADAR_ELASTICACHE_ENABLED === 'true' && process.env.RADAR_MIGRATION_ENABLED === 'true'
}

Persistence.getReaderClientDuringMigration = function () {
  return Persistence.readFromReplica() ? Persistence.redisReplica() : Persistence.redis()
}

module.exports = Persistence
