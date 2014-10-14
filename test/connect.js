var Persistence = require('../lib/persistence.js');
var configuration = require('../configuration.example.js');

configuration.use_connection = 'sentinel';

Persistence.setConfig(configuration);
process.on('message', function(message) {
  if(message === 'connect') {
    Persistence.connect(function() {
      process.send('connected');
    });
  }
});
