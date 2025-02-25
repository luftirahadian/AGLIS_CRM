const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
// const dbConnection = require('./db'); // Mengimpor koneksi dari db.js
// const tickets = require('./dummyData'); // Impor dummy data tiket
const mysql = require('mysql2');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;

// Koneksi ke database
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root', // Ganti dengan username database Anda
    password: 'Gapura#2024!!', // Ganti dengan password database Anda
    database: 'crm_ticketing'
});

db.connect(err => {
    if (err) {
        console.error('Error connecting to the database:', err);
        return;
    }
    console.log('Connected to the database.');
});

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: 'your_secret_key', resave: false, saveUninitialized: true }));

// Middleware untuk menyimpan rute aktif
app.use((req, res, next) => {
    res.locals.activeRoute = req.path; // Menyimpan rute aktif
    next();
});

// Middleware untuk memeriksa autentikasi
function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        return next(); // Jika pengguna sudah login, lanjutkan ke rute berikutnya
    }
    res.redirect('/login'); // Jika tidak, alihkan ke halaman login
}

// Middleware untuk memeriksa role
function checkRole(role) {
    return (req, res, next) => {
        if (req.session.userRole === role) {
            return next(); // Jika role sesuai, lanjutkan
        }
        res.redirect('/'); // Jika tidak, arahkan ke halaman utama atau halaman lain
    };
}

// Tambahkan fungsi ini di atas route Anda
function formatDateTime(dateString) {
    const optionsDate = { year: 'numeric', month: 'long', day: 'numeric' };
    const optionsTime = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    const date = new Date(dateString);
    const formattedDate = date.toLocaleDateString('id-ID', optionsDate);
    const formattedTime = date.toLocaleTimeString('id-ID', optionsTime);
    return `${formattedDate} ${formattedTime}`;
}

// Route untuk halaman utama
app.get('/', isAuthenticated, (req, res) => {
    // Ambil data dari database atau hitung total tiket
    const queryTotalTickets = 'SELECT COUNT(*) AS total FROM tickets';
    const queryOpenTickets = 'SELECT COUNT(*) AS total FROM tickets WHERE status = "Terbuka"';
    const queryClosedTickets = 'SELECT COUNT(*) AS total FROM tickets WHERE status = "Selesai"';

    db.query(queryTotalTickets, (err, totalResult) => {
        if (err) {
            console.error('Error fetching total tickets:', err);
            return res.status(500).send('Error fetching total tickets');
        }

        db.query(queryOpenTickets, (err, openResult) => {
            if (err) {
                console.error('Error fetching open tickets:', err);
                return res.status(500).send('Error fetching open tickets');
            }

            db.query(queryClosedTickets, (err, closedResult) => {
                if (err) {
                    console.error('Error fetching closed tickets:', err);
                    return res.status(500).send('Error fetching closed tickets');
                }

                // Kirim data ke tampilan
                res.render('index', {
                    totalTickets: totalResult[0].total,
                    totalOpenTickets: openResult[0].total,
                    totalClosedTickets: closedResult[0].total,
                    userRole: req.session.userRole
                });
            });
        });
    });
});

// Route untuk menampilkan daftar tiket
app.get('/list', isAuthenticated, (req, res) => {
    const query = 'SELECT *, createdAt FROM tickets'; // Mengambil semua tiket termasuk createdAt
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching tickets:', err);
            return res.status(500).send('Error fetching tickets');
        }
        // Kirim fungsi formatDateTime ke tampilan
        res.render('list', { tickets: results, formatDateTime, userRole: req.session.userRole }); // Mengirim data tiket dan fungsi ke tampilan
    });
});

// Route untuk mendapatkan statistik tiket
app.get('/statistic', isAuthenticated, checkRole('admin'), (req, res) => {
    const sql = "SELECT status, COUNT(*) as count FROM tickets GROUP BY status";
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error fetching statistics: ", err);
            return res.status(500).send("Error fetching statistics");
        }

        // Hitung total tiket
        const totalTickets = results.reduce((acc, stat) => acc + stat.count, 0);
        const totalOpenTickets = results.find(stat => stat.status === 'Terbuka')?.count || 0;
        const totalClosedTickets = results.find(stat => stat.status === 'Selesai')?.count || 0;

        console.log("Total Tiket:", totalTickets);
        console.log("Tiket Terbuka:", totalOpenTickets);
        console.log("Tiket Selesai:", totalClosedTickets);

        // Kirim data ke tampilan
        res.render('statistic', {
            statistics: results,
            totalTickets,
            totalOpenTickets,
            totalClosedTickets,
            userRole: req.session.userRole
        });
    });
});

function getNewTicketNumber(callback) {
    const queryLastTicket = 'SELECT no_tiket FROM tickets ORDER BY id DESC LIMIT 1';
    db.query(queryLastTicket, (err, results) => {
        if (err) {
            return callback(err);
        }

        let newTicketNumber = 'TKT-00001'; // Default jika tidak ada tiket
        if (results.length > 0) {
            const lastTicketNumber = results[0].no_tiket;
            const lastNumber = parseInt(lastTicketNumber.split('-')[1]) + 1; // Ambil nomor terakhir dan tambahkan 1
            newTicketNumber = `TKT-${lastNumber.toString().padStart(5, '0')}`; // Format nomor tiket baru
        }

        console.log('New Ticket Number:', newTicketNumber);
        callback(null, newTicketNumber);
    });
}

// Route untuk membuat tiket
app.get('/create', isAuthenticated, checkRole('admin'), (req, res) => {
    getNewTicketNumber((err, newTicketNumber) => {
        if (err) {
            console.error('Error fetching last ticket number:', err);
            return res.status(500).send('Error fetching last ticket number');
        }
        const createdAt = new Date(); // Atau ambil dari database jika perlu
        res.render('create', { newTicketNumber, createdAt, userRole: req.session.userRole, formatDateTime });
    });
});

// Route untuk membuat tiket
app.post('/ticket/create', isAuthenticated, (req, res) => {
    getNewTicketNumber((err, newTicketNumber) => {
        if (err) {
            console.error('Error fetching last ticket number:', err);
            return res.status(500).send('Error fetching last ticket number');
        }

        const { cid, nama, alamat, no_hp, komplain, pelapor } = req.body;

        // Pastikan status selalu diatur ke 'Terbuka'
        const status = 'Terbuka';

        const sql = 'INSERT INTO tickets (no_tiket, cid, nama, alamat, no_hp, komplain, pelapor, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
        const values = [newTicketNumber, cid, nama, alamat, no_hp, komplain, pelapor, status];

        db.query(sql, values, (err, result) => {
            if (err) {
                console.error('Error creating ticket:', err);
                return res.status(500).send('Error creating ticket');
            }
            res.send({ success: true }); // Kirim respons sukses
        });
    });
});

// Route untuk menampilkan detail tiket
app.get('/ticket/:id', isAuthenticated, (req, res) => {
    const ticketId = parseInt(req.params.id); // Ambil ID dari parameter URL
    const query = 'SELECT * FROM tickets WHERE id = ?'; // Query untuk mengambil tiket berdasarkan ID
    db.query(query, [ticketId], (err, results) => {
        if (err) {
            console.error('Error fetching ticket:', err);
            return res.status(500).send('Error fetching ticket');
        }
        const ticket = results[0];
        if (ticket) {
            res.json(ticket); // Mengirim detail tiket sebagai respons
        } else {
            res.status(404).send('Ticket not found'); // Jika tiket tidak ditemukan
        }
    });
});

// Route untuk menampilkan halaman edit tiket
app.get('/ticket/edit/:id', isAuthenticated, (req, res) => {
    const ticketId = req.params.id;
    const query = 'SELECT * FROM tickets WHERE id = ?';
    db.query(query, [ticketId], (err, results) => {
        if (err) {
            console.error('Error fetching ticket details:', err);
            return res.status(500).send('Error fetching ticket details');
        }
        if (results.length > 0) {
            const ticket = results[0];
            console.log('Ticket data:', ticket); // Tambahkan log ini untuk memeriksa data tiket
            res.render('edit', { ticket, userRole: req.session.userRole, formatDateTime }); // Kirim fungsi ke tampilan
        } else {
            res.status(404).send('Ticket not found'); // Jika tiket tidak ditemukan
        }
    });
});

// Route untuk mengupdate tiket
app.post('/ticket/update/:id', isAuthenticated, (req, res) => {
    const ticketId = req.params.id;
    const { no_tiket, cid, nama, alamat, no_hp, komplain, pelapor, status, jenis_gangguan, jenis_perbaikan, lokasi_odp, lokasi_closure, jarak_kabel, redaman_terakhir, nama_wifi, password_wifi, keterangan, teknisi } = req.body;

    // Validasi di sisi server
    if (!status || !jenis_gangguan || !jenis_perbaikan || !lokasi_odp || !lokasi_closure || !jarak_kabel || !redaman_terakhir || !nama_wifi || !password_wifi || !keterangan || !teknisi) {
        return res.status(400).send('Semua field yang diperlukan harus diisi.');
    }

    // SQL untuk memperbarui tiket
    const sql = `UPDATE tickets SET 
        jenis_gangguan = ?,
        jenis_perbaikan = ?,
        lokasi_odp = ?,
        lokasi_closure = ?,
        jarak_kabel = ?,
        redaman_terakhir = ?,
        nama_wifi = ?,
        password_wifi = ?,
        keterangan = ?,
        teknisi = ?,
        status = ? 
        WHERE id = ?`;

    const values = [jenis_gangguan, jenis_perbaikan, lokasi_odp, lokasi_closure, jarak_kabel, redaman_terakhir, nama_wifi, password_wifi, keterangan, teknisi, status, ticketId];

    console.log('Data yang diterima untuk pembaruan:', req.body);

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error('Error updating ticket:', err);
            return res.status(500).send('Error updating ticket');
        }
        res.redirect('/list'); // Redirect ke halaman daftar tiket setelah berhasil
    });
});

// Route untuk halaman login
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// Route untuk menangani login
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    db.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
        if (err) {
            console.error('Error fetching user:', err);
            return res.render('login', { error: 'Terjadi kesalahan server. Silakan coba lagi.' });
        }

        if (results.length > 0) {
            const user = results[0];
            if (bcrypt.compareSync(password, user.password)) {
                // Login berhasil
                req.session.userId = user.id;
                req.session.userRole = user.role;
                return res.redirect('/');
            } else {
                // Password salah
                return res.render('login', { error: 'Email atau password salah.' });
            }
        } else {
            // Pengguna tidak ditemukan
            return res.render('login', { error: 'Email atau password salah.' });
        }
    });
});

// Route untuk halaman pengelolaan pengguna
app.get('/users', isAuthenticated, checkRole('admin'), (req, res) => {
    db.query('SELECT * FROM users', (err, users) => {
        if (err) return res.status(500).send('Error fetching users');
        res.render('user-management', { users, userRole: req.session.userRole });
    });
});

// Route untuk menambah pengguna
app.post('/users/add', (req, res) => {
    const { name, email, password, role } = req.body;
    const hashedPassword = bcrypt.hashSync(password, 10);

    db.query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', 
        [name, email, hashedPassword, role], (err) => {
            if (err) return res.status(500).send('Error adding user');
            res.send({ success: true });
        });
});

// Route untuk menghapus pengguna
app.post('/users/delete', (req, res) => {
    const { id } = req.body;
    db.query('DELETE FROM users WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).send('Error deleting user');
        res.send({ success: true });
    });
});

// Route untuk logout
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.redirect('/'); // Redirect ke halaman utama jika ada kesalahan
        }
        res.clearCookie('connect.sid'); // Hapus cookie sesi jika ada
        res.redirect('/login'); // Redirect ke halaman login setelah logout
    });
});

// Route untuk memperbarui status tiket
app.post('/tickets/update', isAuthenticated, (req, res) => {
    const { ticketId, status } = req.body;
    let sql = 'UPDATE tickets SET status = ?';
    const params = [status];

    if (status === 'Terbuka') {
        sql += ', tanggal_perbaikan = NULL';
    } else {
        sql += ', tanggal_perbaikan = NOW()';
    }

    sql += ' WHERE id = ?';
    params.push(ticketId);

    db.query(sql, params, (err) => {
        if (err) return res.status(500).send('Error updating ticket');
        res.send({ success: true });
    });
});

// Route untuk memperbarui pengguna
app.post('/users/update', isAuthenticated, (req, res) => {
    const { id, name, email, role, password } = req.body;
    let query = 'UPDATE users SET name = ?, email = ?, role = ?';
    const values = [name, email, role];

    if (password) {
        const hashedPassword = bcrypt.hashSync(password, 10);
        query += ', password = ?';
        values.push(hashedPassword);
    }

    query += ' WHERE id = ?';
    values.push(id);

    db.query(query, values, (err) => {
        if (err) return res.status(500).send('Error updating user');
        res.send({ success: true });
    });
});

// Mulai server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
