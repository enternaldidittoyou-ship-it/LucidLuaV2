require('dotenv').config();
const http  = require('http');
const { getActiveMachoKeys } = require('./shared/keyManager');

const PORT       = process.env.KEYS_SERVER_PORT || 3000;
const AUTH_TOKEN = process.env.KEYS_SERVER_TOKEN;

const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET' || !req.url.startsWith('/keys')) {
        res.writeHead(404);
        return res.end('Not found');
    }

    if (AUTH_TOKEN) {
        const url   = new URL(req.url, `http://localhost`);
        const token = url.searchParams.get('token');
        if (token !== AUTH_TOKEN) {
            res.writeHead(403);
            return res.end('Forbidden');
        }
    }

    try {
        const keys = await getActiveMachoKeys();
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(keys);
    } catch (err) {
        console.error('[KeysServer] Error fetching keys:', err);
        res.writeHead(500);
        res.end('Internal error');
    }
});

server.listen(PORT, () => {
    console.log(`[KeysServer] Serving keys at http://0.0.0.0:${PORT}/keys`);
});
