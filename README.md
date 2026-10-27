# Discord Music + Moderation Bot

A Discord slash-command bot designed for Infrlo.

## Music commands
- `/play query` — search by song name, or use a YouTube/SoundCloud track URL
- `/join` — join the voice channel you are currently in
- `/queue` — show the current track and upcoming tracks
- `/skip` — skip the current track
- `/pause` and `/resume` — pause/resume playback
- `/stop` — stop playback and clear the queue
- `/leave` — leave voice

## Moderation commands
- `/kick`, `/ban`
- `/timeout`, `/untimeout`
- `/clear amount` — delete up to 100 recent messages (Discord does not bulk-delete messages older than 14 days)
- `/slowmode seconds`
- `/lock`, `/unlock`
- `/warn`, `/warnings`, `/clearwarns`
- `/ping`, `/help`

Moderation commands are restricted by Discord permissions. The bot needs the corresponding server permissions. Its role must also be above members it is asked to kick, ban, or timeout.

## Infrlo setup

Repository: `hardboy32/DISCORD`  
Branch: `main`

**Build Command**
```bash
npm install --omit=dev --no-audit --no-fund
```

**Start Command**
```bash
npm start
```

The buildpack currently selects Node.js 20 even though the voice library requires Node.js 22.12 or newer. This project includes the Node.js 22.23.4 binary as an npm dependency, and `npm start` uses the local binary. On startup, the logs should print `v22.23.4` before the bot login message.

Add these Environment Variables in Infrlo:
- `DISCORD_TOKEN` — bot token from Discord Developer Portal
- `DISCORD_CLIENT_ID` — Application ID from Discord Developer Portal
- `DISCORD_GUILD_ID` — optional test server ID. For a public bot, leave it blank so commands register globally.

Do not put the real token in GitHub or in `.env.example`. Add it only to Infrlo's Environment Variables. Redeploy after setting the variables.

## Invite the bot

In Discord Developer Portal, create an application and add its Bot. Use OAuth2 URL Generator with scopes `bot` and `applications.commands`. Grant only the permissions needed: View Channels, Send Messages, Use Application Commands, Connect, Speak, Kick Members, Ban Members, Moderate Members, Manage Messages, and Manage Channels. The bot's role hierarchy must permit the requested moderation action.

## Notes
- Music source extraction depends on upstream YouTube/SoundCloud changes and network access from the host. The code does not bundle a large static FFmpeg binary, to keep deployment lighter.
- Warning records are saved to `data/warnings.json`. They may be lost when Infrlo replaces an ephemeral container unless persistent storage is enabled.
- The Node.js binary is installed locally from npm to bypass an Infrlo buildpack that currently uses Node.js 20 for this app. This adds some download size to the build.
