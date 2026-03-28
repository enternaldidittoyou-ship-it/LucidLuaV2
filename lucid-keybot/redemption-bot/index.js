require('dotenv').config();
const {
    Client, GatewayIntentBits, SlashCommandBuilder,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    REST, Routes, PermissionFlagsBits
} = require('discord.js');
const {
    redeemKey, resubscribeKey, getKeyByDiscordId, checkExpired,
    isBlacklisted, blacklistUser, unblacklistUser, getBlacklist,
} = require('../shared/keyManager');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

function isStaff(member) {
    if (!process.env.STAFF_ROLE_IDS) return false;
    const staffRoles = process.env.STAFF_ROLE_IDS.split(',').map(id => id.trim());
    return member.roles.cache.some(role => staffRoles.includes(role.id));
}


const commands = [
    new SlashCommandBuilder()
        .setName('redeem_button')
        .setDescription('[ADMIN] Post the Redeem / Resubscribe panel in this channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('mystatus')
        .setDescription('Check the status of your LucidLua license'),

    new SlashCommandBuilder()
        .setName('blacklist')
        .setDescription('[ADMIN] Manage the redemption blacklist')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
.addSubcommand(sub => sub
    .setName('add')
    .setDescription('Blacklist a user by macho auth key and license key')
    .addStringOption(opt => opt
        .setName('macho_auth_key')
        .setDescription('Macho authentication key')
        .setRequired(true))
    .addStringOption(opt => opt
        .setName('license_key')
        .setDescription('LucidLua license key')
        .setRequired(true))
    .addStringOption(opt => opt
        .setName('reason')
        .setDescription('Reason for blacklisting')
        .setRequired(false)))
        .addSubcommand(sub => sub
            .setName('remove')
            .setDescription('Remove a user from the blacklist')
            .addStringOption(opt => opt
                .setName('user_id')
                .setDescription('Discord user ID to remove')
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('Show all blacklisted users')),
].map(c => c.toJSON());

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.REDEMPTION_BOT_TOKEN);
    try {
        console.log('[RedemptionBot] Registering slash commands...');
        await rest.put(
            Routes.applicationGuildCommands(process.env.REDEMPTION_BOT_CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );
        console.log('[RedemptionBot] Slash commands registered.');
    } catch (err) {
        console.error('[RedemptionBot] Failed to register commands:', err);
    }
}

function buildRedeemPanel() {
    const now     = new Date();
    const dateStr = `${now.getMonth()+1}/${now.getDate()}/${now.getFullYear()} ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

    const embed = new EmbedBuilder()
        .setTitle('Redeem / Resubscribe')
        .setDescription(
            'Click the button below to redeem your key.\n\n' +
            '**Required:** Authentication Key (numbers) + LucidLua key\n' +
            '**Format:** `LucidLua-XXXXX-XXXXX-XXXXX`\n\n' +
            '**Resubscribe:** Only swaps your Authentication Key on an existing active key.'
        )
        .setColor(0x1a1a2e)
        .setFooter({ text: dateStr });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('open_redeem_modal')
            .setLabel('Redeem Key')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('open_resubscribe_modal')
            .setLabel('Resubscribe')
            .setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [row] };
}

function buildRedeemModal() {
    return new ModalBuilder()
        .setCustomId('modal_redeem')
        .setTitle('Redeem Key')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('input_license_key')
                    .setLabel('LucidLua Key')
                    .setPlaceholder('LucidLua-XXXXX-XXXXX-XXXXX')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(40)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('input_macho_key')
                    .setLabel('Authentication Key')
                    .setPlaceholder('Enter your authentication key')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100)
            ),
        );
}

function buildResubscribeModal() {
    return new ModalBuilder()
        .setCustomId('modal_resubscribe')
        .setTitle('Resubscribe')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('input_license_key')
                    .setLabel('LucidLua Key')
                    .setPlaceholder('LucidLua-XXXXX-XXXXX-XXXXX')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(40)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('input_new_macho_key')
                    .setLabel('New Authentication Key')
                    .setPlaceholder('Enter your new authentication key')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100)
            ),
        );
}

client.on('interactionCreate', async (interaction) => {
    await checkExpired();
    const { user } = interaction;

    // ── Slash Commands ────────────────────────────────────────────────────────
if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'redeem_button') {
        if (!isStaff(interaction.member)) {
            return interaction.reply({ content: '❌ You need a staff role to use this command.', ephemeral: true });
        }
        await interaction.reply({ content: '✅ Panel posted!', ephemeral: true });
        await interaction.channel.send(buildRedeemPanel());
    }

        if (interaction.commandName === 'mystatus') {
            await interaction.deferReply({ ephemeral: true });
            const data = await getKeyByDiscordId(user.id);

            if (!data) {
                return interaction.editReply({
                    embeds: [errorEmbed('No Key Found', "You haven't redeemed a key yet. Click **Redeem Key** in the redeem channel.")]
                });
            }

            const now     = new Date();
            const expired = data.expiresAt && new Date(data.expiresAt) < now;
            const expiry  = data.expiresAt
                ? `<t:${Math.floor(new Date(data.expiresAt).getTime() / 1000)}:R>`
                : '**Lifetime** ♾️';

            const embed = new EmbedBuilder()
                .setTitle(expired ? '❌ License Expired' : '🟢 License Active')
                .setColor(expired ? 0xff4444 : data.active ? 0x00ff88 : 0xff8800)
                .addFields(
                    { name: '🔑 License Key', value: `\`${data.licenseKey}\``, inline: false },
                    { name: '🔐 Auth Key',    value: `\`${data.machoKey ?? 'Not redeemed'}\``, inline: false },
                    { name: '📅 Expires',     value: expired ? `~~${expiry}~~ ❌ Expired` : expiry, inline: true },
                    { name: '📌 Status',      value: !data.active ? '🔴 Revoked' : expired ? '🔴 Expired' : '🟢 Active', inline: true },
                    { name: '📆 Redeemed',    value: data.redeemedAt ? `<t:${Math.floor(new Date(data.redeemedAt).getTime() / 1000)}:D>` : 'N/A', inline: true },
                )
                .setFooter({ text: 'LucidLua' })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        }

if (interaction.commandName === 'blacklist') {
    if (!isStaff(interaction.member)) {
        return interaction.reply({ content: '❌ You need a staff role to use this command.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') {
        const machoKey = interaction.options.getString('macho_auth_key').trim();
        const licenseKey = interaction.options.getString('license_key').trim().toUpperCase();
        const reason = interaction.options.getString('reason') ?? null;
        
        // Look up the key in database to get discord_id
        const db = await require('../shared/keyManager').getDb();
        const { rows } = await db.query(
            'SELECT discord_id FROM keys WHERE macho_key = $1 AND UPPER(license_key) = UPPER($2)',
            [machoKey, licenseKey]
        );
        
        if (rows.length === 0) {
            return interaction.editReply({
                embeds: [errorEmbed('Key Not Found', 'No key found with those credentials.')]
            });
        }
    
    const targetId = rows[0].discord_id;
    await blacklistUser(targetId, user.tag, reason);
    
    const embed = new EmbedBuilder()
        .setTitle('🚫 User Blacklisted')
        .setColor(0xff4444)
        .addFields(
            { name: '👤 User ID', value: targetId, inline: true },
            { name: '🔑 License Key', value: licenseKey, inline: true },
            { name: '📝 Reason', value: reason ?? 'No reason provided', inline: true },
        )
        .setFooter({ text: `Blacklisted by ${user.tag}` })
        .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    logToStaffChannel(client, `🚫 **${user.tag}** blacklisted user \`${targetId}\\`${reason ? ` — *${reason}*` : ''}`);
}
            if (sub === 'remove') {
                const targetId = interaction.options.getString('user_id').trim();
                const removed  = await unblacklistUser(targetId);
                if (!removed) {
                    return interaction.editReply({
                        embeds: [errorEmbed('Not Blacklisted', `User \`${targetId}\` is not on the blacklist.`)]
                    });
                }
                const embed = new EmbedBuilder()
                    .setTitle('✅ User Removed from Blacklist')
                    .setColor(0x00ff88)
                    .addFields({ name: '👤 User ID', value: targetId, inline: true })
                    .setFooter({ text: `Removed by ${user.tag}` })
                    .setTimestamp();
                await interaction.editReply({ embeds: [embed] });
                logToStaffChannel(client, `✅ **${user.tag}** removed \`${targetId}\` from the blacklist`);
            }

            if (sub === 'list') {
                const entries = await getBlacklist();
                if (entries.length === 0) {
                    return interaction.editReply({
                        embeds: [new EmbedBuilder()
                            .setTitle('📋 Blacklist')
                            .setDescription('The blacklist is currently empty.')
                            .setColor(0x5865f2)
                            .setTimestamp()]
                    });
                }
                const lines = entries.map((e, i) =>
                    `**${i + 1}.** \`${e.discordId}\`${e.reason ? ` — ${e.reason}` : ''} *(by ${e.blacklistedBy ?? 'unknown'}, <t:${Math.floor(new Date(e.blacklistedAt).getTime() / 1000)}:R>)*`
                ).join('\n');
                const embed = new EmbedBuilder()
                    .setTitle(`📋 Blacklist (${entries.length})`)
                    .setDescription(lines.length > 4000 ? lines.slice(0, 4000) + '\n…' : lines)
                    .setColor(0x5865f2)
                    .setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }
        }
    }

    // ── Buttons ───────────────────────────────────────────────────────────────
    if (interaction.isButton()) {
        if (interaction.customId === 'open_redeem_modal')      return interaction.showModal(buildRedeemModal());
        if (interaction.customId === 'open_resubscribe_modal') return interaction.showModal(buildResubscribeModal());
    }

    // ── Modals ────────────────────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {

        // Redeem
        if (interaction.customId === 'modal_redeem') {
            await interaction.deferReply({ ephemeral: true });

            // Blacklist check
            if (await isBlacklisted(user.id)) {
                return interaction.editReply({
                    embeds: [errorEmbed('Blacklisted', 'You have been blacklisted and cannot redeem keys.')]
                });
            }

            const licenseKey = interaction.fields.getTextInputValue('input_license_key').trim().toUpperCase();
            const machoKey   = interaction.fields.getTextInputValue('input_macho_key').trim();

            const keyPattern = /^LUCIDLUA-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/;
            if (!keyPattern.test(licenseKey)) {
                return interaction.editReply({
                    embeds: [errorEmbed('Invalid Key Format', 'Your license key must be in this format:\n`LucidLua-XXXXX-XXXXX-XXXXX`')]
                });
            }
            if (!machoKey || machoKey.length < 3) {
                return interaction.editReply({
                    embeds: [errorEmbed('Invalid Auth Key', 'Please enter your MachoAuthenticationKey from the menu.')]
                });
            }

            const result = await redeemKey(licenseKey, machoKey, user.id, user.tag);

            if (!result.success) {
                return interaction.editReply({ embeds: [errorEmbed('Redemption Failed', result.reason)] });
            }

            const { entry } = result;
            const expiry = entry.expiresAt
                ? `<t:${Math.floor(new Date(entry.expiresAt).getTime() / 1000)}:F>`
                : '**Lifetime** ♾️';

            const embed = new EmbedBuilder()
                .setTitle('✅ Key Redeemed Successfully')
                .setColor(0x00ff88)
                .setDescription('Your Authentication Key has been registered.\nThe menu will now authenticate you automatically.')
                .addFields(
                    { name: '🔑 License Key', value: `\`${licenseKey}\``, inline: false },
                    { name: '🔐 Auth Key',    value: `\`${machoKey}\``,   inline: false },
                    { name: '📅 Expires',     value: expiry,              inline: true  },
                    { name: '✅ Status',      value: 'Active',            inline: true  },
                )
                .setFooter({ text: 'LucidLua • Never share your Auth Key!' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
            logToStaffChannel(client, `🎉 **${user.tag}** redeemed \`${licenseKey}\` (expires: ${entry.expiresAt ?? 'lifetime'})`);

            // Assign Customer role
            if (process.env.CUSTOMER_ROLE_ID) {
                try {
                    const member = await interaction.guild.members.fetch(user.id);
                    await member.roles.add(process.env.CUSTOMER_ROLE_ID);
                } catch (err) {
                    console.error(`[RedemptionBot] Failed to assign Customer role to ${user.tag}:`, err);
                }
            }
        }

        // Resubscribe
if (interaction.customId === 'modal_resubscribe') {
    await interaction.deferReply({ ephemeral: true });

    // Blacklist check
    if (await isBlacklisted(user.id)) {
        return interaction.editReply({
            embeds: [errorEmbed('Blacklisted', 'You have been blacklisted and cannot redeem keys.')]
        });
    }

            const licenseKey  = interaction.fields.getTextInputValue('input_license_key').trim().toUpperCase();
            const newMachoKey = interaction.fields.getTextInputValue('input_new_macho_key').trim();

            const keyPattern = /^LUCIDLUA-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/;
            if (!keyPattern.test(licenseKey)) {
                return interaction.editReply({
                    embeds: [errorEmbed('Invalid Key Format', 'Your license key must be in this format:\n`LucidLua-XXXXX-XXXXX-XXXXX`')]
                });
            }
            if (!newMachoKey || newMachoKey.length < 3) {
                return interaction.editReply({
                    embeds: [errorEmbed('Invalid Auth Key', 'Please enter your new MachoAuthenticationKey.')]
                });
            }

            const result = await resubscribeKey(licenseKey, newMachoKey, user.id, user.tag);

            if (!result.success) {
                return interaction.editReply({ embeds: [errorEmbed('Resubscribe Failed', result.reason)] });
            }

            const embed = new EmbedBuilder()
                .setTitle('🔄 Resubscribed Successfully')
                .setColor(0x5865f2)
                .setDescription('Your Authentication Key has been updated on your existing active license.')
                .addFields(
                    { name: '🔑 License Key',  value: `\`${licenseKey}\``,  inline: false },
                    { name: '🔐 New Auth Key', value: `\`${newMachoKey}\``, inline: false },
                    { name: '✅ Status',       value: 'Active',             inline: true  },
                )
                .setFooter({ text: 'LucidLua • Never share your Auth Key!' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
            logToStaffChannel(client, `🔄 **${user.tag}** resubscribed \`${licenseKey}\` with a new auth key`);
        }
    }
});

function errorEmbed(title, description) {
    return new EmbedBuilder()
        .setTitle(`❌ ${title}`)
        .setDescription(description ?? 'An unknown error occurred.')
        .setColor(0xff4444)
        .setFooter({ text: 'LucidLua' })
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
    console.log(`[RedemptionBot] Logged in as ${client.user.tag}`);
    await registerCommands();
    setInterval(checkExpired, 60 * 60 * 1000);
});

client.login(process.env.REDEMPTION_BOT_TOKEN);
