const ConnectionHelper = require('../lib/connection_helper.js')
const assert = require('assert')
const configuration = require('../configuration.example.js')

describe('Given a configuration to Connection Helper', function () {
  beforeEach(function () {
    this.configuration = JSON.parse(JSON.stringify(configuration))
  })
  describe('if use_connection is present', function () {
    it('should parse redis config correctly', function () {
      this.configuration.use_connection = 'redis'
      this.configuration.connection_settings.redis.port = 6380
      const parsed = ConnectionHelper.parse(this.configuration)
      assert.equal(parsed.name, 'redis')
      assert.deepEqual(parsed.config, {
        host: 'localhost',
        port: 6380
      })
    })
    it('should parse sentinel config correctly', function () {
      this.configuration.use_connection = 'sentinel'
      const parsed = ConnectionHelper.parse(this.configuration)
      assert.equal(parsed.name, 'sentinel')
      assert.deepEqual(parsed.config, {
        id: 'mymaster',
        sentinels: [{ host: 'localhost', port: 26379 }, { host: 'localhost', port: 26380 }, { host: 'localhost', port: 26381 }]
      })
    })
    it('should throw error if missing from connection_settings', function () {
      const self = this
      this.configuration.use_connection = 'non-existing'
      assert.throws(function () {
        ConnectionHelper.parse(self.configuration)
      }, /No connection_settings provided/)
    })
  })

  describe('if use_connection is not present', function () {
    it('should fallback to legacy style', function () {
      delete this.configuration.use_connection
      const parsed = ConnectionHelper.parse(this.configuration)
      assert.equal(parsed.name, 'default')
      assert.deepEqual(parsed.config, {
        host: 'localhost',
        port: 6379
      })
    })
  })
})
