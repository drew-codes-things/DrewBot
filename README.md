<div align="center">

# DrewBot

**A Discord moderation and utility bot with TMDB search, Reddit memes, embed management, and a full suite of slash commands.**

[![JavaScript](https://img.shields.io/badge/javascript-discord.js%20v14-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.js.org/)
[![Node.js](https://img.shields.io/badge/node.js-18+-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

</div>

---

## Overview

DrewBot is a single-file Discord bot built with discord.js v14. All commands are registered as global slash commands on startup. The bot uses TMDB to power a paginated movie and TV search, delivers random image memes from RedditDownloaderV4's Discord relay or Reddit's public Atom RSS feed, and provides a complete moderation toolkit - all from `index.js` with no external command loader or framework.

---

## Commands

### General

| Command | Description |
|---|---|
| `/ping` | Returns current API websocket latency in ms |
| `/status` | Uptime, latency, server count, bot and discord.js versions, memory use and whether the meme relay is set up |
| `/help` | Lists all commands grouped by category |
| `/serverinfo` | Shows server name, member count (humans vs bots), owner, channel count, role count, and creation date |
| `/profile [user]` | Shows a user's avatar, account creation date, server join date, nickname, and roles. Defaults to yourself if no user is provided |
| `/meme` | Posts a random r/memes image from the Discord relay (RedditDownloaderV4's Devvit app) when one is set up, otherwise from r/memes via RSS. Parses Atom `<content>` HTML to resolve the best quality image from `i.redd.it`, `preview.redd.it`, or `media:thumbnail` |
| `/search <title> <type>` | Searches TMDB for a movie or TV show. Results are paginated with Previous/Next buttons. Fetches up to 3 pages of TMDB results. Session expires after 5 minutes |

### Moderation

All moderation commands require the matching Discord permission on the invoking user, and `/ban`, `/kick`, `/mute`, `/unmute`, `/restrict` and `/unrestrict` only work on members whose highest role is below the moderator's (the server owner can act on anyone). Commands only work inside a server, not in DMs.

| Command | Permission required | Description |
|---|---|---|
| `/ban <user> [reason]` | Ban Members | Bans a user. Checks `bannable` before attempting |
| `/unban <userid>` | Ban Members | Unbans a user by their numeric ID |
| `/kick <user> [reason]` | Kick Members | Kicks a user. Checks `kickable` before attempting |
| `/mute <user> [minutes]` | Moderate Members | Times out a user. Default: 10 minutes, max: 40320 (28 days) |
| `/unmute <user>` | Moderate Members | Removes an active timeout |
| `/restrict <user>` | Manage Roles | Denies `SendMessages` for the user in the current channel via a permission overwrite |
| `/unrestrict <user>` | Manage Roles | Removes the `SendMessages` overwrite for the user in the current channel |
| `/purge <amount>` | Manage Messages | Bulk deletes up to 100 messages. Skips any older than 14 days (Discord API limit). Reports how many were skipped |
| `/massunban [confirm]` | Ban Members | Unbans every currently banned user. Requires `confirm: true` to proceed |

### Embeds

| Command | Permission required | Description |
|---|---|---|
| `/embedcreate <channel> <title> <description>` | Manage Messages | Sends a new embed to the specified channel |
| `/embededit <messagelink> [title] [description]` | Manage Messages | Edits an existing bot embed by Discord message link. Validates the link domain before fetching |

These commands also check your access to the channel they act on, not only the channel you type in. `/embedcreate`, `/welcomechannel` and `/reactionrolecreate` need View Channel, Send Messages (Send Messages in Threads for a thread) and Embed Links in the target channel. `/embededit`, `/reactionroleadd` and `/reactionroleremove` only change messages DrewBot posted, and need View Channel plus Send Messages or Manage Messages where that message is. A private thread also needs you to be in it or to have Manage Threads.

### Welcome

| Command | Permission required | Description |
|---|---|---|
| `/welcomechannel <channel>` | Manage Messages | Sets the channel where new-member welcome messages are posted |

When a new member joins a server with a welcome channel configured, DrewBot posts an embed mentioning them there. The channel choice is stored per-guild in `welcome-config.json` (not committed to git).

### Reaction Roles

| Command | Permission required | Description |
|---|---|---|
| `/reactionrolecreate <channel> <title> <description>` | Manage Roles | Posts a reaction role panel embed (no buttons yet) and replies with its message link |
| `/reactionroleadd <messagelink> <role> <label>` | Manage Roles | Adds a button for the given role to an existing panel. Fails if the role is `@everyone`, a managed integration role, above the bot's highest role, or not below your own highest role (the server owner is exempt). A panel supports up to 25 role buttons (5 rows of 5) |
| `/reactionroleremove <messagelink> <role>` | Manage Roles | Removes a role's button from an existing panel |

Members click a role's button to receive it, and click it again to remove it - a toggle, same as classic emoji reaction roles but using Discord buttons instead (matches the buttons already used by `/search`). Panel-to-role mappings are stored per-message in `reaction-roles.json` (not committed to git), so panels keep working across bot restarts.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

Requires: `discord.js`, `axios`, `dotenv`

### 2. Configure environment

Copy `.env.example` to `.env`:

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_client_id
TMDB_API_KEY=your_tmdb_api_key
GUILD_ID=                 # optional: register to one guild for instant updates
COOLDOWN_SECONDS=3        # optional: per-user per-command cooldown (default 3)
```

Get a TMDB API key at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api).

**Least-privilege token:** create the bot with only the scopes/intents it needs - `bot` + `applications.commands` scopes, and Server Members + Moderation gateway intents. Grant the bot role only the moderation permissions you intend to use (Ban/Kick/Moderate Members, Manage Roles, Manage Messages). Never commit the token; it lives only in `.env`.

### 3. Run

```bash
node index.js
```

Slash commands are registered on startup. By default they register **globally** (can take up to 1 hour to propagate). Set `GUILD_ID` in `.env` to register them to a single guild instead, where updates are **instant** - ideal for development.

Every moderation command (`/ban`, `/kick`, `/mute`, `/purge`, etc.) is recorded to `audit.log` (and the console) with a timestamp, the invoking user, the guild, and the target. A per-user per-command cooldown (`COOLDOWN_SECONDS`, default 3s) throttles spam. Set `LOG_JSON=true` to emit structured JSON logs (lifecycle, command registration, audit, errors) to stdout.

### 4. Test

```bash
npm test
```

The tests use Node's built-in runner with Discord mocked out, so they need no token and never contact Discord. Loading `index.js` from a test does not start the bot; only `node index.js` does.

---

## How the Meme Command Works

The `/meme` command fetches `https://www.reddit.com/r/memes/.rss?limit=25` as raw XML, parses the Atom `<content>` block for each entry, HTML-unescapes the content, and extracts `<img src>` URLs. Candidates are scored in priority order:

| Source | Score |
|---|---|
| `i.redd.it` | 3 (best) |
| `preview.redd.it` | 2 |
| `external-preview.redd.it` | 1 |
| Direct image URL (any host) | 0 |

`preview.redd.it` URLs are rewritten to their `i.redd.it` originals before posting. If no valid image is found in the content block, the entry's `<media:thumbnail>` is used as a fallback (placeholder values like `self`, `default`, `nsfw` are ignored).

### Discord relay

Reddit's RSS can be throttled or shut off, so `/meme` can also use the relay [RedditDownloaderV4](https://github.com/drew-codes-things/RedditDownloaderV4) uses. Its Devvit app runs inside Reddit and can only reach `discord.com`, so it posts `RELAY:` batches of media links to a Discord webhook. DrewBot is already in the server, so it reads that channel itself - no discord-poller needed, only the webhook.

1. Set up the Devvit app and its webhook as in RedditDownloaderV4's README, pointing the webhook at a channel DrewBot can read
2. In the [Developer Portal](https://discord.com/developers/applications), DrewBot's Bot tab: enable **Message Content Intent** (without it the relay messages arrive empty)
3. Set `RELAY_CHANNEL_ID`, and optionally `RELAY_WEBHOOK_ID` (the `{id}` in the webhook URL) so only that webhook is trusted
4. In Reddit, run **[starbottyyay] Fetch Media to Server** on r/memes

On startup DrewBot loads the channel's last 100 messages, then picks up new batches as they arrive, keeping up to 500 image posts in memory. Messages typed by people or other bots are ignored. If the relay has no r/memes images yet, `/meme` falls back to RSS.

---

## How the Search Command Works

`/search` queries the TMDB `/search/movie` or `/search/tv` endpoint for up to 3 pages of results. Results are displayed one at a time in an embed with Previous/Next navigation buttons. The collector filters to the original user only and auto-expires after 5 minutes, removing the buttons and appending a session-expired notice to the footer.

---

## Notes

- All commands are global slash commands registered via the REST API at startup using `Routes.applicationCommands`.
- The bot status is set to `Watching over the server` (activity type 3) on ready.
- The embed accent colour is turquoise (`0x40E0D0`) throughout.
- The `/embededit` command validates the message link domain against `discord.com`, `canary.discord.com`, and `ptb.discord.com` before fetching.
- The `/purge` command handles the case where only 1 deletable message exists by calling `.delete()` directly instead of `bulkDelete`, since Discord's bulk delete requires at least 2 messages.

---

## Get the Code

Clone with git:

```bash
git clone https://github.com/drew-codes-things/DrewBot.git
```

Or with the [GitHub CLI](https://cli.github.com/):

```bash
gh repo clone drew-codes-things/DrewBot
```

## License

MIT - made by [Drew](https://github.com/drew-codes-things)
