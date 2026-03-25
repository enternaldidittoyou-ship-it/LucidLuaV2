const fs = require('fs');
const path = require('path');

const KEYS_FILE = path.join(__dirname, '../data/keys.json');
const KEYS_TXT_FILE = path.join(__dirname, '../data/keys.txt'); // served publicly for MachoWebRequest

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

/**
 * Key format: LucidLua-XXXXX-XXXXX-XXXXX
 * Storage format:
 * {
 *   "LucidLua-XXXXX-XXXXX-XXXXX": {
 *     "machoKey": "user's MachoAuthenticationKey",
 *     "discordId": "123456789",
 *     "discordTag": "user#0000",
 *     "redeemedAt": "ISO date or null",
 *     "expiresAt": "ISO date or null (null = lifetime)",
 *     "createdAt": "ISO date",
 *     "createdBy": "staff discord tag",
 *     "active": true/false
 *   }
 * }
 */

function loadKeys() {
    if (!fs.existsSync(KEYS_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveKeys(keys) {
    fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
    rebuildTxt(keys);
}

// Rebuild the plain-text file that MachoWebRequest reads
function rebuildTxt(keys) {
    const now = new Date();
    const lines = [];
    for (const [licenseKey, data] of Object.entries(keys)) {
        if (!data.active) continue;
        if (!data.machoKey) continue; // not yet redeemed
        if (data.expiresAt && new Date(data.expiresAt) < now) continue; // expired
        lines.push(data.machoKey);
    }
    fs.writeFileSync(KEYS_TXT_FILE, lines.join('\n'));
}

function generateLicenseKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const seg = () => Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `LucidLua-${seg()}-${seg()}-${seg()}`;
}

// duration options: '1d', '7d', '30d', '90d', '365d', 'lifetime'
function calcExpiry(duration) {
    if (duration === 'lifetime') return null;
    const map = { '1d': 1, '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
    const days = map[duration];
    if (!days) throw new Error(`Unknown duration: ${duration}`);
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString();
}

function createKey(duration, createdBy) {
    const keys = loadKeys();
    let licenseKey;
    do { licenseKey = generateLicenseKey(); } while (keys[licenseKey]);

    keys[licenseKey] = {
        machoKey: null,
        discordId: null,
        discordTag: null,
        redeemedAt: null,
        expiresAt: calcExpiry(duration),
        createdAt: new Date().toISOString(),
        createdBy,
        active: true,
    };
    saveKeys(keys);
    return licenseKey;
}

function redeemKey(licenseKey, machoKey, discordId, discordTag) {
    const keys = loadKeys();
    const entry = keys[licenseKey];

    if (!entry) return { success: false, reason: 'Key not found.' };
    if (!entry.active) return { success: false, reason: 'This key has been deactivated.' };
    if (entry.redeemedAt) return { success: false, reason: 'This key has already been redeemed.' };
    if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
        return { success: false, reason: 'This key has expired before redemption.' };
    }

    // Check if this discordId already has an active key
    for (const [k, v] of Object.entries(keys)) {
        if (v.discordId === discordId && v.active) {
            return { success: false, reason: `You already have an active key: \`${k}\`` };
        }
    }

    // Check if this machoKey is already registered
    for (const [k, v] of Object.entries(keys)) {
        if (v.machoKey === machoKey && v.active) {
            return { success: false, reason: 'That Macho Authentication Key is already registered.' };
        }
    }

    entry.machoKey = machoKey;
    entry.discordId = discordId;
    entry.discordTag = discordTag;
    entry.redeemedAt = new Date().toISOString();
    saveKeys(keys);

    return { success: true, entry };
}

function getKeyByDiscordId(discordId) {
    const keys = loadKeys();
    for (const [licenseKey, data] of Object.entries(keys)) {
        if (data.discordId === discordId) return { licenseKey, ...data };
    }
    return null;
}

function revokeKey(licenseKey) {
    const keys = loadKeys();
    if (!keys[licenseKey]) return false;
    keys[licenseKey].active = false;
    saveKeys(keys);
    return true;
}

function checkExpired() {
    const keys = loadKeys();
    const now = new Date();
    let changed = false;
    for (const data of Object.values(keys)) {
        if (data.active && data.expiresAt && new Date(data.expiresAt) < now) {
            data.active = false;
            changed = true;
        }
    }
    if (changed) saveKeys(keys);
}

// Resubscribe: swap the machoKey on an already-redeemed active key
// The key must already be redeemed by this user (matched by licenseKey + discordId)
function resubscribeKey(licenseKey, newMachoKey, discordId, discordTag) {
    const keys = loadKeys();
    const entry = keys[licenseKey];

    if (!entry) return { success: false, reason: 'Key not found.' };
    if (!entry.active) return { success: false, reason: 'This key has been deactivated.' };
    if (!entry.redeemedAt) return { success: false, reason: 'This key has not been redeemed yet. Use Redeem Key instead.' };
    if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
        return { success: false, reason: 'This key has expired.' };
    }

    // Security: only the original redeemer can resubscribe their own key
    if (entry.discordId !== discordId) {
        return { success: false, reason: 'This key was not redeemed by your account.' };
    }

    // Check new macho key isn't already used on a different key
    for (const [k, v] of Object.entries(keys)) {
        if (k !== licenseKey && v.machoKey === newMachoKey && v.active) {
            return { success: false, reason: 'That Authentication Key is already registered to a different license.' };
        }
    }

    entry.machoKey    = newMachoKey;
    entry.discordTag  = discordTag; // update tag in case they changed username
    saveKeys(keys);

    return { success: true, entry };
}

function listKeys(activeOnly = true) {
    const keys = loadKeys();
    return Object.entries(keys)
        .filter(([, v]) => !activeOnly || v.active)
        .map(([licenseKey, v]) => ({ licenseKey, ...v }));
}

module.exports = {
    createKey,
    redeemKey,
    resubscribeKey,
    revokeKey,
    listKeys,
    getKeyByDiscordId,
    checkExpired,
    loadKeys,
};
