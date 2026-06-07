const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');
const axios = require('axios');
const fs = require('fs');

const config = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID || null,
    tmdbApiKey: process.env.TMDB_API_KEY,
    tmdbBase: 'https://api.themoviedb.org/3',
    status: 'Watching over the server',
    color: 0x40E0D0,
};
const HTTP_TIMEOUT_MS = 15000;
const LOG_JSON = (process.env.LOG_JSON || 'false').toLowerCase() === 'true';

function logEvent(level, event, data = {}) {
    if (LOG_JSON) {
        console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...data }));
    } else {
        const extra = Object.keys(data).length ? ' ' + JSON.stringify(data) : '';
        console.log(`[${level.toUpperCase()}] ${event}${extra}`);
    }
}

const COOLDOWN_MS = (parseInt(process.env.COOLDOWN_SECONDS, 10) || 3) * 1000;
const MOD_COMMANDS = new Set([
    'ban', 'unban', 'kick', 'mute', 'unmute', 'restrict', 'unrestrict', 'purge', 'massunban',
]);
const cooldowns = new Map();

function checkCooldown(userId, command) {
    const key = `${userId}:${command}`;
    const now = Date.now();
    const last = cooldowns.get(key) || 0;
    if (now - last < COOLDOWN_MS) return Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
    cooldowns.set(key, now);
    return 0;
}

function auditLog(interaction) {
    let target = '';
    const user = interaction.options.getUser('user');
    const userId = interaction.options.getString('userid');
    if (user) target = ` target=${user.tag}(${user.id})`;
    else if (userId) target = ` target=${userId}`;
    const line = `[${new Date().toISOString()}] guild=${interaction.guildId || 'DM'} `
        + `user=${interaction.user.tag}(${interaction.user.id}) command=/${interaction.commandName}${target}`;
    logEvent('audit', 'moderation', {
        guild: interaction.guildId || 'DM',
        user: `${interaction.user.tag}(${interaction.user.id})`,
        command: `/${interaction.commandName}`,
    });
    try {
        fs.appendFileSync(path.join(__dirname, 'audit.log'), line + '\n');
    } catch (err) {
        console.error('[AUDIT][error] could not write audit.log:', err.message);
    }
}

const commands = [
    new SlashCommandBuilder()
        .setName('search')
        .setDescription('Search for a movie or TV series')
        .addStringOption(o => o.setName('title').setDescription('Title to search for').setRequired(true))
        .addStringOption(o => o.setName('type').setDescription('Movie or TV show').setRequired(true)
            .addChoices({ name: 'Movie', value: 'movie' }, { name: 'TV Show', value: 'tv' })),

    new SlashCommandBuilder().setName('help').setDescription('List all available commands'),
    new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Display server information'),
    new SlashCommandBuilder().setName('meme').setDescription('Get a random meme from r/memes'),

    new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View a user profile')
        .addUserOption(o => o.setName('user').setDescription('User to view').setRequired(false)),

    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a user')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addUserOption(o => o.setName('user').setDescription('User to ban').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a user by ID')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addStringOption(o => o.setName('userid').setDescription('User ID to unban').setRequired(true)),

    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a user')
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
        .addUserOption(o => o.setName('user').setDescription('User to kick').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Timeout a user for a duration')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o => o.setName('user').setDescription('User to mute').setRequired(true))
        .addIntegerOption(o => o.setName('minutes').setDescription('Duration in minutes (default: 10)').setRequired(false).setMinValue(1).setMaxValue(40320)),

    new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Remove timeout from a user')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(o => o.setName('user').setDescription('User to unmute').setRequired(true)),

    new SlashCommandBuilder()
        .setName('restrict')
        .setDescription('Restrict a user from sending messages in this channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addUserOption(o => o.setName('user').setDescription('User to restrict').setRequired(true)),

    new SlashCommandBuilder()
        .setName('unrestrict')
        .setDescription('Remove channel restriction from a user')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addUserOption(o => o.setName('user').setDescription('User to unrestrict').setRequired(true)),

    new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Bulk delete messages (max 100)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(o => o.setName('amount').setDescription('Number of messages').setRequired(true).setMinValue(1).setMaxValue(100)),

    new SlashCommandBuilder()
        .setName('massunban')
        .setDescription('Unban all banned users')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addBooleanOption(o => o.setName('confirm').setDescription('Confirm mass unban').setRequired(true)),

    new SlashCommandBuilder()
        .setName('embedcreate')
        .setDescription('Send an embed to a channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('Embed title').setRequired(true))
        .addStringOption(o => o.setName('description').setDescription('Embed body').setRequired(true)),

    new SlashCommandBuilder()
        .setName('embededit')
        .setDescription('Edit an existing bot embed')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(o => o.setName('messagelink').setDescription('Link to the message').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('New title').setRequired(false))
        .addStringOption(o => o.setName('description').setDescription('New description').setRequired(false)),
].map(c => c.toJSON());

const embed = (title) =>
    new EmbedBuilder().setColor(config.color).setTitle(title).setTimestamp();

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });

const REDDIT_RSS_HEADERS = {
    'User-Agent': 'linux:drewbot:1.0 (by /u/drew-gnr)',
    'Accept': 'application/rss+xml, application/xml, text/xml',
};
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const SKIP_THUMBS = new Set(['self', 'default', 'nsfw', 'spoiler', 'image', '']);

function previewToOriginal(url) {
    try {
        const parsed = new URL(url);
        if (parsed.hostname === 'preview.redd.it') {
            return `https://i.redd.it${parsed.pathname}`;
        }
    } catch (_) {}
    return url;
}

function scoreImageUrl(url) {
    const u = url.toLowerCase();
    if (u.includes('i.redd.it'))               return 3;
    if (u.includes('preview.redd.it'))          return 2;
    if (u.includes('external-preview.redd.it')) return 1;
    const path = u.split('?')[0];
    if (IMAGE_EXTENSIONS.some(ext => path.endsWith(ext))) return 0;
    return -1;
}

function extractImageFromContent(rawContent) {
    if (!rawContent) return null;

    const unescaped = rawContent
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');

    const imgRegex = /<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi;
    const candidates = [];
    let m;
    while ((m = imgRegex.exec(unescaped)) !== null) {
        candidates.push(m[1].replace(/&amp;/g, '&'));
    }

    if (candidates.length === 0) return null;

    const best = candidates.reduce((a, b) => scoreImageUrl(a) >= scoreImageUrl(b) ? a : b);
    if (scoreImageUrl(best) < 0) return null;

    return previewToOriginal(best);
}

async function fetchSubredditRss(subreddit) {
    const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/.rss?limit=25`;
    const res = await axios.get(url, {
        headers: REDDIT_RSS_HEADERS,
        timeout: HTTP_TIMEOUT_MS,
        responseType: 'text',
    });

    const xml = res.data;
    const entries = [];

    const entryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
    let entryMatch;
    while ((entryMatch = entryRegex.exec(xml)) !== null) {
        const block = entryMatch[1];

        const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch
            ? titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim()
            : '';

        const linkMatch =
            block.match(/<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["']/i) ||
            block.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']alternate["']/i) ||
            block.match(/<link[^>]+href=["']([^"']+)["']/i);
        const link = linkMatch ? linkMatch[1] : '';

        const contentMatch =
            block.match(/<content[^>]*>([\s\S]*?)<\/content>/i) ||
            block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);

        let imageUrl = null;

        if (contentMatch) {
            imageUrl = extractImageFromContent(contentMatch[1]);
        }

        if (!imageUrl) {
            const thumbMatch = block.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
            if (thumbMatch) {
                const thumb = thumbMatch[1];
                if (!SKIP_THUMBS.has(thumb) && thumb.startsWith('http')) {
                    imageUrl = thumb;
                }
            }
        }

        if (title && link) {
            entries.push({ title, link, imageUrl });
        }
    }

    return entries;
}

function buildSearchEmbed(result, idx, total, type) {
    const e = embed(result.title || result.name)
        .setDescription(result.overview || 'No description available.')
        .setFooter({ text: `Result ${idx + 1} of ${total} - Rating: ${result.vote_average?.toFixed(1) ?? 'N/A'}/10` });
    if (result.poster_path)
        e.setImage(`https://image.tmdb.org/t/p/w500${result.poster_path}`);
    if (type === 'movie')
        e.addFields(
            { name: 'Release Date', value: result.release_date || 'N/A', inline: true },
            { name: 'Original Title', value: result.original_title || 'N/A', inline: true },
        );
    else
        e.addFields(
            { name: 'First Air Date', value: result.first_air_date || 'N/A', inline: true },
            { name: 'Original Name', value: result.original_name || 'N/A', inline: true },
        );
    return e;
}

function navRow(idx, total) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('prev').setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(idx === 0),
        new ButtonBuilder().setCustomId('next').setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(idx === total - 1),
    );
}

function parseDiscordMessageLink(link) {
    try {
        const parsed = new URL(link);
        const host = parsed.hostname.toLowerCase();
        const allowedHosts = new Set(['discord.com', 'www.discord.com', 'canary.discord.com', 'ptb.discord.com']);
        if (!allowedHosts.has(host)) return null;
        const segments = parsed.pathname.split('/').filter(Boolean);
        if (segments.length < 4 || segments[0] !== 'channels') return null;
        const channelId = segments[2];
        const messageId = segments[3];
        if (!/^\d+$/.test(channelId) || !/^\d+$/.test(messageId)) return null;
        return { channelId, messageId };
    } catch {
        return null;
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildPresences,
    ],
});

client.once('ready', async () => {
    logEvent('info', 'online', { tag: client.user.tag });
    client.user.setActivity(config.status, { type: 3 });
    try {
        const rest = new REST({ version: '10' }).setToken(config.token);
        const route = config.guildId
            ? Routes.applicationGuildCommands(config.clientId, config.guildId)
            : Routes.applicationCommands(config.clientId);
        await rest.put(route, { body: commands });
        logEvent('info', 'commands_registered', {
            count: commands.length,
            scope: config.guildId ? `guild:${config.guildId}` : 'global',
        });
    } catch (err) {
        logEvent('error', 'command_registration_failed', { error: err.message });
    }
});


async function handlePing(interaction) {
    await interaction.reply(`Pong! API latency: ${client.ws.ping}ms`);
}

async function handleHelp(interaction) {
    const e = embed('DrewBot - Commands')
        .setDescription('All available slash commands:')
        .addFields(
            { name: 'General', value: '`/ping` `/help` `/search` `/profile` `/serverinfo` `/meme`' },
            { name: 'Moderation', value: '`/ban` `/unban` `/kick` `/mute` `/unmute` `/restrict` `/unrestrict` `/purge` `/massunban`' },
            { name: 'Embeds', value: '`/embedcreate` `/embededit`' },
        );
    await interaction.reply({ embeds: [e] });
}

async function handleServerInfo(interaction) {
    try {
        const { guild } = interaction;
        const bots = guild.members.cache.filter(m => m.user.bot).size;
        const humans = Math.max(guild.memberCount - bots, 0);

        const e = embed(`${guild.name}`)
            .setThumbnail(guild.iconURL({ dynamic: true, size: 512 }))
            .setDescription(guild.description || '')
            .addFields(
                { name: 'Members', value: `${humans} humans - ${bots} bots`, inline: true },
                { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
                { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
                { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
                { name: 'ID', value: guild.id, inline: true },
            );
        await interaction.reply({ embeds: [e] });
    } catch (err) {
        console.error('[serverinfo][error]', err.message);
        await interaction.reply(ephemeral('Failed to fetch server info right now.'));
    }
}

async function handleProfile(interaction) {
    const { guild } = interaction;
    const user = interaction.options.getUser('user') || interaction.user;
    const guildMember = await guild.members.fetch(user.id).catch(() => null);
    const e = embed(`${user.username}'s Profile`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 512 }))
        .addFields(
            { name: 'ID', value: user.id, inline: true },
            { name: 'Account created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
            { name: 'Joined server', value: guildMember ? `<t:${Math.floor(guildMember.joinedTimestamp / 1000)}:R>` : 'N/A', inline: true },
            { name: 'Nickname', value: guildMember?.nickname || 'None', inline: true },
            { name: 'Roles', value: guildMember?.roles.cache.filter(r => r.id !== guild.id).map(r => r.toString()).join(' ') || 'None' },
        );
    await interaction.reply({ embeds: [e] });
}

async function handleMeme(interaction) {
    await interaction.deferReply();
    try {
        const entries = await fetchSubredditRss('memes');
        const imageEntries = entries.filter(e => e.imageUrl);

        if (!imageEntries.length) {
            return interaction.editReply('Couldn\'t find any image memes right now. Try again in a moment!');
        }

        const pick = imageEntries[Math.floor(Math.random() * imageEntries.length)];

        const e = embed(pick.title)
            .setImage(pick.imageUrl)
            .setDescription(`[View on Reddit](${pick.link})`)
            .setFooter({ text: 'r/memes' });

        await interaction.editReply({ embeds: [e] });
    } catch (err) {
        console.error('[meme][error]', err.message);
        await interaction.editReply('Failed to fetch a meme. Reddit\'s RSS might be down.');
    }
}

async function fetchAllTmdbResults(type, query, maxPages = 3) {
    const results = [];
    for (let page = 1; page <= maxPages; page++) {
        const res = await axios.get(`${config.tmdbBase}/search/${type}`, {
            params: { api_key: config.tmdbApiKey, query, language: 'en-US', page },
            timeout: HTTP_TIMEOUT_MS,
        });
        const pageResults = res.data.results || [];
        results.push(...pageResults);
        if (page >= res.data.total_pages) break;
    }
    return results;
}

async function handleSearch(interaction) {
    await interaction.deferReply();
    const query = interaction.options.getString('title');
    const type = interaction.options.getString('type');
    try {
        const results = await fetchAllTmdbResults(type, query);
        if (!results.length) return interaction.editReply('No results found.');
        let idx = 0;
        const reply = await interaction.editReply({
            embeds: [buildSearchEmbed(results[idx], idx, results.length, type)],
            components: [navRow(idx, results.length)],
        });
        const collector = reply.createMessageComponentCollector({
            filter: i => i.user.id === interaction.user.id,
            time: 300000,
        });
        collector.on('collect', async i => {
            idx = i.customId === 'next' ? idx + 1 : idx - 1;
            await i.update({
                embeds: [buildSearchEmbed(results[idx], idx, results.length, type)],
                components: [navRow(idx, results.length)],
            });
        });
        collector.on('end', () => {
            interaction
                .editReply({
                    components: [],
                    embeds: [
                        buildSearchEmbed(results[idx], idx, results.length, type).setFooter({
                            text: `Result ${idx + 1} of ${results.length} - Search session expired. Run /search again.`,
                        }),
                    ],
                })
                .catch(() => {});
        });
    } catch (err) {
        console.error('[search][error]', err.message);
        await interaction.editReply('Failed to fetch results. Check your TMDB API key.');
    }
}

async function handleBan(interaction) {
    const { guild } = interaction;
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const gm = await guild.members.fetch(user.id).catch(() => null);
    if (gm && !gm.bannable) {
        return interaction.reply(ephemeral('I cannot ban that user. They may have a higher role than me or be a server admin.'));
    }
    try {
        await guild.members.ban(user.id, { reason });
        await interaction.reply(`Banned **${user.tag}**. Reason: ${reason}`);
    } catch (err) {
        console.error('[ban][error]', err.message);
        await interaction.reply(ephemeral('Failed to ban that user.'));
    }
}

async function handleUnban(interaction) {
    const { guild } = interaction;
    const userId = interaction.options.getString('userid');
    try {
        await guild.members.unban(userId);
        await interaction.reply(`Unbanned user ID \`${userId}\`.`);
    } catch (err) {
        console.error('[unban][error]', err.message);
        await interaction.reply(ephemeral('Could not unban that user ID. Are they actually banned?'));
    }
}

async function handleKick(interaction) {
    const { guild } = interaction;
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const gm = await guild.members.fetch(user.id).catch(() => null);
    if (!gm?.kickable) return interaction.reply(ephemeral('I cannot kick that user.'));
    try {
        await gm.kick(reason);
        await interaction.reply(`Kicked **${user.tag}**. Reason: ${reason}`);
    } catch (err) {
        console.error('[kick][error]', err.message);
        await interaction.reply(ephemeral('Failed to kick that user.'));
    }
}

async function handleMute(interaction) {
    const { guild } = interaction;
    const user = interaction.options.getUser('user');
    const minutes = interaction.options.getInteger('minutes') || 10;
    const gm = await guild.members.fetch(user.id).catch(() => null);
    if (!gm) return interaction.reply(ephemeral('Could not find that member.'));
    try {
        await gm.timeout(minutes * 60 * 1000, `Timed out by ${interaction.user.tag}`);
        await interaction.reply(`Timed out **${user.tag}** for ${minutes} minute(s).`);
    } catch (err) {
        console.error('[mute][error]', err.message);
        await interaction.reply(ephemeral('Failed to timeout that user.'));
    }
}

async function handleUnmute(interaction) {
    const { guild } = interaction;
    const user = interaction.options.getUser('user');
    const gm = await guild.members.fetch(user.id).catch(() => null);
    if (!gm) return interaction.reply(ephemeral('Could not find that member.'));
    try {
        await gm.timeout(null);
        await interaction.reply(`Removed timeout from **${user.tag}**.`);
    } catch (err) {
        console.error('[unmute][error]', err.message);
        await interaction.reply(ephemeral('Failed to remove timeout.'));
    }
}

async function handleRestrict(interaction) {
    const { guild } = interaction;
    const user = interaction.options.getUser('user');
    const gm = await guild.members.fetch(user.id).catch(() => null);
    if (!gm) return interaction.reply(ephemeral('Could not find that member.'));
    try {
        await interaction.channel.permissionOverwrites.edit(gm, { SendMessages: false });
        await interaction.reply(`Restricted **${user.tag}** from sending messages in this channel.`);
    } catch (err) {
        console.error('[restrict][error]', err.message);
        await interaction.reply(ephemeral('Failed to restrict that user.'));
    }
}

async function handleUnrestrict(interaction) {
    const { guild } = interaction;
    const user = interaction.options.getUser('user');
    const gm = await guild.members.fetch(user.id).catch(() => null);
    if (!gm) return interaction.reply(ephemeral('Could not find that member.'));
    try {
        await interaction.channel.permissionOverwrites.edit(gm, { SendMessages: null });
        await interaction.reply(`Removed channel restriction from **${user.tag}**.`);
    } catch (err) {
        console.error('[unrestrict][error]', err.message);
        await interaction.reply(ephemeral('Failed to unrestrict that user.'));
    }
}

async function handlePurge(interaction) {
    const amount = interaction.options.getInteger('amount');
    try {
        const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
        const fetched = await interaction.channel.messages.fetch({ limit: amount });
        const deletable = fetched.filter(m => m.createdTimestamp > cutoff);
        const tooOld = fetched.size - deletable.size;

        let deleted;
        if (deletable.size === 0) {
            return interaction.reply(ephemeral(`None of the last ${fetched.size} message(s) can be deleted - all are older than 14 days.`));
        } else if (deletable.size === 1) {
            await deletable.first().delete();
            deleted = 1;
        } else {
            const result = await interaction.channel.bulkDelete(deletable, true);
            deleted = result.size;
        }

        const skippedNote = tooOld > 0 ? ` (${tooOld} message(s) skipped - older than 14 days)` : '';
        await interaction.reply(ephemeral(`Deleted ${deleted} message(s).${skippedNote}`));
    } catch (err) {
        console.error('[purge][error]', err.message);
        await interaction.reply(ephemeral('Failed to delete messages.'));
    }
}

async function handleMassUnban(interaction) {
    if (!interaction.options.getBoolean('confirm')) return interaction.reply(ephemeral('Cancelled.'));
    const { guild } = interaction;
    const bans = await guild.bans.fetch();
    if (!bans.size) return interaction.reply(ephemeral('No banned users.'));
    await interaction.reply(ephemeral(`Unbanning ${bans.size} users...`));
    let ok = 0;
    for (const ban of bans.values()) {
        await guild.members.unban(ban.user.id).then(() => ok++).catch(() => {});
    }
    await interaction.followUp(ephemeral(`Done. Unbanned ${ok}/${bans.size} users.`));
}

async function handleEmbedCreate(interaction) {
    const channel = interaction.options.getChannel('channel');
    const e = embed(interaction.options.getString('title')).setDescription(interaction.options.getString('description'));
    try {
        await channel.send({ embeds: [e] });
        await interaction.reply(ephemeral('Embed sent.'));
    } catch (err) {
        console.error('[embedcreate][error]', err.message);
        await interaction.reply(ephemeral('Failed to send embed.'));
    }
}

async function handleEmbedEdit(interaction) {
    const link = interaction.options.getString('messagelink');
    const parsed = parseDiscordMessageLink(link);
    if (!parsed) {
        return interaction.reply(ephemeral('Invalid Discord message link. Use a full /channels/... URL.'));
    }
    const { channelId, messageId } = parsed;
    try {
        const ch = await interaction.guild.channels.fetch(channelId);
        const msg = await ch.messages.fetch(messageId);
        if (!msg.embeds[0]) return interaction.reply(ephemeral('No embed on that message.'));
        const orig = msg.embeds[0];
        const e = new EmbedBuilder(orig.data)
            .setTitle(interaction.options.getString('title') || orig.title)
            .setDescription(interaction.options.getString('description') || orig.description);
        await msg.edit({ embeds: [e] });
        await interaction.reply(ephemeral('Embed updated.'));
    } catch (err) {
        console.error('[embededit][error]', err.message);
        await interaction.reply(ephemeral('Could not fetch that message. Check the link.'));
    }
}


const HANDLERS = {
    ping: handlePing,
    help: handleHelp,
    serverinfo: handleServerInfo,
    profile: handleProfile,
    meme: handleMeme,
    search: handleSearch,
    ban: handleBan,
    unban: handleUnban,
    kick: handleKick,
    mute: handleMute,
    unmute: handleUnmute,
    restrict: handleRestrict,
    unrestrict: handleUnrestrict,
    purge: handlePurge,
    massunban: handleMassUnban,
    embedcreate: handleEmbedCreate,
    embededit: handleEmbedEdit,
};

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const handler = HANDLERS[interaction.commandName];
    if (!handler) return;

    const wait = checkCooldown(interaction.user.id, interaction.commandName);
    if (wait > 0) {
        await interaction.reply(ephemeral(`Slow down - try \`/${interaction.commandName}\` again in ${wait}s.`)).catch(() => {});
        return;
    }
    if (MOD_COMMANDS.has(interaction.commandName)) auditLog(interaction);

    try {
        await handler(interaction);
    } catch (err) {
        console.error(`[${interaction.commandName}][error]`, err.message);
        const reply = ephemeral('Something went wrong. Please try again.');
        if (interaction.deferred || interaction.replied) await interaction.followUp(reply).catch(() => {});
        else await interaction.reply(reply).catch(() => {});
    }
});

if (!config.token || !config.clientId) {
    console.error(`[BOT][error] Missing DISCORD_TOKEN/CLIENT_ID. Set them in ${path.join(__dirname, '.env')}`);
    process.exit(1);
}

client.login(config.token).catch(err => {
    console.error('[BOT][error] Login failed:', err.message);
    process.exit(1);
});
