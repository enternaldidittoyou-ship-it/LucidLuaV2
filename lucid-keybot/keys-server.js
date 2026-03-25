/**
 * keys-server.js
 * A tiny HTTP server that serves data/keys.txt
 * Host this anywhere (VPS, Railway, etc.) and point MachoWebRequest at:
 *   http://YOUR_SERVER_IP:3000/keys
 */
require('dotenv').config();
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const PORT      = process.env.KEYS_SERVER_PORT || 3000;
const AUTH_TOKEN = process.env.KEYS_SERVER_TOKEN; // optional secret header to prevent scraping
const KEYS_TXT  = path.join(__dirname, 'data/keys.txt');

const server = http.createServer((req, res) => {
    // Only serve GET /keys
    if (req.method !== 'GET' || req.url !== '/keys') {
        res.writeHead(404);
        return res.end('Not found');
    }

    // Optional: require a secret token in the query string
    // MachoWebRequest("http://yourserver:3000/keys?token=YOUR_SECRET")
    if (AUTH_TOKEN) {
        const url    = new URL(req.url, `http://localhost`);
        const token  = url.searchParams.get('token');
        if (token !== AUTH_TOKEN) {
            res.writeHead(403);
            return res.end('Forbidden');
        }
    }

    if (!fs.existsSync(KEYS_TXT)) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('');
    }

    const content = fs.readFileSync(KEYS_TXT, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(content);
});

server.listen(PORT, () => {
    console.log(`[KeysServer] Serving keys at http://0.0.0.0:${PORT}/keys`);
});
