const SentinelHelper = require('simple_sentinel')
const Persistence = require('../lib/persistence.js')

function PersistenceTestHelper (scope) {
  this.scope = scope
}

PersistenceTestHelper.prototype.connectWithReplica = function () {
  const configurationWithReplica = {
    connection_settings: {
      withReplica: {
        host: 'localhost',
        port: 16379,
        redisReplicaUrl: { host: 'localhost', port: 16380 }
      }
    }
  }
  const config = JSON.parse(JSON.stringify(configurationWithReplica))

  config.use_connection = 'withReplica'
  SentinelHelper.start({ redis: { ports: [16379] } })
  SentinelHelper.start({ redis: { ports: [16380] } })
  Persistence.setConfig(config)
}

module.exports = new PersistenceTestHelper()
