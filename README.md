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
- `/activity` — set the bot activity (bot owner only); choose Playing, Listening, Watching, Competing, or Clear activity

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
npm install --omit=dev --no-audit --no-fund && apt-get update && apt-get install -y ffmpeg
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
- `BOT_OWNER_ID` — optional Discord user ID allowed to change the global activity. The bot attempts to detect the application owner automatically if this is blank; set it if automatic detection does not work.
- `GROQ_API_KEY` — optional key from the Groq free tier; enables AI replies when members mention the bot or reply to it.
- `GROQ_MODEL` — optional Groq model ID; defaults to `openai/gpt-oss-20b`.

Do not put the real token in GitHub or in `.env.example`. Add it only to Infrlo's Environment Variables. Redeploy after setting the variables.

## Free AI chat

The bot can reply conversationally when a member starts a message with `محمد`, `ربات`, `(محمد)`, or `(ربات)`, mentions the bot, or replies to one of its messages. The trigger prefix is removed before the message is sent to the AI. It uses Groq's free API tier by default, with model `openai/gpt-oss-20b`. Free-tier rate limits apply; if a limit is reached, the bot will ask users to try again later.

1. Create a free account at [Groq Console](https://console.groq.com/) and create an API key at [Groq API Keys](https://console.groq.com/keys).
2. In Infrlo Environment Variables, add `GROQ_API_KEY` and set its value to the key you created. Do not put the key in GitHub or share it publicly.
3. In Discord Developer Portal, open the bot application, go to **Bot**, enable **Message Content Intent**, and save changes. The code also requests the Message Content privileged intent.
4. Redeploy the bot on Infrlo.

The bot replies only when mentioned or directly replied to, uses the user's language, keeps a short conversation history per member/channel, and includes a small per-user cooldown. No payment method is needed for the Groq Free plan; do not upgrade to a paid tier if you want to keep this setup free. Review Groq's current [rate limits](https://console.groq.com/docs/rate-limits) because they can change.

## Invite the bot

In Discord Developer Portal, create an application and add its Bot. Use OAuth2 URL Generator with scopes `bot` and `applications.commands`. Grant only the permissions needed: View Channels, Send Messages, Use Application Commands, Connect, Speak, Kick Members, Ban Members, Moderate Members, Manage Messages, and Manage Channels. The bot's role hierarchy must permit the requested moderation action.

## Set the bot activity

Use `/activity` and choose an activity type. Examples: `Playing` + `Chess`, `Listening to` + `Music`, `Watching` + `Movies`, or `Competing in` + `Ranked`. Choose `Clear activity` to remove the activity text. The command changes the bot's global presence and is restricted to the application owner.

## Notes
- Music source extraction depends on upstream YouTube/SoundCloud changes and network access from the host. The Build Command installs the system FFmpeg and the bot prefers `/usr/bin/ffmpeg`; it falls back to the npm `ffmpeg-static` package only if a system binary is unavailable. Runtime logs print the selected FFmpeg path and version.
- Warning records are saved to `data/warnings.json`. They may be lost when Infrlo replaces an ephemeral container unless persistent storage is enabled.
- The Node.js binary is installed locally from npm to bypass an Infrlo buildpack that currently uses Node.js 20 for this app. This adds some download size to the build.
