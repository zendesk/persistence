var Persistence = require('./persistence.js'),
    Lock = require('./lock.js');

Persistence.Lock = Lock;
require('./list.js');
module.exports = Persistence;
