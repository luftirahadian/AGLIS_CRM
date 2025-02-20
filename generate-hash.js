const bcrypt = require('bcrypt');

const password = 'noc#2024';
const hashedPassword = bcrypt.hashSync(password, 10);
console.log(hashedPassword);
