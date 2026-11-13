const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('discord.js');

const EXPORTED_HELPERS = [
    'moderatorOutranks',
    'botCanAssignRole',
    'moderatorCanManageRole',
    'parseDiscordMessageLink',
    'addRelayMessage',
    'extractImageFromContent',
    'checkCooldown',
    'HANDLERS',
];

test('loading index.js neither logs in nor exits, and exposes its helpers', () => {
    process.env.DISCORD_TOKEN = 'test-token-not-real';
    process.env.CLIENT_ID = '1';
    const loginCalls = [];
    const originalLogin = Client.prototype.login;
    const originalExit = process.exit;
    Client.prototype.login = async token => {
        loginCalls.push(token);
        return token;
    };
    process.exit = code => {
        throw new Error(`process.exit(${code}) was called while loading index.js`);
    };
    try {
        const bot = require('../index.js');
        assert.equal(loginCalls.length, 0);
        for (const name of EXPORTED_HELPERS) assert.ok(bot[name], `index.js should export ${name}`);
    } finally {
        Client.prototype.login = originalLogin;
        process.exit = originalExit;
    }
});
