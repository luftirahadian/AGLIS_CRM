const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
// const dbConnection = require('./db'); // Mengimpor koneksi dari db.js
// const tickets = require('./dummyData'); // Impor dummy data tiket
const mysql = require('mysql2');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { sendMessage } = require('./services/wablas');

const app = express();
const PORT = process.env.PORT || 3000;

// Koneksi ke database
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root', // Ganti dengan username database Anda
    password: 'Gapura#2024!!', // Ganti dengan password database Anda
    database: 'crm_ticketing'
});

// Menghubungkan ke database
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

// Fungsi untuk memformat tanggal
function formatDateTime(date) {
    const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return new Date(date).toLocaleDateString('id-ID', options);
}

// Rute untuk halaman utama
app.get('/', isAuthenticated, (req, res) => {
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

                // Kirim data ke template
                res.render('index', {
                    totalTickets: totalResult[0].total,
                    totalOpenTickets: openResult[0].total,
                    totalClosedTickets: closedResult[0].total,
                    userRole: req.session.userRole,
                    userName: req.session.userName,
                    loginSuccess: req.query.login === 'success' // Kirim status login
                });
            });
        });
    });
});

// Rute untuk menampilkan daftar tiket
app.get('/list', isAuthenticated, (req, res) => {
    const sql = 'SELECT * FROM tickets';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching tickets:', err);
            return res.status(500).send('Error fetching tickets');
        }
        res.render('list', {
            tickets: results,
            userRole: req.session.userRole,
            userName: req.session.userName,
            formatDateTime
        });
    });
});

// Rute untuk mendapatkan statistik tiket
app.get('/statistic', isAuthenticated, (req, res) => {
    const sql = 'SELECT DATE(createdAt) AS tanggal, COUNT(*) AS jumlah FROM tickets GROUP BY DATE(createdAt) ORDER BY tanggal';
    
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching statistics:', err);
            return res.status(500).send('Error fetching statistics');
        }

        // Siapkan data untuk grafik
        const labels = results.map(row => row.tanggal); // Ambil tanggal
        const dataCounts = results.map(row => row.jumlah); // Ambil jumlah tiket

        // Jika tidak ada data, kirim array kosong
        if (results.length === 0) {
            return res.render('statistic', {
                labels: JSON.stringify([]),
                dataCounts: JSON.stringify([]),
                totalTickets: 0,
                totalOpenTickets: 0,
                totalClosedTickets: 0,
                userRole: req.session.userRole,
                userName: req.session.userName
            });
        }

        res.render('statistic', {
            labels: JSON.stringify(labels), // Kirim tanggal
            dataCounts: JSON.stringify(dataCounts), // Kirim jumlah tiket
            totalTickets: results.reduce((sum, row) => sum + row.jumlah, 0), // Total tiket
            totalOpenTickets: 0, // Ganti dengan logika yang sesuai jika diperlukan
            totalClosedTickets: 0, // Ganti dengan logika yang sesuai jika diperlukan
            userRole: req.session.userRole,
            userName: req.session.userName
        });
    });
});

// Fungsi untuk mendapatkan nomor tiket baru
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

        // console.log('New Ticket Number:', newTicketNumber);
        callback(null, newTicketNumber);
    });
}

// Rute untuk membuat tiket
app.get('/create', isAuthenticated, checkRole('admin'), (req, res) => {
    getNewTicketNumber((err, newTicketNumber) => {
        if (err) {
            console.error('Error fetching last ticket number:', err);
            return res.status(500).send('Error fetching last ticket number');
        }
        const createdAt = new Date(); // Atau ambil dari database jika perlu
        res.render('create', {
            newTicketNumber,
            createdAt,
            userRole: req.session.userRole,
            userName: req.session.userName,
            formatDateTime
        });
    });
});

// Rute untuk membuat tiket
app.post('/ticket/create', isAuthenticated, async (req, res) => {
    getNewTicketNumber(async (err, newTicketNumber) => {
        if (err) {
            console.error('Error fetching last ticket number:', err);
            return res.status(500).send('Error fetching last ticket number');
        }

        const { cid, nama, alamat, no_hp, komplain, pelapor } = req.body;

        // Pastikan status selalu diatur ke 'Terbuka'
        const status = 'Terbuka';

        const sql = 'INSERT INTO tickets (no_tiket, cid, nama, alamat, no_hp, komplain, pelapor, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
        const values = [newTicketNumber, cid, nama, alamat, no_hp, komplain, pelapor, status];

        db.query(sql, values, async (err, result) => {
            if (err) {
                console.error('Error creating ticket:', err);
                return res.status(500).send('Error creating ticket');
            }

            // Mengubah format nomor WhatsApp
            let nohp = no_hp.replace('+', ''); // Menghapus tanda '+' jika ada

            if (nohp.startsWith('0')) {
                nohp = '62' + nohp.substring(1); // Jika diawali dengan '0', ganti dengan '62'
            } else if (nohp.startsWith('+0')) {
                nohp = '62' + nohp.substring(2); // Jika diawali dengan '+0', ganti dengan '62'
            } else if (nohp.startsWith('+62')) {
                nohp = nohp.substring(1); // Jika diawali dengan '+62', hapus tanda '+' di depan
            } else if (!nohp.startsWith('62')) {
                nohp = '62' + nohp; // Jika tidak diawali dengan '0', '+0', dan '+62', tambahkan '62' di depan
            }

            // Mendapatkan waktu saat tiket dibuat
            const createdAt = new Date().toLocaleString(); // Format waktu sesuai kebutuhan

            // Kirim pesan WhatsApp setelah tiket berhasil dibuat
            const message = `📢🔔 *Tiket aduan baru telah dibuat* 🔊
            *Tanggal :* ${createdAt}
            
*No Tiket :* ${newTicketNumber}
*CID :* ${cid}
*Nama :* ${nama}
*Alamat :* ${alamat}
*No. WA :* https://wa.me/${nohp}
*Komplain :* ${komplain}
*Link Tiket :* http://localhost:3000/ticket/view/${result.insertId}

Pelapor 📝 *${pelapor}*`;
            
            // Daftar penerima
            const recipients = [
                { phone: nohp, message: message, isGroup: false }, // Kirim ke nomor individu
                { phone: '120363044550799792', message: message, isGroup: true }, // Kirim ke grup 1
                { phone: '120363277167789572', message: message, isGroup: true }  // Kirim ke grup 2
            ];

            try {
                await sendMessage(recipients); // Kirim pesan ke semua penerima
            } catch (error) {
                console.error('Error sending WhatsApp message:', error);
            }

            res.send({ success: true }); // Kirim respons sukses
        });
    });
});

// Rute untuk menampilkan detail tiket
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

// Rute untuk menampilkan halaman edit tiket
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
            res.render('edit', { ticket, userRole: req.session.userRole, userName: req.session.userName, formatDateTime }); // Kirim fungsi ke tampilan
        } else {
            res.status(404).send('Ticket not found'); // Jika tiket tidak ditemukan
        }
    });
});

// Rute untuk mengupdate tiket
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

    const sql = 'SELECT * FROM users WHERE email = ?';
    db.query(sql, [email], (err, results) => {
        if (err) {
            console.error('Error fetching user:', err);
            return res.status(500).send('Error fetching user');
        }
        if (results.length === 0) {
            return res.render('login', { error: 'Email atau password salah.' }); // Render dengan pesan kesalahan
        }

        const user = results[0];
        // Bandingkan password yang dimasukkan dengan password yang terenkripsi
        if (bcrypt.compareSync(password, user.password)) {
            req.session.userId = user.id; // Simpan ID pengguna di session
            req.session.userRole = user.role; // Simpan role pengguna di session
            req.session.userName = user.nama; // Simpan nama pengguna di session
            return res.redirect('/?login=success'); // Redirect dengan query string
        } else {
            return res.render('login', { error: 'Email atau password salah.' }); // Render dengan pesan kesalahan
        }
    });
});

// Route untuk halaman pengelolaan pengguna
app.get('/users', isAuthenticated, (req, res) => {
    const sql = 'SELECT * FROM users';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching users:', err);
            return res.status(500).send('Error fetching users');
        }
        res.render('user-management', {
            users: results,
            userRole: req.session.userRole,
            userName: req.session.userName // Kirim nama pengguna
        });
    });
});

// Route untuk menambah pengguna
app.post('/users/add', isAuthenticated, (req, res) => {
    console.log('Data yang diterima:', req.body); // Log data yang diterima
    const { nama, email, password, role } = req.body;

    // Validasi di sini jika diperlukan
    if (!nama || !email || !password || !role) {
        return res.status(400).send('Semua field harus diisi.');
    }

    // Enkripsi password
    const hashedPassword = bcrypt.hashSync(password, 10); // Menggunakan bcrypt untuk mengenkripsi password

    const sql = 'INSERT INTO users (nama, email, password, role) VALUES (?, ?, ?, ?)';
    const values = [nama, email, hashedPassword, role];

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error('Error adding user:', err);
            return res.status(500).send('Error adding user');
        }
        res.send({ success: true }); // Kirim respons sukses
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

// Route untuk mengupdate pengguna
app.post('/users/update', isAuthenticated, (req, res) => {
    console.log('Data yang diterima:', req.body); // Tambahkan log ini
    const { userId, userRole, userPassword, userPasswordConfirm } = req.body;

    // Validasi password
    if (userPassword && userPassword !== userPasswordConfirm) {
        return res.status(400).send('Password dan konfirmasi password tidak cocok.');
    }

    // Logika untuk memperbarui pengguna di database
    let sql = 'UPDATE users SET role = ?' + (userPassword ? ', password = ?' : '') + ' WHERE id = ?';
    const values = [userRole];

    // Jika password baru diisi, tambahkan ke query
    if (userPassword) {
        const hashedPassword = bcrypt.hashSync(userPassword, 10); // Hash password
        values.push(hashedPassword); // Tambahkan hashed password ke values
    }
    values.push(userId); // Tambahkan userId ke values

    db.query(sql, values, (err, results) => {
        if (err) {
            console.error('Error updating user:', err);
            return res.status(500).send('Error updating user');
        }
        res.send('User updated successfully');
    });
});

// Route untuk mengedit pengguna
app.post('/users/edit/:id', isAuthenticated, (req, res) => {
    const userId = req.params.id;
    const { userName, userEmail, userPassword } = req.body;

    // Logika untuk memperbarui pengguna di database
    let sql = 'UPDATE users SET name = ?, email = ? WHERE id = ?';
    const values = [userName, userEmail, userId];

    // Jika password baru diisi, tambahkan ke query
    if (userPassword) {
        sql = 'UPDATE users SET name = ?, email = ?, password = ? WHERE id = ?';
        const hashedPassword = bcrypt.hashSync(userPassword, 10); // Hash password
        values.push(hashedPassword);
    }

    db.query(sql, values, (err, results) => {
        if (err) {
            console.error('Error updating user:', err);
            return res.status(500).send('Error updating user');
        }
        res.send('User updated successfully');
    });
});

// Uji pengiriman pesan ke nomor dan grup
app.get('/test-send-message', async (req, res) => {
    const message = 'Hello, this is a message to the group and individual!';

    const recipients = [
        { phone: '628197670700', message: message, isGroup: false }, // Nomor individu
        { phone: '120363044550799792', message: message, isGroup: true }, // Grup 1
        { phone: '120363277167789572', message: message, isGroup: true }  // Grup 2
    ];

    try {
        await sendMessage(recipients); // Mengirim pesan ke semua penerima
        res.send('Pesan berhasil dikirim ke nomor dan grup!');
    } catch (error) {
        res.status(500).send('Gagal mengirim pesan ke nomor dan grup.');
    }
});

// Rute untuk menampilkan detail tiket (akses publik)
app.get('/ticket/view/:id', (req, res) => {
    const ticketId = req.params.id; // Ambil ID tiket dari parameter URL
    const query = 'SELECT * FROM tickets WHERE id = ?'; // Query untuk mengambil tiket berdasarkan ID

    db.query(query, [ticketId], (err, results) => {
        if (err) {
            console.error('Error fetching ticket:', err);
            return res.status(500).send('Error fetching ticket');
        }
        if (results.length > 0) {
            const ticket = results[0]; // Ambil tiket pertama dari hasil
            res.render('view-ticket', { ticket, userRole: null, userName: null }); // Tambahkan userRole dan userName dengan nilai null
        } else {
            res.status(404).send('Ticket not found'); // Jika tiket tidak ditemukan
        }
    });
});

// Mulai server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
