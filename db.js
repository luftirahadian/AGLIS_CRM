const mysql = require('mysql2');

// Koneksi ke database
const dbConnection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'crm_ticketing'
});

// Menghubungkan ke database
dbConnection.connect((err) => {
    if (err) {
        console.error('Error connecting to the database:', err);
        return;
    }
    console.log('Connected to MySQL Database');
});

module.exports = dbConnection; // Ekspor koneksi untuk digunakan di file lain 