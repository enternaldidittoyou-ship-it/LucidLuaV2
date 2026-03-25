const { Client } = require('pg');

// ─── Database Connection ───────────────────────────────────────────────────────
let db;

async function getDb() {
    if (db) return db;
    db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    await db.query(`
        CREATE TABLE IF NOT EXISTS keys (
            license_key     TEXT PRIMARY KEY,
            macho_key       TEXT,
            discord_id      TEXT,
            discord_tag     TEXT,
            redeemed_at     TIMESTAMPTZ,
            expires_at      TIMESTAMPTZ,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_by      TEXT,
            active          BOOLEAN NOT NULL DEFAULT TRUE
        )
    `);
    return db;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function generateLicenseKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const seg = () => Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `LucidLua-${seg()}-${seg()}-${seg()}`;
}

function calcExpiry(duration) {
    if (duration === 'lifetime') return null;
    const map = { '1d': 1, '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
    const days = map[duration];
    if (!days) throw new Error(`Unknown duration: ${duration}`);
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
}

function rowToEntry(row) {
    if (!row) return null;
    return {
        licenseKey:  row.license_key,
        machoKey:    row.macho_key,
        discordId:   row.discord_id,
        discordTag:  row.discord_tag,
        redeemedAt:  row.redeemed_at,
        expiresAt:   row.expires_at,
        createdAt:   row.created_at,
        createdBy:   row.created_by,
        active:      row.active,
    };
}

// ─── Exported Functions ────────────────────────────────────────────────────────
async function createKey(duration, createdBy) {
    const db = await getDb();
    let licenseKey;

    // Keep generating until we get a unique one
    while (true) {
        licenseKey = generateLicenseKey();
        const exists = await db.query('SELECT 1 FROM keys WHERE license_key = $1', [licenseKey]);
        if (exists.rowCount === 0) break;
    }

    const expiresAt = calcExpiry(duration);
    await db.query(
        `INSERT INTO keys (license_key, expires_at, created_by)
         VALUES ($1, $2, $3)`,
        [licenseKey, expiresAt, createdBy]
    );
    return licenseKey;
}

async function redeemKey(licenseKey, machoKey, discordId, discordTag) {
    const db = await getDb();
    const { rows } = await db.query('SELECT * FROM keys WHERE license_key = $1', [licenseKey]);
    const entry = rows[0];

    if (!entry)        return { success: false, reason: 'Key not found.' };
    if (!entry.active) return { success: false, reason: 'This key has been deactivated.' };
    if (entry.redeemed_at) return { success: false, reason: 'This key has already been redeemed.' };
    if (entry.expires_at && new Date(entry.expires_at) < new Date()) {
        return { success: false, reason: 'This key has expired before redemption.' };
    }

    // Check if discord user already has a key
    const existing = await db.query(
        'SELECT license_key FROM keys WHERE discord_id = $1 AND active = TRUE',
        [discordId]
    );
    if (existing.rowCount > 0) {
        return { success: false, reason: `You already have an active key: \`${existing.rows[0].license_key}\`` };
    }

    // Check if macho key already registered
    const machoExists = await db.query(
        'SELECT 1 FROM keys WHERE macho_key = $1 AND active = TRUE',
        [machoKey]
    );
    if (machoExists.rowCount > 0) {
        return { success: false, reason: 'That Authentication Key is already registered.' };
    }

    await db.query(
        `UPDATE keys SET macho_key=$1, discord_id=$2, discord_tag=$3, redeemed_at=NOW()
         WHERE license_key=$4`,
        [machoKey, discordId, discordTag, licenseKey]
    );

    const updated = await db.query('SELECT * FROM keys WHERE license_key = $1', [licenseKey]);
    return { success: true, entry: rowToEntry(updated.rows[0]) };
}

async function resubscribeKey(licenseKey, newMachoKey, discordId, discordTag) {
    const db = await getDb();
    const { rows } = await db.query('SELECT * FROM keys WHERE license_key = $1', [licenseKey]);
    const entry = rows[0];

    if (!entry)        return { success: false, reason: 'Key not found.' };
    if (!entry.active) return { success: false, reason: 'This key has been deactivated.' };
    if (!entry.redeemed_at) return { success: false, reason: 'This key has not been redeemed yet. Use Redeem Key instead.' };
    if (entry.expires_at && new Date(entry.expires_at) < new Date()) {
        return { success: false, reason: 'This key has expired.' };
    }
    if (entry.discord_id !== discordId) {
        return { success: false, reason: 'This key was not redeemed by your account.' };
    }

    // Check new macho key not used on a different key
    const machoExists = await db.query(
        'SELECT 1 FROM keys WHERE macho_key = $1 AND active = TRUE AND license_key != $2',
        [newMachoKey, licenseKey]
    );
    if (machoExists.rowCount > 0) {
        return { success: false, reason: 'That Authentication Key is already registered to a different license.' };
    }

    await db.query(
        'UPDATE keys SET macho_key=$1, discord_tag=$2 WHERE license_key=$3',
        [newMachoKey, discordTag, licenseKey]
    );

    const updated = await db.query('SELECT * FROM keys WHERE license_key = $1', [licenseKey]);
    return { success: true, entry: rowToEntry(updated.rows[0]) };
}

async function revokeKey(licenseKey) {
    const db = await getDb();
    const result = await db.query(
        'UPDATE keys SET active=FALSE WHERE license_key=$1',
        [licenseKey]
    );
    return result.rowCount > 0;
}

async function getKeyByDiscordId(discordId) {
    const db = await getDb();
    const { rows } = await db.query(
        'SELECT * FROM keys WHERE discord_id = $1 ORDER BY created_at DESC LIMIT 1',
        [discordId]
    );
    return rows[0] ? rowToEntry(rows[0]) : null;
}

async function checkExpired() {
    const db = await getDb();
    await db.query(
        `UPDATE keys SET active=FALSE
         WHERE active=TRUE AND expires_at IS NOT NULL AND expires_at < NOW()`
    );
}

async function listKeys(activeOnly = true) {
    const db = await getDb();
    const query = activeOnly
        ? 'SELECT * FROM keys WHERE active=TRUE ORDER BY created_at DESC'
        : 'SELECT * FROM keys ORDER BY created_at DESC';
    const { rows } = await db.query(query);
    return rows.map(rowToEntry);
}

// Returns newline-separated list of active macho keys for MachoWebRequest
async function getActiveMachoKeys() {
    const db = await getDb();
    const { rows } = await db.query(
        `SELECT macho_key FROM keys
         WHERE active=TRUE AND macho_key IS NOT NULL
         AND (expires_at IS NULL OR expires_at > NOW())`
    );
    return rows.map(r => r.macho_key).join('\n');
}

module.exports = {
    createKey,
    redeemKey,
    resubscribeKey,
    revokeKey,
    listKeys,
    getKeyByDiscordId,
    checkExpired,
    getActiveMachoKeys,
};
