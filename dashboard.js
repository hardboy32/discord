const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const GUILD_ID = (process.env.DASHBOARD_GUILD_ID || '686002315148394502').trim();
const CLIENT_ID = (process.env.DISCORD_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.DISCORD_CLIENT_SECRET || '').trim();
const SESSION_SECRET = (process.env.DASHBOARD_SESSION_SECRET || '').trim();
const REDIRECT_URI = (process.env.DASHBOARD_REDIRECT_URI || '').trim();
const SETTINGS_FILE = process.env.DASHBOARD_SETTINGS_FILE || path.join('/app/data', 'dashboard-settings.json');
const SESSIONS_FILE = process.env.DASHBOARD_SESSIONS_FILE || path.join(path.dirname(SETTINGS_FILE), 'dashboard-sessions.json');
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PORT = Number(process.env.PORT || 3000);

function loadSessions() {
  try {
    const saved = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    const now = Date.now();
    return new Map(Object.entries(saved).filter(([, session]) =>
      session && typeof session === 'object' &&
      typeof session.expires === 'number' && session.expires > now &&
      session.user && typeof session.user.id === 'string' &&
      session.guildId === GUILD_ID
    ));
  } catch {
    return new Map();
  }
}
const sessions = loadSessions();
const states = new Map();

function saveSessions() {
  fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
  const now = Date.now();
  const active = Object.fromEntries([...sessions.entries()].filter(([, session]) =>
    session && typeof session.expires === 'number' && session.expires > now
  ));
  const tempFile = SESSIONS_FILE + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(active), { mode: 0o600 });
  fs.renameSync(tempFile, SESSIONS_FILE);
}

const defaults = {
  welcome: { enabled: false, channelId: '', message: 'Welcome {user} to {server}!', type: 'text', mention: true, imagePath: '', imageUrl: '' },
  moderation: { enabled: true, antiLink: false, antiSpam: false, antiMentionSpam: false, blockedWords: [], logChannelId: '' },
  logging: {
    enabled: true,
    channelId: '',
    events: {
      memberJoin: true,
      memberLeave: true,
      memberBan: true,
      memberUnban: true,
      memberNicknameUpdate: true,
      memberRolesUpdate: true,
      memberTimeoutUpdate: true,
      memberBoost: true,
      memberAvatarUpdate: true,
      voiceJoin: true,
      voiceLeave: true,
      voiceMove: true,
      voiceMute: false,
      voiceDeafen: false,
      voiceVideo: false,
      voiceStream: false,
      voiceStage: false,
      messageCreate: false,
      messageEdit: true,
      messageDelete: true,
      messageDeleteBulk: true,
      messagePin: true,
      messageReactionAdd: false,
      messageReactionRemove: false,
      messageReactionClear: true,
      pollVoteAdd: false,
      pollVoteRemove: false,
      automod: true,
      autoModerationRuleCreate: true,
      autoModerationRuleUpdate: true,
      autoModerationRuleDelete: true,
      auditLogEntry: false,
      channelCreate: true,
      channelDelete: true,
      channelUpdate: true,
      threadCreate: true,
      threadUpdate: true,
      threadDelete: true,
      threadMembersUpdate: false,
      roleCreate: true,
      roleDelete: true,
      roleUpdate: true,
      guildUpdate: true,
      emojiUpdate: true,
      stickerUpdate: true,
      soundboardCreate: true,
      soundboardUpdate: true,
      soundboardDelete: true,
      inviteCreate: true,
      inviteDelete: true,
      webhookUpdate: true,
      integrationUpdate: true,
      scheduledEventCreate: true,
      scheduledEventUpdate: true,
      scheduledEventDelete: true,
      scheduledEventUserAdd: true,
      scheduledEventUserRemove: true,
      stageInstanceCreate: true,
      stageInstanceUpdate: true,
      stageInstanceDelete: true
    }
  },
  goodbye: { enabled: false, channelId: '', message: 'Goodbye {user}! We will miss you.' },
  autorole: { enabled: false, roleId: '' },
  music: { enabled: true, requestChannelId: '', artworkMode: 'missing' },
  ai: { enabled: true },
  community: { tickets: true, polls: true, giveaways: true, suggestions: true, verification: true, roleButtons: true, levels: true, economy: true, tempVoice: true, invites: true, streamAlerts: true, customCommands: true, backup: true },
  communityConfig: { tickets: { title: 'Support Center', description: 'Need help? Press the button below to open a private support ticket.', buttonLabel: 'Open a ticket' }, polls: { defaultDurationMinutes: 0, maxOptions: 4, allowVoteChange: true }, giveaways: { defaultDurationMinutes: 60, defaultWinners: 1, entryButtonLabel: 'Enter' }, suggestions: { title: 'New suggestion', allowAnonymous: false, approvedMessage: 'Approved', rejectedMessage: 'Rejected' }, verification: { title: 'Server verification', description: 'Press below to verify and receive access.', buttonLabel: 'Verify me' }, roleButtons: { label: 'Get role' }, levels: { xpMin: 12, xpMax: 20, cooldownSeconds: 60, announce: true }, economy: { dailyReward: 500, workMin: 100, workMax: 300, vipPrice: 2500, colorPrice: 1200, bonusPrice: 800, bonusCoins: 500 }, tempVoice: { nameTemplate: '{user} room', defaultLimit: 0, ownerCanManage: true }, invites: { announceJoins: false, messageTemplate: '{user} joined using an invite from {inviter}.' }, streamAlerts: { messageTemplate: '🔴 **{creator} is live on {platform}!**\n{title}\n{url}', checkIntervalSeconds: 120 }, customCommands: { allowEveryone: true, maxCommands: 50 }, backup: { includeChannels: true, includeRoles: true, includeOverwrites: false } }
};

function loadSettings() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return merge(defaults, saved);
  } catch {
    return JSON.parse(JSON.stringify(defaults));
  }
}
function merge(base, value) {
  const out = {};
  for (const key of Object.keys(base)) {
    out[key] = base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])
      ? merge(base[key], value && value[key] && typeof value[key] === 'object' ? value[key] : {})
      : value && value[key] !== undefined ? value[key] : base[key];
  }
  return out;
}
let settings = loadSettings();
function saveSettings() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  const temporaryFile = SETTINGS_FILE + '.tmp';
  fs.writeFileSync(temporaryFile, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryFile, SETTINGS_FILE);
}
function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}
function cookieValue(req, name) {
  const raw = req.headers.cookie || '';
  const item = raw.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
  if (!item) return '';
  try { return decodeURIComponent(item.slice(name.length + 1)); }
  catch { return ''; }
}
function getSession(req) {
  const token = cookieValue(req, 'hb_session');
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const supplied = Buffer.from(parts[1]);
  const expected = Buffer.from(sign(parts[0]));
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  let session = sessions.get(parts[0]);
  // Recover a valid login from the Railway Volume after restarts or when another
  // app instance handled the OAuth callback.
  if (!session) {
    session = loadSessions().get(parts[0]) || null;
    if (session) sessions.set(parts[0], session);
  }
  if (!session || session.expires < Date.now()) {
    sessions.delete(parts[0]);
    saveSessions();
    return null;
  }
  return session;
}
function send(res, status, body, type) {
  res.writeHead(status, { 'content-type': type || 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function legalPage(title, updated, sections) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow"><title>${title} • HARD BOY</title><style>
:root{color-scheme:dark;--bg:#0b1020;--line:#293752;--muted:#a6b4ce;--text:#edf2ff;--accent:#9aa5ff}
*{box-sizing:border-box}
body{margin:0;padding:32px 18px;background:radial-gradient(ellipse at 15% 0,#1b2850 0,transparent 42%),var(--bg);color:var(--text);font:16px/1.7 Inter,system-ui,Segoe UI,sans-serif}
main{width:100%;max-width:900px;margin:0 auto}
header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:22px}
.brand{font-size:17px;font-weight:850;letter-spacing:.5px}.brand span{color:var(--accent)}
a{color:#b9c2ff;text-decoration:none}a:hover{text-decoration:underline}
article{background:linear-gradient(145deg,#17233b,#121b2e);border:1px solid var(--line);border-radius:18px;padding:clamp(20px,4vw,38px);box-shadow:0 14px 35px #0002}
h1{font-size:clamp(29px,5vw,38px);line-height:1.2;margin:0 0 8px}
h2{font-size:20px;line-height:1.35;margin:28px 0 9px}
p{margin:10px 0;color:#dce5f7}
li{margin:7px 0;color:#dce5f7}
ul{padding-left:23px}
.meta{color:var(--muted);font-size:13px;margin-bottom:24px}
footer{color:var(--muted);font-size:13px;text-align:center;margin:20px 0}
code{overflow-wrap:anywhere;color:#c5ccff}
@media(max-width:560px){body{padding:18px 10px}article{border-radius:13px}h2{font-size:18px}}
</style></head><body><main><header><div class="brand">HARD<span>BOY</span> • DISCORD APP</div><a href="/">Dashboard home ↗</a></header><article><h1>${title}</h1><div class="meta">Effective date: ${updated} · Last updated: ${updated}</div>${sections}</article><footer>HARD BOY is an independently operated application and is not affiliated with Discord, Inc.</footer></main></body></html>`;
}

const PRIVACY_POLICY_HTML = `
<p>This Privacy Policy describes how the HARD BOY Discord Bot and its optional web dashboard (together, the “Service”) process information when people use the bot in Discord or sign in to the dashboard.</p>
<p><strong>Application:</strong> HARD BOY Discord Bot · <strong>Discord Application ID:</strong> 812717050753450004 · <strong>Dashboard:</strong> https://discordbot.up.railway.app</p>
<h2>1. Information the Service processes</h2>
<ul>
<li><strong>Discord account and server information:</strong> Discord user IDs, usernames or display names, server IDs and names, channel and role IDs and names, and permission information needed to provide bot features and authorize dashboard access.</li>
<li><strong>Dashboard sign-in:</strong> the dashboard uses Discord OAuth2 with the identify and guilds scopes. It stores the minimum session information (user ID, display name, server ID and expiry) for up to 30 days. The Discord OAuth access token is used for sign-in and is not saved to disk. A signed, HttpOnly, Secure session cookie is stored in your browser.</li>
<li><strong>Commands and feature records:</strong> depending on enabled features, this can include warning reasons and moderator names; XP and level totals; virtual currency balances; poll votes; giveaway entries and winners; invite attribution; suggestions and custom responses; stream-alert creator names; and feature configuration. Records may contain Discord user, server, channel, message or role IDs.</li>
<li><strong>Messages and moderation:</strong> when AutoMod is enabled, the bot reads message text to check the configured invite-link, blocked-word, spam and mass-mention rules. A matching message may be deleted; the moderation log records the author and reason, not the deleted text. Message edit/delete event logs record the author and channel and do not record message content.</li>
<li><strong>Music requests and media:</strong> the bot processes song titles or links submitted to the configured music-request channel and track metadata needed for playback. Older member messages in that selected request channel are removed when a new music request is posted, and remaining member messages are removed during the daily cleanup cycle; bot-generated messages and the music player panel are retained. Music searches and links may be sent to the relevant music source or media extraction provider to resolve playback. Uploaded audio files and music artwork may be stored on the operator's Railway storage volume.</li>
<li><strong>AI messages (only when AI is enabled and invoked):</strong> the prompt directed to the bot and a limited amount of recent conversation context are sent to Groq to generate a reply. The bot keeps a short conversation history temporarily in process memory; it is not written to persistent bot data files and is cleared when the bot process restarts.</li>
<li><strong>Support tickets:</strong> if ticket features are enabled, the bot creates private ticket channels. When a ticket is closed, it can export up to the latest 1,000 messages to a transcript in the channel selected by the server administrator. A transcript may contain message text, author names and attachment URLs.</li>
<li><strong>Browser data:</strong> the dashboard uses a session cookie for authentication. It may store up to 20 recently played track titles and URLs in the user's own browser local storage.</li>
</ul>
<h2>2. How information is used</h2>
<p>Information is used as needed to authenticate server administrators; check permissions; process commands and interactions; provide music, moderation, welcome, ticket, community, XP, economy and notification features; maintain configuration and feature state; protect the Service from abuse; and troubleshoot failures.</p>
<h2>3. Storage and retention</h2>
<ul>
<li>Persistent bot settings, warnings, community feature data, music-panel references, uploaded welcome artwork, fallback music artwork and saved audio files are stored in the Railway volume configured by the operator (normally <code>/app/data</code>).</li>
<li>Persistent feature records are generally kept until a server administrator or operator deletes them, clears the relevant feature data, or removes the stored bot data. Disabling a feature does not necessarily delete records already created by it.</li>
<li>Dashboard sign-in sessions expire after 30 days. Users can also sign out to clear their browser session.</li>
<li>AI conversation context is temporary in-memory data and is not persisted to disk by the Service.</li>
<li>Ticket transcripts and moderation/event logs posted to Discord remain subject to the server's message retention, access and deletion settings.</li>
<li>Music history in the dashboard is stored locally in the user's browser, not in the bot's server-side database.</li>
</ul>
<h2>4. Service providers and sharing</h2>
<p>The Service does not sell personal information and does not use it for advertising. Information may be processed by these providers when the related feature is used:</p>
<ul>
<li><strong>Discord:</strong> account authentication, server, channel, role and message/interaction features.</li>
<li><strong>Railway:</strong> hosting for the bot, dashboard and configured persistent storage.</li>
<li><strong>Groq:</strong> receives AI prompts and limited recent context when the AI feature is enabled and invoked.</li>
<li><strong>Music and streaming providers:</strong> music source and media extraction providers may receive search terms or media links to resolve playback. Twitch, YouTube/Google or Kick may be contacted to check configured live-stream alerts.</li>
</ul>
<p>These providers process information under their own terms and privacy policies. AI prompts are not sent to Groq when AI is disabled or not invoked. Stream-alert creator names are sent to a relevant platform only when that integration is used.</p>
<h2>5. Access, choices and deletion requests</h2>
<p>Server administrators control which optional features are enabled, which channels receive logs and transcripts, and which permissions the bot receives. Administrators can clear warnings using the warning-management commands. Other saved feature data can be removed by the server administrator or Service operator from the relevant bot storage. Removing the bot from a server stops its server features, but does not automatically remove messages, transcripts or records already posted or stored.</p>
<p>To ask about personal information or request access, correction or deletion of data held by the Service, contact the developer through the <a href="https://github.com/hardboy32/discord/issues" target="_blank" rel="noopener noreferrer">project support page on GitHub</a>. Do not include sensitive personal information in a public issue; ask for a private way to provide details. Requests may require enough information to identify the relevant Discord server and account.</p>
<h2>6. Security</h2>
<p>The dashboard restricts management functions to users with server-owner, Administrator or Manage Server permissions and uses signed, secure session cookies. Persistent files are stored on the configured hosting volume. No internet service can guarantee absolute security; server administrators should manage bot permissions, staff access and backups carefully.</p>
<h2>7. Children's privacy</h2>
<p>The Service is intended for use within Discord and is not designed to collect information directly from children. Users must meet the minimum age required by Discord and the laws that apply to them.</p>
<h2>8. Changes and contact</h2>
<p>This Policy may be updated when the Service's features or data practices change. The latest version will be published at this URL. For privacy questions or requests, use the <a href="https://github.com/hardboy32/discord/issues" target="_blank" rel="noopener noreferrer">project support page</a> and avoid posting personal data publicly.</p>
`;

const TERMS_OF_SERVICE_HTML = `
<p>These Terms of Service (“Terms”) govern your use of the HARD BOY Discord Bot and its optional web dashboard (together, the “Service”). By using or inviting the Service, you agree to these Terms. If you do not agree, do not use the Service.</p>
<p><strong>Application:</strong> HARD BOY Discord Bot · <strong>Discord Application ID:</strong> 812717050753450004 · <strong>Dashboard:</strong> https://discordbot.up.railway.app</p>
<h2>1. Eligibility and Discord rules</h2>
<p>You must meet Discord's minimum age requirement and any higher minimum age required by the laws that apply to you. Your use of the Service must comply with Discord's Terms of Service, Community Guidelines, Developer Terms of Service and Developer Policy.</p>
<h2>2. Acceptable use</h2>
<ul>
<li>Do not use the Service to break the law, harass or threaten people, distribute malware, spam users, evade moderation, or infringe another person's rights.</li>
<li>Do not attempt to disrupt, overload, reverse engineer or gain unauthorized access to the Service, its hosting environment or another user's data.</li>
<li>Do not use music, file, AI, moderation or community features in a way that violates the rules or rights of a relevant third-party provider.</li>
<li>Do not submit passwords, payment details or other highly sensitive information through bot commands, AI prompts or support tickets unless strictly necessary and safe to do so.</li>
</ul>
<h2>3. Server administrators and permissions</h2>
<p>Server owners and administrators are responsible for deciding whether to install the bot, granting only the permissions needed, configuring channels and roles, and informing members about features that process messages or create logs and transcripts. Administrators are responsible for access to private ticket channels, transcript channels and server backups. The Service may not work correctly if required Discord permissions or intents are missing.</p>
<h2>4. User content</h2>
<p>You remain responsible for messages, links, audio files, artwork, suggestions, custom responses and other content you submit or cause the Service to process. You must have the rights and permissions needed to provide that content and allow the Service to process it for the feature you use. You grant the Service the limited permission needed to process and display that content to provide the requested functionality.</p>
<h2>5. AI and third-party features</h2>
<p>AI responses are generated by a third-party AI provider and may be incomplete, inaccurate or inappropriate. Do not rely on them as professional advice or as the sole basis for important decisions. Music playback, media extraction and live-stream alerts depend on third-party platforms and may become unavailable or change without notice. You are responsible for complying with those providers' terms and respecting copyright and other rights when sharing or playing content.</p>
<h2>6. Availability and changes</h2>
<p>The Service is provided without a promise of uninterrupted or error-free operation. Features may be modified, suspended or discontinued for maintenance, security, legal, platform or operational reasons. The Service may enforce rate limits or restrict access where necessary to protect the bot, Discord communities or infrastructure.</p>
<h2>7. Disclaimers and liability</h2>
<p>To the maximum extent permitted by applicable law, the Service is provided “as is” and “as available”, without warranties of any kind. Nothing in these Terms excludes or limits liability where such exclusion or limitation is not permitted by law. To the extent permitted by law, the operator is not responsible for indirect or consequential loss, third-party platform outages, user-generated content, or actions taken by server administrators using the Service.</p>
<h2>8. Suspension and termination</h2>
<p>You may stop using the Service at any time and a server administrator may remove the bot from a server. The operator may suspend or terminate access where these Terms are violated, where required by law or platform rules, or where continued operation presents a security or operational risk.</p>
<h2>9. Changes to these Terms</h2>
<p>These Terms may be updated as the Service changes. The current version will be published at this URL. Continued use after an updated version is published means you accept the updated Terms to the extent permitted by applicable law.</p>
<h2>10. Contact</h2>
<p>For questions about these Terms, contact the developer through the <a href="https://github.com/hardboy32/discord/issues" target="_blank" rel="noopener noreferrer">project support page on GitHub</a>. Do not post private or sensitive information in a public issue.</p>
`;
function readBody(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;
    let tooLarge = false;

    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    req.on('data', chunk => {
      if (tooLarge || settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > limit) {
        tooLarge = true;
        const error = new Error('Request too large');
        error.status = 413;
        fail(error);
        return;
      }
      chunks.push(buffer);
    });

    req.on('end', () => {
      if (settled || tooLarge) return;
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        settled = true;
        resolve(JSON.parse(body || '{}'));
      } catch {
        const error = new Error('Invalid JSON');
        error.status = 400;
        fail(error);
      }
    });
    req.on('error', fail);
    req.on('aborted', () => {
      const error = new Error('Request aborted');
      error.status = 400;
      fail(error);
    });
  });
}
async function discord(pathname, token) {
  const response = await fetch('https://discord.com/api/v10' + pathname, {
    headers: { authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('Discord API returned ' + response.status);
  return response.json();
}
function allowed(user) {
  const permissions = BigInt(user.permissions || '0');
  return user.owner === true || (permissions & 0x8n) === 0x8n || (permissions & 0x20n) === 0x20n;
}
function html() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HardBoy • Server Dashboard</title><style>
:root{color-scheme:dark;--bg:#0b1020;--panel:#141d31;--line:#293752;--muted:#98a8c4;--text:#edf2ff;--accent:#7887ff;--green:#5bd6a0}
*{box-sizing:border-box}
html,body{min-height:100%;width:100%}
body{margin:0;overflow-x:hidden;background:radial-gradient(ellipse at 15% 0,#1b2850 0,transparent 42%),var(--bg);color:var(--text);font:15px Inter,system-ui,Segoe UI,sans-serif}
button,input,select,textarea{font:inherit}
button{cursor:pointer;border:0;border-radius:10px;background:var(--accent);color:white;padding:11px 16px;font-weight:700;max-width:100%;white-space:normal;overflow-wrap:anywhere;line-height:1.35}
button.secondary{background:#273653}
button.danger{background:#a83e57}
.hidden{display:none!important}
.shell{display:grid;grid-template-columns:245px minmax(0,1fr);min-height:100vh;align-items:stretch}
.side{display:flex;flex-direction:column;min-width:0;background:#0c1426;border-right:1px solid var(--line);padding:24px 16px;position:sticky;top:0;align-self:start;height:100vh;overflow-y:auto}
.brand{font-size:19px;font-weight:850;margin:4px 10px 28px}
.brand span{color:var(--accent)}
.nav{display:grid;gap:7px}
.nav button{text-align:left;background:transparent;color:#aebbd2;font-weight:600}
.nav button.active,.nav button:hover{background:#202c48;color:white}
.sidefoot{position:static;margin-top:auto;padding:24px 8px 0;color:var(--muted);font-size:12px;line-height:1.5;overflow-wrap:anywhere}
main{min-width:0;align-self:stretch;padding:30px;max-width:1300px;width:100%;margin:0 auto}
.top{min-height:72px;display:flex;justify-content:space-between;align-items:center;gap:16px;margin:0 0 25px}
.top>div{min-width:0}
.eyebrow{color:#91a3c7;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;font-weight:800}
h1{font-size:29px;margin:5px 0}
h2{font-size:19px;margin:0 0 16px}
.muted{color:var(--muted)}
.page{width:100%;min-width:0}
.panel{min-width:0;width:100%;background:linear-gradient(145deg,#17233b,#121b2e);border:1px solid var(--line);border-radius:17px;padding:22px;margin:0 0 18px;box-shadow:0 14px 35px #0002;overflow-wrap:anywhere}
.page>.panel:last-child{margin-bottom:0}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:stretch}
.stat{min-width:0;padding:18px;border-radius:14px;background:#101a2e;border:1px solid #263550}
.stat b{display:block;font-size:22px;margin-top:7px;overflow-wrap:anywhere}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:stretch}
.grid>*{min-width:0}
#communityConfigGrid>.panel{height:100%;margin:0}
.field{display:block;min-width:0;margin:14px 0;color:#c9d5ea;font-size:13px;font-weight:650;overflow-wrap:anywhere}
.field input:not([type=checkbox]),.field select,.field textarea{display:block;width:100%;max-width:100%;min-width:0;margin-top:7px;background:#0b1426;color:white;border:1px solid #394b6b;border-radius:10px;padding:12px;outline:none}
.field textarea{min-height:100px;resize:vertical}
.field input:focus,.field textarea:focus,.field select:focus{border-color:var(--accent)}
.check{display:flex;align-items:flex-start;gap:10px;margin:13px 0;color:#cbd6e9;line-height:1.5}
.check input{width:17px;height:17px;flex:0 0 17px;margin:2px 0 0;accent-color:var(--accent)}
.hint{font-size:12px;color:var(--muted);line-height:1.6}
.player-progress{position:relative;width:100%;height:24px;margin-top:14px;display:flex;align-items:center;touch-action:pan-y}
.player-progress-track{position:absolute;left:0;right:0;top:50%;height:5px;transform:translateY(-50%);overflow:hidden;border-radius:99px;background:#34435e;pointer-events:none}
.player-progress-fill{width:100%;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--green));transform:scaleX(0);transform-origin:left center;will-change:transform}
.player-progress-thumb{position:absolute;left:0;top:50%;width:13px;height:13px;border:2px solid #fff;border-radius:50%;background:var(--accent);box-shadow:0 1px 7px #0008;transform:translate(-50%,-50%);pointer-events:none;will-change:left}
#playerProgressSlider{position:absolute;inset:0;width:100%;height:24px;margin:0;padding:0;opacity:0;cursor:pointer;z-index:2}
.player-progress:focus-within .player-progress-track{box-shadow:0 0 0 2px #7887ff55}
.player-progress:focus-within .player-progress-thumb{box-shadow:0 0 0 4px #7887ff44}
.actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:18px;min-height:40px}
#status{color:var(--green);font-size:13px}
.preview{width:100%;min-width:0;background:#0b1426;border:1px dashed #425578;border-radius:13px;padding:16px;min-height:90px;overflow-wrap:anywhere}
.preview img{max-width:100%;max-height:230px;object-fit:contain;border-radius:9px;display:block;margin-top:10px}
.command{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:16px;padding:15px 0;border-bottom:1px solid #293752;min-width:0;overflow-wrap:anywhere}.command>*{min-width:0;max-width:100%}
.command:last-child{border:0}
.command code{color:#aebaff;font-weight:800}
.tag{display:inline-flex;align-items:center;justify-content:center;font-size:11px;padding:4px 8px;border-radius:20px;background:#273653;color:#cbd8f2;white-space:normal;overflow-wrap:anywhere;max-width:100%;text-align:center}
.command p{margin:5px 0 0;color:var(--muted);font-size:13px}
.formrow{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start}
.login{max-width:500px;margin:12vh auto;padding:30px}
h1,h2,p,label,code,.muted,.hint{overflow-wrap:anywhere}
.top .muted{line-height:1.5}
.actions>span{min-width:0;max-width:100%;overflow-wrap:anywhere;line-height:1.5}
.field input,.field select,.field textarea{min-width:0}
.preview img{height:auto}

@media(max-width:1050px){
  .shell{grid-template-columns:220px minmax(0,1fr)}
  main{padding:24px}
}
@media(max-width:480px){
  main{padding:14px}
  .panel{padding:17px;border-radius:14px}
  h1{font-size:25px}
  h2{font-size:17px}
  .actions{align-items:stretch}
  .actions>button{flex:1 1 auto}
  .actions>span{flex:1 1 100%}
}
@media(max-width:800px){
  .shell{grid-template-columns:minmax(0,1fr)}
  .side{position:relative;top:auto;align-self:auto;height:auto;min-height:0;overflow:visible;padding:14px}
  .brand{margin:4px 8px 12px}
  .nav{display:flex;gap:6px;overflow-x:auto;padding:0 0 6px;scrollbar-width:thin;overscroll-behavior-x:contain}
  .nav button{flex:0 0 auto;white-space:nowrap;padding:9px}
  .sidefoot{display:none}
  main{width:100%;max-width:none;margin:0;padding:18px}
  .stats,.grid,.formrow{grid-template-columns:minmax(0,1fr)}
  .top{align-items:flex-start;flex-direction:column;min-height:0}
}
</style></head><body><section id="login" class="panel login hidden"><div class="brand">HARD<span>BOY</span> CONTROL</div><h1>Server dashboard</h1><p class="muted">Sign in with an account that has server administration permissions.</p><a href="/auth/login"><button>Continue with Discord</button></a></section>
<div id="app" class="shell hidden"><aside class="side"><div class="brand">HARD<span>BOY</span> CONTROL</div><nav class="nav">
<button class="active" data-page="overview">◈ Overview</button><button data-page="welcome">✦ Welcome</button><button data-page="music">♫ Music</button><button data-page="settings">☷ Settings</button><button data-page="commands">⌘ Commands</button><button data-page="moderation">⛨ Moderation</button><button data-page="modules">⚙ Modules</button><button data-page="community">✧ Community</button><button data-page="xp">🏆 XP management</button><button data-page="backup">⬇ Data backup</button>
</nav><div class="sidefoot">Single server • Secure admin access</div></aside><main>
<header class="top"><div><div class="eyebrow">Control center</div><h1 id="pageTitle">Overview</h1><div class="muted" id="userName">Loading server…</div></div><div><span class="tag" id="serverName">Connected</span></div></header>
<section id="page-overview" class="page"><div class="stats"><div class="stat"><span class="muted">Members</span><b id="memberCount">—</b></div><div class="stat"><span class="muted">Text channels</span><b id="channelCount">—</b></div><div class="stat"><span class="muted">Bot status</span><b style="color:var(--green)">Online</b></div></div><div class="panel" style="margin-top:18px"><h2>Welcome to your control center</h2><p class="muted">Manage welcome messages, moderation tools and bot modules from one place. Changes are saved to your Railway volume.</p><button onclick="showPage('welcome')">Configure welcome system</button></div><div class="panel"><h2>Quick access</h2><div class="grid"><button class="secondary" onclick="showPage('commands')">Browse bot commands</button><button class="secondary" onclick="showPage('moderation')">Moderation settings</button></div></div></section>
<section id="page-welcome" class="page hidden"><div class="panel"><h2>Welcome message builder</h2><p class="muted">Choose a text or image welcome, customize mentions and preview the result.</p><div class="grid"><div>
<label class="field">Message format<select id="welcomeType"><option value="text">Text message</option><option value="image">Image message</option></select></label>
<label class="field">Send to channel<select id="welcomeChannel"></select></label>
<div id="welcomeTextFields">
<label class="field">Message text<textarea id="welcomeMessage" maxlength="1500" placeholder="Welcome {user} to {server}!"></textarea></label>
<div class="hint">Available placeholders: <code>{user}</code> (member mention), <code>{username}</code>, <code>{server}</code>, <code>{count}</code>.</div>
<label class="check"><input id="welcomeMention" type="checkbox"> Mention the new member</label>
</div>
<div id="welcomeImageFields" class="hidden">
<label class="field">Welcome image (PNG, JPG or WebP)<input id="welcomeImage" type="file" accept="image/png,image/jpeg,image/webp"></label>
<div class="hint">Images are stored on your Railway Volume and sent as the welcome message. Maximum 5 MB.</div>
</div>
<label class="check"><input id="welcomeEnabled" type="checkbox"> Enable welcome messages</label>
</div><div><div class="eyebrow" style="margin-bottom:9px">Live preview</div><div class="preview"><b id="previewServer">Your server</b><div id="previewMessage" style="margin-top:12px">Welcome @NewMember to Your server!</div><div id="previewImagePlaceholder" class="hint hidden" style="margin-top:12px">Choose an image to see the image welcome preview.</div><img id="previewImage" class="hidden" alt="Welcome image preview"></div><div class="hint" style="margin-top:12px">The preview uses sample member data. Discord formatting may look slightly different.</div></div></div><div class="actions"><button id="saveWelcome">Save welcome settings</button><span id="welcomeStatus"></span></div></div><div class="panel"><h2>Goodbye message</h2><p class="muted">Send a custom message when a member leaves.</p><label class="check"><input id="goodbyeEnabled" type="checkbox"> Enable goodbye messages</label><label class="field">Send to channel<select id="goodbyeChannel"></select></label><label class="field">Message<textarea id="goodbyeMessage" maxlength="1000" placeholder="Goodbye {user}!"></textarea></label><p class="hint">Placeholders: {user}, {username}, {server}, {count}. Mentions are disabled in goodbye messages.</p><button id="saveGoodbye">Save goodbye settings</button> <span id="goodbyeStatus"></span></div></section>
<section id="page-music" class="page hidden">
<div class="panel">
<h2>Play music from the dashboard</h2>
<p class="muted">Paste a link from a site supported by yt-dlp, or a direct audio-file URL. The bot will extract the audio and play it in your selected voice channel.</p>
<div class="grid">
<label class="field">Voice channel<select id="musicVoiceChannel"><option value="">Select a voice channel</option></select></label>
<label class="field">Song link<input id="musicUrl" type="url" maxlength="2000" placeholder="Paste a music/video page or direct audio link"></label>
</div>
<div class="actions"><button id="playDashboardMusic">▶ Play / add to queue</button><span id="musicStatus" role="status" aria-live="polite"></span></div>
<div class="grid" style="margin-top:12px">
<label class="field">Recently played<select id="musicHistorySelect"><option value="">No history yet</option></select></label>
<div class="field"><span>Play a previous link</span><button id="playMusicHistory" class="secondary" type="button">▶ Play selected history</button></div>
</div>
<p class="hint">Supports many sites through yt-dlp and direct audio URLs. Some sites may block bots or require login/subscription. Playlists and live streams may not work. The bot needs Connect and Speak permissions.</p>
</div>
<div class="panel">
<h2>Playback controls</h2>
<div id="dashboardPlayerTitle" style="font-weight:700;margin-bottom:10px">Nothing is playing</div>
<div class="grid">
<label class="field">Jump to position (seconds)<input id="playerSeekPosition" type="number" min="0" step="1" value="0"></label>
<label class="field">Play only until (seconds, optional)<input id="playerSegmentEnd" type="number" min="0" step="1" placeholder="End time"></label>
</div>
<div class="actions">
<button id="playerPause" class="secondary">⏯ Pause / Resume</button><button id="playerLoop" class="secondary">🔂 Loop off</button>
<button id="playerBack" class="secondary">↶ 10 sec</button>
<button id="playerForward" class="secondary">10 sec ↷</button>
<button id="playerSeek">Seek / play segment</button>
<button id="playerStop" class="danger">■ Stop</button>
</div>
<div class="player-progress"><div class="player-progress-track"><div id="playerProgressFill" class="player-progress-fill"></div></div><div id="playerProgressThumb" class="player-progress-thumb"></div><input id="playerProgressSlider" type="range" min="0" max="100" step="any" value="0" aria-label="Playback progress"></div><div class="muted" id="playerProgress" style="margin-top:6px">00:00 / 00:00</div>
<div class="hint">Set a start position and optional end position to play just one selected part of the current track. You can also jump backward or forward by 10 seconds.</div>
<span id="playerControlStatus" role="status" aria-live="polite"></span>
</div>
<div class="panel">
<h2>Saved music library</h2>
<p class="muted">Upload an audio file once. It stays on the Railway Volume after restarts and redeploys until you delete it. Choose a voice channel to play it in Discord.</p>
<div class="grid">
<label class="field">Audio file (MP3, WAV, OGG, OPUS, M4A, AAC or FLAC)<input id="musicLibraryFile" type="file" accept=".mp3,.wav,.ogg,.opus,.m4a,.aac,.flac,audio/*"></label>
<label class="field">Voice channel<select id="musicLibraryVoiceChannel"><option value="">Select a voice channel</option></select></label>
</div>
<div class="actions"><button id="uploadLibraryTrack">⬆ Upload audio</button><span id="musicLibraryStatus" role="status" aria-live="polite"></span></div>
<div id="musicLibraryList" class="command" style="display:block;margin-top:16px">Loading saved tracks…</div>
<p class="hint">Maximum file size: 20 MB per track. Audio files are stored in /app/data/music-library.</p>
</div>
</section>
<section id="page-settings" class="page hidden">
<div class="panel">
<h2>Settings</h2>
<p class="muted">Manage the server-wide music request channel and the artwork shown in the Discord music player. These settings are saved to your Railway storage.</p>
</div>
<div class="panel">
<h2>Automatic music request channel</h2>
<p class="muted">Choose a text channel. Members can simply send a song title or supported music link there; the bot will add it to the music queue. They must be connected to a voice channel first.</p>
<label class="field">Request channel<select id="musicRequestChannel"><option value="">Disabled — choose a channel</option></select></label>
<div class="actions"><button id="saveMusicRequestChannel">Save request channel</button><span id="musicRequestChannelStatus" role="status"></span></div>
<p class="hint">Only messages in this selected channel are treated as music requests. Other channels keep their normal behavior. Every 24 hours, messages written by members in this channel are automatically deleted; bot messages and the music player panel are kept. The bot needs View Channel, Read Message History and Manage Messages permissions.</p>
</div>
<div class="panel">
<h2>Default music artwork</h2>
<p class="muted">Upload a GIF and choose whether it should replace every song cover or appear only when a song has no cover.</p>
<div class="grid">
<label class="field">Fallback GIF (GIF, maximum 8 MB)<input id="musicFallbackGif" type="file" accept="image/gif,.gif"></label>
<div class="field"><span>Current artwork preview</span><div class="preview"><img id="musicFallbackPreview" alt="Current fallback music artwork" style="max-height:190px"></div></div>
</div>
<div class="actions"><button id="uploadMusicFallbackGif">⬆ Upload / replace GIF</button><span id="musicFallbackGifStatus" role="status" aria-live="polite"></span></div>
<div class="grid" style="margin-top:12px">
<label class="field">Artwork behavior<select id="musicArtworkMode"><option value="missing">Only when the song has no cover</option><option value="force">Force uploaded GIF on every song</option></select></label>
<div class="field"><span>Apply behavior</span><button id="saveMusicArtworkMode" type="button">Save artwork mode</button><span id="musicArtworkModeStatus" role="status" aria-live="polite"></span></div>
</div>
<p class="hint">“Force” replaces the track's own cover in the Discord music panel. “Only when missing” keeps each song's original cover whenever available. The setting is saved on Railway.</p>
</div>
</section>
<section id="page-commands" class="page hidden"><div class="panel"><h2>Bot command library</h2><p class="muted">All registered slash commands, grouped by purpose. Admin actions can be launched from the action panel.</p><div id="commandList"></div></div><div class="panel"><h2>Run a moderation command</h2><p class="muted">The bot checks your live server permissions again before executing an action.</p><div class="formrow"><label class="field">Command<select id="adminAction"><option value="kick">Kick member</option><option value="ban">Ban member</option><option value="timeout">Timeout member</option><option value="untimeout">Remove timeout</option><option value="clear">Delete messages</option><option value="slowmode">Set slowmode</option><option value="lock">Lock channel</option><option value="unlock">Unlock channel</option></select></label><label class="field">Member ID<input id="targetUser" placeholder="Discord user ID"></label><div class="field"><span>&nbsp;</span><button id="loadModerationMembers" class="secondary" type="button">Load server members</button></div><label class="field">Choose member from list<select id="moderationMemberSelect"><option value="">Load members first</option></select></label></div><div class="formrow"><label class="field">Amount / minutes<input id="actionAmount" type="number" min="1" placeholder="For timeout or clear"></label><label class="field">Channel<select id="actionChannel"></select></label></div><label class="field">Reason (optional)<input id="actionReason" placeholder="Reason for this action"></label><div class="actions"><button class="danger" id="runAction">Execute command</button><span id="actionStatus"></span></div><p class="hint">For safety, this panel currently supports direct moderation actions. Music playback controls remain available through Discord slash commands.</p></div></section>
<section id="page-moderation" class="page hidden"><div class="panel">
<h2>Moderation & AutoMod</h2>
<label class="check"><input id="moderationEnabled" type="checkbox"> Enable moderation commands</label>
<label class="check"><input id="antiLink" type="checkbox"> Block Discord invite links</label>
<label class="check"><input id="antiSpam" type="checkbox"> Detect message spam (5 messages in 5 seconds)</label>
<label class="check"><input id="antiMentionSpam" type="checkbox"> Block mass mentions (more than 5 users)</label>
<label class="field">Blocked words (one per line)<textarea id="blockedWords" placeholder="word1&#10;word2"></textarea></label>
<hr style="border-color:var(--line);margin:22px 0">
<h2>Server event logs</h2>
<label class="field">Send selected logs to<select id="logChannel"></select></label>
<label class="check"><input id="loggingEnabled" type="checkbox"> Enable server event logs</label>
<div class="actions"><button id="selectAllLogs" class="secondary" type="button">Select all event logs</button><button id="clearAllLogs" class="secondary" type="button">Clear all event logs</button></div>
<p class="muted">Each event has its own switch. New-message, reaction, poll-vote and frequent voice-state logs start disabled to avoid flooding the channel.</p>
<div class="grid"><div><h3>Members</h3><label class="check"><input id="log_memberJoin" type="checkbox"> Member joins</label><label class="check"><input id="log_memberLeave" type="checkbox"> Member leaves</label><label class="check"><input id="log_memberBan" type="checkbox"> Member banned</label><label class="check"><input id="log_memberUnban" type="checkbox"> Member unbanned</label><label class="check"><input id="log_memberNicknameUpdate" type="checkbox"> Nickname changes</label><label class="check"><input id="log_memberRolesUpdate" type="checkbox"> Member role changes</label><label class="check"><input id="log_memberTimeoutUpdate" type="checkbox"> Timeouts added or removed</label><label class="check"><input id="log_memberBoost" type="checkbox"> Server boosts started or ended</label><label class="check"><input id="log_memberAvatarUpdate" type="checkbox"> Server profile avatar changes</label></div><div><h3>Voice channels</h3><label class="check"><input id="log_voiceJoin" type="checkbox"> Member joins voice</label><label class="check"><input id="log_voiceLeave" type="checkbox"> Member leaves voice</label><label class="check"><input id="log_voiceMove" type="checkbox"> Member moves between voice channels</label><label class="check"><input id="log_voiceMute" type="checkbox"> Mute / unmute changes</label><label class="check"><input id="log_voiceDeafen" type="checkbox"> Deafen / undeafen changes</label><label class="check"><input id="log_voiceVideo" type="checkbox"> Camera on / off</label><label class="check"><input id="log_voiceStream" type="checkbox"> Go Live started / stopped</label><label class="check"><input id="log_voiceStage" type="checkbox"> Stage audience / speaker changes</label></div><div><h3>Messages and polls</h3><label class="check"><input id="log_messageCreate" type="checkbox"> New messages (metadata only)</label><label class="check"><input id="log_messageEdit" type="checkbox"> Message edits</label><label class="check"><input id="log_messageDelete" type="checkbox"> Message deletions</label><label class="check"><input id="log_messageDeleteBulk" type="checkbox"> Bulk message deletions</label><label class="check"><input id="log_messagePin" type="checkbox"> Pinned messages changed</label><label class="check"><input id="log_messageReactionAdd" type="checkbox"> Reaction added</label><label class="check"><input id="log_messageReactionRemove" type="checkbox"> Reaction removed</label><label class="check"><input id="log_messageReactionClear" type="checkbox"> Reactions cleared</label><label class="check"><input id="log_pollVoteAdd" type="checkbox"> Poll vote added</label><label class="check"><input id="log_pollVoteRemove" type="checkbox"> Poll vote removed</label></div><div><h3>AutoMod and audit</h3><label class="check"><input id="log_automod" type="checkbox"> AutoMod actions</label><label class="check"><input id="log_autoModerationRuleCreate" type="checkbox"> AutoMod rule created</label><label class="check"><input id="log_autoModerationRuleUpdate" type="checkbox"> AutoMod rule updated</label><label class="check"><input id="log_autoModerationRuleDelete" type="checkbox"> AutoMod rule deleted</label><label class="check"><input id="log_auditLogEntry" type="checkbox"> All administrator audit-log actions (requires View Audit Log)</label></div><div><h3>Channels and threads</h3><label class="check"><input id="log_channelCreate" type="checkbox"> Channel created</label><label class="check"><input id="log_channelDelete" type="checkbox"> Channel deleted</label><label class="check"><input id="log_channelUpdate" type="checkbox"> Channel settings changed</label><label class="check"><input id="log_threadCreate" type="checkbox"> Thread created</label><label class="check"><input id="log_threadUpdate" type="checkbox"> Thread updated</label><label class="check"><input id="log_threadDelete" type="checkbox"> Thread deleted</label><label class="check"><input id="log_threadMembersUpdate" type="checkbox"> Thread members changed</label></div><div><h3>Roles and server assets</h3><label class="check"><input id="log_roleCreate" type="checkbox"> Role created</label><label class="check"><input id="log_roleDelete" type="checkbox"> Role deleted</label><label class="check"><input id="log_roleUpdate" type="checkbox"> Role updated</label><label class="check"><input id="log_guildUpdate" type="checkbox"> Server settings changed</label><label class="check"><input id="log_emojiUpdate" type="checkbox"> Emoji created / changed / deleted</label><label class="check"><input id="log_stickerUpdate" type="checkbox"> Sticker created / changed / deleted</label><label class="check"><input id="log_soundboardCreate" type="checkbox"> Soundboard sound created</label><label class="check"><input id="log_soundboardUpdate" type="checkbox"> Soundboard sound updated</label><label class="check"><input id="log_soundboardDelete" type="checkbox"> Soundboard sound deleted</label></div><div><h3>Invites and integrations</h3><label class="check"><input id="log_inviteCreate" type="checkbox"> Invite created</label><label class="check"><input id="log_inviteDelete" type="checkbox"> Invite deleted</label><label class="check"><input id="log_webhookUpdate" type="checkbox"> Webhook settings changed</label><label class="check"><input id="log_integrationUpdate" type="checkbox"> Server integrations changed</label></div><div><h3>Scheduled events and stages</h3><label class="check"><input id="log_scheduledEventCreate" type="checkbox"> Scheduled event created</label><label class="check"><input id="log_scheduledEventUpdate" type="checkbox"> Scheduled event updated</label><label class="check"><input id="log_scheduledEventDelete" type="checkbox"> Scheduled event deleted</label><label class="check"><input id="log_scheduledEventUserAdd" type="checkbox"> Member subscribed to event</label><label class="check"><input id="log_scheduledEventUserRemove" type="checkbox"> Member unsubscribed from event</label><label class="check"><input id="log_stageInstanceCreate" type="checkbox"> Stage started</label><label class="check"><input id="log_stageInstanceUpdate" type="checkbox"> Stage updated</label><label class="check"><input id="log_stageInstanceDelete" type="checkbox"> Stage ended</label></div></div>
<button id="saveModeration">Save moderation and log settings</button> <span id="moderationStatus" role="status"></span>
<p class="hint">Deleted and edited message logs never include message text. New-message logging records only the author and channel. The administrator audit log requires the bot to have View Audit Log permission. Voice events require the bot to be connected to the server; no private message content is stored.</p>
</div></section>
<section id="page-modules" class="page hidden"><div class="panel"><h2>Bot modules</h2><label class="check"><input id="musicEnabled" type="checkbox"> Enable music commands</label><label class="check"><input id="aiEnabled" type="checkbox"> Enable AI replies</label><p class="hint">AI replies require GROQ_API_KEY in Railway Variables.</p><h2 style="margin-top:24px">Automatic role</h2><label class="check"><input id="autoroleEnabled" type="checkbox"> Give a role to every new member</label><label class="field">Role to assign<select id="autoroleRole"></select></label><p class="hint">The bot needs Manage Roles permission, and its highest role must be above the selected role.</p><button id="saveModules">Save module settings</button> <span id="moduleStatus"></span></div></section>
<section id="page-community" class="page hidden">
<div class="panel"><h2>Community features</h2><p class="muted">Enable or pause each community system. Setup details such as channels, roles and categories are configured with the listed Discord slash commands.</p>
<div class="grid">
<div><h2>Support & participation</h2>
<label class="check"><input id="featureTickets" type="checkbox"> Support tickets & transcripts <code>/ticket-setup</code></label>
<label class="check"><input id="featurePolls" type="checkbox"> Polls <code>/poll</code></label>
<label class="check"><input id="featureGiveaways" type="checkbox"> Giveaways <code>/giveaway</code></label>
<label class="check"><input id="featureSuggestions" type="checkbox"> Suggestions <code>/suggest</code></label>
<label class="check"><input id="featureVerification" type="checkbox"> Member verification <code>/verify-setup</code></label>
<label class="check"><input id="featureRoleButtons" type="checkbox"> Self-role buttons <code>/role-button</code></label>
</div><div><h2>Progress & automation</h2>
<label class="check"><input id="featureLevels" type="checkbox"> XP, levels & leaderboard <code>/rank</code></label>
<label class="check"><input id="featureEconomy" type="checkbox"> Economy & shop <code>/daily</code>, <code>/shop</code></label>
<label class="check"><input id="featureTempVoice" type="checkbox"> Temporary voice rooms <code>/tempvoice-setup</code></label>
<label class="check"><input id="featureInvites" type="checkbox"> Invite tracking <code>/invites</code></label>
<label class="check"><input id="featureStreamAlerts" type="checkbox"> Live stream alerts <code>/stream-alert-setup</code></label>
<label class="check"><input id="featureCustomCommands" type="checkbox"> Custom commands <code>/custom-set</code></label>
<label class="check"><input id="featureBackup" type="checkbox"> Server backup & restore <code>/server-backup</code></label>
</div></div>
<h2 style="margin-top:22px">Community command reference</h2><div id="communityCommandList"></div>
<div class="actions"><button id="saveCommunity">Save community settings</button><span id="communityStatus"></span></div>
<p class="hint">Disabling a feature pauses its commands and interactions; saved data is retained. The bot needs the relevant Discord permissions and the Railway Volume must remain mounted at /app/data.</p></div>
<div class="panel"><h2>Advanced module configuration</h2><p class="muted">Configure the behavior of every community module here. These settings are saved on the Railway Volume and are read by the bot.</p><div id="communityConfigGrid" class="grid"></div><div class="actions"><button id="saveCommunityConfig">Save all advanced settings</button><span id="communityConfigStatus"></span></div><p class="hint">Some actions that publish Discord messages (for example creating a ticket or verification panel) remain explicit actions; these settings control their defaults and runtime behavior.</p></div>
</section>
<section id="page-xp" class="page hidden"><div class="panel"><h2>XP management</h2><p class="muted">Search for a server member, check their current XP, then add or remove points manually.</p><div class="actions"><button id="xpLoadAllButton" class="secondary" type="button">Load all server members</button><span id="xpLoadAllStatus" role="status"></span></div><div class="formrow"><label class="field">Search member by username or display name<input id="xpMemberQuery" maxlength="80" placeholder="Type a member name"></label><div class="field" style="justify-content:end"><span>&nbsp;</span><button id="xpSearchButton" class="secondary">Search members</button></div></div><label class="field">Select member<select id="xpMemberSelect"><option value="">Load the member list or search first</option></select></label><div class="formrow"><label class="field">XP amount<input id="xpAmount" type="number" min="1" max="1000000" value="100"></label><label class="field">Reason (optional)<input id="xpReason" maxlength="180" placeholder="Manual adjustment"></label></div><div class="actions"><button id="xpAddButton">Add XP</button><button id="xpRemoveButton" class="danger">Remove XP</button><span id="xpStatus" role="status"></span></div><p class="hint" id="xpCurrentValue">Choose a member to view their current XP.</p></div></section><section id="page-backup" class="page hidden"><div class="panel"><h2>Complete bot data backup</h2><p class="muted">Download a single JSON archive containing the bot's persistent text data and configuration files from the Railway Volume.</p><div class="stats"><div class="stat"><span class="muted">Included</span><b>JSON / TXT / CSV / LOG</b></div><div class="stat"><span class="muted">Storage</span><b>/app/data</b></div><div class="stat"><span class="muted">Security</span><b>Admin only</b></div></div><p class="hint" style="margin-top:14px">Includes dashboard settings, community data (XP, economy, polls, giveaways, suggestions and custom commands), warnings and other supported text files found in the data folder. Binary files such as welcome images and secrets/tokens are not included. Keep the downloaded backup somewhere safe.</p><div class="actions"><button id="downloadDataBackup">Download complete data backup</button><span id="backupStatus"></span></div><hr style="border-color:var(--line);margin:22px 0"><h2>Restore from backup</h2><p class="muted">Upload a backup JSON previously downloaded from this dashboard. Matching files will be replaced by the backup contents.</p><label class="field">Backup file (.json)<input id="restoreBackupFile" type="file" accept=".json,application/json"></label><div class="actions"><button id="restoreDataBackup" class="danger">Restore selected backup</button><span id="restoreStatus"></span></div><p class="hint">Restore only accepts this bot’s backup format and the same Discord server. It replaces matching text files; it does not restore images, secrets, Discord messages, roles, or channels. Do not close this page while the restore is running.</p></div></section>
</main></div><script>
const LOG_EVENT_KEYS=["memberJoin","memberLeave","memberBan","memberUnban","memberNicknameUpdate","memberRolesUpdate","memberTimeoutUpdate","memberBoost","memberAvatarUpdate","voiceJoin","voiceLeave","voiceMove","voiceMute","voiceDeafen","voiceVideo","voiceStream","voiceStage","messageCreate","messageEdit","messageDelete","messageDeleteBulk","messagePin","messageReactionAdd","messageReactionRemove","messageReactionClear","pollVoteAdd","pollVoteRemove","automod","autoModerationRuleCreate","autoModerationRuleUpdate","autoModerationRuleDelete","auditLogEntry","channelCreate","channelDelete","channelUpdate","threadCreate","threadUpdate","threadDelete","threadMembersUpdate","roleCreate","roleDelete","roleUpdate","guildUpdate","emojiUpdate","stickerUpdate","soundboardCreate","soundboardUpdate","soundboardDelete","inviteCreate","inviteDelete","webhookUpdate","integrationUpdate","scheduledEventCreate","scheduledEventUpdate","scheduledEventDelete","scheduledEventUserAdd","scheduledEventUserRemove","stageInstanceCreate","stageInstanceUpdate","stageInstanceDelete"];
const $=id=>document.getElementById(id);let data=null;let imageData='';
function showPage(name){document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));$('page-'+name).classList.remove('hidden');document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===name));$('pageTitle').textContent=({overview:'Overview',welcome:'Welcome builder',music:'Music player',commands:'Commands',moderation:'Moderation',modules:'Modules',community:'Community features',backup:'Data backup',xp:'XP management',settings:'Settings'})[name]}
document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
function options(select,channels){
  select.replaceChildren();
  const placeholder=document.createElement('option');
  placeholder.value='';
  placeholder.textContent='Select channel';
  select.appendChild(placeholder);
  for(const channel of channels.filter(item=>item.type===0||item.type===5)){
    const option=document.createElement('option');
    option.value=channel.id;
    option.textContent='# '+channel.name;
    select.appendChild(option);
  }
}
function updateWelcomeMode(){const imageMode=$('welcomeType').value==='image';$('welcomeTextFields').classList.toggle('hidden',imageMode);$('welcomeImageFields').classList.toggle('hidden',!imageMode);$('previewMessage').classList.toggle('hidden',imageMode);const hasImage=!!$('previewImage').getAttribute('src');$('previewImage').classList.toggle('hidden',!imageMode||!hasImage);$('previewImagePlaceholder').classList.toggle('hidden',!imageMode||hasImage)}
function preview(){const msg=$('welcomeMessage').value||'Welcome {user} to {server}!';$('previewMessage').textContent=msg.replaceAll('{user}','@NewMember').replaceAll('{username}','NewMember').replaceAll('{server}',data.guild.name).replaceAll('{count}',String(data.guild.memberCount||0));$('previewServer').textContent=data.guild.name;updateWelcomeMode()}
async function api(url,opts){const r=await fetch(url,opts);let j={};try{j=await r.json()}catch{}if(!r.ok){const error=new Error(j.error||'Request failed ('+r.status+')');error.status=r.status;throw error}return j}
async function loadMusicFallbackPreview(){const image=$('musicFallbackPreview');if(!image)return;image.src='/api/music/fallback-artwork?cache='+Date.now();image.onerror=()=>{image.removeAttribute('src');image.alt='No uploaded GIF yet; the default artwork will be used.'}}
$('saveMusicArtworkMode').onclick=async()=>{const button=$('saveMusicArtworkMode'),status=$('musicArtworkModeStatus'),mode=$('musicArtworkMode').value;button.disabled=true;status.textContent='Saving…';try{await api('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({music:{artworkMode:mode}})});if(data&&data.settings&&data.settings.music)data.settings.music.artworkMode=mode;status.textContent=mode==='force'?'Saved: uploaded GIF will replace every track cover.':'Saved: uploaded GIF will be used only when a track has no cover.'}catch(e){status.textContent=e.message||'Could not save artwork mode.'}finally{button.disabled=false}};
$('uploadMusicFallbackGif').onclick=async()=>{const file=$('musicFallbackGif').files[0],status=$('musicFallbackGifStatus'),button=$('uploadMusicFallbackGif');if(!file){status.textContent='Choose a GIF first.';return}if(file.size>8*1024*1024){status.textContent='GIF must be 8 MB or smaller.';return}if(!/\.gif$/i.test(file.name)){status.textContent='Only GIF files are supported.';return}button.disabled=true;status.textContent='Uploading…';try{const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('Could not read the GIF.'));reader.readAsDataURL(file)});await api('/api/music/fallback-artwork',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:file.name,data:encoded})});$('musicFallbackGif').value='';status.textContent='GIF uploaded. It will be used for tracks without cover art.';await loadMusicFallbackPreview()}catch(e){status.textContent=e.message||'GIF upload failed.'}finally{button.disabled=false}};
async function load(){try{data=await api('/api/me');$('login').classList.add('hidden');$('app').classList.remove('hidden');$('serverName').textContent=data.guild.name;$('userName').textContent='Signed in as '+data.user.username;$('memberCount').textContent=data.guild.memberCount||'—';$('channelCount').textContent=data.channels.length;options($('welcomeChannel'),data.channels);options($('musicRequestChannel'),data.channels);const musicVoiceSelect=$('musicVoiceChannel');musicVoiceSelect.innerHTML='<option value="">Select a voice channel</option>';data.channels.filter(c=>c.type===2).forEach(c=>{const option=document.createElement('option');option.value=c.id;option.textContent='🔊 '+c.name;musicVoiceSelect.appendChild(option)});const libraryVoiceSelect=$('musicLibraryVoiceChannel');libraryVoiceSelect.innerHTML='<option value="">Select a voice channel</option>';data.channels.filter(c=>c.type===2).forEach(c=>{const option=document.createElement('option');option.value=c.id;option.textContent='🔊 '+c.name;libraryVoiceSelect.appendChild(option)});await loadMusicLibrary();await loadMusicFallbackPreview();await refreshDashboardPlayer();if(musicPlayerRefresh)clearInterval(musicPlayerRefresh);musicPlayerRefresh=setInterval(refreshDashboardPlayer,3000);options($('goodbyeChannel'),data.channels);options($('logChannel'),data.channels);options($('actionChannel'),data.channels);const autoroleRole=$('autoroleRole');autoroleRole.replaceChildren();const rolePlaceholder=document.createElement('option');rolePlaceholder.value='';rolePlaceholder.textContent='Select role';autoroleRole.appendChild(rolePlaceholder);for(const role of data.roles){const option=document.createElement('option');option.value=role.id;option.textContent=role.name;autoroleRole.appendChild(option)}const s=data.settings;$('musicArtworkMode').value=s.music.artworkMode==='force'?'force':'missing';$('welcomeEnabled').checked=s.welcome.enabled;$('welcomeChannel').value=s.welcome.channelId;$('welcomeMessage').value=s.welcome.message;$('welcomeType').value=s.welcome.type||'text';$('welcomeMention').checked=s.welcome.mention!==false;$('goodbyeEnabled').checked=!!s.goodbye.enabled;$('goodbyeChannel').value=s.goodbye.channelId||'';$('goodbyeMessage').value=s.goodbye.message||'Goodbye {user}! We will miss you.';$('moderationEnabled').checked=s.moderation.enabled;$('antiLink').checked=s.moderation.antiLink;$('antiSpam').checked=!!s.moderation.antiSpam;$('antiMentionSpam').checked=!!s.moderation.antiMentionSpam;$('blockedWords').value=(s.moderation.blockedWords||[]).join('\\n');$('logChannel').value=s.logging.channelId||s.moderation.logChannelId||'';$('loggingEnabled').checked=s.logging.enabled!==false;const logEvents=s.logging.events||{};for(const key of LOG_EVENT_KEYS){const input=$('log_'+key);if(input)input.checked=logEvents[key]!==false;}$('musicEnabled').checked=s.music.enabled;$('musicRequestChannel').value=s.music.requestChannelId||'';$('playDashboardMusic').disabled=!s.music.enabled;$('musicStatus').textContent=s.music.enabled?'':'Music is disabled in the Modules section.';$('aiEnabled').checked=s.ai.enabled;$('autoroleEnabled').checked=!!s.autorole.enabled;$('autoroleRole').value=s.autorole.roleId||'';const cf=s.community||{};for(const [key,id] of Object.entries({tickets:'featureTickets',polls:'featurePolls',giveaways:'featureGiveaways',suggestions:'featureSuggestions',verification:'featureVerification',roleButtons:'featureRoleButtons',levels:'featureLevels',economy:'featureEconomy',tempVoice:'featureTempVoice',invites:'featureInvites',streamAlerts:'featureStreamAlerts',customCommands:'featureCustomCommands',backup:'featureBackup'}))$(id).checked=cf[key]!==false;renderCommunityCommands();renderCommunityConfig(s.communityConfig||{});if(s.welcome.imageUrl){$('previewImage').src=s.welcome.imageUrl+'?v='+Date.now();$('previewImage').classList.remove('hidden')}renderCommands(data.commands);preview();updateWelcomeMode()}catch(e){console.error('Dashboard load failed:',e);if(e.status===401){$('app').classList.add('hidden');$('login').classList.remove('hidden')}else{$('login').classList.add('hidden');$('app').classList.remove('hidden');let notice=$('dashboardLoadError');if(!notice){notice=document.createElement('div');notice.id='dashboardLoadError';notice.className='panel';notice.style.borderColor='#a83e57';$('page-overview').prepend(notice)}notice.textContent='Dashboard data could not be fully loaded: '+(e.message||'Unknown error')}}}
function renderCommands(commands){
  const root=$('commandList');
  root.replaceChildren();
  for(const command of commands){
    const row=document.createElement('div');row.className='command';
    const details=document.createElement('div');
    const name=document.createElement('code');name.textContent='/'+command.name;
    const description=document.createElement('p');description.textContent=command.description;
    const category=document.createElement('span');category.className='tag';category.textContent=command.category;
    details.append(name,description);row.append(details,category);root.appendChild(row);
  }
}

const communityFields=[
 {key:'tickets',title:'🎫 Tickets & support',fields:[['panelChannelId','Panel channel','channel'],['staffRoleId','Support staff role','role'],['transcriptChannelId','Transcript channel','channel'],['categoryId','Ticket category','category'],['title','Panel title','text'],['description','Panel description','textarea'],['buttonLabel','Open button label','text'],]},
 {key:'polls',title:'📊 Polls',fields:[['channelId','Default poll channel','channel'],['defaultDurationMinutes','Default duration (minutes)','number',0,10080],['maxOptions','Maximum options','number',2,4],['allowVoteChange','Allow changing vote','checkbox']]},
 {key:'giveaways',title:'🎉 Giveaways',fields:[['channelId','Default giveaway channel','channel'],['defaultDurationMinutes','Default duration (minutes)','number',1,10080],['defaultWinners','Default winner count','number',1,10],['requiredRoleId','Required entry role','role'],['entryButtonLabel','Entry button label','text']]},
 {key:'suggestions',title:'💡 Suggestions',fields:[['channelId','Suggestion channel','channel'],['reviewerRoleId','Reviewer role','role'],['allowAnonymous','Allow anonymous suggestions','checkbox'],['title','Embed title','text'],['approvedMessage','Approval response','text'],['rejectedMessage','Rejection response','text']]},
 {key:'verification',title:'✅ Verification',fields:[['channelId','Verification panel channel','channel'],['roleId','Verified member role','role'],['title','Panel title','text'],['description','Panel description','textarea'],['buttonLabel','Verify button label','text']]},
 {key:'roleButtons',title:'🎭 Self roles',fields:[['channelId','Role panel channel','channel'],['roleId','Role to assign','role'],['label','Button label','text'],['description','Panel description','textarea']]},
 {key:'levels',title:'🏆 Levels & XP',fields:[['xpMin','Minimum XP per message','number',1,100],['xpMax','Maximum XP per message','number',1,200],['cooldownSeconds','XP cooldown (seconds)','number',0,3600],['voiceXpPerMinute','XP per minute in voice','number',0,1000],['announceChannelId','Level-up announcement channel','channel'],['announce','Announce level-ups','checkbox']]},
 {key:'economy',title:'💰 Economy & shop',fields:[['dailyReward','Daily reward','number',0,1000000],['workMin','Minimum work reward','number',0,1000000],['workMax','Maximum work reward','number',0,1000000],['vipPrice','VIP role price','number',0,100000000],['colorPrice','Color role price','number',0,100000000],['bonusPrice','Bonus item price','number',0,100000000],['bonusCoins','Bonus coins granted','number',0,1000000]]},
 {key:'tempVoice',title:'🔊 Temporary voice',fields:[['creatorChannelId','Join-to-create voice channel','voice'],['categoryId','Room category','category'],['nameTemplate','Room name template ({user})','text'],['defaultLimit','Default user limit (0 = unlimited)','number',0,99],['ownerCanManage','Allow room owner to manage','checkbox']]},
 {key:'invites',title:'📩 Invite tracking',fields:[['logChannelId','Invite log channel','channel'],['announceJoins','Announce tracked joins','checkbox'],['messageTemplate','Join announcement template','text']]},
 {key:'streamAlerts',title:'📺 Stream notifications',fields:[['platform','Default platform','platform'],['creator','Default creator / channel ID','text'],['defaultChannelId','Default alert channel','channel'],['messageTemplate','Alert message template','textarea'],['checkIntervalSeconds','Check interval (seconds)','number',60,600]]},
 {key:'customCommands',title:'⚡ Custom commands',fields:[['defaultChannelId','Default response channel (optional)','channel'],['allowEveryone','Allow all members to run custom commands','checkbox'],['maxCommands','Maximum saved commands','number',1,100]]},
 {key:'backup',title:'💾 Backup & restore',fields:[['includeChannels','Include channels','checkbox'],['includeRoles','Include roles','checkbox'],['includeOverwrites','Include overwrite metadata in export (not automatically reapplied)','checkbox'],]},
];
function communityFieldNode(feature,field,value){const [key,label,type,min,max]=field;const wrap=document.createElement('label');wrap.className=type==='checkbox'?'check':'field';const title=document.createElement('span');title.textContent=label;wrap.appendChild(title);let el;
 if(type==='checkbox'){el=document.createElement('input');el.type='checkbox';el.checked=value===true;el.dataset.configKey=key;el.dataset.configType=type;wrap.prepend(el);return wrap}
 if(type==='platform'){el=document.createElement('select');for(const [v,t] of [['twitch','Twitch'],['youtube','YouTube'],['kick','Kick']]){const o=document.createElement('option');o.value=v;o.textContent=t;el.appendChild(o)}}
 else if(['channel','voice','category','role'].includes(type)){el=document.createElement('select');const empty=document.createElement('option');empty.value='';empty.textContent='Not selected';el.appendChild(empty);const list=type==='role'?data.roles:data.channels.filter(x=>type==='voice'?x.type===2:type==='category'?x.type===4:true);for(const item of list){const o=document.createElement('option');o.value=item.id;o.textContent=(type==='role'?'@':'# ')+item.name;el.appendChild(o)}}
 else if(type==='textarea'){el=document.createElement('textarea');el.rows=3}
 else {el=document.createElement('input');el.type=type;if(type==='number'){if(min!==undefined)el.min=min;if(max!==undefined)el.max=max}}
 el.value=value??'';el.dataset.configKey=key;el.dataset.configType=type;wrap.appendChild(el);return wrap}
function renderCommunityConfig(saved){const root=$('communityConfigGrid');root.innerHTML='';for(const feature of communityFields){const card=document.createElement('div');card.className='panel';const h=document.createElement('h2');h.textContent=feature.title;card.appendChild(h);for(const field of feature.fields)card.appendChild(communityFieldNode(feature,field,saved?.[feature.key]?.[field[0]]));root.appendChild(card)}}
$('saveCommunityConfig').onclick=async()=>{const status=$('communityConfigStatus');status.textContent='Saving…';try{const config={};for(const feature of communityFields){const card=[...$('communityConfigGrid').children].find(x=>x.querySelector('h2')?.textContent===feature.title);config[feature.key]={};for(const el of card.querySelectorAll('[data-config-key]')){let value=el.type==='checkbox'?el.checked:el.value;if(el.dataset.configType==='number')value=value===''?null:Number(value);config[feature.key][el.dataset.configKey]=value}}await api('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({communityConfig:config})});status.textContent='All advanced settings saved.'}catch(e){status.textContent=e.message}};
function renderCommunityCommands(){const rows=[['Tickets','/ticket-setup','Create support panel and choose staff, transcript and category.'],['Polls','/poll','Create a poll with two to four options.'],['Giveaways','/giveaway','Set prize, duration and winner count; winners are drawn automatically.'],['Suggestions','/suggestion-setup, /suggest','Choose the suggestion channel, then collect member ideas.'],['Verification','/verify-setup','Choose the verified role and panel channel.'],['Self roles','/role-button','Publish a button to let members toggle a role.'],['Levels','/rank, /leaderboard','View XP, levels and server ranking.'],['Economy','/daily, /work, /balance, /pay, /shop, /buy','Coins, daily rewards and shop.'],['Temporary voice','/tempvoice-setup','Choose the join-to-create voice channel.'],['Invites','/invites, /invite-leaderboard','View invite attribution and rankings.'],['Stream alerts','/stream-alert-setup','Choose Twitch, YouTube or Kick, creator and alert channel.'],['Custom commands','/custom-set, /custom-run, /custom-delete','Create and run saved server responses.'],['Backup','/server-backup, /server-restore','Export or restore supported server structure.']];$('communityCommandList').innerHTML=rows.map(r=>'<div class="command"><div><b>'+r[0]+'</b><p>'+r[2]+'</p><code>'+r[1]+'</code></div><span class="tag">Community</span></div>').join('')}
let xpSearchResults=[];let allServerMembersCache=null;async function loadAllServerMembers(){const buttons=[$('xpLoadAllButton'),$('loadModerationMembers')].filter(Boolean);buttons.forEach(b=>b.disabled=true);$('xpLoadAllStatus').textContent='Loading members…';try{const result=await api('/api/members/list');allServerMembersCache=result.members||[];xpSearchResults=allServerMembersCache;const xpSelect=$('xpMemberSelect');xpSelect.innerHTML='<option value="">Choose member</option>';for(const member of allServerMembersCache){const option=document.createElement('option');option.value=member.id;option.textContent=member.displayName+' (@'+member.username+') — '+member.xp+' XP';xpSelect.appendChild(option)}const modSelect=$('moderationMemberSelect');if(modSelect){modSelect.innerHTML='<option value="">Choose member</option>';for(const member of allServerMembersCache){const option=document.createElement('option');option.value=member.id;option.textContent=member.displayName+' (@'+member.username+')';modSelect.appendChild(option)}}$('xpLoadAllStatus').textContent=allServerMembersCache.length+' members loaded.';if($('actionStatus'))$('actionStatus').textContent=allServerMembersCache.length+' members loaded.';updateXpCurrent()}catch(e){$('xpLoadAllStatus').textContent=e.message}finally{buttons.forEach(b=>b.disabled=false)}}$('xpLoadAllButton').onclick=loadAllServerMembers;$('loadModerationMembers').onclick=loadAllServerMembers;$('moderationMemberSelect').onchange=()=>{$('targetUser').value=$('moderationMemberSelect').value};async function searchXpMembers(){const q=$('xpMemberQuery').value.trim();if(q.length<2){$('xpStatus').textContent='Enter at least 2 characters.';return}$('xpStatus').textContent='Searching…';try{const result=await api('/api/xp/members?q='+encodeURIComponent(q));xpSearchResults=result.members||[];const select=$('xpMemberSelect');select.innerHTML='<option value="">Choose member</option>';for(const member of xpSearchResults){const option=document.createElement('option');option.value=member.id;option.textContent=member.displayName+' (@'+member.username+') — '+member.xp+' XP';select.appendChild(option)}$('xpStatus').textContent=xpSearchResults.length+' member(s) found.';updateXpCurrent()}catch(e){$('xpStatus').textContent=e.message}}function updateXpCurrent(){const member=xpSearchResults.find(x=>x.id===$('xpMemberSelect').value);$('xpCurrentValue').textContent=member?'Current XP: '+member.xp+' | Level '+Math.floor(Math.sqrt(member.xp/100)):'Choose a member to view their current XP.'}$('xpSearchButton').onclick=searchXpMembers;$('xpMemberSelect').onchange=updateXpCurrent;async function adjustXp(action){const userId=$('xpMemberSelect').value,amount=Number($('xpAmount').value);if(!userId){$('xpStatus').textContent='Choose a member first.';return}if(!Number.isInteger(amount)||amount<1||amount>1000000){$('xpStatus').textContent='Enter an amount from 1 to 1,000,000.';return}$('xpStatus').textContent='Updating…';try{const result=await api('/api/xp/adjust',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId,amount,action,reason:$('xpReason').value})});$('xpStatus').textContent=result.message;const member=xpSearchResults.find(x=>x.id===userId);if(member)member.xp=result.xp;const option=$('xpMemberSelect').selectedOptions[0];if(option)option.textContent=member.displayName+' (@'+member.username+') — '+result.xp+' XP';updateXpCurrent()}catch(e){$('xpStatus').textContent=e.message}}$('xpAddButton').onclick=()=>adjustXp('add');$('xpRemoveButton').onclick=()=>adjustXp('remove');let musicPlayerRefresh=null;
const MUSIC_HISTORY_KEY='dashboardMusicHistory_v1';
function readMusicHistory(){try{const value=JSON.parse(localStorage.getItem(MUSIC_HISTORY_KEY)||'[]');return Array.isArray(value)?value.filter(item=>item&&typeof item.url==='string'&&typeof item.title==='string').slice(0,20):[]}catch{return[]}}
function renderMusicHistory(){const select=$('musicHistorySelect');if(!select)return;const history=readMusicHistory();select.innerHTML='';if(!history.length){const option=document.createElement('option');option.value='';option.textContent='No history yet';select.appendChild(option);return}history.forEach((item,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=item.title;select.appendChild(option)})}
function saveMusicHistory(title,url){const history=readMusicHistory().filter(item=>item.url!==url);history.unshift({title:String(title||url).slice(0,180),url:String(url).slice(0,2000)});try{localStorage.setItem(MUSIC_HISTORY_KEY,JSON.stringify(history.slice(0,20)))}catch{}renderMusicHistory()}
function formatPlayerTime(seconds){const n=Math.max(0,Math.floor(Number(seconds)||0));return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')}
let dashboardPlayerSnapshot=null;
let dashboardPlayerScrubbing=false;
let dashboardPlayerForceSync=false;
function renderDashboardPlayerProgress(previewPosition=null){if(!dashboardPlayerSnapshot)return;const state=dashboardPlayerSnapshot;const duration=Number(state.duration)||0;const elapsed=state.paused?0:(Date.now()-state.receivedAt)/1000;const rawPosition=(Number(state.position)||0)+elapsed;const position=previewPosition===null?(duration>0?Math.min(duration,rawPosition):rawPosition):previewPosition;const slider=$('playerProgressSlider');const safePosition=duration>0?Math.max(0,Math.min(position,duration)):0;const progress=duration>0?safePosition/duration:0;const fill=$('playerProgressFill');const thumb=$('playerProgressThumb');if(fill)fill.style.transform='scaleX('+progress+')';if(thumb)thumb.style.left=(progress*100)+'%';if(duration>0){slider.disabled=false;if(!dashboardPlayerScrubbing&&previewPosition===null)slider.value=safePosition}else{slider.disabled=true;slider.value=0}$('playerProgress').textContent=formatPlayerTime(position)+' / '+(duration>0?formatPlayerTime(duration):'--:--')+(state.paused?' • Paused':'')+' • Queue: '+(state.queueLength||0)}
function animateDashboardPlayer(){if(!dashboardPlayerScrubbing)renderDashboardPlayerProgress();requestAnimationFrame(animateDashboardPlayer)}
requestAnimationFrame(animateDashboardPlayer);
async function refreshDashboardPlayer(){try{const state=await api('/api/music/player');const receivedAt=Date.now();const previous=dashboardPlayerSnapshot;if(previous&&!dashboardPlayerForceSync&&state.playing&&!state.paused&&previous.playing&&!previous.paused&&state.title===previous.title){const predicted=(Number(previous.position)||0)+(receivedAt-previous.receivedAt)/1000;const drift=predicted-(Number(state.position)||0);if(drift>0&&drift<4)state.position=Math.max(Number(state.position)||0,predicted-0.12)}dashboardPlayerForceSync=false;dashboardPlayerSnapshot={...state,receivedAt};$('dashboardPlayerTitle').textContent=state.playing?(state.title||'Playing'):'Nothing is playing';const loop=$('playerLoop');if(loop){loop.textContent=state.loopMode==='track'?'🔂 Loop on':'🔂 Loop off';loop.classList.toggle('active',state.loopMode==='track')}const slider=$('playerProgressSlider');const duration=Number(state.duration)||0;slider.max=duration>0?duration:1;slider.disabled=duration<=0;if(duration>0&&!dashboardPlayerScrubbing&&document.activeElement!==slider)slider.value=Math.min(state.position||0,duration);else if(duration<=0)slider.value=0;if(state.segmentEnd&&!$('playerSegmentEnd').value)$('playerSegmentEnd').value=state.segmentEnd;renderDashboardPlayerProgress()}catch(e){$('dashboardPlayerTitle').textContent='Player status unavailable'}}
async function controlDashboardPlayer(action,values={}){const status=$('playerControlStatus');try{if(action==='seek'||action==='pause'||action==='stop')dashboardPlayerForceSync=true;const result=await api('/api/music/player',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...values})});status.textContent=action==='seek'?'Jumping to selected position…':action==='stop'?'Playback stopped.':action==='pause'?'Playback state updated.':action==='loop'?(result.loopMode==='track'?'Repeat current track enabled.':'Loop disabled.'):'';await refreshDashboardPlayer();return result}catch(e){status.textContent=e.message||'Player control failed.';throw e}}
$('playerProgressSlider').onpointerdown=()=>{dashboardPlayerScrubbing=true};
$('playerProgressSlider').onkeydown=()=>{dashboardPlayerScrubbing=true};
$('playerProgressSlider').oninput=()=>{const value=Number($('playerProgressSlider').value);$('playerSeekPosition').value=value;renderDashboardPlayerProgress(value)};
$('playerProgressSlider').onchange=async()=>{const value=Number($('playerProgressSlider').value);$('playerSeekPosition').value=value;try{await controlDashboardPlayer('seek',{position:value})}catch{}finally{dashboardPlayerScrubbing=false;await refreshDashboardPlayer()}};
$('playerProgressSlider').onpointerup=()=>{if(dashboardPlayerScrubbing)$('playerProgressSlider').dispatchEvent(new Event('change',{bubbles:true}))};
$('playerProgressSlider').onpointercancel=()=>{if(dashboardPlayerScrubbing){dashboardPlayerScrubbing=false;refreshDashboardPlayer()}};

$('playerPause').onclick=()=>controlDashboardPlayer('pause').catch(()=>{});
$('playerLoop').onclick=()=>controlDashboardPlayer('loop').catch(()=>{});
$('playMusicHistory').onclick=async()=>{const history=readMusicHistory(),index=Number($('musicHistorySelect').value),item=history[index];if(!item){$('musicStatus').textContent='Choose a history item first.';return}await playDashboardMusicUrl(item.url,$('playMusicHistory'))};

$('playerBack').onclick=()=>controlDashboardPlayer('seek',{position:Math.max(0,Number($('playerSeekPosition').value||0)-10)}).catch(()=>{});
$('playerForward').onclick=()=>controlDashboardPlayer('seek',{position:Number($('playerSeekPosition').value||0)+10}).catch(()=>{});
$('playerSeek').onclick=()=>controlDashboardPlayer('seek',{position:Number($('playerSeekPosition').value||0),endAt:Number($('playerSegmentEnd').value||0)}).catch(()=>{});
$('playerStop').onclick=()=>controlDashboardPlayer('stop').catch(()=>{});
$('uploadLibraryTrack').onclick=async()=>{const file=$('musicLibraryFile').files[0],status=$('musicLibraryStatus'),button=$('uploadLibraryTrack');if(!file){status.textContent='Choose an audio file first.';return}if(file.size>20*1024*1024){status.textContent='The file must be 20 MB or smaller.';return}button.disabled=true;status.textContent='Uploading…';try{const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('Could not read the selected file.'));reader.readAsDataURL(file)});await api('/api/music/library',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:file.name,data})});$('musicLibraryFile').value='';status.textContent='Upload complete.';await loadMusicLibrary()}catch(e){status.textContent=e.message||'Upload failed.'}finally{button.disabled=false}};
async function loadMusicLibrary(){const root=$('musicLibraryList');if(!root)return;try{const result=await api('/api/music/library');const tracks=result.tracks||[];root.innerHTML='';if(!tracks.length){root.textContent='No saved tracks yet. Upload an audio file above.';return}for(const track of tracks){const row=document.createElement('div');row.className='command';row.style.display='flex';row.style.alignItems='center';row.style.justifyContent='space-between';row.style.gap='12px';const info=document.createElement('div');const title=document.createElement('b');title.textContent=track.title;const meta=document.createElement('p');meta.textContent=track.extension.toUpperCase()+' • '+(track.size/1024/1024).toFixed(2)+' MB';info.append(title,meta);const actions=document.createElement('div');actions.style.display='flex';actions.style.gap='8px';const playButton=document.createElement('button');playButton.textContent='▶ Play';playButton.onclick=()=>playSavedLibraryTrack(track.id,playButton);const deleteButton=document.createElement('button');deleteButton.className='danger';deleteButton.textContent='Delete';deleteButton.onclick=()=>deleteSavedLibraryTrack(track.id,deleteButton);actions.append(playButton,deleteButton);row.append(info,actions);root.appendChild(row)}}catch(e){root.textContent='Could not load music library: '+e.message}}
async function playSavedLibraryTrack(id,button){const channelId=$('musicLibraryVoiceChannel').value,status=$('musicLibraryStatus');if(!channelId){status.textContent='Choose a voice channel first.';return}button.disabled=true;status.textContent='Connecting to voice and adding track…';try{const result=await api('/api/music/library/play',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,voiceChannelId:channelId})});status.textContent='Added "'+result.title+'" to #'+result.channelName+'. Queue position: '+result.position+'.'}catch(e){status.textContent=e.message||'Could not play this track.'}finally{button.disabled=false}}
async function deleteSavedLibraryTrack(id,button){if(!confirm('Permanently delete this audio file from the Railway Volume?'))return;button.disabled=true;try{await api('/api/music/library/'+encodeURIComponent(id),{method:'DELETE'});$('musicLibraryStatus').textContent='Audio file deleted.';await loadMusicLibrary()}catch(e){$('musicLibraryStatus').textContent=e.message||'Delete failed.';button.disabled=false}}
async function playDashboardMusicUrl(url,button){const status=$('musicStatus');const voiceChannelId=$('musicVoiceChannel').value;if(!voiceChannelId){status.textContent='Choose a voice channel first.';return}if(!url){status.textContent='Paste a music/video page or direct audio link first.';return}button.disabled=true;status.textContent='Resolving link and connecting to voice channel…';try{const result=await api('/api/music/play',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({voiceChannelId,url})});status.textContent='Added "'+result.title+'" to #'+result.channelName+'. Queue position: '+result.position+'.';saveMusicHistory(result.title||url,url)}catch(e){status.textContent=e.message||'Could not start playback.'}finally{button.disabled=false}}
$('playDashboardMusic').onclick=()=>playDashboardMusicUrl($('musicUrl').value.trim(),$('playDashboardMusic'));
renderMusicHistory();
$('welcomeType').addEventListener('change',updateWelcomeMode);$('welcomeMessage').addEventListener('input',preview);$('welcomeImage').addEventListener('change',()=>{const file=$('welcomeImage').files[0];if(!file)return;if(file.size>5*1024*1024){alert('Image must be 5 MB or smaller.');$('welcomeImage').value='';return}const reader=new FileReader();reader.onload=()=>{imageData=reader.result;$('previewImage').src=imageData;updateWelcomeMode()};reader.readAsDataURL(file)});
$('saveWelcome').onclick=async()=>{const status=$('welcomeStatus');status.textContent='Saving…';try{const mode=$('welcomeType').value;if(mode==='image'&&imageData){await api('/api/welcome-image',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({data:imageData})});imageData=''}await api('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({welcome:{enabled:$('welcomeEnabled').checked,channelId:$('welcomeChannel').value,message:$('welcomeMessage').value,type:mode,mention:$('welcomeMention').checked}})});status.textContent='Saved successfully.';await load()}catch(e){status.textContent=e.message}};
$('saveGoodbye').onclick=async()=>{const status=$('goodbyeStatus');status.textContent='Saving…';try{await api('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({goodbye:{enabled:$('goodbyeEnabled').checked,channelId:$('goodbyeChannel').value,message:$('goodbyeMessage').value}})});status.textContent='Saved successfully.'}catch(e){status.textContent=e.message}};
$('selectAllLogs').onclick=()=>LOG_EVENT_KEYS.forEach(key=>{const input=$('log_'+key);if(input)input.checked=true;});
$('clearAllLogs').onclick=()=>LOG_EVENT_KEYS.forEach(key=>{const input=$('log_'+key);if(input)input.checked=false;});
$('saveModeration').onclick=async()=>{try{const events={};for(const key of LOG_EVENT_KEYS){const input=$('log_'+key);if(input)events[key]=input.checked;}await api('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({moderation:{enabled:$('moderationEnabled').checked,antiLink:$('antiLink').checked,antiSpam:$('antiSpam').checked,antiMentionSpam:$('antiMentionSpam').checked,blockedWords:$('blockedWords').value.split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean).slice(0,100),logChannelId:$('logChannel').value},logging:{enabled:$('loggingEnabled').checked,channelId:$('logChannel').value,events}})});$('moderationStatus').textContent='Saved.'}catch(e){$('moderationStatus').textContent=e.message}};
$('saveCommunity').onclick=async()=>{const status=$('communityStatus');status.textContent='Saving…';try{const community={tickets:$('featureTickets').checked,polls:$('featurePolls').checked,giveaways:$('featureGiveaways').checked,suggestions:$('featureSuggestions').checked,verification:$('featureVerification').checked,roleButtons:$('featureRoleButtons').checked,levels:$('featureLevels').checked,economy:$('featureEconomy').checked,tempVoice:$('featureTempVoice').checked,invites:$('featureInvites').checked,streamAlerts:$('featureStreamAlerts').checked,customCommands:$('featureCustomCommands').checked,backup:$('featureBackup').checked};await api('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({community})});status.textContent='Saved. Disabled features are paused.'}catch(e){status.textContent=e.message}};
$('saveModules').onclick=async()=>{try{await api('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({music:{enabled:$('musicEnabled').checked},ai:{enabled:$('aiEnabled').checked},autorole:{enabled:$('autoroleEnabled').checked,roleId:$('autoroleRole').value}})});$('moduleStatus').textContent='Saved.'}catch(e){$('moduleStatus').textContent=e.message}};
$('saveMusicRequestChannel').onclick=async()=>{const status=$('musicRequestChannelStatus');status.textContent='Saving…';try{await api('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({music:{requestChannelId:$('musicRequestChannel').value}})});status.textContent=$('musicRequestChannel').value?'Request channel saved.':'Automatic music requests disabled.'}catch(e){status.textContent=e.message}};
$('runAction').onclick=async()=>{const status=$('actionStatus');status.textContent='Working…';try{const result=await api('/api/admin-command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:$('adminAction').value,userId:$('targetUser').value,amount:Number($('actionAmount').value)||0,channelId:$('actionChannel').value,reason:$('actionReason').value})});status.textContent=result.message||'Command completed.'}catch(e){status.textContent=e.message}};
$('downloadDataBackup').onclick=()=>{const status=$('backupStatus');status.textContent='Preparing backup…';const link=document.createElement('a');link.href='/api/data-backup';link.download='';document.body.appendChild(link);link.click();link.remove();status.textContent='If the download did not start, sign in again and retry.'};
$('restoreDataBackup').onclick=async()=>{const file=$('restoreBackupFile').files[0],status=$('restoreStatus');if(!file){status.textContent='Choose a JSON backup file first.';return}if(!confirm('Restore this backup? Matching text files on Railway will be overwritten.'))return;status.textContent='Validating and restoring…';try{const backup=JSON.parse(await file.text());const result=await api('/api/data-restore',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({backup})});status.textContent='Restore complete: '+result.restored+' files restored. Reloading dashboard…';setTimeout(()=>location.reload(),1200)}catch(e){status.textContent=e.message}};
load();
</script></body></html>`;
}
function startDashboard(client, playFromDashboard, playSavedTrackFromDashboard, getDashboardMusicStatus, controlDashboardMusic) {
  if (!CLIENT_ID || !CLIENT_SECRET || !SESSION_SECRET || !REDIRECT_URI) {
    console.warn('Dashboard is disabled: configure DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DASHBOARD_SESSION_SECRET and DASHBOARD_REDIRECT_URI.');
    return;
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/privacy') return send(res, 200, legalPage('Privacy Policy', 'November 18, 2026', PRIVACY_POLICY_HTML), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/terms') return send(res, 200, legalPage('Terms of Service', 'November 18, 2026', TERMS_OF_SERVICE_HTML), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, html(), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/auth/login') {
        const now = Date.now();
        for (const [savedState, expiresAt] of states) {
          if (expiresAt <= now) states.delete(savedState);
        }
        while (states.size >= 1000) {
          const oldestState = states.keys().next().value;
          if (!oldestState) break;
          states.delete(oldestState);
        }
        const state = crypto.randomBytes(24).toString('hex');
        states.set(state, now + 300000);
        const target = new URL('https://discord.com/oauth2/authorize');
        target.searchParams.set('client_id', CLIENT_ID);
        target.searchParams.set('redirect_uri', REDIRECT_URI);
        target.searchParams.set('response_type', 'code');
        target.searchParams.set('scope', 'identify guilds');
        target.searchParams.set('state', state);
        return res.writeHead(302, {
          location: target.toString(),
          'cache-control': 'no-store',
          'set-cookie': 'hb_oauth_state=' + encodeURIComponent(state) + '; HttpOnly; Secure; SameSite=Lax; Path=/auth/callback; Max-Age=300',
        }).end();
      }
      if (req.method === 'GET' && url.pathname === '/auth/callback') {
        const state = url.searchParams.get('state');
        const browserState = cookieValue(req, 'hb_oauth_state');
        if (!state || browserState !== state || !states.has(state) || states.get(state) < Date.now()) {
          return res.writeHead(400, {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
            'set-cookie': 'hb_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/auth/callback; Max-Age=0',
          }).end('Invalid login state.');
        }
        states.delete(state);
        const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: url.searchParams.get('code') || '',
            redirect_uri: REDIRECT_URI,
          }),
          signal: AbortSignal.timeout(12000),
        });
        if (!tokenResponse.ok) return send(res, 401, 'Discord login failed.', 'text/plain');
        const tokenData = await tokenResponse.json();
        const [profile, guilds] = await Promise.all([discord('/users/@me', tokenData.access_token), discord('/users/@me/guilds', tokenData.access_token)]);
        const guild = guilds.find(g => g.id === GUILD_ID);
        if (!guild || !allowed(guild)) return send(res, 403, 'You must be a server owner or have Manage Server / Administrator permission.', 'text/plain');
        if (!client.guilds.cache.has(GUILD_ID)) return send(res, 503, 'The bot is not currently in the configured server.', 'text/plain');
        const sid = crypto.randomBytes(32).toString('hex');
        // Only the minimum identity data is persisted; the Discord OAuth token is not stored.
        sessions.set(sid, { user: { id: profile.id, username: profile.global_name || profile.username }, guildId: guild.id, expires: Date.now() + SESSION_TTL_MS });
        saveSessions();
        return res.writeHead(302, { location: '/', 'set-cookie': 'hb_session=' + encodeURIComponent(sid + '.' + sign(sid)) + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000' }).end();
      }
      if (req.method === 'GET' && url.pathname === '/welcome-preview') {
        const session = getSession(req);
        if (!session || session.guildId !== GUILD_ID || !settings.welcome.imagePath) {
          return send(res, 404, 'Not found', 'text/plain');
        }
        const actor = await client.guilds.cache.get(GUILD_ID)?.members.fetch(session.user.id).catch(() => null);
        if (!actor || (!actor.permissions.has('Administrator') && !actor.permissions.has('ManageGuild'))) {
          return send(res, 404, 'Not found', 'text/plain');
        }
        const imageRoot = path.resolve(path.dirname(SETTINGS_FILE), 'welcome-assets') + path.sep;
        const imagePath = path.resolve(settings.welcome.imagePath);
        if (!imagePath.startsWith(imageRoot) || !fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) {
          return send(res, 404, 'Not found', 'text/plain');
        }
        const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
        const type = types[path.extname(imagePath).toLowerCase()];
        if (!type) return send(res, 404, 'Not found', 'text/plain');
        res.writeHead(200, {
          'content-type': type,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        return fs.createReadStream(imagePath).pipe(res);
      }
      if (req.method === 'POST' && url.pathname === '/auth/logout') {
        const s = getSession(req);
        if (s) {
          const sid = cookieValue(req, 'hb_session').split('.')[0];
          sessions.delete(sid);
          saveSessions();
        }
        return res.writeHead(204, { 'set-cookie': 'hb_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0' }).end();
      }
      if (url.pathname.startsWith('/api/')) {
        const session = getSession(req);
        if (!session) return send(res, 401, { error: 'Sign in required' });
        if (session.guildId !== GUILD_ID) return send(res, 403, { error: 'Access denied' });
        const liveGuild = client.guilds.cache.get(GUILD_ID);
        if (!liveGuild) return send(res, 503, { error: 'Bot is not in the configured server' });
        const authorizeManager = async () => {
          const actor = await liveGuild.members.fetch(session.user.id).catch(() => null);
          return !!actor && (actor.permissions.has('Administrator') || actor.permissions.has('ManageGuild'));
        };
        if (req.method === 'POST' && url.pathname === '/api/data-restore') {
          const actor = await liveGuild.members.fetch(session.user.id).catch(() => null);
          if (!actor || (!actor.permissions.has('Administrator') && !actor.permissions.has('ManageGuild'))) return send(res, 403, { error: 'You no longer have server management permission.' });
          const body = await readBody(req, 15 * 1024 * 1024);
          const archive = body.backup;
          if (!archive || archive.format !== 'hardboy-bot-text-backup' || archive.version !== 1 || !Array.isArray(archive.files) || archive.files.length > 250) return send(res, 400, { error: 'Invalid or unsupported backup file.' });
          if (!archive.guild || archive.guild.id !== liveGuild.id) return send(res, 400, { error: 'This backup belongs to a different Discord server.' });
          const allowedExtensions = new Set(['.json','.txt','.log','.csv','.yaml','.yml','.md','.ini','.toml']);
          const dataRoot = path.resolve('/app/data');
          const warningPath = path.resolve(process.env.WARNINGS_FILE || path.join(__dirname, 'data', 'warnings.json'));
          const restoredPaths = [];
          let totalBytes = 0;
          const validated = [];
          for (const item of archive.files) {
            if (!item || typeof item.path !== 'string' || typeof item.content !== 'string') return send(res, 400, { error: 'Backup contains an invalid file entry.' });
            const name = item.path;
            if (name.length > 240 || name.includes('\\') || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) return send(res, 400, { error: 'Backup contains an unsafe file path.' });
            const bytes = Buffer.byteLength(item.content, 'utf8');
            totalBytes += bytes;
            if (bytes > 2 * 1024 * 1024 || totalBytes > 12 * 1024 * 1024) return send(res, 400, { error: 'Backup exceeds the allowed restore size.' });
            if (item.content.includes('\u0000')) return send(res, 400, { error: 'Backup contains binary content.' });
            let target;
            if (name.startsWith('external/')) {
              const base = name.slice('external/'.length);
              const allowedExternal = new Set([path.basename(SETTINGS_FILE), path.basename(warningPath)]);
              if (!base || base.includes('/') || !allowedExternal.has(base)) continue;
              target = base === path.basename(SETTINGS_FILE) ? path.resolve(SETTINGS_FILE) : warningPath;
            } else {
              if (!allowedExtensions.has(path.extname(name).toLowerCase())) continue;
              target = path.resolve(dataRoot, name);
              if (!target.startsWith(dataRoot + path.sep)) return send(res, 400, { error: 'Backup contains an unsafe file path.' });
            }
            validated.push({ target, content: item.content });
          }
          for (const item of validated) {
            fs.mkdirSync(path.dirname(item.target), { recursive: true });
            let cursor = path.dirname(item.target);
            while (cursor.startsWith(dataRoot + path.sep) || cursor === dataRoot) {
              if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Refusing to restore through a symbolic link.');
              if (cursor === dataRoot) break;
              cursor = path.dirname(cursor);
            }
            const temp = item.target + '.restore-' + crypto.randomBytes(6).toString('hex');
            fs.writeFileSync(temp, item.content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
            fs.renameSync(temp, item.target);
            restoredPaths.push(item.target);
          }
          if (restoredPaths.includes(path.resolve(SETTINGS_FILE))) settings = loadSettings();
          return send(res, 200, { ok: true, restored: restoredPaths.length });
        }
        if (req.method === 'GET' && url.pathname === '/api/data-backup') {
          const actor = await liveGuild.members.fetch(session.user.id).catch(() => null);
          if (!actor || (!actor.permissions.has('Administrator') && !actor.permissions.has('ManageGuild'))) return send(res, 403, { error: 'You no longer have server management permission.' });
          const allowedExtensions = new Set(['.json','.txt','.log','.csv','.yaml','.yml','.md','.ini','.toml']);
          const excludedNames = new Set(['.env','credentials.json','secrets.json','token.json']);
          const files = [];
          const maxFiles = 250;
          const maxBytes = 12 * 1024 * 1024;
          let totalBytes = 0;
          const dataRoot = path.resolve('/app/data');
          function collectTextFiles(dir) {
            if (!fs.existsSync(dir)) return;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              if (files.length >= maxFiles || totalBytes >= maxBytes) break;
              if (entry.name.startsWith('.') || excludedNames.has(entry.name.toLowerCase())) continue;
              const full = path.join(dir, entry.name);
              if (entry.isSymbolicLink()) continue;
              if (entry.isDirectory()) { collectTextFiles(full); continue; }
              if (!entry.isFile() || !allowedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
              const stat = fs.statSync(full);
              if (stat.size > 2 * 1024 * 1024 || totalBytes + stat.size > maxBytes) continue;
              const content = fs.readFileSync(full);
              if (content.includes(0)) continue;
              files.push({ path: path.relative(dataRoot, full).split(path.sep).join('/'), content: content.toString('utf8') });
              totalBytes += stat.size;
            }
          }
          collectTextFiles(dataRoot);
          const extraFiles = [SETTINGS_FILE, process.env.WARNINGS_FILE || path.join(__dirname, 'data', 'warnings.json')];
          for (const full of extraFiles) {
            const resolved = path.resolve(full);
            if (resolved.startsWith(dataRoot + path.sep) || resolved === dataRoot || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;
            if (!allowedExtensions.has(path.extname(resolved).toLowerCase()) || files.length >= maxFiles) continue;
            const stat = fs.statSync(resolved);
            if (stat.size > 2 * 1024 * 1024 || totalBytes + stat.size > maxBytes) continue;
            const content = fs.readFileSync(resolved);
            if (content.includes(0)) continue;
            files.push({ path: 'external/' + path.basename(resolved), content: content.toString('utf8') });
            totalBytes += stat.size;
          }
          const archive = { format: 'hardboy-bot-text-backup', version: 1, createdAt: new Date().toISOString(), guild: { id: liveGuild.id, name: liveGuild.name }, fileCount: files.length, totalBytes, files };
          const payload = JSON.stringify(archive, null, 2);
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="hardboy-bot-backup-' + new Date().toISOString().slice(0,10) + '.json"', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          return res.end(payload);
        }
        const authorizeMusicPlayer = async () => {
          const actor = await liveGuild.members.fetch(session.user.id).catch(() => null);
          return !!actor && (actor.permissions.has('Administrator') || actor.permissions.has('ManageGuild'));
        };
        if (req.method === 'GET' && url.pathname === '/api/music/player') {
          if (!await authorizeMusicPlayer()) return send(res, 403, { error: 'Server management permission required.' });
          return send(res, 200, typeof getDashboardMusicStatus === 'function' ? await getDashboardMusicStatus(GUILD_ID) : { playing: false });
        }
        if (req.method === 'POST' && url.pathname === '/api/music/player') {
          if (!settings.music.enabled) return send(res, 403, { error: 'Music is disabled in the Modules section.' });
          if (!await authorizeMusicPlayer()) return send(res, 403, { error: 'Server management permission required.' });
          if (typeof controlDashboardMusic !== 'function') return send(res, 503, { error: 'Music player controls are unavailable.' });
          const body = await readBody(req, 5000);
          try {
            const result = await controlDashboardMusic(GUILD_ID, String(body.action || ''), body);
            return send(res, 200, { ok: true, ...result });
          } catch (error) {
            return send(res, 400, { error: error.message || 'Player control failed.' });
          }
        }
        const musicLibraryDir = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || '/app/data', 'music-library');
        const authorizeMusicManager = async () => {
          const actor = await liveGuild.members.fetch(session.user.id).catch(() => null);
          return !!actor && (actor.permissions.has('Administrator') || actor.permissions.has('ManageGuild'));
        };
        const fallbackGifPath = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || '/app/data', 'music-fallback.gif');
        if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/api/music/fallback-artwork') {
          if (!await authorizeMusicManager()) return send(res, 403, { error: 'Server management permission required.' });
          if (req.method === 'GET') {
            if (!fs.existsSync(fallbackGifPath)) return send(res, 404, { error: 'No custom fallback GIF uploaded yet.' });
            const image = fs.readFileSync(fallbackGifPath);
            res.writeHead(200, { 'content-type': 'image/gif', 'content-length': image.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
            return res.end(image);
          }
          const body = await readBody(req, 12 * 1024 * 1024);
          const encoded = String(body.data || '');
          if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return send(res, 400, { error: 'Choose a valid GIF file.' });
          const bytes = Buffer.from(encoded, 'base64');
          const gifHeader = bytes.subarray(0, 6).toString('ascii');
          if (!['GIF87a', 'GIF89a'].includes(gifHeader) || !bytes.length || bytes.length > 8 * 1024 * 1024) {
            return send(res, 400, { error: 'Only valid GIF files up to 8 MB are supported.' });
          }
          fs.mkdirSync(path.dirname(fallbackGifPath), { recursive: true });
          const temporaryPath = fallbackGifPath + '.tmp';
          fs.writeFileSync(temporaryPath, bytes, { mode: 0o600 });
          fs.renameSync(temporaryPath, fallbackGifPath);
          console.log('Dashboard uploaded a new fallback music GIF:', path.basename(fallbackGifPath), bytes.length, 'bytes');
          return send(res, 200, { ok: true });
        }
        if (req.method === 'GET' && url.pathname === '/api/music/library') {
          if (!await authorizeMusicManager()) return send(res, 403, { error: 'Server management permission required.' });
          fs.mkdirSync(musicLibraryDir, { recursive: true });
          const tracks = fs.readdirSync(musicLibraryDir, { withFileTypes: true })
            .filter(entry => entry.isFile() && !entry.isSymbolicLink() && /^[a-f0-9]{32}__[\p{L}\p{N} _-]{1,70}\.(mp3|wav|ogg|opus|m4a|aac|flac)$/iu.test(entry.name))
            .map(entry => {
              const full = path.join(musicLibraryDir, entry.name);
              const stat = fs.statSync(full);
              const match = /^([a-f0-9]{32})__(.*)\.([^.]+)$/i.exec(entry.name);
              return { id: match[1], title: match[2].replace(/[_-]+/g, ' '), extension: match[3].toLowerCase(), size: stat.size };
            }).sort((a,b) => a.title.localeCompare(b.title));
          return send(res, 200, { tracks });
        }
        if (req.method === 'POST' && url.pathname === '/api/music/library') {
          if (!settings.music.enabled) return send(res, 403, { error: 'Music is disabled in the Modules section.' });
          if (!await authorizeMusicManager()) return send(res, 403, { error: 'Server management permission required.' });
          const body = await readBody(req, 30 * 1024 * 1024);
          const originalName = path.basename(String(body.name || 'audio').replace(/\\\\/g, '/'));
          const extension = path.extname(originalName).toLowerCase().replace('.', '');
          const allowed = new Set(['mp3','wav','ogg','opus','m4a','aac','flac']);
          const encoded = String(body.data || '');
          if (!allowed.has(extension) || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return send(res, 400, { error: 'Choose a supported audio file.' });
          const bytes = Buffer.from(encoded, 'base64');
          if (!bytes.length || bytes.length > 20 * 1024 * 1024) return send(res, 400, { error: 'Audio file must be 20 MB or smaller.' });
          const safeBase = path.basename(originalName, path.extname(originalName)).replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, ' ').trim().slice(0,70) || 'audio';
          fs.mkdirSync(musicLibraryDir, { recursive: true });
          const id = crypto.randomBytes(16).toString('hex');
          fs.writeFileSync(path.join(musicLibraryDir, id + '__' + safeBase + '.' + extension), bytes, { mode: 0o600, flag: 'wx' });
          return send(res, 200, { ok: true, id, title: safeBase });
        }
        if (req.method === 'POST' && url.pathname === '/api/music/library/play') {
          if (!settings.music.enabled) return send(res, 403, { error: 'Music is disabled in the Modules section.' });
          if (!await authorizeMusicManager()) return send(res, 403, { error: 'Server management permission required.' });
          if (typeof playSavedTrackFromDashboard !== 'function') return send(res, 503, { error: 'Saved music playback is unavailable.' });
          const body = await readBody(req, 5000);
          const id = String(body.id || '');
          const voiceChannelId = String(body.voiceChannelId || '').trim();
          if (!/^[a-f0-9]{32}$/.test(id) || !voiceChannelId) return send(res, 400, { error: 'Choose a saved track and voice channel.' });
          const voiceChannel = await liveGuild.channels.fetch(voiceChannelId).catch(() => null);
          if (!voiceChannel || voiceChannel.type !== 2) return send(res, 400, { error: 'The selected channel is not a regular voice channel.' });
          const entries = fs.existsSync(musicLibraryDir) ? fs.readdirSync(musicLibraryDir) : [];
          const filename = entries.find(name => name.startsWith(id + '__') && /\.(mp3|wav|ogg|opus|m4a|aac|flac)$/i.test(name));
          if (!filename) return send(res, 404, { error: 'Saved audio file not found.' });
          const fullPath = path.join(musicLibraryDir, filename);
          const titleMatch = /^[a-f0-9]{32}__(.*)\.[^.]+$/i.exec(filename);
          try {
            const result = await playSavedTrackFromDashboard(GUILD_ID, voiceChannelId, { id, title: titleMatch ? titleMatch[1].replace(/[_-]+/g, ' ') : 'Uploaded audio', source: 'local', filePath: fullPath }, session.user.username);
            return send(res, 200, { ok: true, title: result.track.title, position: result.position, channelName: result.channelName });
          } catch (error) {
            console.error('Saved dashboard music playback failed:', error.stack || error);
            return send(res, error.status || 400, { error: error.message || 'Could not start playback.' });
          }
        }
        if (req.method === 'DELETE' && url.pathname.startsWith('/api/music/library/')) {
          if (!await authorizeMusicManager()) return send(res, 403, { error: 'Server management permission required.' });
          const id = url.pathname.slice('/api/music/library/'.length);
          if (!/^[a-f0-9]{32}$/.test(id)) return send(res, 400, { error: 'Invalid music file ID.' });
          if (!fs.existsSync(musicLibraryDir)) return send(res, 404, { error: 'Saved audio file not found.' });
          const filename = fs.readdirSync(musicLibraryDir).find(name => name.startsWith(id + '__') && /\.(mp3|wav|ogg|opus|m4a|aac|flac)$/i.test(name));
          if (!filename) return send(res, 404, { error: 'Saved audio file not found.' });
          await fs.promises.unlink(path.join(musicLibraryDir, filename));
          return send(res, 200, { ok: true });
        }
        if (req.method === 'POST' && url.pathname === '/api/music/play') {
          if (!settings.music.enabled) return send(res, 403, { error: 'Music is disabled in the Modules section.' });
          if (typeof playFromDashboard !== 'function') return send(res, 503, { error: 'Dashboard music playback is unavailable.' });
          const actor = await liveGuild.members.fetch(session.user.id).catch(() => null);
          if (!actor || (!actor.permissions.has('Administrator') && !actor.permissions.has('ManageGuild'))) {
            return send(res, 403, { error: 'You need Administrator or Manage Server permission to play music from the dashboard.' });
          }
          const body = await readBody(req, 5000);
          const voiceChannelId = String(body.voiceChannelId || '').trim();
          const trackUrl = String(body.url || '').trim();
          if (!voiceChannelId) return send(res, 400, { error: 'Choose a voice channel.' });
          if (!/^https?:\/\//i.test(trackUrl) || trackUrl.length > 2000) {
            return send(res, 400, { error: 'Paste a valid http(s) link from a supported music site.' });
          }
          const voiceChannel = await liveGuild.channels.fetch(voiceChannelId).catch(() => null);
          if (!voiceChannel || voiceChannel.type !== 2) {
            return send(res, 400, { error: 'The selected channel is not a regular voice channel.' });
          }
          try {
            const result = await playFromDashboard(GUILD_ID, voiceChannelId, trackUrl, session.user.username);
            return send(res, 200, {
              ok: true,
              title: result.track.title,
              duration: result.track.duration,
              position: result.position,
              channelName: result.channelName,
            });
          } catch (error) {
            console.error('Dashboard music playback failed:', error.stack || error);
            return send(res, error.status || 400, { error: error.message || 'Could not start playback.' });
          }
        }
        if (req.method === 'GET' && url.pathname === '/api/me') {
          if (!await authorizeManager()) return send(res, 403, { error: 'Server management permission required.' });
          const channels = await liveGuild.channels.fetch();
          const roles = await liveGuild.roles.fetch();
          return send(res, 200, { roles: roles.filter(role => role.id !== liveGuild.id && !role.managed).map(role => ({ id: role.id, name: role.name })).sort((a,b)=>a.name.localeCompare(b.name)), user: session.user, guild: { id: liveGuild.id, name: liveGuild.name, memberCount: liveGuild.memberCount }, channels: channels.filter(c => c && c.guild && (c.isTextBased() || c.isVoiceBased() || c.type === 4)).map(c => ({ id: c.id, name: c.name, type: c.type })).sort((a,b)=>a.name.localeCompare(b.name)), settings, commands: [{name:'play',description:'Play a track by title or URL',category:'Music'},{name:'join',description:'Join your current voice channel',category:'Music'},{name:'queue',description:'Show the music queue',category:'Music'},{name:'skip',description:'Skip the current track',category:'Music'},{name:'pause',description:'Pause playback',category:'Music'},{name:'resume',description:'Resume playback',category:'Music'},{name:'stop',description:'Stop playback and clear the queue',category:'Music'},{name:'leave',description:'Leave the voice channel',category:'Music'},{name:'kick',description:'Kick a server member',category:'Moderation'},{name:'ban',description:'Ban a user',category:'Moderation'},{name:'timeout',description:'Temporarily time out a member',category:'Moderation'},{name:'untimeout',description:'Remove a member timeout',category:'Moderation'},{name:'clear',description:'Delete recent messages',category:'Moderation'},{name:'slowmode',description:'Set channel slowmode',category:'Moderation'},{name:'lock',description:'Lock this channel',category:'Moderation'},{name:'unlock',description:'Unlock this channel',category:'Moderation'},{name:'warn',description:'Add a warning to a member',category:'Moderation'},{name:'warnings',description:'List warnings for a member',category:'Moderation'},{name:'clearwarns',description:'Clear warnings for a member',category:'Moderation'},{name:'activity',description:'Change the bot activity',category:'Bot'},{name:'ping',description:'Check bot latency',category:'Bot'},{name:'help',description:'Show the command list',category:'Bot'}] });
        }
        if (req.method === 'PUT' && url.pathname === '/api/settings') {
          if (!await authorizeManager()) return send(res, 403, { error: 'Server management permission required.' });
          const body = await readBody(req);
          const liveChannels = await liveGuild.channels.fetch();
          const liveRoles = await liveGuild.roles.fetch();
          const channelIds = new Set(liveChannels.filter(c => c && c.guild).map(c => c.id));
          const roleIds = new Set(liveRoles.map(r => r.id));
          const validChannel = id => !id || channelIds.has(id);
          const validRole = id => !id || roleIds.has(id);
          if (body.communityConfig) { for (const config of Object.values(body.communityConfig)) { if (!config || typeof config !== 'object') continue; for (const [key, value] of Object.entries(config)) { if (value === '' || value == null) continue; if (['panelChannelId','transcriptChannelId','channelId','announceChannelId','creatorChannelId','defaultChannelId','logChannelId','categoryId'].includes(key) && !validChannel(value)) return send(res, 400, { error: 'Invalid channel or category selection: ' + key }); if (['staffRoleId','reviewerRoleId','requiredRoleId','roleId','unverifiedRoleId'].includes(key) && !validRole(value)) return send(res, 400, { error: 'Invalid role selection: ' + key }); } } }
          if (!validChannel(body.welcome && body.welcome.channelId) || !validChannel(body.goodbye && body.goodbye.channelId) || !validChannel(body.moderation && body.moderation.logChannelId) || !validChannel(body.logging && body.logging.channelId) || !validChannel(body.music && body.music.requestChannelId)) return send(res, 400, { error: 'Invalid channel' });
          settings = merge(settings, body);
          if (settings.welcome.type === 'image' && !settings.welcome.imagePath) return send(res, 400, { error: 'Upload a welcome image before selecting image mode.' });
          settings.welcome.message = String(settings.welcome.message || defaults.welcome.message).slice(0, 500);
          saveSettings();
          return send(res, 200, { ok: true });
        }
        if (req.method === 'PUT' && url.pathname === '/api/welcome-image') {
          if (!await authorizeManager()) return send(res, 403, { error: 'Server management permission required.' });
          const body = await readBody(req, 7 * 1024 * 1024);
          const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ''));
          if (!match) return send(res, 400, { error: 'Upload a PNG, JPG or WebP image.' });
          const bytes = Buffer.from(match[2], 'base64');
          if (!bytes.length || bytes.length > 5 * 1024 * 1024) return send(res, 400, { error: 'Image must be 5 MB or smaller.' });
          const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
          const imageDir = path.join(path.dirname(SETTINGS_FILE), 'welcome-assets');
          fs.mkdirSync(imageDir, { recursive: true });
          const imagePath = path.join(imageDir, 'welcome.' + ext);
          fs.writeFileSync(imagePath, bytes, { mode: 0o600 });
          settings.welcome.imagePath = imagePath;
          settings.welcome.imageUrl = '/welcome-preview';
          saveSettings();
          return send(res, 200, { ok: true });
        }
        if (req.method === 'GET' && url.pathname === '/api/members/list') { const actor=await liveGuild.members.fetch(session.user.id).catch(()=>null); if(!actor||(!actor.permissions.has('Administrator')&&!actor.permissions.has('ManageGuild')))return send(res,403,{error:'Server management permission required.'}); const found=await liveGuild.members.fetch().catch(()=>null); if(!found)return send(res,503,{error:'Could not load server members. Check the Server Members intent.'}); const xpDb=require('./community').getXpData?require('./community').getXpData():null; const members=found.filter(m=>!m.user.bot).map(m=>({id:m.id,username:m.user.username,displayName:m.displayName,xp:Number(xpDb?.[liveGuild.id]?.[m.id]?.xp||0)})).sort((a,b)=>a.displayName.localeCompare(b.displayName)); return send(res,200,{members}); }
        if (req.method === 'GET' && url.pathname === '/api/xp/members') { const actor=await liveGuild.members.fetch(session.user.id).catch(()=>null); if(!actor||(!actor.permissions.has('Administrator')&&!actor.permissions.has('ManageGuild')))return send(res,403,{error:'Server management permission required.'}); const q=String(url.searchParams.get('q')||'').trim().slice(0,80); if(q.length<2)return send(res,400,{error:'Enter at least 2 characters.'}); const found=await liveGuild.members.search({query:q,limit:25}).catch(()=>null); if(!found)return send(res,503,{error:'Could not search server members.'}); const xpDb=require('./community').getXpData?require('./community').getXpData():null; const members=found.filter(m=>!m.user.bot).map(m=>({id:m.id,username:m.user.username,displayName:m.displayName,xp:Number(xpDb?.[liveGuild.id]?.[m.id]?.xp||0)})); return send(res,200,{members}); }
        if (req.method === 'POST' && url.pathname === '/api/xp/adjust') { const actor=await liveGuild.members.fetch(session.user.id).catch(()=>null); if(!actor||(!actor.permissions.has('Administrator')&&!actor.permissions.has('ManageGuild')))return send(res,403,{error:'Server management permission required.'}); const body=await readBody(req,5000); const userId=String(body.userId||'').trim(); const amount=Number(body.amount); const action=String(body.action||''); if(!/^\d{17,20}$/.test(userId)||!Number.isInteger(amount)||amount<1||amount>1000000||!['add','remove'].includes(action))return send(res,400,{error:'Invalid member or XP amount.'}); const target=await liveGuild.members.fetch(userId).catch(()=>null); if(!target||target.user.bot)return send(res,404,{error:'Human server member not found.'}); const community=require('./community'); if(typeof community.adjustXp!=='function')return send(res,503,{error:'XP adjustment is unavailable.'}); const xp=community.adjustXp(liveGuild.id,userId,action==='add'?amount:-amount); return send(res,200,{ok:true,xp,message:(action==='add'?'Added ':'Removed ')+amount+' XP '+(action==='add'?'to ':'from ')+target.displayName+'.'}); }
        if (req.method === 'POST' && url.pathname === '/api/admin-command') {
          const body = await readBody(req);
          const actor = await liveGuild.members.fetch(session.user.id).catch(() => null);
          if (!actor || !actor.permissions.has('Administrator') && !actor.permissions.has('ManageGuild')) return send(res, 403, { error: 'You no longer have server management permission.' });
          const reason = String(body.reason || 'Executed from server dashboard').slice(0, 400);
          const targetId = String(body.userId || '').trim();
          const target = targetId ? await liveGuild.members.fetch(targetId).catch(() => null) : null;
          const channel = body.channelId ? await liveGuild.channels.fetch(String(body.channelId)).catch(() => null) : null;
          const amount = Number(body.amount || 0);
          const action = String(body.action || '');
          if (['kick','ban','timeout','untimeout'].includes(action) && !target) return send(res, 400, { error: 'Enter a valid server member ID.' });
          if (['clear','slowmode','lock','unlock'].includes(action) && (!channel || !channel.isTextBased())) return send(res, 400, { error: 'Choose a valid text channel.' });
          if (action === 'kick') { if (!actor.permissions.has('KickMembers')) return send(res,403,{error:'You need Kick Members permission.'}); await target.kick(reason); }
          else if (action === 'ban') { if (!actor.permissions.has('BanMembers')) return send(res,403,{error:'You need Ban Members permission.'}); await liveGuild.members.ban(target.id,{reason}); }
          else if (action === 'timeout') { if (!actor.permissions.has('ModerateMembers')) return send(res,403,{error:'You need Moderate Members permission.'}); if (!Number.isInteger(amount)||amount<1||amount>40320) return send(res,400,{error:'Timeout must be 1–40320 minutes.'}); await target.timeout(amount*60000,reason); }
          else if (action === 'untimeout') { if (!actor.permissions.has('ModerateMembers')) return send(res,403,{error:'You need Moderate Members permission.'}); await target.timeout(null,reason); }
          else if (action === 'clear') { if (!actor.permissions.has('ManageMessages')) return send(res,403,{error:'You need Manage Messages permission.'}); if (!Number.isInteger(amount)||amount<1||amount>100) return send(res,400,{error:'Choose 1–100 messages.'}); const deleted=await channel.bulkDelete(amount,true); return send(res,200,{ok:true,message:deleted.size+' messages deleted.'}); }
          else if (action === 'slowmode') { if (!actor.permissions.has('ManageChannels')) return send(res,403,{error:'You need Manage Channels permission.'}); if (!Number.isInteger(amount)||amount<0||amount>21600) return send(res,400,{error:'Slowmode must be 0–21600 seconds.'}); await channel.setRateLimitPerUser(amount,reason); }
          else if (action === 'lock' || action === 'unlock') { if (!actor.permissions.has('ManageChannels')) return send(res,403,{error:'You need Manage Channels permission.'}); await channel.permissionOverwrites.edit(liveGuild.roles.everyone,{SendMessages:action==='lock'?false:null},{reason}); }
          else return send(res,400,{error:'Unsupported dashboard action.'});
          return send(res,200,{ok:true,message:'/'+action+' completed successfully.'});
        }
        return send(res, 404, { error: 'Not found' });
      }
      return send(res, 404, 'Not found', 'text/plain');
    } catch (error) {
      console.error('Dashboard request failed:', error.message || error);
      const status = Number.isInteger(error.status) ? error.status : 500;
      return send(res, status, { error: status === 413 ? 'Request too large' : status === 400 ? (error.message || 'Bad request') : 'Internal server error' });
    }
  });
  server.listen(PORT, '0.0.0.0', () => console.log('Dashboard listening on port ' + PORT + ' for server ' + GUILD_ID));
  return server;
}
function getDashboardSettings(guildId) {
  return guildId === GUILD_ID ? settings : defaults;
}
module.exports = { startDashboard, getDashboardSettings };
