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
    res.redirect('/login'); // Jika tidak, arahkan ke halaman login
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
    const query = 'SELECT *, DATE_FORMAT(tanggal_laporan, "%Y-%m-%d %H:%i:%s") AS tanggal_laporan FROM tickets'; // Mengambil semua tiket
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
        res.render('create', { newTicketNumber, userRole: req.session.userRole }); // Kirim nomor tiket baru ke tampilan
    });
});

// Route untuk membuat tiket
app.post('/ticket/create', isAuthenticated, (req, res) => {
    getNewTicketNumber((err, newTicketNumber) => {
        if (err) {
            console.error('Error fetching last ticket number:', err);
            return res.status(500).send('Error fetching last ticket number');
        }

        const newTicket = {
            no_tiket: newTicketNumber,
            cid: req.body.cid,
            nama: req.body.nama,
            alamat: req.body.alamat,
            no_hp: req.body.no_hp,
            komplain: req.body.komplain,
            pelapor: req.body.pelapor,
            tanggal_laporan: req.body.tanggal_laporan || new Date().toISOString().slice(0, 10),
            jenis_gangguan: req.body.jenis_gangguan || null,
            jenis_perbaikan: req.body.jenis_perbaikan || null,
            lokasi_odp: req.body.lokasi_odp || null,
            lokasi_closure: req.body.lokasi_closure || null,
            jarak_kabel: req.body.jarak_kabel || null,
            redaman_terakhir: req.body.redaman_terakhir || null,
            nama_wifi: req.body.nama_wifi || null,
            password_wifi: req.body.password_wifi || null,
            keterangan: req.body.keterangan || null,
            tanggal_perbaikan: req.body.status === 'Terbuka' ? null : req.body.tanggal_perbaikan, // Kosongkan jika status 'Terbuka'
            teknisi: req.body.teknisi || null,
            status: 'Terbuka', // Set status default ke Terbuka
        };

        const query = 'INSERT INTO tickets SET ?';
        db.query(query, newTicket, (err, result) => {
            if (err) {
                console.error('Error creating ticket:', err);
                return res.status(500).send('Error creating ticket');
            }
            res.redirect('/list'); // Redirect ke halaman daftar tiket setelah berhasil
        });
    });
});

// Route untuk menampilkan detail tiket
app.get('/ticket/:id', isAuthenticated, (req, res) => {
    console.log('Fetching ticket with ID:', req.params.id); // Tambahkan log ini
    const ticketId = parseInt(req.params.id); // Ambil ID dari parameter URL
    const query = 'SELECT * FROM tickets WHERE id = ?'; // Query untuk mengambil tiket berdasarkan ID
    db.query(query, [ticketId], (err, results) => {
        if (err) {
            console.error('Error fetching ticket details:', err);
            return res.status(500).send('Error fetching ticket details');
        }
        if (results.length > 0) {
            res.json(results[0]); // Mengirim detail tiket sebagai respons
        } else {
            res.status(404).send('Ticket not found'); // Jika tiket tidak ditemukan
        }
    });
});

// Route untuk menampilkan halaman edit tiket
app.get('/ticket/edit/:id', isAuthenticated, (req, res) => {
    const ticketId = req.params.id;
    // Ambil tiket dari database
    const query = 'SELECT * FROM tickets WHERE id = ?';
    db.query(query, [ticketId], (err, results) => {
        if (err) {
            console.error('Error fetching ticket details:', err);
            return res.status(500).send('Error fetching ticket details');
        }
        if (results.length > 0) {
            res.render('edit', { ticket: results[0] }); // Render halaman edit dengan data tiket
        } else {
            res.status(404).send('Ticket not found'); // Jika tiket tidak ditemukan
        }
    });
});

// Route untuk mengupdate tiket
app.post('/ticket/update/:id', isAuthenticated, (req, res) => {
    const ticketId = req.params.id;
    const { no_tiket, cid, nama, alamat, no_hp, komplain, pelapor, tanggal_laporan, tanggal_perbaikan, status } = req.body;

    // Mengonversi tanggal dan waktu ke format yang sesuai
    const formattedTanggalLaporan = new Date(tanggal_laporan).toISOString().slice(0, 19).replace('T', ' ');

    // Kosongkan tanggal_perbaikan jika status adalah 'Terbuka'
    const formattedTanggalPerbaikan = status === 'Terbuka' ? null : new Date(tanggal_perbaikan).toISOString().slice(0, 19).replace('T', ' ');

    // SQL untuk memperbarui tiket
    const sql = `UPDATE tickets SET 
        no_tiket = ?, 
        cid = ?, 
        nama = ?, 
        alamat = ?, 
        no_hp = ?, 
        komplain = ?, 
        pelapor = ?, 
        tanggal_laporan = ?, 
        tanggal_perbaikan = ? 
        WHERE id = ?`;

    const values = [no_tiket, cid, nama, alamat, no_hp, komplain, pelapor, formattedTanggalLaporan, formattedTanggalPerbaikan, ticketId];

    db.query(sql, values, (err, result) => {
        if (err) {
            return res.status(500).send(err);
        }
        res.redirect('/list');
    });
});

// Route untuk halaman login
app.get('/login', (req, res) => {
    res.render('login');
});

// Route untuk menangani login
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    db.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
        if (err) return res.status(500).send('Error fetching user');

        if (results.length > 0) {
            const user = results[0];
            if (bcrypt.compareSync(password, user.password)) {
                req.session.userId = user.id;
                req.session.userRole = user.role;
                return res.redirect('/');
            } else {
                return res.status(401).send('Password salah');
            }
        } else {
            return res.status(404).send('Pengguna tidak ditemukan');
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