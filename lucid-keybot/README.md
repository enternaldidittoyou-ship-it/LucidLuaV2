# LucidLua Key Management System

Two Discord bots + a tiny HTTP server for authenticating players via `MachoWebRequest`.

---

## 📁 Project Structure

```
lucid-keybot/
├── shared/
│   └── keyManager.js        ← Core key logic (shared by both bots)
├── redemption-bot/
│   └── index.js             ← Player-facing bot (/redeem, /mystatus)
├── keygen-bot/
│   └── index.js             ← Staff-only bot (/genkey, /revokekey, /listkeys, /keyinfo)
├── keys-server.js           ← HTTP server that serves keys.txt for MachoWebRequest
├── data/
│   ├── keys.json            ← Key database (auto-created)
│   └── keys.txt             ← Plain-text active keys served to the menu (auto-created)
├── .env.example             ← Copy this to .env and fill it in
└── package.json
```

---

## ⚙️ Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create two Discord Bot apps
Go to https://discord.com/developers/applications and create **two separate bots**:
- **LucidLua Redemption** — players use this
- **LucidLua Staff** — staff only

For each, copy the **Bot Token** and **Application/Client ID**.

Enable these bot permissions:
- `Send Messages`
- `Use Slash Commands`
- `Read Message History`

Invite both bots to your server with the `applications.commands` + `bot` scope.

### 3. Configure environment
```bash
cp .env.example .env
```
Fill in `.env`:

| Variable | Description |
|---|---|
| `GUILD_ID` | Your Discord server ID (right-click server → Copy ID) |
| `STAFF_LOG_CHANNEL_ID` | Channel where actions are logged |
| `STAFF_ROLE_ID` | Role ID allowed to use `/genkey`, `/revokekey`, etc. |
| `REDEMPTION_BOT_TOKEN` | Token for the redemption bot |
| `REDEMPTION_BOT_CLIENT_ID` | Client ID for the redemption bot |
| `KEYGEN_BOT_TOKEN` | Token for the staff keygen bot |
| `KEYGEN_BOT_CLIENT_ID` | Client ID for the keygen bot |
| `KEYS_SERVER_PORT` | Port for the keys HTTP server (default: 3000) |
| `KEYS_SERVER_TOKEN` | Optional secret for the /keys endpoint |

### 4. Run everything
```bash
npm run start:all
```

Or run individually:
```bash
npm run start:redemption   # Redemption bot
npm run start:keygen       # Staff keygen bot
npm run start:server       # Keys HTTP server
```

---

## 🎮 Lua Menu Integration

In your menu's auth script, replace `YOUR_SERVER_URL` with your server's IP/domain:

```lua
local KeysBin    = MachoWebRequest("http://YOUR_SERVER_IP:3000/keys")
local CurrentKey = MachoAuthenticationKey()
local KeyPresent = string.find(KeysBin, CurrentKey)

if KeyPresent ~= nil then
    MachoMenuNotification("LucidLua", "✅ Authenticated [" .. CurrentKey .. "]")
else
    MachoMenuNotification("LucidLua", "❌ Key not found. Redeem at discord.gg/YOURSERVER")
end
```

If you set a `KEYS_SERVER_TOKEN`, use:
```lua
local KeysBin = MachoWebRequest("http://YOUR_SERVER_IP:3000/keys?token=YOUR_SECRET")
```

> **Tip:** Host the keys server on a VPS (DigitalOcean, Vultr, etc.) or a free platform like Railway.app. Make sure port 3000 is open in your firewall.

---

## 🤖 Bot Commands

### Redemption Bot (Players)

| Command | Description |
|---|---|
| `/redeem license_key macho_key` | Redeem a license key by providing your LucidLua key AND your `MachoAuthenticationKey` |
| `/mystatus` | Check your current license status and expiry |

**How to get your MachoAuthenticationKey:**
Players run this in the menu console:
```lua
print(MachoAuthenticationKey())
```
Then paste that value when using `/redeem`.

### Keygen Bot (Staff Only — requires the configured role)

| Command | Description |
|---|---|
| `/genkey duration [amount]` | Generate 1–25 keys with the chosen expiry |
| `/revokekey key` | Deactivate a key immediately |
| `/listkeys [active_only]` | List all keys with status |
| `/keyinfo key` | Show full details of a specific key |

**Duration options:** 1 Day, 7 Days, 30 Days, 90 Days, 1 Year, Lifetime

---

## 🔑 Key Format

```
LucidLua-XXXXX-XXXXX-XXXXX
```
Example: `LucidLua-A3K7F-9ZX2M-BQ4RT`

---

## 🔄 How It Works

1. Staff uses `/genkey` → key is saved to `data/keys.json` (unredeemed)
2. Staff gives key to player
3. Player opens menu, runs `print(MachoAuthenticationKey())` in console to get their Macho Key
4. Player uses `/redeem LucidLua-XXXXX... <machoKey>` in Discord
5. The bot saves the Macho Key and rebuilds `data/keys.txt`
6. On next menu load, `MachoWebRequest` fetches `keys.txt` and finds their key → authenticated ✅

---

## 🛡️ Security Notes

- Each license key can only be redeemed **once**
- Each Discord user can only have **one active key**
- Each Macho Key can only be registered **once**
- Expired keys are automatically removed from `keys.txt`
- Staff can revoke any key at any time
- Add `KEYS_SERVER_TOKEN` to prevent unauthorized scraping of your keys list
