const Persistence = require('./persistence.js')
const IdGen = require('./id_gen.js')
const List = require('./list.js')
const Lock = require('./lock.js')

Persistence.IdGen = IdGen
Persistence.Lock = Lock
Persistence.List = List
module.exports = Persistence
