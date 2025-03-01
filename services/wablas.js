require('dotenv').config();
const axios = require('axios');

const sendMessage = async (recipients) => {
    const url = 'https://kudus.wablas.com/api/v2/send-message';
    const apiKey = process.env.WABLAS_API_KEY;

    const headers = {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
    };

    const payload = {
        data: recipients.map(recipient => ({
            phone: recipient.phone,
            message: recipient.message,
            secret: false,
            retry: false,
            isGroup: recipient.isGroup
        }))
    };

    const options = {
        method: 'POST',
        headers: headers,
        data: payload
    };

    try {
        const response = await axios(url, options);
        console.log('Messages sent:', response.data);
    } catch (error) {
        console.error('Error sending messages:', error.response ? error.response.data : error.message);
    }
};

// Fungsi untuk mengirim laporan gangguan ke grup
const sendGroupNewTicket = async (groupId, message) => {
    const recipients = [
        { phone: groupId, message: message, isGroup: true } // Mengatur penerima sebagai grup
    ];

    try {
        await sendMessage(recipients); // Mengirim pesan ke grup
        console.log('Pesan berhasil dikirim ke grup:', groupId);
    } catch (error) {
        console.error('Error sending message to group:', error);
    }
};

// Fungsi untuk menangani respons laporan gangguan
const problemGroupResponse = (event) => {
    const groupId = '120363277167789572'; // ID grup yang dituju
    const now = new Date();

    const cid = event.namedValues['CID'][0];
    const nama = event.namedValues['Nama Customer'][0];
    const alamat = event.namedValues['Alamat Customer'][0];
    let nohp = event.namedValues['No. Whatapps Customer'][0].replace('+', '');
    const komplain = event.namedValues['Komplain Gangguan'][0];
    const jenis = event.namedValues['Jenis Gangguan'][0];
    const tgl = event.namedValues['Tanggal Laporan'][0];
    const cs = event.namedValues['CS'][0];

    // Mengubah format nomor WhatsApp
    if (nohp.startsWith("0")) {
        nohp = "62" + nohp.substring(1);
    }

    const pesan = `*Laporan Gangguan*
${now}

*CID :* ${cid}
*Nama Customer :* ${nama}
*Alamat Customer :* ${alamat}
*No. WA :* https://wa.me/${nohp}
*Komplain Gangguan :* ${komplain}
*Jenis Gangguan :* ${jenis}
*Tanggal Gangguan :* ${tgl}

_Ttd CS_ 📝 *${cs}*`;

    sendGroupNewTicket(groupId, pesan); // Mengirim pesan ke grup
};

module.exports = { sendMessage, sendGroupNewTicket, problemGroupResponse };