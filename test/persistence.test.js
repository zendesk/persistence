const assert = require('assert')
const SentinelHelper = require('simple_sentinel')
const Persistence = require('../lib/persistence.js')
let client
const proxyquire = require('proxyquire')

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

      const keyTTL = 2
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
      }, 2500)
    })
  })
})
