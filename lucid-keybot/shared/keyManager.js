const { Pool } = require('pg');

// ─── Database Connection ───────────────────────────────────────────────────────
let pool;
let initialized = false;

async function getDb() {
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DATABASE_URL?.includes('railway')
                ? { rejectUnauthorized: false }
                : false,
        });
    }

    if (!initialized) {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS keys (
                license_key  TEXT PRIMARY KEY,
                macho_key    TEXT,
                discord_id   TEXT,
                discord_tag  TEXT,
                redeemed_at  TIMESTAMPTZ,
                expires_at   TIMESTAMPTZ,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                created_by   TEXT,
                active       BOOLEAN NOT NULL DEFAULT TRUE
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS blacklist (
                discord_id      TEXT PRIMARY KEY,
                blacklisted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                blacklisted_by  TEXT,
                reason          TEXT
            )
        `);
        initialized = true;
        console.log('[KeyManager] Database ready.');
    }

    return pool;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function generateLicenseKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const seg   = () => Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `LucidLua-${seg()}-${seg()}-${seg()}`;
}

function calcExpiry(duration) {
    if (duration === 'lifetime') return null;
    const map  = { '1d': 1, '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
    const days = map[duration];
    if (!days) throw new Error(`Unknown duration: ${duration}`);
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
}

function rowToEntry(row) {
    if (!row) return null;
    return {
        licenseKey: row.license_key,
        machoKey:   row.macho_key,
        discordId:  row.discord_id,
        discordTag: row.discord_tag,
        redeemedAt: row.redeemed_at,
        expiresAt:  row.expires_at,
        createdAt:  row.created_at,
        createdBy:  row.created_by,
        active:     row.active,
    };
}

// ─── Exported Functions ────────────────────────────────────────────────────────
async function createKey(duration, createdBy) {
    const db = await getDb();
    let licenseKey;
    while (true) {
        licenseKey = generateLicenseKey().toUpperCase();
        const { rowCount } = await db.query('SELECT 1 FROM keys WHERE UPPER(license_key) = UPPER($1)', [licenseKey]);
        if (rowCount === 0) break;
    }
    const expiresAt = calcExpiry(duration);
    await db.query(
        'INSERT INTO keys (license_key, expires_at, created_by) VALUES ($1, $2, $3)',
        [licenseKey, expiresAt, createdBy]
    );
    console.log(`[KeyManager] Created key: ${licenseKey}`);
    return licenseKey;
}

async function redeemKey(licenseKey, machoKey, discordId, discordTag) {
    const db       = await getDb();
    const { rows } = await db.query('SELECT * FROM keys WHERE UPPER(license_key) = UPPER($1)', [licenseKey]);
    const entry    = rows[0];

    if (!entry)            return { success: false, reason: 'Key not found.' };
    if (!entry.active)     return { success: false, reason: 'This key has been deactivated.' };
    if (entry.redeemed_at) return { success: false, reason: 'This key has already been redeemed.' };
    if (entry.expires_at && new Date(entry.expires_at) < new Date()) {
        return { success: false, reason: 'This key has expired before redemption.' };
    }

    const existingUser = await db.query(
        'SELECT license_key FROM keys WHERE discord_id = $1 AND active = TRUE',
        [discordId]
    );
    if (existingUser.rowCount > 0) {
        return { success: false, reason: `You already have an active key: \`${existingUser.rows[0].license_key}\`` };
    }

    const existingMacho = await db.query(
        'SELECT 1 FROM keys WHERE macho_key = $1 AND active = TRUE',
        [machoKey]
    );
    if (existingMacho.rowCount > 0) {
        return { success: false, reason: 'That Authentication Key is already registered.' };
    }

    await db.query(
        'UPDATE keys SET macho_key=$1, discord_id=$2, discord_tag=$3, redeemed_at=NOW() WHERE UPPER(license_key)=UPPER($4)',
        [machoKey, discordId, discordTag, licenseKey]
    );

    const updated = await db.query('SELECT * FROM keys WHERE UPPER(license_key) = UPPER($1)', [licenseKey]);
    console.log(`[KeyManager] Redeemed key: ${licenseKey} by ${discordTag}`);
    return { success: true, entry: rowToEntry(updated.rows[0]) };
}

async function resubscribeKey(licenseKey, newMachoKey, discordId, discordTag) {
    const db       = await getDb();
    const { rows } = await db.query('SELECT * FROM keys WHERE UPPER(license_key) = UPPER($1)', [licenseKey]);
    const entry    = rows[0];

    if (!entry)             return { success: false, reason: 'Key not found.' };
    if (!entry.active)      return { success: false, reason: 'This key has been deactivated.' };
    if (!entry.redeemed_at) return { success: false, reason: 'This key has not been redeemed yet. Use Redeem Key instead.' };
    if (entry.expires_at && new Date(entry.expires_at) < new Date()) {
        return { success: false, reason: 'This key has expired.' };
    }
    if (entry.discord_id !== discordId) {
        return { success: false, reason: 'This key was not redeemed by your account.' };
    }

    const machoExists = await db.query(
        'SELECT 1 FROM keys WHERE macho_key = $1 AND active = TRUE AND license_key != $2',
        [newMachoKey, licenseKey]
    );
    if (machoExists.rowCount > 0) {
        return { success: false, reason: 'That Authentication Key is already registered to a different license.' };
    }

    await db.query(
        'UPDATE keys SET macho_key=$1, discord_tag=$2 WHERE UPPER(license_key)=UPPER($3)',
        [newMachoKey, discordTag, licenseKey]
    );

    const updated = await db.query('SELECT * FROM keys WHERE UPPER(license_key) = UPPER($1)', [licenseKey]);
    return { success: true, entry: rowToEntry(updated.rows[0]) };
}

async function revokeKey(licenseKey) {
    const db     = await getDb();
    const result = await db.query('UPDATE keys SET active=FALSE WHERE UPPER(license_key)=UPPER($1)', [licenseKey]);
    return result.rowCount > 0;
}

async function getKeyByDiscordId(discordId) {
    const db       = await getDb();
    const { rows } = await db.query(
        'SELECT * FROM keys WHERE discord_id = $1 ORDER BY created_at DESC LIMIT 1',
        [discordId]
    );
    return rows[0] ? rowToEntry(rows[0]) : null;
}

async function checkExpired() {
    const db = await getDb();
    await db.query(
        'UPDATE keys SET active=FALSE WHERE active=TRUE AND expires_at IS NOT NULL AND expires_at < NOW()'
    );
}

async function listKeys(activeOnly = true) {
    const db       = await getDb();
    const query    = activeOnly
        ? 'SELECT * FROM keys WHERE active=TRUE ORDER BY created_at DESC'
        : 'SELECT * FROM keys ORDER BY created_at DESC';
    const { rows } = await db.query(query);
    return rows.map(rowToEntry);
}

async function getActiveMachoKeys() {
    const db       = await getDb();
    const { rows } = await db.query(
        `SELECT macho_key FROM keys
         WHERE active=TRUE AND macho_key IS NOT NULL
         AND (expires_at IS NULL OR expires_at > NOW())`
    );
    return rows.map(r => r.macho_key).join('\n');
}

// ─── Blacklist ─────────────────────────────────────────────────────────────────
async function isBlacklisted(discordId) {
    const db           = await getDb();
    const { rowCount } = await db.query('SELECT 1 FROM blacklist WHERE discord_id = $1', [discordId]);
    return rowCount > 0;
}

async function blacklistUser(discordId, blacklistedBy, reason) {
    const db = await getDb();
    await db.query(
        `INSERT INTO blacklist (discord_id, blacklisted_by, reason)
         VALUES ($1, $2, $3)
         ON CONFLICT (discord_id) DO UPDATE
             SET blacklisted_at = NOW(),
                 blacklisted_by = EXCLUDED.blacklisted_by,
                 reason         = EXCLUDED.reason`,
        [discordId, blacklistedBy ?? null, reason ?? null]
    );
}

async function unblacklistUser(discordId) {
    const db     = await getDb();
    const result = await db.query('DELETE FROM blacklist WHERE discord_id = $1', [discordId]);
    return result.rowCount > 0;
}

async function getBlacklist() {
    const db       = await getDb();
    const { rows } = await db.query('SELECT * FROM blacklist ORDER BY blacklisted_at DESC');
    return rows.map(r => ({
        discordId:     r.discord_id,
        blacklistedAt: r.blacklisted_at,
        blacklistedBy: r.blacklisted_by,
        reason:        r.reason,
    }));
}

// ─── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
    getDb,
    createKey,
    redeemKey,
    resubscribeKey,
    revokeKey,
    listKeys,
    getKeyByDiscordId,
    checkExpired,
    getActiveMachoKeys,
    isBlacklisted,
    blacklistUser,
    unblacklistUser,
    getBlacklist,
};
