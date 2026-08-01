<div align="center">

# DrewBot

**A Discord moderation and utility bot with TMDB search, Reddit memes, embed management, and a full suite of slash commands.**

[![JavaScript](https://img.shields.io/badge/javascript-discord.js%20v14-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.js.org/)
[![Node.js](https://img.shields.io/badge/node.js-18+-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

</div>

---

## Overview

DrewBot is a single-file Discord bot built with discord.js v14. All commands are registered as global slash commands on startup. The bot uses TMDB to power a paginated movie and TV search, scrapes Reddit's public Atom RSS feed to deliver random image memes, and provides a complete moderation toolkit - all from `index.js` with no external command loader or framework.

---

## Commands

### General

| Command | Description |
|---|---|
| `/ping` | Returns current API websocket latency in ms |
| `/help` | Lists all commands grouped by category |
| `/serverinfo` | Shows server name, member count (humans vs bots), owner, channel count, role count, and creation date |
| `/profile [user]` | Shows a user's avatar, account creation date, server join date, nickname, and roles. Defaults to yourself if no user is provided |
| `/meme` | Fetches a random image post from r/memes via RSS. Parses Atom `<content>` HTML to resolve the best quality image from `i.redd.it`, `preview.redd.it`, or `media:thumbnail` |
| `/search <title> <type>` | Searches TMDB for a movie or TV show. Results are paginated with Previous/Next buttons. Fetches up to 3 pages of TMDB results. Session expires after 5 minutes |

### Moderation

All moderation commands require the matching Discord permission on the invoking user.

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

### Welcome

| Command | Permission required | Description |
|---|---|---|
| `/welcomechannel <channel>` | Manage Messages | Sets the channel where new-member welcome messages are posted |

When a new member joins a server with a welcome channel configured, DrewBot posts an embed mentioning them there. The channel choice is stored per-guild in `welcome-config.json` (not committed to git).

### Reaction Roles

| Command | Permission required | Description |
|---|---|---|
| `/reactionrolecreate <channel> <title> <description>` | Manage Roles | Posts a reaction role panel embed (no buttons yet) and replies with its message link |
| `/reactionroleadd <messagelink> <role> <label>` | Manage Roles | Adds a button for the given role to an existing panel. Fails if the role is `@everyone`, a managed integration role, or above the bot's highest role. A panel supports up to 25 role buttons (5 rows of 5) |
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
