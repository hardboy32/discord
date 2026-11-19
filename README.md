# Discord Music + Moderation + AI Bot (Railway)

This repository runs the Discord bot, Lavalink audio engine, and single-server web dashboard together in one Railway service and one container. Lavalink is bound to localhost; the dashboard uses Discord OAuth2 and is locked to server `686002315148394502` by default.

## Features

### Music
- `/play query` — search by song name or play a YouTube/SoundCloud URL
- `/join`, `/queue`, `/skip`, `/pause`, `/resume`, `/stop`, `/leave`
- Natural-language music requests, for example: `play the song ...`
- Lavalink 4.2.2 with the YouTube Source plugin; title searches try YouTube first and use SoundCloud as a fallback. Public YouTube playback does not require account cookies by default.

### Interactive now-playing panel

When a track starts, the bot posts or updates one music player message in the text channel where playback was requested. It includes the track artwork when the source provides one, title, duration, requester, and buttons for pause/resume, skip, stop, loop mode, and queue display. Loop mode cycles through off, repeat current track, and repeat queue. Music controls are limited to members who are in the bot's voice channel.

## Moderation
- `/kick`, `/ban`, `/timeout`, `/untimeout`
- `/clear amount`, `/slowmode seconds`, `/lock`, `/unlock`
- `/warn`, `/warnings`, `/clearwarns`
- `/ping`, `/help`, `/activity`



### Community features
- `/poll` — create interactive polls with up to four choices; members can change their vote.
- `/giveaway` and `/giveaway-end` — create giveaways, collect entries, and draw winners.
- `/suggestion-setup` and `/suggest` — collect suggestions in a selected channel; moderators can approve or reject.
- `/verify-setup` — post a verification button that assigns the configured role.
- `/role-button` — publish self-assignable role buttons.
- `/rank` and `/leaderboard` — message XP, levels, and server rankings.
- `/tempvoice-setup` — create temporary voice rooms when members join a configured voice channel; empty rooms are deleted.

- `/daily`, `/work`, `/balance`, `/pay`, `/shop`, and `/buy` — persistent coins, daily rewards, work earnings, transfers, and a simple role shop.
- `/custom-set`, `/custom-run`, and `/custom-delete` — save reusable server responses.
- `/invites` and `/invite-leaderboard` — track invite attribution and show inviter rankings (the bot needs Manage Server permission to fetch invites).
- `/stream-alert-setup` — monitor Twitch, YouTube, and Kick creators and post live alerts in a selected channel. Add `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` for Twitch, and `YOUTUBE_API_KEY` for YouTube; Kick uses a public endpoint that may change.
- Community configuration, votes, giveaway entries, and XP are stored in `/app/data/community-data.json` (keep the Railway Volume mounted at `/app/data`).

### Server backup commands
- `/server-backup` — export role and channel structure as JSON.
- `/server-restore` — recreate missing roles and channels from that JSON (does not restore messages, member assignments, category nesting, or permission overwrites).
- The dashboard's **Data Backup** page contains the switch for enabling or pausing these slash commands, plus separate controls for bot-data and server-structure backups.

### Support tickets
- Run `/ticket-setup` with a panel channel, staff role, and transcript channel (optional category).
- Members can open a private ticket from the posted button; the channel is visible to the opener, the configured staff role, and the bot.
- The ticket owner or support staff can close it. The bot exports up to the latest 1,000 messages as a text transcript to the configured transcript channel and marks the ticket closed.
- Ticket panel configuration is stored in the panel message, so opening tickets continues to work after bot restarts.

### AutoMod and server logs
- Optional Discord invite filtering, message-spam detection (5 messages / 5 seconds), mass-mention filtering, and blocked-word filtering.
- AutoMod ignores members with Manage Messages or Administrator permission.
- Configurable server event logs with 65 independent switches in the dashboard: member joins/leaves, bans/unbans, nickname/role/timeout/boost/avatar changes; voice joins/leaves/moves, mute/deafen, camera, streaming, stage and voice effects; message metadata, edit/delete/bulk-delete, pins, reactions, polls and optional typing events; AutoMod rules/actions; channels, threads, roles, server settings, emojis, stickers, soundboard, invites, webhooks, integrations, slash-command permissions, scheduled events and stage instances.
- Optional Discord audit-log entry logging can identify administrative actions such as kicks and permission changes when the bot has **View Audit Log**. Some low-value or high-volume items (new messages, reactions, poll votes, typing, presence and detailed voice-state changes) start disabled.
- Message content is never included in event logs. Message-create logs record only author and channel; edit/delete logs record author and channel only. Presence/activity logging is opt-in and requires the **Presence Intent** in Discord Developer Portal plus `ENABLE_PRESENCE_LOGGING=true` in Railway Variables.
- Configure the destination channel and each log switch from the dashboard's Server Logs page. Select-all and clear-all controls are available.
- Configurable goodbye messages with `{user}`, `{username}`, `{server}`, and `{count}` placeholders.

Moderation commands require the corresponding Discord permissions. The bot role must be above members it is asked to moderate.

### AI chat
When enabled, the bot can answer when a member:
- Starts a message with `bot` or `assistant`
- Mentions the bot
- Replies directly to one of the bot's messages

AI replies use the member's language, maintain a short in-memory conversation history per member/channel, and have a small per-user cooldown. AI is powered by the Groq API; it is not enabled until `GROQ_API_KEY` is configured.

### Web dashboard

The dashboard is served by the same Node.js process at the Railway public domain. It includes Overview, Welcome, Music, Commands, Moderation, Server Logs, Automatic Roles, AI, Activity, Community, XP Management, Reaction Roles, and Data Backup pages. Music playback and server-wide music options are grouped together; moderation actions and server event logs have separate pages. The Activity page controls the bot's global online status and profile activity (Playing, Watching, Listening, Competing, or a linked Streaming activity). These settings are saved to `/app/data/dashboard-settings.json`, applied immediately, and restored after a restart. The Streaming presence does not broadcast video or share a screen. The dashboard is restricted to the configured server; only its owner or members with Manage Server / Administrator can sign in.

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
3. Keep the repository's `Dockerfile`. Railway will build the same service with Node.js 22, Java 17, and Lavalink; do not override it with Railpack or a custom build command.
4. Set the variables listed below in the service's **Variables** tab.
5. Deploy the service. `npm start` runs `start.js`, which starts Lavalink first, waits for it to become healthy, then starts the Discord bot. Both processes share the same Railway container.
6. Keep the service running as a single replica so multiple copies do not compete to run the same Discord bot token.

### Railway build/runtime settings

- Builder: Dockerfile (included in the repository)
- Runtime: Node.js 22 and OpenJDK 17
- Build command: handled by Dockerfile; no custom command is needed
- Start command: `npm start` (starts Lavalink and the bot under one supervisor)
- Public networking/domain: required for the dashboard
- Port: Railway supplies `PORT` for the dashboard; Lavalink uses private `127.0.0.1:2333` only
- Audio processing: Lavalink handles decoding and Discord voice playback directly; the bot no longer starts a separate FFmpeg process
- Memory: allow enough memory for both Node.js and Java. Reduce `LAVALINK_JAVA_XMX` if the container reaches its memory limit.

## Environment variables

| Variable | Required? | Purpose |
|---|---|---|
| `DISCORD_TOKEN` | **Yes** | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Recommended | Discord application ID |
| `DISCORD_GUILD_ID` | Optional | Test server ID; commands update faster in this server. Leave blank for global commands |
| `BOT_OWNER_ID` | Optional | Your Discord user ID for the owner-only `/activity` command |
| `GROQ_API_KEY` | Optional | Enables AI chat replies |
| `GROQ_MODEL` | Optional | Groq model ID; defaults to `openai/gpt-oss-20b` |
| `LAVALINK_PASSWORD` | Optional | Private localhost password; generated automatically when omitted |
| `DEBUG_LOGS` | Optional | Enable routine diagnostic logs while troubleshooting |
| `ENABLE_PRESENCE_LOGGING` | Optional | Enable online status/activity logs only after enabling Presence Intent in the Discord Developer Portal |
| `LAVALINK_JAVA_XMX` | Optional | Lavalink Java maximum heap; defaults to `512m` |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Optional | Twitch live stream alerts |
| `YOUTUBE_API_KEY` | Optional | YouTube live stream alerts |
| `DASHBOARD_GUILD_ID` | Optional | Single dashboard server; defaults to `686002315148394502` |
| `DISCORD_CLIENT_SECRET` | Dashboard | Discord OAuth2 Client Secret |
| `DASHBOARD_SESSION_SECRET` | Dashboard | Long random secret used to sign login sessions |
| `DASHBOARD_REDIRECT_URI` | Dashboard | Exact Railway URL ending in `/auth/callback` |
| `DASHBOARD_SETTINGS_FILE` | Optional | Settings JSON path; default `/app/data/dashboard-settings.json` |
| `WARNINGS_FILE` | Optional | Warnings JSON path; default is `./data/warnings.json` |

Never commit real bot tokens, API keys, or YouTube cookies to GitHub. Add secrets only in Railway Variables.

### Lavalink and YouTube

The Docker image downloads the official Lavalink 4.2.2 release and configures a pinned YouTube Source plugin snapshot. The YouTube source tries several supported InnerTube clients in order. The Lavalink audio buffers are tuned to better tolerate short processing pauses, and Opus encoding quality is set to a CPU-friendlier level. No YouTube cookie variable is required for normal public tracks. YouTube may still restrict playback from a hosting IP, so SoundCloud remains the alternate search source.

Lavalink listens only on `127.0.0.1:2333`; it is not exposed as a public Railway port. The startup supervisor creates a random internal password automatically unless `LAVALINK_PASSWORD` is supplied. Java plugin dependencies are cached under the Railway Volume when it is mounted at `/app/data`.

The bot and Lavalink share one Railway service. Keep the deployment at one replica to avoid duplicate bot logins and competing audio nodes.

## Persistent storage (recommended)

Warning records are written to `data/warnings.json`. Railway's normal container filesystem is temporary, so create a Railway **Volume** and mount it at:

```text
/app/data
```

The app's default warning-file location is `/app/data/warnings.json` when Railway runs the project from `/app`. You do not need to set `WARNINGS_FILE` unless you want a different location.

The bot's music queue and AI conversation history are held in memory and are intentionally not persisted; they reset when the service restarts. Lavalink's downloaded plugin dependencies are cached under `/app/data/.java-home` when the Railway Volume is mounted.

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
- **Lavalink does not become ready:** check the Java/Lavalink startup messages in Railway logs and confirm the Dockerfile build completed.
- **YouTube playback fails:** try a SoundCloud result or inspect Lavalink logs for client/source errors. The YouTube plugin uses several clients, but YouTube can still restrict a hosting IP.
- **Music does not play:** confirm the bot has Connect and Speak permissions and that the Lavalink node reports ready before testing `/play`.
- **Warnings disappear after redeploy:** confirm the Railway Volume is mounted at `/app/data`.

## Local checks

```bash
npm install
npm run check
```

The full runtime is intended for the included Docker image or Railway. `start.js` expects the Docker build to provide the compiled YouTube Cipher binary and `Lavalink.jar`; running `npm start` directly on a plain local Node.js install will stop with a missing-binary message.
