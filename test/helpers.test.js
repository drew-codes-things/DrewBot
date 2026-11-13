const test = require('node:test');
const assert = require('node:assert/strict');

const RELAY_CHANNEL_ID = '500';
const RELAY_WEBHOOK_ID = '600';
process.env.RELAY_CHANNEL_ID = RELAY_CHANNEL_ID;
process.env.RELAY_WEBHOOK_ID = RELAY_WEBHOOK_ID;

const {
    moderatorOutranks,
    botCanAssignRole,
    moderatorCanManageRole,
    parseDiscordMessageLink,
    addRelayMessage,
    extractImageFromContent,
    checkCooldown,
} = require('../index.js');

const GUILD_ID = '100';
const OWNER_ID = '1';
const MODERATOR_ID = '2';

function memberAt(id, position) {
    return { id, roles: { highest: { position } } };
}

function interactionBy(userId, position) {
    return {
        guild: { id: GUILD_ID, ownerId: OWNER_ID },
        user: { id: userId },
        member: memberAt(userId, position),
    };
}

test('a moderator can act only on members below their highest role', () => {
    const moderator = interactionBy(MODERATOR_ID, 5);
    assert.equal(moderatorOutranks(moderator, memberAt('3', 4)), true);
    assert.equal(moderatorOutranks(moderator, memberAt('3', 5)), false);
    assert.equal(moderatorOutranks(moderator, memberAt('3', 9)), false);
});

test('nobody but the owner can act on the owner, and the owner can act on anyone', () => {
    assert.equal(moderatorOutranks(interactionBy(MODERATOR_ID, 99), memberAt(OWNER_ID, 0)), false);
    assert.equal(moderatorOutranks(interactionBy(OWNER_ID, 0), memberAt('3', 99)), true);
});

test('the bot will not hand out @everyone, managed roles or roles at or above its own', () => {
    const guild = { id: GUILD_ID, members: { me: memberAt('bot', 10) } };
    assert.equal(botCanAssignRole(guild, { id: GUILD_ID, position: 0, managed: false }), false);
    assert.equal(botCanAssignRole(guild, { id: '7', position: 1, managed: true }), false);
    assert.equal(botCanAssignRole(guild, { id: '7', position: 10, managed: false }), false);
    assert.equal(botCanAssignRole(guild, { id: '7', position: 9, managed: false }), true);
    assert.equal(botCanAssignRole({ id: GUILD_ID, members: { me: null } }, { id: '7', position: 1, managed: false }), false);
});

test('a moderator can only put roles below their own on a reaction role panel', () => {
    assert.equal(moderatorCanManageRole(interactionBy(MODERATOR_ID, 5), { position: 4 }), true);
    assert.equal(moderatorCanManageRole(interactionBy(MODERATOR_ID, 5), { position: 5 }), false);
    assert.equal(moderatorCanManageRole(interactionBy(OWNER_ID, 0), { position: 50 }), true);
});

test('message links are accepted only from Discord hosts with numeric ids', () => {
    assert.deepEqual(
        parseDiscordMessageLink('https://discord.com/channels/100/200/300'),
        { channelId: '200', messageId: '300' },
    );
    assert.deepEqual(
        parseDiscordMessageLink('https://canary.discord.com/channels/100/200/300'),
        { channelId: '200', messageId: '300' },
    );
    assert.equal(parseDiscordMessageLink('https://discord.com.evil.example/channels/100/200/300'), null);
    assert.equal(parseDiscordMessageLink('https://discord.com/channels/100/200'), null);
    assert.equal(parseDiscordMessageLink('https://discord.com/channels/100/abc/300'), null);
    assert.equal(parseDiscordMessageLink('not a link'), null);
});

function relayMessage(overrides) {
    return {
        id: 'm1',
        channelId: RELAY_CHANNEL_ID,
        webhookId: RELAY_WEBHOOK_ID,
        content: 'RELAY:' + JSON.stringify([{ url: 'https://i.redd.it/a.png', postId: 't3_abc', subreddit: 'memes' }]),
        ...overrides,
    };
}

test('relay images are taken only from the configured webhook in the relay channel', () => {
    assert.equal(addRelayMessage(relayMessage({ channelId: '999' })), 0);
    assert.equal(addRelayMessage(relayMessage({ webhookId: null })), 0);
    assert.equal(addRelayMessage(relayMessage({ webhookId: '601' })), 0);
    assert.equal(addRelayMessage(relayMessage({ content: 'RELAY:not json' })), 0);
    assert.equal(addRelayMessage(relayMessage({ content: 'hello' })), 0);
    assert.equal(addRelayMessage(relayMessage({})), 1);
    assert.equal(addRelayMessage(relayMessage({})), 0);
});

test('relay items that are not images are skipped', () => {
    const content = 'RELAY:' + JSON.stringify([
        { url: 'https://v.redd.it/clip', postId: 't3_video', subreddit: 'memes' },
        { url: 'https://i.redd.it/b.jpg', postId: 't3_image', subreddit: 'memes' },
    ]);
    assert.equal(addRelayMessage(relayMessage({ content })), 1);
});

test('the best RSS image is chosen and preview links point at the original', () => {
    const content = '&lt;img src=&quot;https://example.com/x.png&quot;&gt;'
        + '&lt;img src=&quot;https://preview.redd.it/y.png?width=640&amp;amp;s=1&quot;&gt;';
    assert.equal(extractImageFromContent(content), 'https://i.redd.it/y.png');
    const withOriginal = content + '&lt;img src=&quot;https://i.redd.it/z.png&quot;&gt;';
    assert.equal(extractImageFromContent(withOriginal), 'https://i.redd.it/z.png');
    assert.equal(extractImageFromContent('&lt;img src=&quot;https://example.com/page&quot;&gt;'), null);
    assert.equal(extractImageFromContent(''), null);
});

test('a repeated command inside the cooldown is refused, other commands are not', () => {
    assert.equal(checkCooldown('user-a', 'ping'), 0);
    assert.ok(checkCooldown('user-a', 'ping') > 0);
    assert.equal(checkCooldown('user-a', 'help'), 0);
    assert.equal(checkCooldown('user-b', 'ping'), 0);
});
