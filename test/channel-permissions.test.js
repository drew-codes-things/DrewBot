const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ChannelType, MessageFlags, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const { HANDLERS } = require('../index.js');

const GUILD_ID = '100';
const BOT_ID = '900';
const MEMBER = { id: '2', roles: { highest: { position: 40 } } };
const REACTION_ROLES_PATH = path.join(__dirname, '..', 'reaction-roles.json');
const WELCOME_CONFIG_PATH = path.join(__dirname, '..', 'welcome-config.json');

const { ViewChannel, SendMessages, SendMessagesInThreads, EmbedLinks, ManageMessages, ManageThreads, Administrator } = PermissionFlagsBits;
const CAN_POST_EMBEDS = [ViewChannel, SendMessages, EmbedLinks];

function fakeChannel(id, memberPermissions, { type = ChannelType.GuildText, messages = {}, threadMemberIds = [] } = {}) {
    const isThreadType = type === ChannelType.PublicThread || type === ChannelType.PrivateThread;
    const channel = {
        id,
        type,
        sent: [],
        isThread: () => isThreadType,
        members: { cache: new Map(threadMemberIds.map(memberId => [memberId, {}])) },
        permissionsFor: member => (member === MEMBER ? new PermissionsBitField(memberPermissions) : null),
        send: async payload => {
            channel.sent.push(payload);
            return { id: '777', url: `https://discord.com/channels/${GUILD_ID}/${id}/777` };
        },
        messages: {
            fetch: async messageId => {
                if (!messages[messageId]) throw new Error('Unknown Message');
                return messages[messageId];
            },
        },
        toString: () => `<#${id}>`,
    };
    return channel;
}

function fakeMessage(authorId) {
    const message = {
        author: { id: authorId },
        edits: [],
        embeds: [{ data: { title: 'Old title', description: 'Old body' }, title: 'Old title', description: 'Old body' }],
        edit: async payload => {
            message.edits.push(payload);
            return message;
        },
    };
    return message;
}

function fakeInteraction({ channel = null, strings = {}, role = null, guildChannels = {} } = {}) {
    const interaction = {
        guildId: GUILD_ID,
        guild: {
            id: GUILD_ID,
            ownerId: '1',
            members: { me: { roles: { highest: { position: 50 } } } },
            channels: {
                fetch: async channelId => {
                    if (!guildChannels[channelId]) throw new Error('Unknown Channel');
                    return guildChannels[channelId];
                },
            },
        },
        member: MEMBER,
        user: { id: MEMBER.id, tag: 'member#0001' },
        client: { user: { id: BOT_ID } },
        options: {
            getChannel: () => channel,
            getString: name => strings[name] ?? null,
            getRole: () => role,
        },
        replies: [],
        reply: async payload => {
            interaction.replies.push(payload);
        },
    };
    return interaction;
}

function lastReply(interaction) {
    const payload = interaction.replies.at(-1);
    return typeof payload === 'string' ? { content: payload } : payload;
}

function assertRefused(interaction, pattern) {
    const reply = lastReply(interaction);
    assert.ok(reply, 'the member should get a reply');
    assert.equal(reply.flags, MessageFlags.Ephemeral);
    assert.match(reply.content, pattern);
}

function recordStoreWrites(t) {
    const writes = [];
    const realWrite = fs.writeFileSync;
    t.mock.method(fs, 'writeFileSync', (file, ...rest) => {
        if (file === REACTION_ROLES_PATH || file === WELCOME_CONFIG_PATH) {
            writes.push(file);
            return undefined;
        }
        return realWrite.call(fs, file, ...rest);
    });
    return writes;
}

function serveReactionRoles(t, store) {
    const realRead = fs.readFileSync;
    t.mock.method(fs, 'readFileSync', (file, ...rest) => {
        if (file === REACTION_ROLES_PATH) return JSON.stringify(store);
        return realRead.call(fs, file, ...rest);
    });
}

const EMBED_FIELDS = { title: 'Hello', description: 'Body' };

for (const [missing, granted] of [
    ['View Channel', [SendMessages, EmbedLinks]],
    ['Send Messages', [ViewChannel, EmbedLinks]],
    ['Embed Links', [ViewChannel, SendMessages]],
]) {
    test(`/embedcreate refuses a member without ${missing} in the target channel`, async () => {
        const channel = fakeChannel('200', granted);
        const interaction = fakeInteraction({ channel, strings: EMBED_FIELDS });
        await HANDLERS.embedcreate(interaction);
        assert.equal(channel.sent.length, 0);
        assertRefused(interaction, /<#200>/);
    });
}

test('/embedcreate posts when the member can view, send and embed links in the target channel', async () => {
    const channel = fakeChannel('200', CAN_POST_EMBEDS);
    const interaction = fakeInteraction({ channel, strings: EMBED_FIELDS });
    await HANDLERS.embedcreate(interaction);
    assert.equal(channel.sent.length, 1);
    assert.equal(lastReply(interaction).content, 'Embed sent.');
});

test('/embedcreate lets an administrator post anywhere', async () => {
    const channel = fakeChannel('200', [Administrator]);
    const interaction = fakeInteraction({ channel, strings: EMBED_FIELDS });
    await HANDLERS.embedcreate(interaction);
    assert.equal(channel.sent.length, 1);
});

test('/embedcreate into a thread needs Send Messages in Threads, not Send Messages', async () => {
    const refused = fakeChannel('201', CAN_POST_EMBEDS, { type: ChannelType.PublicThread });
    const refusedInteraction = fakeInteraction({ channel: refused, strings: EMBED_FIELDS });
    await HANDLERS.embedcreate(refusedInteraction);
    assert.equal(refused.sent.length, 0);

    const allowed = fakeChannel('202', [ViewChannel, SendMessagesInThreads, EmbedLinks], { type: ChannelType.PublicThread });
    await HANDLERS.embedcreate(fakeInteraction({ channel: allowed, strings: EMBED_FIELDS }));
    assert.equal(allowed.sent.length, 1);
});

test('/embedcreate into a private thread needs membership or Manage Threads', async () => {
    const threadPermissions = [ViewChannel, SendMessagesInThreads, EmbedLinks];
    const outsider = fakeChannel('203', threadPermissions, { type: ChannelType.PrivateThread });
    await HANDLERS.embedcreate(fakeInteraction({ channel: outsider, strings: EMBED_FIELDS }));
    assert.equal(outsider.sent.length, 0);

    const joined = fakeChannel('204', threadPermissions, { type: ChannelType.PrivateThread, threadMemberIds: [MEMBER.id] });
    await HANDLERS.embedcreate(fakeInteraction({ channel: joined, strings: EMBED_FIELDS }));
    assert.equal(joined.sent.length, 1);

    const manager = fakeChannel('205', [...threadPermissions, ManageThreads], { type: ChannelType.PrivateThread });
    await HANDLERS.embedcreate(fakeInteraction({ channel: manager, strings: EMBED_FIELDS }));
    assert.equal(manager.sent.length, 1);
});

test('/embedcreate refuses a channel it cannot check permissions on', async () => {
    const interaction = fakeInteraction({ channel: { id: '206', type: ChannelType.GuildText }, strings: EMBED_FIELDS });
    await HANDLERS.embedcreate(interaction);
    assertRefused(interaction, /<#206>|channel/);
});

function editLink(channelId, messageId = '300') {
    return { messagelink: `https://discord.com/channels/${GUILD_ID}/${channelId}/${messageId}`, title: 'New title' };
}

test('/embededit refuses to edit a message the bot did not post', async () => {
    const message = fakeMessage('someone-else');
    const channel = fakeChannel('210', [ViewChannel, SendMessages, ManageMessages], { messages: { 300: message } });
    const interaction = fakeInteraction({ strings: editLink('210'), guildChannels: { 210: channel } });
    await HANDLERS.embededit(interaction);
    assert.equal(message.edits.length, 0);
    assertRefused(interaction, /only edit embeds I posted/);
});

test('/embededit refuses a member who can neither send nor manage messages in that channel', async () => {
    const message = fakeMessage(BOT_ID);
    const channel = fakeChannel('211', [ViewChannel, EmbedLinks], { messages: { 300: message } });
    const interaction = fakeInteraction({ strings: editLink('211'), guildChannels: { 211: channel } });
    await HANDLERS.embededit(interaction);
    assert.equal(message.edits.length, 0);
    assertRefused(interaction, /<#211>/);
});

test('/embededit refuses a member who cannot see that channel', async () => {
    const message = fakeMessage(BOT_ID);
    const channel = fakeChannel('212', [SendMessages, ManageMessages], { messages: { 300: message } });
    const interaction = fakeInteraction({ strings: editLink('212'), guildChannels: { 212: channel } });
    await HANDLERS.embededit(interaction);
    assert.equal(message.edits.length, 0);
    assertRefused(interaction, /<#212>/);
});

for (const [label, granted] of [
    ['Manage Messages', [ViewChannel, ManageMessages]],
    ['Send Messages', [ViewChannel, SendMessages]],
]) {
    test(`/embededit edits the bot's embed for a member with View Channel and ${label}`, async () => {
        const message = fakeMessage(BOT_ID);
        const channel = fakeChannel('213', granted, { messages: { 300: message } });
        const interaction = fakeInteraction({ strings: editLink('213'), guildChannels: { 213: channel } });
        await HANDLERS.embededit(interaction);
        assert.equal(message.edits.length, 1);
        assert.equal(lastReply(interaction).content, 'Embed updated.');
    });
}

test('/welcomechannel refuses a channel the member cannot post embeds in, and saves nothing', async t => {
    const writes = recordStoreWrites(t);
    const channel = fakeChannel('220', [ViewChannel, EmbedLinks]);
    const interaction = fakeInteraction({ channel });
    await HANDLERS.welcomechannel(interaction);
    assert.deepEqual(writes, []);
    assertRefused(interaction, /<#220>/);
});

test('/welcomechannel saves a channel the member can post embeds in', async t => {
    const writes = recordStoreWrites(t);
    const channel = fakeChannel('221', CAN_POST_EMBEDS);
    const interaction = fakeInteraction({ channel });
    await HANDLERS.welcomechannel(interaction);
    assert.deepEqual(writes, [WELCOME_CONFIG_PATH]);
});

test('/reactionrolecreate refuses a channel the member cannot post embeds in, and saves nothing', async t => {
    const writes = recordStoreWrites(t);
    const channel = fakeChannel('230', [ViewChannel, EmbedLinks]);
    const interaction = fakeInteraction({ channel, strings: EMBED_FIELDS });
    await HANDLERS.reactionrolecreate(interaction);
    assert.equal(channel.sent.length, 0);
    assert.deepEqual(writes, []);
    assertRefused(interaction, /<#230>/);
});

test('/reactionrolecreate posts a panel where the member can post embeds', async t => {
    const writes = recordStoreWrites(t);
    serveReactionRoles(t, {});
    const channel = fakeChannel('231', CAN_POST_EMBEDS);
    await HANDLERS.reactionrolecreate(fakeInteraction({ channel, strings: EMBED_FIELDS }));
    assert.equal(channel.sent.length, 1);
    assert.deepEqual(writes, [REACTION_ROLES_PATH]);
});

const PANEL_ROLE = { id: '41', name: 'Gamer', position: 5, managed: false };

function panelSetup(t, granted, { roles = {} } = {}) {
    const writes = recordStoreWrites(t);
    serveReactionRoles(t, { 300: { channelId: '240', roles } });
    const panelMessage = fakeMessage(BOT_ID);
    const channel = fakeChannel('240', granted, { messages: { 300: panelMessage } });
    const interaction = fakeInteraction({
        strings: { messagelink: `https://discord.com/channels/${GUILD_ID}/240/300`, label: 'Gamer' },
        role: PANEL_ROLE,
        guildChannels: { 240: channel },
    });
    return { writes, panelMessage, interaction };
}

test('/reactionroleadd refuses a panel in a channel the member cannot send or manage in', async t => {
    const { writes, panelMessage, interaction } = panelSetup(t, [ViewChannel]);
    await HANDLERS.reactionroleadd(interaction);
    assert.equal(panelMessage.edits.length, 0);
    assert.deepEqual(writes, []);
    assertRefused(interaction, /<#240>/);
});

test('/reactionroleadd updates a panel in a channel the member can manage', async t => {
    const { writes, panelMessage, interaction } = panelSetup(t, [ViewChannel, ManageMessages]);
    await HANDLERS.reactionroleadd(interaction);
    assert.equal(panelMessage.edits.length, 1);
    assert.deepEqual(writes, [REACTION_ROLES_PATH]);
});

test('/reactionroleremove refuses a panel in a channel the member cannot see', async t => {
    const { writes, panelMessage, interaction } = panelSetup(t, [SendMessages, ManageMessages], { roles: { 41: 'Gamer' } });
    await HANDLERS.reactionroleremove(interaction);
    assert.equal(panelMessage.edits.length, 0);
    assert.deepEqual(writes, []);
    assertRefused(interaction, /<#240>/);
});

test('/reactionroleremove updates a panel in a channel the member can send in', async t => {
    const { writes, panelMessage, interaction } = panelSetup(t, [ViewChannel, SendMessages], { roles: { 41: 'Gamer' } });
    await HANDLERS.reactionroleremove(interaction);
    assert.equal(panelMessage.edits.length, 1);
    assert.deepEqual(writes, [REACTION_ROLES_PATH]);
});
