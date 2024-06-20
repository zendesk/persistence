const assert = require('assert')
const SentinelHelper = require('simple_sentinel')
const Persistence = require('../lib/persistence.js')
let client
let replicaClient
const proxyquire = require('proxyquire')
const PersistenceTestHelper = require('./persistence_test_helper.test.js')

describe('given a connected persistence', function () {
  before(function (done) {
    process.env.noverbose = true
    SentinelHelper.start({ redis: { ports: [16379] } })
    Persistence.setConfig({ redis_host: 'localhost', redis_port: 16379 })
    Persistence.connect(function () {
      client = Persistence.redis()
      Persistence.delWildCard('*', done)
    })
  })

  after(function (done) {
    Persistence.delWildCard('*', function () {
      Persistence.disconnect(function () {
        SentinelHelper.stop({ redis: { ports: [16379] } })
        done()
      })
    })
  })

  describe('after connection', function () {
    it('should be able to get client and subscriber', function () {
      assert.ok(Persistence.redis())
      assert.ok(Persistence.pubsub())
    })
  })
  describe('while handling errors', function () {
    it('should filter out non JSON redis strings (ie. do not return corrupted data)', function (done) {
      const key = 'persistence.test'

      client.del(key)
      client.hset(key, 'bar1', 'this string should be filtered out')
      client.hset(key, 'bar2', '"this string should be returned"', function () {
        Persistence.readHashAll(key, function (result) {
          assert.deepEqual({ bar2: 'this string should be returned' }, result)
          done()
        })
      })
    })
    it('should log an Error object', function () {
      let logged
      const spy = function () {
        return {
          error: function (x) {
            logged = x
          }
        }
      }
      const Persistence = proxyquire('../lib/persistence', { minilog: spy })

      Persistence.handler('x')
      assert(logged instanceof Error)
      Persistence.handler(new Error('x'))
      assert(logged instanceof Error)
    })
  })

  describe('while persisting messages', function () {
    it('should serialize objects', function (done) {
      // (nherment) TODO: the result should actually be deserialized because it is being serialized in persistOrdered()
      // The problem is that radar_client currently deserializes the response.
      // We need to make the client not deserialize the response so that we can deserialize it here.

      const key = 'persistence.messages.object.test'
      const objectValue = {
        foo: 'bar'
      }

      Persistence.persistOrdered(key, objectValue, function (err) {
        if (err) {
          return done(err)
        }
        Persistence.readOrderedWithScores(key, undefined, function (replies) {
          assert(replies instanceof Array)
          assert.equal(2, replies.length)
          assert.equal('string', typeof replies[0])
          assert.equal(JSON.stringify(objectValue), replies[0])
          done()
        })
      })
    })

    it('should serialize strings', function (done) {
      // (nherment) TODO: the result should actually be deserialized because it is being serialized in persistOrdered()
      // The problem is that radar_client currently deserializes the response.
      // We need to make the client not deserialize the response so that we can deserialize it here.

      const key = 'persistence.messages.string.test'
      const stringValue = 'Hello World'

      Persistence.persistOrdered(key, stringValue, function (err) {
        if (err) {
          return done(err)
        }
        Persistence.readOrderedWithScores(key, undefined, function (replies) {
          assert(replies instanceof Array)
          assert.equal(2, replies.length)
          assert.equal('string', typeof replies[0])
          assert.equal(JSON.stringify(stringValue), replies[0])
          done()
        })
      })
    })

    it('should set/get a single key from a hash', function (done) {
      const hash = 'persistence.test'
      const key = 'persistence.messages.object.test'
      const objectValue = {
        foo: 'bar'
      }

      Persistence.persistHash(hash, key, objectValue)
      Persistence.readHashValue(hash, key, function (reply) {
        if (reply) {
          assert.deepEqual({ foo: 'bar' }, reply)
          done()
        }
      })
    })

    it('should set/get a single standalone key', function (done) {
      const key = 'persistence.messages.object.test'
      const objectValue = {
        foo: 'bar'
      }

      Persistence.persistKey(key, objectValue)
      Persistence.readKey(key, function (reply) {
        if (reply) {
          assert.deepEqual({ foo: 'bar' }, reply)
          done()
        }
      })
    })

    it('should set/get a single standalone key with TTL', function (done) {
      const key = 'persistence.messages.object.test'
      const objectValue = {
        foo: 'bar'
      }

      const keyTTL = 2
      Persistence.persistKey(key, objectValue, keyTTL)
      Persistence.redis().ttl(key, function (err, remainingTTL) {
        if (err) return done(err)
        assert.ok(remainingTTL && (remainingTTL >= 0 && remainingTTL <= 2))
      })
      Persistence.readKey(key, function (reply) {
        if (reply) {
          assert.deepEqual({ foo: 'bar' }, reply)
          done()
        }
      })
    })

    it('should set and not get a single standalone key with expired TTL', function (done) {
      this.timeout(4000)
      const key = 'persistence.messages.object.test'
      const objectValue = {
        foo: 'bar'
      }

      const keyTTL = 1
      Persistence.persistKey(key, objectValue, keyTTL)
      Persistence.redis().ttl(key, function (err, remainingTTL) {
        if (err) return done(err)
        assert.ok(remainingTTL && (remainingTTL >= 0 && remainingTTL <= 2))
      })
      setTimeout(function () {
        Persistence.readKey(key, function (reply) {
          if (!reply) {
            done()
          }
        })
      }, 1500)
    })
  })
})

describe('given the migration is enabled', function () {
  before(function (done) {
    process.env.noverbose = true
    process.env.RADAR_MIGRATION_ENABLED = 'true'
    PersistenceTestHelper.connectWithReplica()

    Persistence.connect(function () {
      client = Persistence.redis()
      Persistence.delWildCard('*', done)
    })
  })

  after(function (done) {
    Persistence.delWildCard('*', function () {
      Persistence.disconnect(function () {
        SentinelHelper.stop({ redis: { ports: [16379] } })
        SentinelHelper.stop({ redis: { ports: [16380] } })
        done()
      })
    })
  })

  describe('after connection', function () {
    it('should be able to get client and subscriber', function () {
      assert.ok(Persistence.redis())
      assert.ok(Persistence.redisReplica())
      assert.ok(Persistence.pubsub())
    })
  })

  describe('while persisting messages to the replica', function () {
    it('should set a single standalone key to the replica', function (done) {
      const key = 'persistence.replica.messages.object.test'
      const objectValue = { foo: 'bar' }

      Persistence.persistKey(key, objectValue)
      Persistence.redisReplica().get(key, (err, result) => {
        if (err) return done(err)
        assert.deepEqual({ foo: 'bar' }, JSON.parse(result))
        done()
      })
    })

    it('should set a single key from a hash to the replica', function (done) {
      const hash = 'persistence.test'
      const key = 'persistence.replica.messages.object.test'
      const objectValue = {
        foo: 'bar'
      }

      Persistence.persistHash(hash, key, objectValue)
      Persistence.redisReplica()
        .hget(hash, key)
        .then((reply) => {
          assert.deepEqual({ foo: 'bar' }, JSON.parse(reply))
          done()
        })
    })

    it('should set a single standalone key with TTL to the replica', function (done) {
      const key = 'persistence.replica.messages.object.test'
      const objectValue = {
        foo: 'bar'
      }

      const keyTTL = 2
      Persistence.persistKey(key, objectValue, keyTTL)
      Persistence.redisReplica().ttl(key, function (err, remainingTTL) {
        if (err) return done(err)
        assert.ok(remainingTTL && (remainingTTL >= 0 && remainingTTL <= 2))
        done()
      })
    })

    it('should set and not get a single standalone key with expired TTL from the replica', function (done) {
      this.timeout(4000)
      const key = 'persistence.replica.messages.object.test'
      const objectValue = {
        foo: 'bar'
      }

      const keyTTL = 2
      Persistence.persistKey(key, objectValue, keyTTL)
      Persistence.redisReplica().ttl(key, function (err, remainingTTL) {
        if (err) return done(err)
        assert.ok(remainingTTL && (remainingTTL >= 0 && remainingTTL <= 2))
      })
      setTimeout(function () {
        Persistence.redisReplica().get(key, (err, result) => {
          if (err) return done(err)
          if (!result) {
            done()
          }
        })
      }, 2500)
    })

    it('should not get a single standalone key after deleting from the replica', function (done) {
      const key = 'persistence.replica.messages.object.test'
      const objectValue = {
        foo: 'bar'
      }

      Persistence.persistKey(key, objectValue)
      Persistence.del(key)
      Persistence.redisReplica().get(key, (err, result) => {
        if (err) return done(err)
        if (!result) {
          done()
        }
      })
    })
  })
})

describe('given reading from replica is enabled', function () {
  before(function (done) {
    process.env.noverbose = true
    process.env.RADAR_MIGRATION_ENABLED = 'true'
    process.env.RADAR_ELASTICACHE_ENABLED = 'true'

    PersistenceTestHelper.connectWithReplica()

    Persistence.connect(function () {
      client = Persistence.redis()
      replicaClient = Persistence.redisReplica()
      Persistence.delWildCard('*', done)
    })
  })

  after(function (done) {
    Persistence.delWildCard('*', function () {
      Persistence.disconnect(function () {
        SentinelHelper.stop({ redis: { ports: [16379] } })
        SentinelHelper.stop({ redis: { ports: [16380] } })
        done()
      })
    })
  })

  describe('readKey', function () {
    it('reads via the replica client', function (done) {
      const key = 'persistence.read.replica.messages.object.test'

      client.set(key, JSON.stringify('this string should NOT be returned'))
      replicaClient.set(key, JSON.stringify('this string should be returned'))
      Persistence.readKey(key, function (result) {
        assert.deepEqual('this string should be returned', result)
        Persistence.delWildCard('*', done)
      })
    })
  })

  describe('readKey with expired TTL', function () {
    it('reads via the replica client', function (done) {
      const multi = client.multi()
      const multiReplica = replicaClient.multi()

      multi.set('k1', JSON.stringify('v1'))
      multi.expire('k1', 10)
      multi.exec()

      multiReplica.set('k2', JSON.stringify('v1'))
      multiReplica.expire('k2', 1)
      multiReplica.exec()

      setTimeout(function () {
        Persistence.readKey('k2', function (result) {
          assert.deepEqual(null, result)
          Persistence.delWildCard('*', done)
        })
      }, 1200)
    })
  })

  describe('readKey with not expired TTL', function () {
    it('reads via the replica client', function (done) {
      const multi = client.multi()
      const multiReplica = replicaClient.multi()

      multi.set('k1', JSON.stringify('v1'))
      multi.expire('k1', 10)
      multi.exec()

      multiReplica.set('k2', JSON.stringify('v2'))
      multiReplica.expire('k2', 2)
      multiReplica.exec()

      setTimeout(function () {
        Persistence.readKey('k2', function (result) {
          assert.deepEqual('v2', result)
          Persistence.delWildCard('*', done)
        })
      }, 500)
    })
  })

  describe('readHashValue', function () {
    it('reads via the replica client', function (done) {
      const hash = 'persistence.test'
      const key = 'persistence.readHashValue.replica.messages.object.test'

      client.hset(hash, key, JSON.stringify('this string should NOT be returned'))
      replicaClient.hset(hash, key, JSON.stringify('this string should be returned'))
      Persistence.readHashValue(hash, key, function (result) {
        assert.deepEqual('this string should be returned', result)
        Persistence.delWildCard('*', done)
      })
    })
  })

  describe('readHashAll', function () {
    it('reads via the replica client', function (done) {
      const hash = 'persistence.test'

      client.hset(hash, 'k1', JSON.stringify('value1'))
      client.hset(hash, 'k2', JSON.stringify('value1'))
      replicaClient.hset(hash, 'k3', JSON.stringify('value3'))
      replicaClient.hset(hash, 'k4', JSON.stringify('value4'))

      Persistence.readHashAll(hash, function (result) {
        assert.deepEqual({ k3: 'value3', k4: 'value4' }, result)
        Persistence.delWildCard('*', done)
      })
    })
  })

  describe('delWildCard', function () {
    it('reads keys via the replica client and delete them', function (done) {
      const key = 'persistence.read.replica.messages.object.test'

      client.set(key, JSON.stringify('this string should NOT be returned'))
      replicaClient.set(key, JSON.stringify('this string should be returned'))

      Persistence.delWildCard('*', function () {
        replicaClient.get(key, function (err, result) {
          if (err) return done(err)
          assert.deepEqual(null, result)
          done()
        })
      })
    })
  })

  describe('keys', function () {
    it('reads keys via the replica client and delete them', function (done) {
      const key = 'persistence.read.messages.object.test'
      const keyReplica = 'persistence.read.replica.messages.object.test'

      client.set(key, JSON.stringify('this string should NOT be returned'))
      replicaClient.set(keyReplica, JSON.stringify('this string should be returned'))

      Persistence.keys('*', function (err, result) {
        if (err) return done(err)
        assert.deepEqual([keyReplica], result)
        done()
      })
    })
  })
})

describe('given reading from replica is not enabled', function () {
  before(function (done) {
    process.env.noverbose = true
    process.env.RADAR_MIGRATION_ENABLED = 'true'
    process.env.RADAR_ELASTICACHE_ENABLED = 'false'

    PersistenceTestHelper.connectWithReplica()

    Persistence.connect(function () {
      client = Persistence.redis()
      replicaClient = Persistence.redisReplica()
      Persistence.delWildCard('*', done)
    })
  })

  after(function (done) {
    Persistence.delWildCard('*', function () {
      Persistence.disconnect(function () {
        SentinelHelper.stop({ redis: { ports: [16379] } })
        SentinelHelper.stop({ redis: { ports: [16380] } })
        done()
      })
    })
  })

  describe('readKey', function () {
    it('reads via the main client', function (done) {
      const key = 'persistence.read.replica.messages.object.test'

      client.set(key, JSON.stringify('this string should be returned'))
      replicaClient.set(key, JSON.stringify('this string should NOT be returned'))
      Persistence.readKey(key, function (result) {
        assert.deepEqual('this string should be returned', result)
        done()
      })
    })
  })
})
