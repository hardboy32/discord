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
  welcome: { enabled: false, channelId: '', message: 'Welcome {user} to {server}!', type: 'text', mention: true, imagePath: '', imageUrl: '' },
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
function readBody(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > limit) reject(new Error('Request too large')); });
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HardBoy • Server Dashboard</title><style>
:root{color-scheme:dark;--bg:#0b1020;--panel:#141d31;--line:#293752;--muted:#98a8c4;--text:#edf2ff;--accent:#7887ff;--green:#5bd6a0}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 15% 0,#1b2850 0,transparent 42%),var(--bg);color:var(--text);font:15px Inter,system-ui,Segoe UI,sans-serif}
button,input,select,textarea{font:inherit}button{cursor:pointer;border:0;border-radius:10px;background:var(--accent);color:white;padding:11px 16px;font-weight:700}button.secondary{background:#273653}button.danger{background:#a83e57}.hidden{display:none!important}
.shell{display:grid;grid-template-columns:245px 1fr;min-height:100vh}.side{background:#0c1426;border-right:1px solid var(--line);padding:24px 16px;position:sticky;top:0;height:100vh}.brand{font-size:19px;font-weight:850;margin:4px 10px 28px}.brand span{color:var(--accent)}.nav{display:grid;gap:7px}.nav button{text-align:left;background:transparent;color:#aebbd2;font-weight:600}.nav button.active,.nav button:hover{background:#202c48;color:white}.sidefoot{position:absolute;bottom:22px;left:24px;color:var(--muted);font-size:12px}
main{padding:32px;max-width:1300px;width:100%;margin:auto}.top{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:25px}.eyebrow{color:#91a3c7;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;font-weight:800}h1{font-size:29px;margin:5px 0}h2{font-size:19px;margin:0 0 16px}.muted{color:var(--muted)}.panel{background:linear-gradient(145deg,#17233b,#121b2e);border:1px solid var(--line);border-radius:17px;padding:22px;margin-bottom:18px;box-shadow:0 14px 35px #0002}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.stat{padding:18px;border-radius:14px;background:#101a2e;border:1px solid #263550}.stat b{display:block;font-size:22px;margin-top:7px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.field{display:block;margin:14px 0;color:#c9d5ea;font-size:13px;font-weight:650}.field input:not([type=checkbox]),.field select,.field textarea{display:block;width:100%;margin-top:7px;background:#0b1426;color:white;border:1px solid #394b6b;border-radius:10px;padding:12px;outline:none}.field textarea{min-height:100px;resize:vertical}.field input:focus,.field textarea:focus,.field select:focus{border-color:var(--accent)}.check{display:flex;align-items:center;gap:10px;margin:13px 0;color:#cbd6e9}.check input{width:17px;height:17px;accent-color:var(--accent)}.hint{font-size:12px;color:var(--muted);line-height:1.6}.actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:18px}#status{color:var(--green);font-size:13px}.preview{background:#0b1426;border:1px dashed #425578;border-radius:13px;padding:16px;min-height:90px}.preview img{max-width:100%;max-height:230px;object-fit:contain;border-radius:9px;display:block;margin-top:10px}.command{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:15px 0;border-bottom:1px solid #293752}.command:last-child{border:0}.command code{color:#aebaff;font-weight:800}.tag{font-size:11px;padding:4px 8px;border-radius:20px;background:#273653;color:#cbd8f2;white-space:nowrap}.command p{margin:5px 0 0;color:var(--muted);font-size:13px}.formrow{display:grid;grid-template-columns:1fr 1fr;gap:10px}.login{max-width:500px;margin:12vh auto;padding:30px}
@media(max-width:800px){.shell{grid-template-columns:1fr}.side{height:auto;position:relative;padding:14px}.brand{margin:4px 8px 12px}.nav{display:flex;overflow:auto}.nav button{white-space:nowrap;padding:9px}.sidefoot{display:none}main{padding:18px}.stats,.grid{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}}
</style></head><body><section id="login" class="panel login hidden"><div class="brand">HARD<span>BOY</span> CONTROL</div><h1>Server dashboard</h1><p class="muted">Sign in with an account that has server administration permissions.</p><a href="/auth/login"><button>Continue with Discord</button></a></section>
<div id="app" class="shell hidden"><aside class="side"><div class="brand">HARD<span>BOY</span> CONTROL</div><nav class="nav">
<button class="active" data-page="overview">◈ Overview</button><button data-page="welcome">✦ Welcome</button><button data-page="commands">⌘ Commands</button><button data-page="moderation">⛨ Moderation</button><button data-page="modules">⚙ Modules</button>
</nav><div class="sidefoot">Single server • Secure admin access</div></aside><main>
<header class="top"><div><div class="eyebrow">Control center</div><h1 id="pageTitle">Overview</h1><div class="muted" id="userName">Loading server…</div></div><div><span class="tag" id="serverName">Connected</span></div></header>
<section id="page-overview" class="page"><div class="stats"><div class="stat"><span class="muted">Members</span><b id="memberCount">—</b></div><div class="stat"><span class="muted">Text channels</span><b id="channelCount">—</b></div><div class="stat"><span class="muted">Bot status</span><b style="color:var(--green)">Online</b></div></div><div class="panel" style="margin-top:18px"><h2>Welcome to your control center</h2><p class="muted">Manage welcome messages, moderation tools and bot modules from one place. Changes are saved to your Railway volume.</p><button onclick="showPage('welcome')">Configure welcome system</button></div><div class="panel"><h2>Quick access</h2><div class="grid"><button class="secondary" onclick="showPage('commands')">Browse bot commands</button><button class="secondary" onclick="showPage('moderation')">Moderation settings</button></div></div></section>
<section id="page-welcome" class="page hidden"><div class="panel"><h2>Welcome message builder</h2><p class="muted">Choose a text or image welcome, customize mentions and preview the result.</p><div class="grid"><div>
<label class="field">Message format<select id="welcomeType"><option value="text">Text message</option><option value="image">Image message</option></select></label>
<label class="field">Send to channel<select id="welcomeChannel"></select></label>
<label class="field">Message text<textarea id="welcomeMessage" maxlength="1500" placeholder="Welcome {user} to {server}!"></textarea></label>
<div class="hint">Available placeholders: <code>{user}</code> (member mention), <code>{username}</code>, <code>{server}</code>, <code>{count}</code>.</div>
<label class="check"><input id="welcomeMention" type="checkbox"> Mention the new member</label>
<label class="check"><input id="welcomeEnabled" type="checkbox"> Enable welcome messages</label>
<label class="field">Welcome image (PNG, JPG or WebP)<input id="welcomeImage" type="file" accept="image/png,image/jpeg,image/webp"></label>
<div class="hint">Images are stored on your Railway Volume and attached by the bot when a member joins. Maximum 5 MB.</div>
</div><div><div class="eyebrow" style="margin-bottom:9px">Live preview</div><div class="preview"><b id="previewServer">Your server</b><div id="previewMessage" style="margin-top:12px">Welcome @NewMember to Your server!</div><img id="previewImage" class="hidden" alt="Welcome image preview"></div><div class="hint" style="margin-top:12px">The preview uses sample member data. Discord formatting may look slightly different.</div></div></div><div class="actions"><button id="saveWelcome">Save welcome settings</button><span id="welcomeStatus"></span></div></div></section>
<section id="page-commands" class="page hidden"><div class="panel"><h2>Bot command library</h2><p class="muted">All registered slash commands, grouped by purpose. Admin actions can be launched from the action panel.</p><div id="commandList"></div></div><div class="panel"><h2>Run a moderation command</h2><p class="muted">The bot checks your live server permissions again before executing an action.</p><div class="formrow"><label class="field">Command<select id="adminAction"><option value="kick">Kick member</option><option value="ban">Ban member</option><option value="timeout">Timeout member</option><option value="untimeout">Remove timeout</option><option value="clear">Delete messages</option><option value="slowmode">Set slowmode</option><option value="lock">Lock channel</option><option value="unlock">Unlock channel</option></select></label><label class="field">Member ID<input id="targetUser" placeholder="Discord user ID"></label></div><div class="formrow"><label class="field">Amount / minutes<input id="actionAmount" type="number" min="1" placeholder="For timeout or clear"></label><label class="field">Channel<select id="actionChannel"></select></label></div><label class="field">Reason (optional)<input id="actionReason" placeholder="Reason for this action"></label><div class="actions"><button class="danger" id="runAction">Execute command</button><span id="actionStatus"></span></div><p class="hint">For safety, this panel currently supports direct moderation actions. Music playback controls remain available through Discord slash commands.</p></div></section>
<section id="page-moderation" class="page hidden"><div class="panel"><h2>Moderation settings</h2><label class="check"><input id="moderationEnabled" type="checkbox"> Enable moderation commands</label><label class="check"><input id="antiLink" type="checkbox"> Block Discord invite links</label><label class="field">Moderation log channel<select id="logChannel"></select></label><button id="saveModeration">Save moderation settings</button> <span id="moderationStatus"></span></div></section>
<section id="page-modules" class="page hidden"><div class="panel"><h2>Bot modules</h2><label class="check"><input id="musicEnabled" type="checkbox"> Enable music commands</label><label class="check"><input id="aiEnabled" type="checkbox"> Enable AI replies</label><p class="hint">AI replies require GROQ_API_KEY in Railway Variables.</p><button id="saveModules">Save module settings</button> <span id="moduleStatus"></span></div></section>
</main></div><script>
const $=id=>document.getElementById(id);let data=null;let imageData='';
function showPage(name){document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));$('page-'+name).classList.remove('hidden');document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===name));$('pageTitle').textContent=({overview:'Overview',welcome:'Welcome builder',commands:'Commands',moderation:'Moderation',modules:'Modules'})[name]}
document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
function options(select,channels){select.innerHTML='<option value="">Select channel</option>'+channels.map(c=>'<option value="'+c.id+'"></option>').join('');Array.from(select.options).forEach((o,i)=>{if(i)o.textContent='# '+channels[i-1].name})}
function preview(){const msg=$('welcomeMessage').value||'Welcome {user} to {server}!';$('previewMessage').textContent=msg.replaceAll('{user}','@NewMember').replaceAll('{username}','NewMember').replaceAll('{server}',data.guild.name).replaceAll('{count}',String(data.guild.memberCount||0));$('previewServer').textContent=data.guild.name}
async function api(url,opts){const r=await fetch(url,opts);let j={};try{j=await r.json()}catch{}if(!r.ok)throw new Error(j.error||'Request failed ('+r.status+')');return j}
async function load(){try{data=await api('/api/me');$('login').classList.add('hidden');$('app').classList.remove('hidden');$('serverName').textContent=data.guild.name;$('userName').textContent='Signed in as '+data.user.username;$('memberCount').textContent=data.guild.memberCount||'—';$('channelCount').textContent=data.channels.length;options($('welcomeChannel'),data.channels);options($('logChannel'),data.channels);options($('actionChannel'),data.channels);const s=data.settings;$('welcomeEnabled').checked=s.welcome.enabled;$('welcomeChannel').value=s.welcome.channelId;$('welcomeMessage').value=s.welcome.message;$('welcomeType').value=s.welcome.type||'text';$('welcomeMention').checked=s.welcome.mention!==false;$('moderationEnabled').checked=s.moderation.enabled;$('antiLink').checked=s.moderation.antiLink;$('logChannel').value=s.moderation.logChannelId;$('musicEnabled').checked=s.music.enabled;$('aiEnabled').checked=s.ai.enabled;if(s.welcome.imageUrl){$('previewImage').src=s.welcome.imageUrl+'?v='+Date.now();$('previewImage').classList.remove('hidden')}renderCommands(data.commands);preview()}catch(e){$('login').classList.remove('hidden');console.error(e)}}
function renderCommands(commands){$('commandList').innerHTML=commands.map(c=>'<div class="command"><div><code>/'+c.name+'</code><p>'+c.description+'</p></div><span class="tag">'+c.category+'</span></div>').join('')}
$('welcomeMessage').addEventListener('input',preview);$('welcomeImage').addEventListener('change',()=>{const file=$('welcomeImage').files[0];if(!file)return;if(file.size>5*1024*1024){alert('Image must be 5 MB or smaller.');$('welcomeImage').value='';return}const reader=new FileReader();reader.onload=()=>{imageData=reader.result;$('previewImage').src=imageData;$('previewImage').classList.remove('hidden')};reader.readAsDataURL(file)});
$('saveWelcome').onclick=async()=>{const status=$('welcomeStatus');status.textContent='Saving…';try{if(imageData){await api('/api/welcome-image',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({data:imageData})});imageData=''}await api('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({welcome:{enabled:$('welcomeEnabled').checked,channelId:$('welcomeChannel').value,message:$('welcomeMessage').value,type:$('welcomeType').value,mention:$('welcomeMention').checked}})});status.textContent='Saved successfully.';await load()}catch(e){status.textContent=e.message}};
$('saveModeration').onclick=async()=>{try{await api('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({moderation:{enabled:$('moderationEnabled').checked,antiLink:$('antiLink').checked,logChannelId:$('logChannel').value}})});$('moderationStatus').textContent='Saved.'}catch(e){$('moderationStatus').textContent=e.message}};
$('saveModules').onclick=async()=>{try{await api('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({music:{enabled:$('musicEnabled').checked},ai:{enabled:$('aiEnabled').checked}})});$('moduleStatus').textContent='Saved.'}catch(e){$('moduleStatus').textContent=e.message}};
$('runAction').onclick=async()=>{const status=$('actionStatus');status.textContent='Working…';try{const result=await api('/api/admin-command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:$('adminAction').value,userId:$('targetUser').value,amount:Number($('actionAmount').value)||0,channelId:$('actionChannel').value,reason:$('actionReason').value})});status.textContent=result.message||'Command completed.'}catch(e){status.textContent=e.message}};
load();
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
        sessions.set(sid, { user: { id: profile.id, username: profile.global_name || profile.username }, guildId: guild.id, accessToken: tokenData.access_token, expires: Date.now() + 8 * 60 * 60 * 1000 });
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
        if (session.guildId !== GUILD_ID) return send(res, 403, { error: 'Access denied' });
        const liveGuild = client.guilds.cache.get(GUILD_ID);
        if (!liveGuild) return send(res, 503, { error: 'Bot is not in the configured server' });
        if (req.method === 'GET' && url.pathname === '/api/me') {
          const channels = await liveGuild.channels.fetch();
          return send(res, 200, { user: session.user, guild: { id: liveGuild.id, name: liveGuild.name, memberCount: liveGuild.memberCount }, channels: channels.filter(c => c && c.isTextBased() && c.guild).map(c => ({ id: c.id, name: c.name })).sort((a,b)=>a.name.localeCompare(b.name)), settings, commands: [{name:'play',description:'Play a track by title or URL',category:'Music'},{name:'join',description:'Join your current voice channel',category:'Music'},{name:'queue',description:'Show the music queue',category:'Music'},{name:'skip',description:'Skip the current track',category:'Music'},{name:'pause',description:'Pause playback',category:'Music'},{name:'resume',description:'Resume playback',category:'Music'},{name:'stop',description:'Stop playback and clear the queue',category:'Music'},{name:'leave',description:'Leave the voice channel',category:'Music'},{name:'kick',description:'Kick a server member',category:'Moderation'},{name:'ban',description:'Ban a user',category:'Moderation'},{name:'timeout',description:'Temporarily time out a member',category:'Moderation'},{name:'untimeout',description:'Remove a member timeout',category:'Moderation'},{name:'clear',description:'Delete recent messages',category:'Moderation'},{name:'slowmode',description:'Set channel slowmode',category:'Moderation'},{name:'lock',description:'Lock this channel',category:'Moderation'},{name:'unlock',description:'Unlock this channel',category:'Moderation'},{name:'warn',description:'Add a warning to a member',category:'Moderation'},{name:'warnings',description:'List warnings for a member',category:'Moderation'},{name:'clearwarns',description:'Clear warnings for a member',category:'Moderation'},{name:'activity',description:'Change the bot activity',category:'Bot'},{name:'ping',description:'Check bot latency',category:'Bot'},{name:'help',description:'Show the command list',category:'Bot'}] });
        }
        if (req.method === 'PUT' && url.pathname === '/api/settings') {
          const body = await readBody(req);
          const channelIds = new Set((await liveGuild.channels.fetch()).filter(c => c && c.isTextBased()).map(c => c.id));
          const validChannel = id => !id || channelIds.has(id);
          if (!validChannel(body.welcome && body.welcome.channelId) || !validChannel(body.moderation && body.moderation.logChannelId)) return send(res, 400, { error: 'Invalid channel' });
          settings = merge(settings, body);
          settings.welcome.message = String(settings.welcome.message || defaults.welcome.message).slice(0, 500);
          saveSettings();
          return send(res, 200, { ok: true });
        }
        if (req.method === 'PUT' && url.pathname === '/api/welcome-image') {
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
        if (req.method === 'GET' && url.pathname === '/welcome-preview') {
          const s = getSession(req);
          if (!s || s.guildId !== GUILD_ID || !settings.welcome.imagePath || !fs.existsSync(settings.welcome.imagePath)) return send(res, 404, 'Not found', 'text/plain');
          const ext = path.extname(settings.welcome.imagePath).toLowerCase();
          const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
          res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          return fs.createReadStream(settings.welcome.imagePath).pipe(res);
        }
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
