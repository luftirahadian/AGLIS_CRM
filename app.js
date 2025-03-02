require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const mysql = require('mysql2');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { sendMessage } = require('./services/wablas');
const util = require('util');

const app = express();
const PORT = process.env.PORT || 3000;

// Koneksi ke database
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
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
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: process.env.SESSION_SECRET || 'your_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24
    }
}));

// Middleware untuk menyimpan rute aktif
app.use((req, res, next) => {
    res.locals.activeRoute = req.path; // Menyimpan rute aktif
    next();
});

// Middleware untuk memeriksa autentikasi
function isAuthenticated(req, res, next) {
    console.log('Session:', req.session); // Log session
    if (req.session.userId) {
        return next(); // Pengguna terautentikasi, lanjutkan ke rute berikutnya
    }
    console.log('Error: User not authenticated.'); // Log error
    res.redirect('/login'); // Arahkan ke halaman login jika tidak terautentikasi
}

// Middleware untuk memeriksa role
function checkRole(role) {
    return (req, res, next) => {
        if (req.session.userRole === role || req.session.userRole === 'superadmin') {
            return next(); // Jika role sesuai atau pengguna adalah superadmin, lanjutkan
        }
        res.redirect('/'); // Jika tidak, arahkan ke halaman utama atau halaman lain
    };
}

// Middleware untuk memeriksa role superadmin
function checkSuperAdmin(req, res, next) {
    if (req.session.userRole === 'superadmin') {
        return next(); // Jika pengguna adalah superadmin, lanjutkan
    }
    res.redirect('/'); // Jika tidak, arahkan ke halaman utama atau halaman lain
}

// Middleware untuk memeriksa privilege berdasarkan role
function checkPrivileges(requiredRoles) {
    return (req, res, next) => {
        const userRole = req.session.userRole;
        console.log('User Role:', userRole); // Log user role
        console.log('Required Roles:', requiredRoles); // Log required roles

        // Jika pengguna adalah superadmin, izinkan semua akses
        if (userRole === 'superadmin') {
            return next();
        }

        // Daftar akses berdasarkan role
        const privileges = {
            admin: [
                'createUser',
                'viewAllUsers',
                'editAllUsers',
                'viewTickets',
                'editTickets',
                'createTickets',
                'viewOwnUser'
            ],
            teknisi: [
                'viewTickets',
                'editTickets',
                'viewOwnUser'
            ]
        };

        // Periksa akses berdasarkan role
        if (privileges[userRole] && privileges[userRole].some(role => requiredRoles.includes(role))) {
            return next(); // Izinkan akses jika role sesuai
        }

        // Tambahan untuk teknisi: akses ke data pengguna sendiri
        if (userRole === 'teknisi' && requiredRoles.includes('viewOwnUser') && req.session.userId === req.params.id) {
            return next(); // Teknisi bisa melihat dan mengubah data user sendiri
        }

        // Jika tidak memenuhi syarat, kirim pesan kesalahan
        res.status(403).send('Access denied'); // Akses ditolak
    };
}

// Fungsi untuk memformat tanggal
function formatDateTime(date) {
    const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return new Date(date).toLocaleDateString('id-ID', options);
}

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

        callback(null, newTicketNumber);
    });
}

const dbQuery = util.promisify(db.query).bind(db); // Mengubah db.query menjadi promise

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
                    loginSuccess: req.query.login === 'success', // Kirim status login
                    currentPage: 'dashboard' // Menetapkan currentPage untuk dashboard
                });
            });
        });
    });
});

// Rute untuk menampilkan daftar tiket
app.get('/list', isAuthenticated, checkPrivileges(['viewTickets']), async (req, res) => {
    try {
        const results = await dbQuery('SELECT * FROM tickets');
        res.render('list', {
            tickets: results,
            userRole: req.session.userRole,
            userName: req.session.userName,
            formatDateTime,
            currentPage: 'list'
        });
    } catch (err) {
        console.error('Error fetching tickets:', err);
        return res.status(500).send('Error fetching tickets');
    }
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
                userName: req.session.userName,
                currentPage: 'statistic' // Menetapkan currentPage untuk statistik
            });
        }

        res.render('statistic', {
            labels: JSON.stringify(labels), // Kirim tanggal
            dataCounts: JSON.stringify(dataCounts), // Kirim jumlah tiket
            totalTickets: results.reduce((sum, row) => sum + row.jumlah, 0), // Total tiket
            totalOpenTickets: 0, // Ganti dengan logika yang sesuai jika diperlukan
            totalClosedTickets: 0, // Ganti dengan logika yang sesuai jika diperlukan
            userRole: req.session.userRole,
            userName: req.session.userName,
            currentPage: 'statistic' // Menetapkan currentPage untuk statistik
        });
    });
});

// Rute untuk membuat tiket
app.get('/create', isAuthenticated, checkPrivileges(['createTickets']), (req, res) => {
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
            formatDateTime,
            currentPage: 'create' // Menetapkan currentPage untuk membuat tiket
        });
    });
});

// Rute untuk membuat tiket
app.post('/ticket/create', isAuthenticated, checkPrivileges(['createTickets']), async (req, res) => {
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

_Ttd Pelapor_ 📝 *${pelapor}*`;
            
            // Daftar penerima
            const recipients = [
                { phone: nohp, message: message, isGroup: false }, // Kirim ke nomor pelanggan
                // { phone: '120363044550799792', message: message, isGroup: true }, // Kirim ke grup Karkot Activity
                // { phone: '120363277167789572', message: message, isGroup: true }  // Kirim ke grup Laporan Gangguan
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
            // console.log('Ticket data:', ticket); // Log data tiket
            
            // Ambil no_hp dan simpan di req.body
            // req.body.no_hp = ticket.no_hp; 
            // console.log('No HP berhasil ditambahkan ke req.body:', req.body.no_hp); // Log no_hp

            // Log ketika no_hp berhasil ditempelkan ke field halaman edit
            // console.log('No HP berhasil ditempelkan ke field halaman edit:', ticket.no_hp); // Log no_hp yang ditempelkan

            res.render('edit', { ticket, userRole: req.session.userRole, userName: req.session.userName, formatDateTime }); // Kirim fungsi ke tampilan
        } else {
            res.status(404).send('Ticket not found'); // Jika tiket tidak ditemukan
        }
    });
});

// Rute untuk mengupdate tiket
app.post('/ticket/update/:id', isAuthenticated, checkPrivileges(['editTickets']), async (req, res) => {
    const ticketId = req.params.id;

    // Log semua data yang diterima
    // console.log('Isi req.body sebelum validasi:', req.body);

    // Ambil no_hp dari req.body
    // const { no_hp } = req.body;
    // console.log('No HP yang akan digunakan untuk pembaruan:', no_hp); // Log no_hp

    // Ambil field lain dari req.body
    const { no_tiket, cid, nama, no_hp, alamat, komplain, pelapor, status, jenis_gangguan, jenis_perbaikan, lokasi_odp, lokasi_closure, jarak_kabel, redaman_terakhir, nama_wifi, password_wifi, keterangan, teknisi } = req.body;

    // Debugging: Log nilai no_hp
    // console.log('No HP:', no_hp); // Tambahkan log ini untuk memeriksa nilai no_hp

    // Validasi di sisi server
    if (!status || !jenis_gangguan || !jenis_perbaikan || !redaman_terakhir || !keterangan || !teknisi ) {
        console.log('Validasi gagal, field yang hilang:', { status, jenis_gangguan, jenis_perbaikan, redaman_terakhir, keterangan, teknisi });
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

    // console.log('SQL yang akan dijalankan:', sql); // Log SQL
    // console.log('Nilai yang akan digunakan untuk pembaruan:', values); // Log nilai yang akan digunakan

    db.query(sql, values, async (err, result) => {
        if (err) {
            console.error('Error updating ticket:', err);
            return res.status(500).send('Error updating ticket');
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

        // Mendapatkan waktu saat tiket diperbarui
        const updatedAt = new Date().toLocaleString(); // Format waktu sesuai kebutuhan

        // Kirim pesan WhatsApp setelah tiket berhasil diperbarui
        const message = `✅ *Tiket aduan telah diperbarui* 🔔
    *Tanggal :* ${updatedAt}

*No Tiket:* ${ticketId}
*CID:* ${cid}
*Nama:* ${nama}
*Alamat:* ${alamat}
*No. WA:* https://wa.me/${nohp}
*Komplain:* ${komplain}
*Pelapor:* ${pelapor}
*Jenis Gangguan:* ${jenis_gangguan}
*Jenis Perbaikan:* ${jenis_perbaikan}
*Lokasi ODP:* ${lokasi_odp}
*Lokasi Closure:* ${lokasi_closure}
*Jarak Kabel:* ${jarak_kabel}
*Redaman Terakhir:* ${redaman_terakhir}
*Nama WiFi:* ${nama_wifi}
*Password WiFi:* ${password_wifi}
*Keterangan:* ${keterangan}
*Status:* ${status}

_Ttd Teknisi_ 📝 *${teknisi}*`;

        // Pastikan no_hp didefinisikan sebelum digunakan
        // if (!no_hp) {
        //     console.error('No HP tidak didefinisikan');
        //     return res.status(400).send('No HP tidak didefinisikan');
        // }

        // Daftar penerima
        const recipients = [
            { phone: nohp, message: message, isGroup: false }, // Kirim ke nomor pelanggan
            // { phone: '120363044550799792', message: message, isGroup: true }, // Kirim ke grup Karkot Activity
            // { phone: '120363277167789572', message: message, isGroup: true }  // Kirim ke grup Laporan Gangguan
        ];

        try {
            await sendMessage(recipients); // Kirim pesan ke semua penerima
            console.log('Pesan WhatsApp berhasil dikirim ke:', recipients); // Log sukses pengiriman pesan
            res.redirect('/list'); // Redirect ke halaman daftar tiket setelah berhasil
        } catch (error) {
            console.error('Error sending WhatsApp message:', error);
            res.status(500).send('Gagal mengirim pesan WhatsApp.');
        }
    });
});

// Rute untuk memperbarui status tiket
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

// Route untuk halaman login
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// Route untuk menangani login
app.post('/login', (req, res) => {
    const { username, password } = req.body; // Ambil username dari body

    const sql = 'SELECT * FROM users WHERE username = ?'; // Ubah query untuk menggunakan username
    const startTime = Date.now(); // Mulai waktu

    db.query(sql, [username], (err, results) => {
        const duration = Date.now() - startTime; // Hitung durasi
        console.log(`Query duration: ${duration} ms`); // Log durasi query

        if (err) {
            console.error('Error fetching user:', err);
            return res.status(500).send('Error fetching user');
        }
        if (results.length === 0) {
            return res.render('login', { error: 'Username atau password salah.' }); // Ubah pesan kesalahan
        }

        const user = results[0];
        // Bandingkan password yang dimasukkan dengan password yang terenkripsi
        if (bcrypt.compareSync(password, user.password)) {
            req.session.userId = user.id; // Simpan ID pengguna di session
            req.session.userRole = user.role; // Simpan role pengguna di session
            req.session.userName = user.nama; // Simpan nama pengguna di session
            return res.redirect('/?login=success'); // Redirect dengan query string
        } else {
            return res.render('login', { error: 'Username atau password salah.' }); // Ubah pesan kesalahan
        }
    });
});

// Route untuk halaman pengelolaan pengguna
app.get('/users', isAuthenticated, (req, res) => {
    const userRole = req.session.userRole;
    const userId = req.session.userId;

    let sql;
    if (userRole === 'teknisi') {
        // Jika role teknisi, hanya ambil data pengguna itu sendiri
        sql = 'SELECT * FROM users WHERE id = ? AND role = "teknisi"';
        db.query(sql, [userId], (err, results) => {
            if (err) {
                console.error('Error fetching user:', err);
                return res.status(500).send('Error fetching user');
            }
            res.render('user-management', {
                users: results,
                userRole: userRole,
                userName: req.session.userName,
                currentPage: 'user-management' // Menetapkan currentPage untuk user-management
            });
        });
    } else if (userRole === 'admin') {
        // Jika role admin, ambil pengguna dengan role admin dan teknisi
        sql = 'SELECT * FROM users WHERE role IN ("admin", "teknisi")';
        db.query(sql, (err, results) => {
            if (err) {
                console.error('Error fetching users:', err);
                return res.status(500).send('Error fetching users');
            }
            res.render('user-management', {
                users: results,
                userRole: userRole,
                userName: req.session.userName,
                currentPage: 'user-management' // Menetapkan currentPage untuk user-management
            });
        });
    } else if (userRole === 'superadmin') {
        // Jika role superadmin, ambil semua pengguna
        sql = 'SELECT * FROM users';
        db.query(sql, (err, results) => {
            if (err) {
                console.error('Error fetching users:', err);
                return res.status(500).send('Error fetching users');
            }
            res.render('user-management', {
                users: results,
                userRole: userRole,
                userName: req.session.userName,
                currentPage: 'user-management' // Menetapkan currentPage untuk user-management
            });
        });
    } else {
        // Jika role tidak valid, arahkan ke halaman lain atau tampilkan pesan kesalahan
        return res.status(403).send('Access denied'); // Akses ditolak
    }
});

// Route untuk menambah pengguna
app.post('/users/add', isAuthenticated, checkPrivileges(['createUser']), async (req, res) => {
    const { username, nama, email, password, role } = req.body;

    // Validasi di sini jika diperlukan
    if (!username || !nama || !email || !password || !role) {
        return res.status(400).send('Semua field harus diisi.');
    }

    // Cek apakah pengguna yang membuat adalah admin dan mencoba memberikan role superadmin
    if (req.session.userRole === 'admin' && role === 'superadmin') {
        return res.status(403).send('Anda tidak diizinkan untuk membuat pengguna dengan role Superadmin.');
    }

    // Enkripsi password
    const hashedPassword = bcrypt.hashSync(password, 10); // Menggunakan bcrypt untuk mengenkripsi password

    const sql = 'INSERT INTO users (username, nama, email, password, role) VALUES (?, ?, ?, ?, ?)';
    const values = [username, nama, email, hashedPassword, role];

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error('Error adding user:', err); // Log kesalahan
            return res.status(500).send('Error adding user');
        }
        res.send({ success: true }); // Kirim respons sukses
    });
});

// Route untuk menghapus pengguna
app.post('/users/delete', isAuthenticated, checkPrivileges(['deleteAllUsers']), (req, res) => {
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

// Route untuk mengupdate pengguna
app.post('/users/update', isAuthenticated, checkPrivileges(['editAllUsers']), (req, res) => {
    const { userId, userRole, userPassword, userPasswordConfirm } = req.body;

    // Cek apakah pengguna yang mengedit adalah admin dan mencoba memberikan role superadmin
    if (req.session.userRole === 'admin' && userRole === 'superadmin') {
        return res.status(403).send('Anda tidak diizinkan untuk mengubah pengguna menjadi role Superadmin.');
    }

    // Cek apakah pengguna yang mengedit adalah admin dan mencoba mengubah role mereka sendiri
    if (req.session.userId === userId && req.session.userRole === 'admin') {
        return res.status(403).send('Anda tidak diizinkan untuk mengubah role Anda sendiri.');
    }

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
app.get('/send-message', async (req, res) => {
    const message = 'Hello, this is a message to the group and individual!';

    const recipients = [
        { phone: '628197670700', message: message, isGroup: false }, // Nomor individu
        // { phone: '120363044550799792', message: message, isGroup: true }, // Grup 1
        // { phone: '120363277167789572', message: message, isGroup: true }  // Grup 2
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

// Rute untuk halaman manajemen role
app.get('/role', isAuthenticated, (req, res) => {
    // Periksa apakah pengguna adalah superadmin
    if (req.session.userRole !== 'superadmin') {
        return res.status(403).send('Akses ditolak. Hanya superadmin yang dapat mengakses halaman ini.');
    }

    // Ambil semua role dari database
    const sql = 'SELECT * FROM roles ORDER BY id ASC'; // Mengambil roles dan mengurutkannya berdasarkan ID
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching roles:', err);
            return res.status(500).send('Error fetching roles');
        }
        res.render('role', {
            roles: results,
            userRole: req.session.userRole,
            userName: req.session.userName,
            currentPage: 'role' // Menetapkan currentPage untuk role
        });
    });
});

// Rute untuk menambah role
app.post('/role/add', isAuthenticated, async (req, res) => {
    const { name } = req.body;

    if (!name) {
        return res.status(400).json({ error: 'Nama role tidak boleh kosong.' }); // Mengembalikan respons JSON
    }

    const sql = 'INSERT INTO roles (name) VALUES (?)';

    try {
        await dbQuery(sql, [name]); // Menggunakan dbQuery untuk menambahkan role
        res.status(201).json({ message: 'Role added successfully' }); // Mengembalikan respons JSON
    } catch (err) {
        console.error('Error adding role:', err);
        return res.status(500).json({ error: 'Error adding role' }); // Mengembalikan respons JSON
    }
});

// Rute untuk menghapus role
app.delete('/role/delete/:id', isAuthenticated, (req, res) => {
    const roleId = req.params.id;
    const sql = 'DELETE FROM roles WHERE id = ?';
    db.query(sql, [roleId], (err) => {
        if (err) {
            console.error('Error deleting role:', err);
            return res.status(500).json({ error: 'Error deleting role' }); // Mengembalikan respons JSON
        }
        res.status(200).json({ message: 'Role deleted successfully' }); // Mengembalikan respons JSON
    });
});

// Mulai server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

app.use((req, res) => {
    res.status(404).send('404 Not Found'); // Menangani route yang tidak ditemukan
});

// Middleware untuk menangani kesalahan
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});
