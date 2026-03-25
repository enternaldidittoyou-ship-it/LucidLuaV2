# 🚂 Railway Setup Guide — LucidLua Key Bot

---

## 📁 Step 1 — GitHub Repo

Create a new GitHub repo and upload these files exactly as-is:

```
lucid-keybot/
├── redemption-bot/
│   └── index.js
├── keygen-bot/
│   └── index.js
├── shared/
│   └── keyManager.js
├── keys-server.js
├── package.json
├── railway.toml
└── .gitignore
```

> ❌ Do NOT upload: `.env`, `data/`, `node_modules/`
> The `.gitignore` already blocks these.

---

## 🤖 Step 2 — Create Discord Bots

Go to https://discord.com/developers/applications

### Bot 1 — Redemption Bot (players use this)
1. Click **New Application** → name it `LucidLua Redemption`
2. Go to **Bot** tab → click **Add Bot**
3. Under **Privileged Gateway Intents** enable: `SERVER MEMBERS INTENT`
4. Copy the **Token** (you'll need it later)
5. Go to **OAuth2 → URL Generator**
   - Scopes: `bot` + `applications.commands`
   - Bot Permissions: `Send Messages`, `Read Messages/View Channels`
   - Copy the URL and open it to invite the bot to your server

### Bot 2 — Keygen Bot (staff only)
1. Click **New Application** → name it `LucidLua Staff`
2. Repeat the exact same steps above
3. Copy its **Token** and **Application ID** separately

---

## 🚂 Step 3 — Railway Project

1. Go to https://railway.app and log in
2. Click **New Project → Deploy from GitHub repo**
3. Select your `lucid-keybot` repo
4. Railway will detect it automatically

---

## 💾 Step 4 — Add a Volume (keeps your keys.json safe)

> Without this, your key database resets every deploy!

1. In your Railway project, click your service
2. Go to **Volumes** tab → **Add Volume**
3. Set the **Mount Path** to `/app/data`
4. Click **Add**

This makes the `data/` folder persist forever even through restarts and deploys.

---

## 🔐 Step 5 — Environment Variables

In Railway, click your service → **Variables** tab → add each one:

| Variable | Where to get it |
|---|---|
| `GUILD_ID` | Discord: right-click your server → Copy Server ID |
| `STAFF_LOG_CHANNEL_ID` | Discord: right-click your log channel → Copy Channel ID |
| `STAFF_ROLE_ID` | Discord: Server Settings → Roles → right-click your staff role → Copy Role ID |
| `REDEMPTION_BOT_TOKEN` | Discord Dev Portal → Redemption Bot → Bot → Token |
| `REDEMPTION_BOT_CLIENT_ID` | Discord Dev Portal → Redemption Bot → General Information → Application ID |
| `KEYGEN_BOT_TOKEN` | Discord Dev Portal → Staff Bot → Bot → Token |
| `KEYGEN_BOT_CLIENT_ID` | Discord Dev Portal → Staff Bot → General Information → Application ID |
| `KEYS_SERVER_PORT` | Set to `3000` |
| `KEYS_SERVER_TOKEN` | Make up any secret password (optional but recommended) |

---

## ▶️ Step 6 — Deploy

1. Railway will auto-deploy when you push to GitHub
2. Check the **Logs** tab — you should see:
   ```
   [RedemptionBot] Logged in as LucidLua Redemption#XXXX
   [KeygenBot] Logged in as LucidLua Staff#XXXX
   [KeysServer] Serving keys at http://0.0.0.0:3000/keys
   ```

---

## 🌐 Step 7 — Get your Keys Server URL

1. In Railway, click your service → **Settings** tab
2. Under **Networking** → click **Generate Domain**
3. You'll get a URL like: `lucid-keybot-production.up.railway.app`

Your `MachoWebRequest` URL will be:
```lua
-- Without token protection:
local KeysBin = MachoWebRequest("https://lucid-keybot-production.up.railway.app/keys")

-- With token protection (recommended):
local KeysBin = MachoWebRequest("https://lucid-keybot-production.up.railway.app/keys?token=YOUR_SECRET")
```

---

## ✅ Step 8 — Test It

1. In Discord, go to your redeem channel and type `/redeem_button` (you need Administrator)
2. The panel should appear with **Redeem Key** and **Resubscribe** buttons
3. In your staff channel, use `/genkey` to generate a test key
4. Click **Redeem Key**, enter the test key + a fake auth key
5. Check your Railway logs to confirm it worked

---

## 🔄 Updating the Bot Later

Just push changes to GitHub → Railway auto-redeploys. Your `data/` folder (Volume) stays safe.

---

## ❓ Common Issues

| Problem | Fix |
|---|---|
| Bot not responding | Check Railway logs for errors |
| Slash commands not showing | Wait 1-2 minutes after first boot for Discord to register them |
| Keys reset after deploy | Make sure the Volume is mounted at `/app/data` |
| `Cannot find module` error | Make sure `package.json` is in the root of the repo |
