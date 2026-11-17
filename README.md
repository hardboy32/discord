# Discord Music + Moderation + AI Bot (Railway)

This repository runs the Discord bot and its single-server web dashboard together in one Railway service. The dashboard uses Discord OAuth2 and is locked to server `686002315148394502` by default.

## Features

### Music
- `/play query` — search by song name or play a YouTube/SoundCloud URL
- `/join`, `/queue`, `/skip`, `/pause`, `/resume`, `/stop`, `/leave`
- Natural-language music requests, for example: `play the song ...`

### Interactive now-playing panel

When a track starts, the bot posts or updates one music player message in the text channel where playback was requested. It includes the track artwork when the source provides one, title, duration, requester, and buttons for pause/resume, skip, stop, loop mode, and queue display. Loop mode cycles through off, repeat current track, and repeat queue. Music controls are limited to members who are in the bot's voice channel.

## Moderation
- `/kick`, `/ban`, `/timeout`, `/untimeout`
- `/clear amount`, `/slowmode seconds`, `/lock`, `/unlock`
- `/warn`, `/warnings`, `/clearwarns`
- `/ping`, `/help`, `/activity`


### Support tickets
- Run `/ticket-setup` with a panel channel, staff role, and transcript channel (optional category).
- Members can open a private ticket from the posted button; the channel is visible to the opener, the configured staff role, and the bot.
- The ticket owner or support staff can close it. The bot exports up to the latest 1,000 messages as a text transcript to the configured transcript channel and marks the ticket closed.
- Ticket panel configuration is stored in the panel message, so opening tickets continues to work after bot restarts.

### AutoMod and server logs
- Optional Discord invite filtering, message-spam detection (5 messages / 5 seconds), mass-mention filtering, and blocked-word filtering.
- AutoMod ignores members with Manage Messages or Administrator permission.
- Configurable event logging for joins, departures, deleted/edited messages (without recording message content), bans, unbans, and channel/role creation or deletion.
- Configurable goodbye messages with `{user}`, `{username}`, `{server}`, and `{count}` placeholders.
- Configure AutoMod and event logging from the dashboard. Set the log channel in the Moderation page.

Moderation commands require the corresponding Discord permissions. The bot role must be above members it is asked to moderate.

### AI chat
When enabled, the bot can answer when a member:
- Starts a message with `bot` or `assistant`
- Mentions the bot
- Replies directly to one of the bot's messages

AI replies use the member's language, maintain a short in-memory conversation history per member/channel, and have a small per-user cooldown. AI is powered by the Groq API; it is not enabled until `GROQ_API_KEY` is configured.

### Web dashboard

The dashboard is served by the same Node.js process at the Railway public domain. It includes Welcome, Moderation, Music, and AI settings. Changes are saved to `/app/data/dashboard-settings.json` and are applied by the bot. The dashboard is restricted to the configured server; only its owner or members with Manage Server / Administrator can sign in.

To enable it:
1. In Discord Developer Portal, open your application **OAuth2** page and copy the Client Secret.
2. In OAuth2 Redirects, add the exact URL `https://YOUR-RAILWAY-DOMAIN/auth/callback` after creating a Railway public domain.
3. Add `DISCORD_CLIENT_SECRET`, `DASHBOARD_SESSION_SECRET` (a long random value), and `DASHBOARD_REDIRECT_URI` to Railway Variables. Keep `DASHBOARD_GUILD_ID` as `686002315148394502`.
4. In Railway, create a public domain for this service. The dashboard listens on Railway's `PORT`; do not create a second service.
5. Mount a Railway Volume at `/app/data` so dashboard settings and warning records persist.
6. In Discord Developer Portal > Bot, enable **Server Members Intent** so welcome messages can be delivered. Message Content Intent is still needed for chat AI and natural-language music requests.
7. Redeploy and open the Railway domain. Sign in with a Discord account that owns the server or has Manage Server / Administrator permission.

Generate the session secret locally with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`. Never put the OAuth client secret or session secret in GitHub or chat.

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
- Public networking/domain: required for the dashboard
- Port: Railway supplies `PORT`; no fixed port value is needed
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
| `DASHBOARD_GUILD_ID` | Optional | Single dashboard server; defaults to `686002315148394502` |
| `DISCORD_CLIENT_SECRET` | Dashboard | Discord OAuth2 Client Secret |
| `DASHBOARD_SESSION_SECRET` | Dashboard | Long random secret used to sign login sessions |
| `DASHBOARD_REDIRECT_URI` | Dashboard | Exact Railway URL ending in `/auth/callback` |
| `DASHBOARD_SETTINGS_FILE` | Optional | Settings JSON path; default `/app/data/dashboard-settings.json` |\n| `YOUTUBE_COOKIES_B64` | Optional | Base64-encoded Netscape-format YouTube cookies; helps yt-dlp access videos that require a signed-in session |
| `WARNINGS_FILE` | Optional | Warnings JSON path; default is `./data/warnings.json` |

Never commit real bot tokens, API keys, or YouTube cookies to GitHub. Add secrets only in Railway Variables.

### Configure YouTube cookies (optional)

The bot uses the official standalone `yt-dlp` binary for YouTube search and playback. It downloads the binary into the temporary runtime directory on first use; no extra Railway build command or Python installation is required.

If YouTube returns "Sign in to confirm you're not a bot", you can optionally provide a Netscape-format cookies file:

1. Use a separate YouTube/Google account that has no personal data, payment methods, or important services.
2. Export cookies for YouTube in Netscape cookies.txt format. Treat this file like a password.
3. Base64-encode the entire file (Linux/macOS: `base64 -w 0 cookies.txt`; Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cookies.txt"))`).
4. Add the resulting single-line value to Railway Variables as `YOUTUBE_COOKIES_B64`.
5. Redeploy. The bot writes the decoded cookies to a permission-restricted temporary file and never prints cookie contents in logs.

Do not send cookies in Discord, chat, GitHub issues, or repository files. Cookies can expire or be revoked, and this does not guarantee YouTube access if the hosting IP is blocked.

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
- **YouTube asks you to sign in:** configure `YOUTUBE_COOKIES_B64` with a Base64-encoded Netscape cookies file in Railway Variables. Cookies may expire, and YouTube may still block the hosting IP.\n- **Music does not play:** check Railway logs for source extraction/network errors and confirm the bot has Connect and Speak permissions. YouTube and SoundCloud extraction can be affected by upstream changes.
- **Warnings disappear after redeploy:** confirm the Railway Volume is mounted at `/app/data`.

## Local checks

```bash
npm install
npm run check
npm start
```
