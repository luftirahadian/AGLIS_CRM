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
    if (req.session && req.session.userId) {
        return next(); // Jika pengguna terautentikasi, lanjutkan ke rute berikutnya
    }
    res.redirect('/login'); // Alihkan ke halaman login jika tidak terautentikasi
}

// Middleware untuk memeriksa role
function checkRole(role) {
    return (req, res, next) => {
        const userRoleId = req.session.userRoleId; // Ambil role_id pengguna dari session
        const superAdminRoleId = 1; // Misalkan ID superadmin adalah 1

        if (userRoleId === role || userRoleId === superAdminRoleId) {
            return next(); // Jika role sesuai atau pengguna adalah superadmin, lanjutkan
        }
        res.redirect('/'); // Jika tidak, arahkan ke halaman utama atau halaman lain
    };
}

// Middleware untuk memeriksa role superadmin
function checkSuperAdmin(req, res, next) {
    if (req.session.userRoleId === '1') {
        return next(); // Jika pengguna adalah superadmin, lanjutkan
    }
    res.redirect('/'); // Jika tidak, arahkan ke halaman utama atau halaman lain
}

// Middleware untuk memeriksa privilege berdasarkan role
function checkPrivileges(requiredRoles) {
    return (req, res, next) => {
        const userRoleId = req.session.userRoleId; // Ambil role_id pengguna dari session
        console.log('User Role ID:', userRoleId); // Log userRoleId
        console.log('Required Roles:', requiredRoles); // Log requiredRoles
        const superAdminRoleId = 1; // Misalkan ID superadmin adalah 1
        const adminRoleId = 2; // Misalkan ID admin adalah 2
        const nocRoleId = 3; // Misalkan ID admin adalah 3
        const teknisiRoleId = 4; // Misalkan ID admin adalah 4
        const warehouseRoleId = 5; // Misalkan ID admin adalah 5

        // Jika pengguna adalah superadmin, izinkan semua akses
        if (userRoleId === superAdminRoleId) {
            return next();
        }

        // Daftar akses berdasarkan role
        const privileges = {
            1: ['createUser', 'viewAllUsers', 'editAllUsers', 'viewTickets', 'editTickets', 'createTickets', 'viewOwnUser'], // Superadmin
            2: ['createUser', 'viewAllUsers', 'editAllUsers', 'viewTickets', 'editTickets', 'createTickets'], // Admin
            3: ['viewTickets', 'editTickets', 'viewOwnUser'], // NOC
            4: ['viewTickets', 'editTickets', 'viewOwnUser'], // Teknisi
            5: ['viewTickets', 'editTickets', 'viewOwnUser'], // Warehouse
            6: ['viewTickets', 'editTickets', 'viewOwnUser'], // Finance
            7: ['viewTickets', 'createTickets', 'viewOwnUser'], // CS
            8: ['viewTickets', 'editTickets', 'viewOwnUser'] // Marketing
        };

        // Periksa akses berdasarkan role
        if (privileges[userRoleId] && requiredRoles.some(role => privileges[userRoleId].includes(role))) {
            return next(); // Izinkan akses jika role sesuai
        }

        // Tambahan untuk teknisi: akses ke data pengguna sendiri
        // if (userRoleId === teknisiRoleId && requiredRoles.includes('viewOwnUser') && req.session.userId === req.params.id) {
        //     return next(); // Teknisi bisa melihat dan mengubah data user sendiri
        // }

        // Jika tidak memenuhi syarat, kirim pesan kesalahan
        res.status(403).send('Access denied'); // Akses ditolak
    };
}

// Fungsi untuk memformat tanggal dan waktu
function formatDateTime(date) {
    const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return new Date(date).toLocaleDateString('id-ID', options); // Format sesuai dengan locale Indonesia
}

// Tambahkan fungsi ke res.locals agar dapat diakses di semua template
app.use((req, res, next) => {
    res.locals.formatDateTime = formatDateTime; // Menambahkan fungsi ke res.locals
    next();
});

// Fungsi untuk menghasilkan nomor tiket baru
function generateNewTicketNumber(callback) {
    const sql = 'SELECT no_tiket FROM tickets ORDER BY id DESC LIMIT 1'; // Ambil tiket terakhir
    db.query(sql, (err, results) => {
        if (err) {
            return callback(err); // Pastikan callback didefinisikan
        }

        let newTicketNumber = 'TKT-00001'; // Default jika tidak ada tiket
        if (results.length > 0) {
            const lastTicketNumber = results[0].no_tiket;
            const lastNumber = parseInt(lastTicketNumber.split('-')[1]) + 1; // Ambil nomor terakhir dan tambahkan 1
            newTicketNumber = `TKT-${lastNumber.toString().padStart(5, '0')}`; // Format nomor tiket baru
        }

        callback(null, newTicketNumber); // Panggil callback dengan hasil
    });
}

const dbQuery = util.promisify(db.query).bind(db); // Mengubah db.query menjadi promise

// Fungsi untuk mengambil data tiket dari database
async function getTickets() {
    const sql = 'SELECT * FROM tickets'; // Query untuk mengambil semua tiket
    return new Promise((resolve, reject) => {
        db.query(sql, (err, results) => {
            if (err) {
                return reject(err); // Jika ada kesalahan, tolak promise
            }
            resolve(results); // Kembalikan hasil
        });
    });
}

// Fungsi untuk mengambil data pengguna dari database
async function getUsers() {
    const sql = 'SELECT * FROM users'; // Query untuk mengambil semua pengguna
    return new Promise((resolve, reject) => {
        db.query(sql, (err, results) => {
            if (err) {
                return reject(err); // Jika ada kesalahan, tolak promise
            }
            resolve(results); // Kembalikan hasil
        });
    });
}

// Fungsi untuk mengambil data role dari database
async function getRoles() {
    const sql = 'SELECT * FROM roles'; // Query untuk mengambil semua role
    return new Promise((resolve, reject) => {
        db.query(sql, (err, results) => {
            if (err) {
                return reject(err); // Jika ada kesalahan, tolak promise
            }
            resolve(results); // Kembalikan hasil
        });
    });
}

async function getUserById(userId) {
    const query = 'SELECT * FROM users WHERE id = ?';
    const [rows] = await db.query(query, [userId]);
    return rows;
}

// Middleware untuk memeriksa hak akses
function checkUserRole(allowedRoles) {
    return (req, res, next) => {
        const userRoleId = req.session.userRoleId; // Ambil userRoleId dari session
        if (allowedRoles.includes(userRoleId)) {
            return next(); // Jika memiliki hak akses, lanjutkan
        }
        res.status(403).send('Access denied'); // Jika tidak, kirim pesan akses ditolak
    };
}

async function authenticateUser(username, password) {
    // Logika untuk memverifikasi pengguna, misalnya:
    const query = 'SELECT * FROM users WHERE username = ?';
    const [rows] = await db.query(query, [username]);

    if (rows.length > 0) {
        const user = rows[0];
        // Verifikasi password (misalnya, menggunakan bcrypt)
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (isPasswordValid) {
            return user; // Kembalikan objek pengguna jika berhasil
        }
    }
    return null; // Kembalikan null jika tidak ada pengguna yang cocok
}

// Route untuk halaman login
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// Route untuk menangani login
app.post('/login', (req, res) => {
    const { username, password } = req.body; // Ambil username dari body
    const sql = 'SELECT * FROM users WHERE username = ?'; // Ubah query untuk menggunakan username

    db.query(sql, [username], (err, results) => {
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
            req.session.userRoleId = user.role_id; // Simpan role_id pengguna di session
            req.session.userName = user.nama; // Simpan nama pengguna di session
            return res.redirect('/?login=success'); // Redirect dengan query string
        } else {
            return res.render('login', { error: 'Username atau password salah.' }); // Ubah pesan kesalahan
        }
    });
});

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
                    userRoleId: req.session.userRoleId,
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
app.get('/list', isAuthenticated, async (req, res) => {
    try {
        const tickets = await getTickets(); // Ambil data tiket dari database
        const userRoleId = req.session.userRoleId; // Ambil userRoleId dari session
        res.render('list', {
            tickets: tickets,
            userName: req.session.userName, // Kirim nama pengguna ke tampilan
            userRoleId: userRoleId, // Kirim userRoleId ke tampilan
            currentPage: 'list' // Kirim currentPage ke tampilan
        });
    } catch (error) {
        console.error('Error fetching tickets:', error);
        res.status(500).send('Error fetching tickets');
    }
});

// Rute untuk halaman pembuatan tiket
app.get('/create', isAuthenticated, checkPrivileges(['createUser']), async (req, res) => {
    try {
        const newTicketNumber = await new Promise((resolve, reject) => {
            generateNewTicketNumber((err, ticketNumber) => {
                if (err) {
                    return reject(err);
                }
                resolve(ticketNumber);
            });
        });

        const createdAt = new Date(); // Atur createdAt ke waktu saat ini

        res.render('create', {
            newTicketNumber: newTicketNumber, // Kirim nomor tiket baru ke tampilan
            userRoleId: req.session.userRoleId,
            userName: req.session.userName,
            currentPage: 'create', // Menetapkan currentPage untuk create
            createdAt: createdAt // Kirim createdAt ke tampilan
        });
    } catch (error) {
        console.error('Error generating new ticket number:', error);
        res.status(500).send('Error generating new ticket number');
    }
});

// Rute untuk membuat tiket
app.post('/ticket/create', isAuthenticated, checkPrivileges(['createTickets']), async (req, res) => {
    generateNewTicketNumber(async (err, newTicketNumber) => {
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
            res.render('view-ticket', { 
                ticket, 
                userRoleId: req.session.userRoleId || null, // Pastikan userRoleId tidak undefined
                userName: req.session.userName || null, // Pastikan userName tidak undefined
                currentPage: 'view-ticket' // Kirim currentPage ke tampilan
            });
        } else {
            res.status(404).send('Ticket not found'); // Jika tiket tidak ditemukan
        }
    });
});

// Rute untuk mengambil detail tiket
app.get('/ticket/:id', (req, res) => {
    const ticketId = req.params.id; // Ambil ID tiket dari parameter URL
    const query = 'SELECT * FROM tickets WHERE id = ?'; // Query untuk mengambil tiket berdasarkan ID

    db.query(query, [ticketId], (err, results) => {
        if (err) {
            console.error('Error fetching ticket:', err);
            return res.status(500).json({ error: 'Error fetching ticket' }); // Mengembalikan respons JSON
        }
        if (results.length > 0) {
            const ticket = results[0]; // Ambil tiket pertama dari hasil
            res.json(ticket); // Mengembalikan tiket sebagai respons JSON
        } else {
            res.status(404).json({ error: 'Ticket not found' }); // Jika tiket tidak ditemukan
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
            res.render('edit', { 
                ticket, 
                userRoleId: req.session.userRoleId, 
                userName: req.session.userName, 
                currentPage: 'edit', // Menetapkan currentPage untuk edit
                formatDateTime 
            }); // Kirim fungsi ke tampilan
        } else {
            res.status(404).send('Ticket not found'); // Jika tiket tidak ditemukan
        }
    });
});

// Rute untuk mengupdate tiket
app.post('/ticket/update/:id', isAuthenticated, checkPrivileges(['editTickets']), async (req, res) => {
    const ticketId = req.params.id;

    // Ambil field dari req.body
    const { no_tiket, cid, nama, no_hp, alamat, komplain, pelapor, status, jenis_gangguan, jenis_perbaikan, lokasi_odp, lokasi_closure, jarak_kabel, redaman_terakhir, nama_wifi, password_wifi, keterangan, teknisi } = req.body;

    // Validasi di sisi server
    if (!status || !jenis_gangguan || !jenis_perbaikan || !redaman_terakhir || !keterangan || !teknisi) {
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

    db.query(sql, values, async (err, result) => {
        if (err) {
            console.error('Error updating ticket:', err);
            return res.status(500).send('Error updating ticket');
        }

        // Mengubah format nomor WhatsApp
        let nohp = no_hp.replace('+', ''); // Menghapus tanda '+' jika ada

        // Format nomor WhatsApp
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
                userRoleId: req.session.userRoleId,
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
            userRoleId: req.session.userRoleId,
            userName: req.session.userName,
            currentPage: 'statistic' // Menetapkan currentPage untuk statistik
        });
    });
});

// Rute untuk halaman manajemen pengguna
app.get('/user', isAuthenticated, checkUserRole([1, 2, 3, 4, 5, 6, 7, 8]), async (req, res) => {
    try {
        const users = await getUsers(); // Ambil data pengguna
        const roles = await getRoles(); // Ambil data role
        const userRole = req.session.userRoleId; // Ambil userRole dari session
        const currentUserId = req.session.userId; // Ambil ID pengguna saat ini dari session
        
        let filteredUsers;

        // Logika untuk memfilter pengguna berdasarkan role
        if (userRole === 1) {
            // Jika superadmin, tampilkan semua pengguna
            filteredUsers = users; 
        } else if (userRole === 2) {
            // Jika admin, tampilkan semua pengguna kecuali yang memiliki role superadmin
            filteredUsers = users.filter(user => user.role_id !== 1); 
        } else {
            // Jika bukan superadmin atau admin, hanya tampilkan pengguna itu sendiri
            filteredUsers = users.filter(user => user.id === currentUserId); 
        }

        res.render('user', {
            users: filteredUsers, // Kirim pengguna yang sudah difilter
            userRole: userRole, // Kirim userRole ke tampilan
            userRoleId: userRole,
            userName: req.session.userName,
            currentPage: 'user',
            roles: roles
        });
    } catch (error) {
        console.error('Error fetching users or roles:', error);
        res.status(500).send('Error fetching users or roles');
    }
});

// Route untuk menambah pengguna
app.post('/users/add', isAuthenticated, checkPrivileges(['createUser']), async (req, res) => {
    const { username, nama, email, password, passwordConfirm, userRole } = req.body;
    const superAdminRoleId = 1; // Misalkan ID superadmin adalah 1
    const adminRoleId = 2; // Misalkan ID admin adalah 2
    const nocRoleId = 3; // Misalkan ID non teknisi adalah 3
    const teknisiRoleId = 4; // Misalkan ID teknisi adalah 4

    // Validasi di sini jika diperlukan
    if (!username || !nama || !email || !password || !passwordConfirm || !userRole) {
        return res.status(400).send('Semua field harus diisi.'); // Pastikan semua field diisi
    }

    // Cek apakah pengguna yang membuat adalah admin dan mencoba memberikan role superadmin
    if (req.session.userRoleId === adminRoleId && userRole === superAdminRoleId) {
        return res.status(403).send('Anda tidak diizinkan untuk membuat pengguna dengan role Superadmin.');
    }

    // Cek apakah password dan konfirmasi password cocok
    if (password !== passwordConfirm) {
        return res.status(400).send('Password dan verifikasi password tidak cocok.'); // Validasi password
    }

    // Enkripsi password
    const hashedPassword = bcrypt.hashSync(password, 10); // Menggunakan bcrypt untuk mengenkripsi password

    const sql = 'INSERT INTO users (username, nama, email, password, role_id) VALUES (?, ?, ?, ?, ?)';
    const values = [username, nama, email, hashedPassword, userRole]; // Pastikan role adalah role_id

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error('Error adding user:', err); // Log kesalahan
            return res.status(500).send('Error adding user');
        }
        res.send({ success: true }); // Kirim respons sukses
    });
});

// Route untuk mengupdate pengguna
app.post('/users/update', isAuthenticated, checkPrivileges(['editAllUsers']), (req, res) => {
    const { userId, userRoleId, userPassword, userPasswordConfirm } = req.body;
    const superAdminRoleId = 1; // Misalkan ID superadmin adalah 1
    const adminRoleId = 2; // Misalkan ID admin adalah 2
    const nocRoleId = 3; // Misalkan ID non teknisi adalah 3
    const teknisiRoleId = 4; // Misalkan ID teknisi adalah 4

    // Cek apakah pengguna yang mengedit adalah admin dan mencoba memberikan role superadmin
    if (req.session.userRoleId === adminRoleId && userRoleId === superAdminRoleId) {
        return res.status(403).send('Anda tidak diizinkan untuk mengubah pengguna menjadi role Superadmin.');
    }

    // Cek apakah pengguna yang mengedit adalah admin dan mencoba mengubah role mereka sendiri
    if (req.session.userId === userId && req.session.userRoleId === adminRoleId) {
        return res.status(403).send('Anda tidak diizinkan untuk mengubah role Anda sendiri.');
    }

    // Validasi password
    if (userPassword && userPassword !== userPasswordConfirm) {
        return res.status(400).send('Password dan konfirmasi password tidak cocok.');
    }

    // Logika untuk memperbarui pengguna di database
    let sql = 'UPDATE users SET role_id = ?' + (userPassword ? ', password = ?' : '') + ' WHERE id = ?';
    const values = [userRoleId];

    // Jika password baru diisi, tambahkan ke query
    if (userPassword) {
        const hashedPassword = bcrypt.hashSync(userPassword, 10); // Hash password
        values.push(hashedPassword);
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

// Route untuk menghapus pengguna
app.post('/users/delete', isAuthenticated, checkPrivileges(['deleteAllUsers']), (req, res) => {
    const { id } = req.body;
    db.query('DELETE FROM users WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).send('Error deleting user');
        res.send({ success: true });
    });
});

// Route untuk mengedit pengguna
app.post('/users/edit/:id', isAuthenticated, (req, res) => {
    const userId = req.params.id;
    const { userUsername, userRole, userName, userEmail, userPassword } = req.body;

    // Logika untuk memperbarui pengguna di database
    let sql = 'UPDATE users SET username = ?, role_id = ?, nama = ?, email = ? WHERE id = ?';
    const values = [userUsername, userRole, userName, userEmail, userId];

    // Jika password baru diisi, tambahkan ke query
    if (userPassword) {
        sql = 'UPDATE users SET username = ?, role_id = ?, nama = ?, email = ?, password = ? WHERE id = ?';
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

// Rute untuk halaman manajemen role
app.get('/role', isAuthenticated, checkPrivileges(['viewAllRoles']), async (req, res) => {
    try {
        const roles = await getRoles(); // Ambil data role dari database
        res.render('role', {
            userRoleId: req.session.userRoleId,
            userName: req.session.userName,
            currentPage: 'role', // Menetapkan currentPage untuk role
            roles: roles // Kirim data roles ke tampilan
        });
    } catch (error) {
        console.error('Error fetching roles:', error);
        res.status(500).send('Error fetching roles');
    }
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

app.use((req, res) => {
    res.status(404).send('404 Not Found'); // Menangani route yang tidak ditemukan
});

// Middleware untuk menangani kesalahan
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Mulai server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
