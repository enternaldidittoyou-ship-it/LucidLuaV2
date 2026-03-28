require('dotenv').config();
const {
    Client, GatewayIntentBits, SlashCommandBuilder,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    REST, Routes, PermissionFlagsBits
} = require('discord.js');
const { createKey, revokeKey, listKeys, checkExpired } = require('../shared/keyManager');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const DURATION_CHOICES = [
    { name: '1 Day',    value: '1d'       },
    { name: '7 Days',   value: '7d'       },
    { name: '30 Days',  value: '30d'      },
    { name: '90 Days',  value: '90d'      },
    { name: '1 Year',   value: '365d'     },
    { name: 'Lifetime', value: 'lifetime' },
];

const commands = [
    new SlashCommandBuilder()
        .setName('genkey')
        .setDescription('[STAFF] Generate a new LucidLua license key')
        .addStringOption(o => o
            .setName('duration')
            .setDescription('How long should this key be valid?')
            .setRequired(true)
            .addChoices(...DURATION_CHOICES))
        .addIntegerOption(o => o
            .setName('amount')
            .setDescription('How many keys to generate (default: 1, max: 25)')
            .setMinValue(1)
            .setMaxValue(25)),

    new SlashCommandBuilder()
        .setName('revokekey')
        .setDescription('[STAFF] Revoke a license key')
        .addStringOption(o => o
            .setName('key')
            .setDescription('The license key to revoke')
            .setRequired(true)),

    new SlashCommandBuilder()
        .setName('listkeys')
        .setDescription('[STAFF] List all keys')
        .addBooleanOption(o => o
            .setName('active_only')
            .setDescription('Only show active keys (default: true)')),

    new SlashCommandBuilder()
        .setName('keyinfo')
        .setDescription('[STAFF] Look up info on a specific key')
        .addStringOption(o => o
            .setName('key')
            .setDescription('The license key to look up')
            .setRequired(true)),

].map(c => c.toJSON());

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.KEYGEN_BOT_TOKEN);
    try {
        console.log('[KeygenBot] Registering slash commands...');
        await rest.put(
            Routes.applicationGuildCommands(process.env.KEYGEN_BOT_CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );
        console.log('[KeygenBot] Slash commands registered.');
    } catch (err) {
        console.error('[KeygenBot] Failed to register commands:', err);
    }
}

function hasStaffRole(member) {
 const staffRoleIds = process.env.STAFF_ROLE_IDS;
 if (!staffRoleIds) return member.permissions.has(PermissionFlagsBits.Administrator);
 const roles = staffRoleIds.split(',').map(id => id.trim());
 return member.roles.cache.some(role => roles.includes(role.id));
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    await checkExpired();

    const { commandName, member, user } = interaction;

    if (!hasStaffRole(member)) {
        return interaction.reply({
            embeds: [errorEmbed('Access Denied', 'You do not have permission to use staff commands.')],
            ephemeral: true,
        });
    }

    // ── /genkey ──────────────────────────────────────────────────────────────
    if (commandName === 'genkey') {
        await interaction.deferReply({ ephemeral: true });

        const duration = interaction.options.getString('duration');
        const amount   = interaction.options.getInteger('amount') ?? 1;
        const label    = DURATION_CHOICES.find(c => c.value === duration)?.name ?? duration;

        const generatedKeys = [];
        for (let i = 0; i < amount; i++) {
            const key = await createKey(duration, user.tag);
            generatedKeys.push(key);
        }

        const keyList = generatedKeys.map(k => `\`${k}\``).join('\n');

        const embed = new EmbedBuilder()
            .setTitle(`🔑 Generated ${amount} Key${amount > 1 ? 's' : ''}`)
            .setColor(0x5865f2)
            .addFields(
                { name: '⏳ Duration', value: label,   inline: true },
                { name: '👤 By',      value: user.tag, inline: true },
                { name: `🗝️ Key${amount > 1 ? 's' : ''}`, value: keyList, inline: false },
            )
            .setDescription('Keys are ready to distribute. They activate when a player redeems them.')
            .setFooter({ text: 'LucidLua Staff • Keep keys secure' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        logToStaffChannel(client, `🔑 **${user.tag}** generated **${amount}** key(s) (${label}):\n${keyList}`);
    }

    // ── /revokekey ───────────────────────────────────────────────────────────
    if (commandName === 'revokekey') {
        await interaction.deferReply({ ephemeral: true });

        const key     = interaction.options.getString('key').trim().toUpperCase();
        const success = await revokeKey(key);

        if (!success) {
            return interaction.editReply({
                embeds: [errorEmbed('Not Found', `Key \`${key}\` does not exist.`)]
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('🔴 Key Revoked')
            .setColor(0xff4444)
            .setDescription(`Key \`${key}\` has been deactivated.`)
            .setFooter({ text: `Revoked by ${user.tag}` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        logToStaffChannel(client, `🔴 **${user.tag}** revoked key \`${key}\``);
    }

    // ── /listkeys ────────────────────────────────────────────────────────────
    if (commandName === 'listkeys') {
        await interaction.deferReply({ ephemeral: true });

        const activeOnly = interaction.options.getBoolean('active_only') ?? true;
        const keys       = await listKeys(activeOnly);

        if (keys.length === 0) {
            return interaction.editReply({
                embeds: [errorEmbed('No Keys', `No ${activeOnly ? 'active ' : ''}keys found.`)]
            });
        }

        const shown = keys.slice(0, 20);
        const now   = new Date();

        const rows = shown.map(k => {
            const redeemed = k.machoKey ? '✅' : '⏳';
            const expired  = k.expiresAt && new Date(k.expiresAt) < now ? '💀' : '';
            const expLabel = k.expiresAt
                ? `<t:${Math.floor(new Date(k.expiresAt).getTime() / 1000)}:d>`
                : '∞';
            return `${redeemed}${expired} \`${k.licenseKey}\` — ${expLabel} — ${k.discordTag ?? '_unredeemed_'}`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setTitle(`📋 Keys (${keys.length} total${activeOnly ? ', active only' : ''})`)
            .setColor(0x5865f2)
            .setDescription(rows.length > 4000 ? rows.slice(0, 4000) + '…' : rows)
            .setFooter({ text: '✅ redeemed  ⏳ unredeemed  💀 expired' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }

    // ── /keyinfo ─────────────────────────────────────────────────────────────
    if (commandName === 'keyinfo') {
        await interaction.deferReply({ ephemeral: true });

        const keyInput = interaction.options.getString('key').trim().toUpperCase();
        const keys     = await listKeys(false);
        const entry    = keys.find(k => k.licenseKey === keyInput);

        if (!entry) {
            return interaction.editReply({
                embeds: [errorEmbed('Not Found', `Key \`${keyInput}\` does not exist.`)]
            });
        }

        const now     = new Date();
        const expired = entry.expiresAt && new Date(entry.expiresAt) < now;

        const embed = new EmbedBuilder()
            .setTitle('🔎 Key Info')
            .setColor(entry.active && !expired ? 0x00ff88 : 0xff4444)
            .addFields(
                { name: '🔑 Key',          value: `\`${entry.licenseKey}\``,                    inline: false },
                { name: '🔐 Auth Key',     value: entry.machoKey ? `\`${entry.machoKey}\`` : '_Not redeemed_', inline: false },
                { name: '👤 Discord User', value: entry.discordTag ?? '_None_',                 inline: true  },
                { name: '🆔 Discord ID',   value: entry.discordId  ?? '_None_',                 inline: true  },
                { name: '📅 Expires',      value: entry.expiresAt
                    ? `<t:${Math.floor(new Date(entry.expiresAt).getTime() / 1000)}:F>`
                    : '**Lifetime**',                                                            inline: true  },
                { name: '📌 Status',       value: !entry.active ? '🔴 Revoked' : expired ? '🔴 Expired' : entry.machoKey ? '🟢 Active' : '🟡 Unredeemed', inline: true },
                { name: '🛠️ Created By',  value: entry.createdBy ?? 'Unknown',                 inline: true  },
                { name: '📆 Created',      value: `<t:${Math.floor(new Date(entry.createdAt).getTime() / 1000)}:D>`, inline: true },
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
});

function errorEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(`❌ ${title}`)
        .setDescription(description)
        .setColor(0xff4444)
        .setFooter({ text: 'LucidLua Staff' })
        .setTimestamp();
}

async function logToStaffChannel(client, message) {
    if (!process.env.STAFF_LOG_CHANNEL_ID) return;
    try {
        const channel = await client.channels.fetch(process.env.STAFF_LOG_CHANNEL_ID);
        if (channel) channel.send(message);
    } catch {}
}

client.once('ready', async () => {
    console.log(`[KeygenBot] Logged in as ${client.user.tag}`);
    await registerCommands();
    setInterval(checkExpired, 60 * 60 * 1000);
});

client.login(process.env.KEYGEN_BOT_TOKEN);
