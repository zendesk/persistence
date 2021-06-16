module.exports = {
  // (optional) Only usable if you define use_connection.
  // Lets you specify a number of redis options and pick one.
  connection_settings: {
    redis: {
      host: 'localhost',
      port: 6379
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
  },

  // Select the config to use
  use_connection: 'redis'
}
