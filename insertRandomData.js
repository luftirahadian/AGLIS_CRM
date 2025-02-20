const mysql = require('mysql2');
const db = require('./db');

// Fungsi untuk menghasilkan data acak
function generateRandomData() {
    const noTiket = `TKT-${Math.floor(Math.random() * 10000).toString().padStart(5, '0')}`;
    const cid = Math.floor(Math.random() * 1000000000).toString();
    const nama = `Nama ${Math.floor(Math.random() * 100)}`;
    const alamat = `Alamat ${Math.floor(Math.random() * 100)} No. ${Math.floor(Math.random() * 10)}`;
    const noHp = `08${Math.floor(Math.random() * 1000000000).toString()}`;
    const komplain = `Komplain ${Math.floor(Math.random() * 10)}`;
    const pelapor = `Pelapor ${Math.floor(Math.random() * 10)}`;
    const tanggalLaporan = new Date().toISOString().slice(0, 10); // Tanggal hari ini
    const status = Math.random() > 0.5 ? 'Terbuka' : 'Selesai';
    
    return [
        noTiket, cid, nama, alamat, noHp, komplain, pelapor, tanggalLaporan, status
    ];
}

// Koneksi ke database
const dbConnection = mysql.createConnection({
    host: 'localhost',
    user: 'root', // ganti dengan username MySQL Anda
    password: 'root', // ganti dengan password MySQL Anda
    database: 'crm_ticketing' // ganti dengan nama database Anda
});

// Menghubungkan ke database
dbConnection.connect((err) => {
    if (err) throw err;
    console.log('Connected to MySQL Database');

    // Hapus semua data dari tabel tickets
    dbConnection.query('DELETE FROM tickets', (err, result) => {
        if (err) {
            console.error('Error deleting tickets:', err);
            return;
        }
        console.log('All tickets deleted successfully');

        // Menyiapkan query untuk insert data
        const query = 'INSERT INTO tickets (no_tiket, cid, nama, alamat, no_hp, komplain, pelapor, tanggal_laporan, status) VALUES ?';
        const values = [];

        // Menghasilkan 20 data acak dengan nomor tiket berurutan
        for (let i = 1; i <= 20; i++) {
            const no_tiket = `TKT-${i.toString().padStart(3, '0')}`; // Format nomor tiket berurutan
            const cid = Math.floor(Math.random() * 1000000000).toString();
            const nama = `Nama ${Math.floor(Math.random() * 100)}`;
            const alamat = `Alamat ${Math.floor(Math.random() * 100)} No. ${Math.floor(Math.random() * 10)}`;
            const no_hp = `08${Math.floor(Math.random() * 1000000000).toString()}`;
            const komplain = `Komplain ${Math.floor(Math.random() * 10)}`;
            const pelapor = `Pelapor ${Math.floor(Math.random() * 10)}`;
            const tanggal_laporan = new Date().toISOString().slice(0, 10); // Tanggal hari ini
            const status = i % 2 === 0 ? 'Selesai' : 'Terbuka'; // Setiap tiket genap ditutup

            values.push([no_tiket, cid, nama, alamat, no_hp, komplain, pelapor, tanggal_laporan, status]);
        }

        // Menjalankan query untuk insert data
        dbConnection.query(query, [values], (err, result) => {
            if (err) throw err;
            console.log(`${result.affectedRows} records inserted`);
            dbConnection.end(); // Menutup koneksi
        });
    });
}); 