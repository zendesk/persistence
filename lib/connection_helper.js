const Connection = require('./connection.js')

const connections = {}

function ConnectionHelper () {
}

ConnectionHelper.parse = function (configuration) {
  let config = {}; let name = 'default'

  if (!configuration) {
    throw new Error('No configuration provided')
  }

  if (configuration.use_connection) {
    name = configuration.use_connection
    config = configuration.connection_settings && configuration.connection_settings[name]
    if (!config) {
      throw new Error('No connection_settings provided: ' + configuration + ' use_connection: ' + name)
    }
  } else {
    // legacy style
    config.host = configuration.redis_host || 'localhost'
    config.port = configuration.redis_port || 6379
  }
  return { name: name, config: config }
}

ConnectionHelper.connection = function (configuration) {
  const parsed = ConnectionHelper.parse(configuration)

  let connection = connections[parsed.name]

  if (!connection) {
    connection = new Connection(parsed.name, parsed.config)
    connections[parsed.name] = connection
  }
  return connection
}

ConnectionHelper.destroyConnection = function (configuration, done) {
  const name = ConnectionHelper.parse(configuration).name
  const connection = connections[name]
  if (!connection || !connection.name) {
    done(new Error('No connection found'))
    return
  }

  connection.teardown(function () {
    delete connections[connection.name]
    done()
  })
}

module.exports = ConnectionHelper
