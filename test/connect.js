var Persistence = require('../persistence.js');
var configuration = require('../configuration.example.js');

configuration.use_connection = 'sentinel';

Persistence.setConfig(configuration);
process.on('message', function(message) {
  if(message === 'connect') {
    Persistence.connect(function() {
      process.send('connected');
    });
  }
  else if (message === 'test_error')
  {
    Persistence.handler({ msg: 'error msg' });
  }
});
