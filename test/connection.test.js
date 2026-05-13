const assert = require('assert')
const ConnectionHelper = require('../lib/connection_helper.js')
const SentinelHelper = require('simple_sentinel')
const { execSync } = require('child_process')

function gracefulShutdown (ports) {
  // Shutdown all processes first via redis-cli (graceful shutdown)
  ports.forEach(port => {
    try {
      execSync(`redis-cli -p ${port} shutdown nosave`, { stdio: 'ignore', timeout: 2000 })
    } catch {
      // Process may already be down
    }
  })
  // Wait for processes to fully exit before allowing file cleanup
  ports.forEach(port => {
    for (let i = 0; i < 20; i++) {
      try {
        execSync(`redis-cli -p ${port} ping`, { stdio: 'ignore', timeout: 500 })
        execSync('sleep 0.1')
      } catch {
        break
      }
    }
  })
}

describe('given a ConnectionHelper', function () {
  const configuration = {
    connection_settings: {
      redis: {
        host: 'localhost',
        port: 16379
      },
      sentinel: {
        // sentinel master name is required
        id: 'mymaster',
        sentinels: [
          {
            host: 'localhost',
            port: 26379
          },
          {
            host: 'localhost',
            port: 26380
          },
          {
            host: 'localhost',
            port: 26381
          }]
      }
    }
  }
  describe('with redis configuration', function () {
    const helperConfig = {
      redis: {
        ports: [16379]
      }
    }
    before(function () {
      SentinelHelper.start(helperConfig)
    })
    after(function () {
      SentinelHelper.stop(helperConfig)
    })
    it('should connect', function (done) {
      const config = JSON.parse(JSON.stringify(configuration))
      config.use_connection = 'redis'

      const connection = ConnectionHelper.connection(config)
      connection.establish(function () {
        assert.deepEqual(connection.config, { host: 'localhost', port: 16379, enableReadyCheck: true })
        connection.teardown(function () {
          ConnectionHelper.destroyConnection(config, done)
        })
      })
    })
    it('should reuse existing connection', function (done) {
      const config = JSON.parse(JSON.stringify(configuration))
      config.use_connection = 'redis'

      const connection = ConnectionHelper.connection(config)
      connection.establish(function () {
        assert.deepEqual(connection.config, { host: 'localhost', port: 16379, enableReadyCheck: true })
        assert.deepEqual(connection, ConnectionHelper.connection(config))
        connection.teardown(function () {
          ConnectionHelper.destroyConnection(config, done)
        })
      })
    })
  })

  describe('with sentinel configuration', function () {
    const helperConfig = {
      redis: {
        ports: [16379, 16380, 16381]
      },
      sentinel: {
        ports: [26379, 26380, 26381]
      }
    }
    before(function () {
      this.timeout(10000)
      SentinelHelper.start(helperConfig)
    })
    after(function (done) {
      this.timeout(10000)
      // Gracefully shutdown processes and wait for them to exit before cleanup
      // This avoids a race condition in simple_sentinel where rm -rf runs before processes fully exit
      gracefulShutdown([...helperConfig.sentinel.ports, ...helperConfig.redis.ports])
      SentinelHelper.stop(helperConfig)
      done()
    })

    it('should connect', function (done) {
      const config = JSON.parse(JSON.stringify(configuration))
      config.use_connection = 'sentinel'
      const connection = ConnectionHelper.connection(config)
      connection.establish(function () {
        assert.equal(connection.config.id, configuration.connection_settings.sentinel.id)

        const expectedSentinels = new Set(configuration.connection_settings.sentinel.sentinels)
        const receivedSentinels = new Set(connection.config.sentinels)
        assert.deepStrictEqual(receivedSentinels, expectedSentinels)
        connection.teardown(function () {
          ConnectionHelper.destroyConnection(config, done)
        })
      })
    })

    it('should reuse existing connection', function (done) {
      const config = JSON.parse(JSON.stringify(configuration))
      config.use_connection = 'sentinel'

      const connection = ConnectionHelper.connection(config)

      connection.establish(function () {
        assert.deepEqual(connection, ConnectionHelper.connection(config))
        connection.teardown(function () {
          ConnectionHelper.destroyConnection(config, done)
        })
      })
    })
  })
  describe('given a connection', function () {
    let connection
    const config = JSON.parse(JSON.stringify(configuration))
    config.use_connection = 'redis'

    const helperConfig = {
      redis: {
        ports: [16379]
      }
    }
    before(function (done) {
      process.env.noverbose = true
      SentinelHelper.start(helperConfig)
      connection = ConnectionHelper.connection(config)
      connection.establish(done)
    })
    after(function (done) {
      ConnectionHelper.destroyConnection(config, done)
      process.env.noverbose = true
      SentinelHelper.stop(helperConfig)
    })
    it('should not create different clients for multiple establish calls', function (done) {
      let client1, client2
      connection.establish(function () {
        client1 = connection.client
      })
      connection.establish(function () {
        client2 = connection.client
        assert.equal(client1, client2)
        done()
      })
    })
  })
})
