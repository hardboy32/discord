# Discord Music + Moderation + AI Bot (Railway)

This repository is configured to run as a **persistent Discord bot service on Railway**. It does not need a public domain, HTTP server, or exposed port.

## Features

### Music
- `/play query` — search by song name or play a YouTube/SoundCloud URL
- `/join`, `/queue`, `/skip`, `/pause`, `/resume`, `/stop`, `/leave`
- Natural-language music requests, for example: `محمد آهنگ ... رو پخش کن`

### Interactive now-playing panel

When a track starts, the bot posts or updates one music player message in the text channel where playback was requested. It includes the track artwork when the source provides one, title, duration, requester, and buttons for pause/resume, skip, stop, loop mode, and queue display. Loop mode cycles through off, repeat current track, and repeat queue. Music controls are limited to members who are in the bot's voice channel.

## Moderation
- `/kick`, `/ban`, `/timeout`, `/untimeout`
- `/clear amount`, `/slowmode seconds`, `/lock`, `/unlock`
- `/warn`, `/warnings`, `/clearwarns`
- `/ping`, `/help`, `/activity`

Moderation commands require the corresponding Discord permissions. The bot role must be above members it is asked to moderate.

### AI chat
When enabled, the bot can answer when a member:
- Starts a message with `محمد` or `ربات`
- Mentions the bot
- Replies directly to one of the bot's messages

AI replies use the member's language, maintain a short in-memory conversation history per member/channel, and have a small per-user cooldown. AI is powered by the Groq API; it is not enabled until `GROQ_API_KEY` is configured.

## Deploy on Railway

1. In Railway, create a new project and choose **Deploy from GitHub repo**.
2. Select `hardboy32/discord` and the `main` branch.
3. Let Railway detect the Node.js project automatically. Do not add an Infrlo build command, Dockerfile, or custom FFmpeg apt-install command.
4. Set the variables listed below in the service's **Variables** tab.
5. Deploy the service. The start command is `npm start`; it is also defined in `package.json`.
6. Keep the service running as a single replica so multiple copies do not compete to run the same Discord bot token.

### Railway build/runtime settings

- Builder: Railway's automatic Railpack detection
- Runtime: Node.js 22 (minimum 22.12.0)
- Build command: leave blank / automatic
- Start command: `npm start`
- Public networking/domain: not required
- Port: not required
- FFmpeg: supplied by the `ffmpeg-static` npm dependency; no system package installation is configured

## Environment variables

| Variable | Required? | Purpose |
|---|---|---|
| `DISCORD_TOKEN` | **Yes** | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Recommended | Discord application ID |
| `DISCORD_GUILD_ID` | Optional | Test server ID; commands update faster in this server. Leave blank for global commands |
| `BOT_OWNER_ID` | Optional | Your Discord user ID for the owner-only `/activity` command |
| `GROQ_API_KEY` | Optional | Enables AI chat replies |
| `GROQ_MODEL` | Optional | Groq model ID; defaults to `openai/gpt-oss-20b` |
| `WARNINGS_FILE` | Optional | Warnings JSON path; default is `./data/warnings.json` |

Never commit real bot tokens or API keys to GitHub. Add secrets only in Railway Variables.

## Persistent storage (recommended)

Warning records are written to `data/warnings.json`. Railway's normal container filesystem is temporary, so create a Railway **Volume** and mount it at:

```text
/app/data
```

The app's default warning-file location is `/app/data/warnings.json` when Railway runs the project from `/app`. You do not need to set `WARNINGS_FILE` unless you want a different location.

The bot's music queue and AI conversation history are held in memory and are intentionally not persisted; they reset when the service restarts.

## Discord Developer Portal setup

1. Create an application and add a Bot.
2. Copy the bot token and application ID into Railway Variables.
3. Under **Bot**, enable **Message Content Intent**. The bot requests this privileged intent to support the Persian name-prefix triggers and conversational AI.
4. Invite the bot using OAuth2 URL Generator with scopes `bot` and `applications.commands`.
5. Grant the permissions needed by your server: View Channels, Send Messages, Use Application Commands, Connect, Speak, Kick Members, Ban Members, Moderate Members, Manage Messages, and Manage Channels. Only grant moderation permissions if you intend to use those features.
6. Ensure the bot's role is above members it needs to kick, ban, or timeout.

## Enable Groq AI

1. Create an API key at [Groq Console](https://console.groq.com/keys).
2. Add it as `GROQ_API_KEY` in Railway Variables.
3. Optionally set `GROQ_MODEL`; otherwise the default is `openai/gpt-oss-20b`.
4. Redeploy (or let Railway restart the service after the variable change).

Groq free-tier rate limits apply and can change. If the key is absent, the bot's music and moderation features still run; only AI chat is disabled.

## Troubleshooting

- **Bot does not log in:** check `DISCORD_TOKEN` and confirm the token has not been reset.
- **AI does not answer:** check `GROQ_API_KEY`, the selected model, and the Discord Message Content Intent setting.
- **Slash commands do not appear:** temporarily set `DISCORD_GUILD_ID` to your test server ID and confirm the bot was invited with `applications.commands`.
- **Music does not play:** check Railway logs for source extraction/network errors and confirm the bot has Connect and Speak permissions. YouTube and SoundCloud extraction can be affected by upstream changes.
- **Warnings disappear after redeploy:** confirm the Railway Volume is mounted at `/app/data`.

## Local checks

```bash
npm install
npm run check
npm start
```
