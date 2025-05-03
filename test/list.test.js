const assert = require('assert')
const SentinelHelper = require('simple_sentinel')
const Persistence = require('../lib/index.js')
const PersistenceTestHelper = require('./persistence_test_helper.test.js')
const IdGen = require('../lib/id_gen.js')

function validateList (list, done) {
  const parsed = []
  Persistence.redis().lrange('test-list', 0, -1, function (error, entries) {
    if (error) {
      throw new Error(error)
    }
    entries.forEach(function (entry) {
      parsed.push(JSON.parse(entry))
    })
    assert.deepEqual(parsed, list)
    done()
  })
}

function validateReplicaList (list, done) {
  const parsed = []
  Persistence.redisReplica().lrange('test-list', 0, -1, function (error, entries) {
    if (error) {
      throw new Error(error)
    }
    entries.forEach(function (entry) {
      parsed.push(JSON.parse(entry))
    })
    assert.deepEqual(parsed, list)
    done()
  })
}

describe('given a list', function () {
  let list

  before(function (done) {
    process.env.noverbose = true
    SentinelHelper.start({ redis: { ports: [16479] } })
    Persistence.setConfig({ redis_host: 'localhost', redis_port: 16479 })
    Persistence.connect(function () {
      Persistence.delWildCard('*', done)
    })
  })

  after(function (done) {
    Persistence.delWildCard('*', function () {
      Persistence.disconnect(function () {
        SentinelHelper.stop({ redis: { ports: [16479] } })
        done()
      })
    })
  })

  beforeEach(function (done) {
    list = new Persistence.List('test-list', 3600, 3)
    Persistence.delWildCard('*', done)
  })

  afterEach(function (done) {
    Persistence.delWildCard('*', done)
  })

  function ListSubscriber (list) {
    this.notifications = []
    this.list = list
    this.subscriber = Persistence.pubsub()

    this.start = function () {
      const listSub = this
      this.subscriber.subscribe(this.list)
      this.subscriber.on('message', function (channel, message) {
        listSub.notifications.push(JSON.parse(message))
      })
    }

    this.validate = function (l) {
      this.subscriber.unsubscribe()
      this.subscriber.removeAllListeners('message')
      assert.deepEqual(l, this.notifications)
    }
  }

  describe('when pushing new entries', function () {
    it('should be able to stamp incrementing ids properly', function (done) {
      list.push({ value: 'hi' }, function (err, m) {
        assert.ok(!err)
        assert.equal(m.id, 1)
      })
      list.push({ value: 'world' }, function (err, m) {
        assert.ok(!err)
        assert.equal(m.id, 2)
        validateList([{ value: 'hi', id: 1 }, { value: 'world', id: 2 }], done)
      })
    })

    it('should also publish to redis', function (done) {
      const l = new ListSubscriber('test-list')
      l.start()
      list.push({ value: 'hi' })
      list.push({ value: 'world' })
      setTimeout(function () {
        l.validate([{ value: 'hi', id: 1 }, { value: 'world', id: 2 }])
        done()
      }, 100)
    })

    describe('concurrently with another process', function () {
      it('should wait for push to complete', function (done) {
        const lock = new Persistence.Lock('persistence_lock:/id_gen:/test-list')
        lock.acquire() // hold the lock to simulate another push going on
        let pushable = false

        list.push({ value: 'hi' }, function (err, message) {
          assert.ok(pushable) // is false in the beginning and true after success
          assert.ok(!err)
          assert.deepEqual(message, { value: 'hi', id: 1 })
          done()
        })
        setTimeout(function () {
          pushable = true
          lock.release()
          list.unblock() // poke the list to try again
        }, 500)
      })
    })

    describe('when reading/getting info', function () {
      beforeEach(function (done) {
        list.push({ value: 10 })
        list.push({ value: 20 })
        list.push({ value: 30 }, function () {
          setTimeout(done, 50)
        })
      })
      it('should get info correctly', function (done) {
        list.info(function (err, start, end, length) {
          assert.equal(err, null)
          assert.equal(start, 1)
          assert.equal(end, 3)
          assert.equal(length, 3)
          done()
        })
      })

      it('should read from correctly', function (done) {
        list.info(function (err, start, end, length) {
          if (err) {
            throw new Error(err)
          }
          list.read(2, start, end, length, function (err, list) {
            assert.ok(!err)
            assert.deepEqual(list, [{ value: 30, id: 3 }])
            done()
          })
        })
      })

      it('should return with error if out of bounds', function (done) {
        list.info(function (err, start, end, length) {
          if (err) {
            throw new Error(err)
          }
          list.read(5, start, end, length, function (err, list) {
            assert.equal(err, 'sync-error')
            assert.ok(!list)
            done()
          })
        })
      })

      describe('when configured for fixed length', function () {
        beforeEach(function (done) {
          list.push({ value: 40 })
          list.push({ value: 50 }, function () {
            setTimeout(done, 50)
          })
        })

        it('should correctly trim the list to the right length', function (done) {
          list.info(function (err, start, end, length) {
            assert.equal(err, null)
            assert.equal(start, 3)
            assert.equal(end, 5)
            assert.equal(length, 3)
            list.read(null, start, end, length, function (err, list) {
              assert.ok(!err)
              assert.deepEqual(list, [{ value: 30, id: 3 }, { value: 40, id: 4 }, { value: 50, id: 5 }])
              done()
            })
          })
        })
      })
    })
  })
})

describe('given migration is enabled', function () {
  let list
  before(function (done) {
    process.env.noverbose = true
    process.env.RADAR_MIGRATION_ENABLED = 'true'
    PersistenceTestHelper.connectWithReplica()

    Persistence.connect(function () {
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

  beforeEach(function (done) {
    list = new Persistence.List('test-list', 3600, 3)
    Persistence.delWildCard('*', done)
  })

  afterEach(function (done) {
    Persistence.delWildCard('*', done)
  })

  describe('when pushing new entries', function () {
    it('should be able to stamp incrementing ids properly', function (done) {
      list.push({ value: 'test' }, function (err, m) {
        assert.ok(!err)
        assert.equal(m.id, 1)
        validateList([{ id: 1, value: 'test' }], function () {})
        validateReplicaList([{ id: 1, value: 'test' }], done)
      })
    })
  })
})

describe('given reading from replica is enabled', function () {
  let list
  before(function (done) {
    process.env.noverbose = true
    process.env.RADAR_MIGRATION_ENABLED = 'true'
    process.env.RADAR_ELASTICACHE_ENABLED = 'true'
    PersistenceTestHelper.connectWithReplica()

    Persistence.connect(function () {
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

  beforeEach(function (done) {
    list = new Persistence.List('test-list', 3600, 3)
    Persistence.delWildCard('*', done)
  })

  afterEach(function (done) {
    Persistence.delWildCard('*', done)
  })

  describe('when read', function () {
    it('should read from replica', function (done) {
      const multi = Persistence.redis().multi()
      const multiReplica = Persistence.redisReplica().multi()
      const value = { value: 'test' }
      const replicaValue = { value: 'replica-test' }
      const entry = JSON.parse(JSON.stringify(value))
      const replicaEntry = JSON.parse(JSON.stringify(replicaValue))
      const idGen = new IdGen('id_gen:/' + list.name)

      idGen.alloc(function (err, value) {
        assert.ok(!err)
        entry.id = value
        multi.rpush(list.name, JSON.stringify(entry), Persistence.handler)
        multi.exec()

        replicaEntry.id = value
        multiReplica.rpush(list.name, JSON.stringify(replicaEntry), Persistence.handler)
        multiReplica.exec()

        list.read(0, 0, 1, 1, function (err, list) {
          assert.ok(!err)
          assert.deepEqual(list, [{ value: 'replica-test', id: 1 }])
          done()
        })
      })
    })

    it('should get info correctly from the replica', function (done) {
      const multiReplica = Persistence.redisReplica().multi()
      const replicaValue = { value: 'replica-test2' }
      const replicaEntry = JSON.parse(JSON.stringify(replicaValue))
      const idGen = new IdGen('id_gen:/' + list.name)

      idGen.alloc(function (err, value) {
        if (err) return done(err)
        replicaEntry.id = value
        multiReplica.rpush(list.name, JSON.stringify(replicaEntry), Persistence.handler)
        multiReplica.exec()

        list.info(function (err, start, end, length) {
          assert.equal(err, null)
          assert.equal(start, 2)
          assert.equal(end, 2)
          assert.equal(length, 1)
          done()
        })
      })
    })
  })
})
