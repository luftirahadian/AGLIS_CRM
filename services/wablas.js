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

module.exports = { sendMessage };