const bcrypt = require('bcrypt');

const password = 'noc@2024!!'; // Password yang ingin di-hash

bcrypt.hash(password, 10, (err, hash) => {
    if (err) {
        console.error('Error hashing password:', err);
    } else {
        console.log('Hashed Password:', hash);
    }
});