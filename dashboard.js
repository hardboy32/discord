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
const PORT = Number(process.env.PORT || 3000);
const sessions = new Map();
const states = new Map();

const defaults = {
  welcome: { enabled: false, channelId: '', message: 'Welcome {user} to {server}!' },
  moderation: { enabled: true, antiLink: false, logChannelId: '' },
  music: { enabled: true },
  ai: { enabled: true }
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
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), { mode: 0o600 });
}
function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}
function cookieValue(req, name) {
  const raw = req.headers.cookie || '';
  const item = raw.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}
function getSession(req) {
  const token = cookieValue(req, 'hb_session');
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const supplied = Buffer.from(parts[1]);
  const expected = Buffer.from(sign(parts[0]));
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  const session = sessions.get(parts[0]);
  if (!session || session.expires < Date.now()) {
    sessions.delete(parts[0]);
    return null;
  }
  return session;
}
function send(res, status, body, type) {
  res.writeHead(status, { 'content-type': type || 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 20000) reject(new Error('Request too large')); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
async function discord(pathname, token) {
  const response = await fetch('https://discord.com/api/v10' + pathname, { headers: { authorization: 'Bearer ' + token } });
  if (!response.ok) throw new Error('Discord API returned ' + response.status);
  return response.json();
}
function allowed(user) {
  const permissions = BigInt(user.permissions || '0');
  return user.owner === true || (permissions & 0x8n) === 0x8n || (permissions & 0x20n) === 0x20n;
}
function html() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Server Control</title><style>*{box-sizing:border-box}body{margin:0;background:#0b1020;color:#e8ecf5;font:15px system-ui}main{max-width:900px;margin:40px auto;padding:20px}.card{background:#151d32;border:1px solid #293550;border-radius:16px;padding:22px;margin:16px 0}.muted{color:#9eabc4}h1{font-size:28px}h2{font-size:19px;margin-top:0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}label{display:block;margin:12px 0;color:#cbd5e8}input[type=text],select{width:100%;padding:11px;border-radius:9px;border:1px solid #40506e;background:#0e1629;color:white}input[type=checkbox]{transform:scale(1.2);margin-right:10px}button,.login{display:inline-block;background:#5865f2;color:white;border:0;border-radius:9px;padding:11px 17px;font-weight:650;text-decoration:none;cursor:pointer}.save{margin-top:15px}.hidden{display:none}#status{margin-left:12px;color:#9de0b3}@media(max-width:650px){.grid{grid-template-columns:1fr}main{margin:12px auto}}</style></head><body><main><h1>Server Control Panel</h1><p class="muted">Single-server dashboard</p><section id="login" class="card"><h2>Sign in with Discord</h2><p class="muted">Only server owners and administrators can manage these settings.</p><a class="login" href="/auth/login">Continue with Discord</a></section><section id="app" class="hidden"><div class="card"><h2 id="serverName">Your server</h2><p class="muted" id="userName"></p></div><div class="grid"><section class="card"><h2>Welcome system</h2><label><input id="welcomeEnabled" type="checkbox"> Enable welcome messages</label><label>Welcome channel<select id="welcomeChannel"></select></label><label>Message<input id="welcomeMessage" type="text" maxlength="500"></label><p class="muted">Placeholders: {user}, {server}, {count}</p></section><section class="card"><h2>Moderation</h2><label><input id="moderationEnabled" type="checkbox"> Enable moderation commands</label><label><input id="antiLink" type="checkbox"> Block invite links</label><label>Moderation log channel<select id="logChannel"></select></label></section><section class="card"><h2>Music</h2><label><input id="musicEnabled" type="checkbox"> Enable music commands</label></section><section class="card"><h2>AI assistant</h2><label><input id="aiEnabled" type="checkbox"> Enable AI replies</label><p class="muted">Requires GROQ_API_KEY in Railway.</p></section></div><button class="save" id="save">Save settings</button><span id="status"></span></section></main><script>
const $=id=>document.getElementById(id);let channelOptions=[];
async function load(){const r=await fetch('/api/me');if(!r.ok){$('login').classList.remove('hidden');return}const d=await r.json();$('login').classList.add('hidden');$('app').classList.remove('hidden');$('serverName').textContent=d.guild.name;$('userName').textContent='Signed in as '+d.user.username;channelOptions=d.channels;for(const id of ['welcomeChannel','logChannel']){const s=$(id);s.innerHTML='<option value="">Not set</option>'+channelOptions.map(c=>'<option value="'+c.id+'">'+c.name.replace(/</g,'&lt;')+'</option>').join('')}const s=d.settings;$('welcomeEnabled').checked=s.welcome.enabled;$('welcomeChannel').value=s.welcome.channelId;$('welcomeMessage').value=s.welcome.message;$('moderationEnabled').checked=s.moderation.enabled;$('antiLink').checked=s.moderation.antiLink;$('logChannel').value=s.moderation.logChannelId;$('musicEnabled').checked=s.music.enabled;$('aiEnabled').checked=s.ai.enabled}
$('save').onclick=async()=>{const settings={welcome:{enabled:$('welcomeEnabled').checked,channelId:$('welcomeChannel').value,message:$('welcomeMessage').value},moderation:{enabled:$('moderationEnabled').checked,antiLink:$('antiLink').checked,logChannelId:$('logChannel').value},music:{enabled:$('musicEnabled').checked},ai:{enabled:$('aiEnabled').checked}};const r=await fetch('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(settings)});$('status').textContent=r.ok?'Saved.':'Could not save settings.'};load();
</script></body></html>`;
}
function startDashboard(client) {
  if (!CLIENT_ID || !CLIENT_SECRET || !SESSION_SECRET || !REDIRECT_URI) {
    console.warn('Dashboard is disabled: configure DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DASHBOARD_SESSION_SECRET and DASHBOARD_REDIRECT_URI.');
    return;
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, html(), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/auth/login') {
        const state = crypto.randomBytes(24).toString('hex');
        states.set(state, Date.now() + 300000);
        const target = new URL('https://discord.com/oauth2/authorize');
        target.searchParams.set('client_id', CLIENT_ID);
        target.searchParams.set('redirect_uri', REDIRECT_URI);
        target.searchParams.set('response_type', 'code');
        target.searchParams.set('scope', 'identify guilds');
        target.searchParams.set('state', state);
        return res.writeHead(302, { location: target.toString(), 'cache-control': 'no-store' }).end();
      }
      if (req.method === 'GET' && url.pathname === '/auth/callback') {
        const state = url.searchParams.get('state');
        if (!state || !states.has(state) || states.get(state) < Date.now()) return send(res, 400, 'Invalid login state.', 'text/plain');
        states.delete(state);
        const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: REDIRECT_URI }) });
        if (!tokenResponse.ok) return send(res, 401, 'Discord login failed.', 'text/plain');
        const tokenData = await tokenResponse.json();
        const [profile, guilds] = await Promise.all([discord('/users/@me', tokenData.access_token), discord('/users/@me/guilds', tokenData.access_token)]);
        const guild = guilds.find(g => g.id === GUILD_ID);
        if (!guild || !allowed(guild)) return send(res, 403, 'You must be a server owner or have Manage Server / Administrator permission.', 'text/plain');
        if (!client.guilds.cache.has(GUILD_ID)) return send(res, 503, 'The bot is not currently in the configured server.', 'text/plain');
        const sid = crypto.randomBytes(32).toString('hex');
        sessions.set(sid, { user: { id: profile.id, username: profile.global_name || profile.username }, accessToken: tokenData.access_token, expires: Date.now() + 8 * 60 * 60 * 1000 });
        return res.writeHead(302, { location: '/', 'set-cookie': 'hb_session=' + encodeURIComponent(sid + '.' + sign(sid)) + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800' }).end();
      }
      if (req.method === 'POST' && url.pathname === '/auth/logout') {
        const s = getSession(req);
        if (s) { const sid = cookieValue(req, 'hb_session').split('.')[0]; sessions.delete(sid); }
        return res.writeHead(204, { 'set-cookie': 'hb_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0' }).end();
      }
      if (url.pathname.startsWith('/api/')) {
        const session = getSession(req);
        if (!session) return send(res, 401, { error: 'Sign in required' });
        const guilds = await discord('/users/@me/guilds', session.accessToken);
        const guild = guilds.find(g => g.id === GUILD_ID);
        if (!guild || !allowed(guild)) return send(res, 403, { error: 'Access denied' });
        const liveGuild = client.guilds.cache.get(GUILD_ID);
        if (!liveGuild) return send(res, 503, { error: 'Bot is not in the configured server' });
        if (req.method === 'GET' && url.pathname === '/api/me') {
          const channels = await liveGuild.channels.fetch();
          return send(res, 200, { user: session.user, guild: { id: liveGuild.id, name: liveGuild.name }, channels: channels.filter(c => c && c.isTextBased() && c.guild).map(c => ({ id: c.id, name: c.name })).sort((a,b)=>a.name.localeCompare(b.name)), settings });
        }
        if (req.method === 'PUT' && url.pathname === '/api/settings') {
          const body = await readBody(req);
          const channelIds = new Set((await liveGuild.channels.fetch()).filter(c => c && c.isTextBased()).map(c => c.id));
          const validChannel = id => !id || channelIds.has(id);
          if (!validChannel(body.welcome && body.welcome.channelId) || !validChannel(body.moderation && body.moderation.logChannelId)) return send(res, 400, { error: 'Invalid channel' });
          settings = merge(defaults, body);
          settings.welcome.message = String(settings.welcome.message || defaults.welcome.message).slice(0, 500);
          saveSettings();
          return send(res, 200, { ok: true });
        }
        return send(res, 404, { error: 'Not found' });
      }
      return send(res, 404, 'Not found', 'text/plain');
    } catch (error) {
      console.error('Dashboard request failed:', error.message || error);
      return send(res, 500, { error: 'Internal server error' });
    }
  });
  server.listen(PORT, '0.0.0.0', () => console.log('Dashboard listening on port ' + PORT + ' for server ' + GUILD_ID));
  return server;
}
function getDashboardSettings(guildId) {
  return guildId === GUILD_ID ? settings : defaults;
}
module.exports = { startDashboard, getDashboardSettings };
