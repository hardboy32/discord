require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
let bundledFfmpegPath = null;
try {
  bundledFfmpegPath = require('ffmpeg-static');
} catch (error) {
  console.warn('ffmpeg-static package could not be loaded:', error.message || error);
}
const ffmpegPath = [
  process.env.FFMPEG_PATH,
  '/usr/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  bundledFfmpegPath,
].find(candidate => candidate && fs.existsSync(candidate));

if (!ffmpegPath) {
  console.error('FFmpeg is missing. Install it in Infrlo Build Command or set FFMPEG_PATH.');
  process.exit(1);
}
console.log('Using FFmpeg binary:', ffmpegPath);

function logFfmpegVersion() {
  const probe = spawn(ffmpegPath, ['-version'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let reported = false;
  probe.stdout.on('data', chunk => {
    if (reported) return;
    const firstLine = chunk.toString().split(String.fromCharCode(10))[0].trim();
    if (firstLine) {
      reported = true;
      console.log('FFmpeg version:', firstLine);
    }
  });
  probe.on('error', error => {
    console.error('Could not run FFmpeg version check:', error.message || error);
  });
}
const {
  ActivityType,
  Client,
  EmbedBuilder,
  Events,
  MessageFlags,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');
const {
  AudioPlayerStatus,
  StreamType,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} = require('@discordjs/voice');
const play = require('@iamtraction/play-dl');

const TOKEN = (process.env.DISCORD_TOKEN || '').trim();
const CLIENT_ID = (process.env.DISCORD_CLIENT_ID || '').trim();
const BOT_OWNER_ID = (process.env.BOT_OWNER_ID || '').trim();
const GUILD_ID = (process.env.DISCORD_GUILD_ID || '').trim();
const WARNINGS_FILE = process.env.WARNINGS_FILE || path.join(__dirname, 'data', 'warnings.json');

if (!TOKEN) {
  console.error('Missing DISCORD_TOKEN. Add the bot token in Infrlo Environment Variables.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const queues = new Map();
let soundCloudInitPromise = null;
let soundCloudClientId = null;

async function ensureSoundCloudReady() {
  if (!soundCloudInitPromise) {
    soundCloudInitPromise = (async () => {
      const clientId = await play.getFreeClientID();
      if (!clientId) throw new Error('SoundCloud did not return a client ID.');
      soundCloudClientId = clientId;
      play.setToken({ soundcloud: { client_id: clientId } });
      console.log('SoundCloud client configured.');
    })().catch((error) => {
      soundCloudInitPromise = null;
      throw error;
    });
  }
  await soundCloudInitPromise;
}

function loadWarnings() {
  try {
    fs.mkdirSync(path.dirname(WARNINGS_FILE), { recursive: true });
    if (!fs.existsSync(WARNINGS_FILE)) fs.writeFileSync(WARNINGS_FILE, '{}', 'utf8');
    const value = JSON.parse(fs.readFileSync(WARNINGS_FILE, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch (error) {
    console.error('Warnings load failed:', error.message);
    return {};
  }
}

let warnings = loadWarnings();

function saveWarnings() {
  fs.mkdirSync(path.dirname(WARNINGS_FILE), { recursive: true });
  fs.writeFileSync(WARNINGS_FILE, JSON.stringify(warnings, null, 2), 'utf8');
}

function getQueue(guildId) {
  if (queues.has(guildId)) return queues.get(guildId);

  const queue = {
    tracks: [],
    current: null,
    connection: null,
    voiceChannelId: null,
    textChannelId: null,
    starting: false,
    player: createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    }),
  };

  queue.player.on('stateChange', (oldState, newState) => {
    console.log(
      'Audio player state:', oldState.status, '->', newState.status,
      '| track:', queue.current ? queue.current.title : 'none'
    );
    if (newState.status === AudioPlayerStatus.Playing) {
      console.log('Audio player entered PLAYING state:', queue.current ? queue.current.title : 'unknown');
    }
  });

  queue.player.on(AudioPlayerStatus.Idle, () => {
    queue.current = null;
    setImmediate(() => void playNext(guildId));
  });

  queue.player.on('error', (error) => {
    console.error('Audio player error:', error.message || error);
    const failedTrack = queue.current;
    queue.current = null;

    // Some sources fail only after audio streaming begins. Keep trying the
    // remaining SoundCloud search candidates in that case too.
    if (failedTrack && failedTrack.source === 'soundcloud' &&
        Array.isArray(failedTrack.alternatives) && failedTrack.alternatives.length) {
      const [nextCandidate, ...remainingCandidates] = failedTrack.alternatives;
      nextCandidate.alternatives = remainingCandidates;
      queue.tracks.unshift(nextCandidate);
      console.warn('SoundCloud stream failed; trying another result:', nextCandidate.title);
    }

    setTimeout(() => void playNext(guildId), 800);
  });

  queues.set(guildId, queue);
  return queue;
}

function durationText(input) {
  const number = Number(input);
  if (!Number.isFinite(number) || number < 0) return 'Unknown';
  const total = Math.floor(number);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  return minutes + ':' + String(seconds).padStart(2, '0');
}

function preferModernSoundCloudFormats(trackInfo, trackTitle = 'unknown track') {
  const formats = Array.isArray(trackInfo && trackInfo.formats) ? trackInfo.formats : [];
  const hls = formats.filter(item => item && item.format && item.format.protocol === 'hls');
  const aac = hls.filter(item =>
    /aac/i.test(String(item.preset || '')) ||
    /aac/i.test(String(item.format.mime_type || ''))
  );

  // SoundCloud deprecated its old MP3/Opus HLS transcodings. Prefer the
  // newer AAC HLS format when the API exposes it.
  const selected = aac.length ? aac : hls;
  if (!selected.length) {
    console.warn('SoundCloud has no HLS audio format for:', trackTitle);
    return trackInfo;
  }

  console.log(
    'SoundCloud formats for "' + String(trackTitle).slice(0, 100) + '": ' +
    selected.map(item => String(item.preset || 'unknown') + '/' +
      String(item.format.mime_type || 'unknown')).join(', ')
  );

  // Keep the library's class prototype so stream_from_info still recognizes
  // this as its native SoundCloudTrack object.
  return Object.assign(Object.create(Object.getPrototypeOf(trackInfo)), trackInfo, {
    formats: selected,
  });
}

async function resolveSoundCloudPlaylistUrl(trackInfo, trackTitle) {
  await ensureSoundCloudReady();
  if (!soundCloudClientId) throw new Error('SoundCloud client ID is unavailable.');
  if (!ffmpegPath) throw new Error('ffmpeg-static binary is unavailable on this host.');

  const formats = Array.isArray(trackInfo && trackInfo.formats) ? trackInfo.formats : [];
  const hlsFormats = formats.filter(item => item && item.format && item.format.protocol === 'hls');
  const aacFormats = hlsFormats.filter(item =>
    /aac/i.test(String(item.preset || '')) ||
    /aac/i.test(String(item.format.mime_type || ''))
  );
  const candidates = (aacFormats.length ? aacFormats : hlsFormats).slice().sort((a, b) => {
    const bitrate = item => {
      const match = String(item.preset || '').match(/[0-9]+k/i);
      return match ? Number(match[0].slice(0, -1)) : 0;
    };
    return bitrate(b) - bitrate(a);
  });
  if (!candidates.length) throw new Error('SoundCloud did not provide an HLS audio format.');

  let lastError;
  for (const format of candidates) {
    try {
      const endpoint = new URL(format.url);
      endpoint.searchParams.set('client_id', soundCloudClientId);
      const response = await fetch(endpoint, {
        headers: { 'user-agent': 'Mozilla/5.0 DiscordMusicBot/1.0' },
      });
      if (!response.ok) throw new Error('SoundCloud media endpoint returned HTTP ' + response.status);

      const mediaData = await response.json();
      const playlistUrl = mediaData && mediaData.url;
      if (!playlistUrl || !(playlistUrl.startsWith('https://') || playlistUrl.startsWith('http://'))) {
        throw new Error('SoundCloud media endpoint did not return a playlist URL.');
      }

      console.log('Resolved SoundCloud HLS for FFmpeg:', trackTitle, '|', format.preset || 'HLS');
      return playlistUrl;
    } catch (error) {
      lastError = error;
      console.warn('SoundCloud HLS URL resolution failed:', format.preset || 'unknown', error.message || error);
    }
  }

  throw lastError || new Error('All SoundCloud HLS formats failed.');
}

async function createSoundCloudPcmStream(trackInfo, trackTitle) {
  const playlistUrl = await resolveSoundCloudPlaylistUrl(trackInfo, trackTitle);
  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-nostdin',
    '-user_agent', 'Mozilla/5.0 DiscordMusicBot/1.0',
    '-headers', 'Origin: https://soundcloud.com\r\nReferer: https://soundcloud.com/\r\n',
    '-i', playlistUrl,
    '-vn',
    '-acodec', 'pcm_s16le',
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1',
  ];

  console.log('Starting diagnostic SoundCloud FFmpeg PCM pipeline:', trackTitle);
  const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.audioBytes = 0;
  let stderrTail = '';

  child.stderr.on('data', chunk => {
    stderrTail = (stderrTail + chunk.toString()).slice(-5000);
  });
  child.on('error', error => {
    console.error('SoundCloud FFmpeg process error:', error.message || error);
  });
  child.stdout.on('data', chunk => {
    child.audioBytes += chunk.length;
    if (child.audioBytes === chunk.length) {
      console.log('SoundCloud FFmpeg emitted first PCM bytes:', chunk.length, 'for', trackTitle);
    }
  });
  child.on('close', (code, signal) => {
    const safeDetails = stderrTail.split(String.fromCharCode(10)).map(line =>
      line.includes('://') ? '[FFmpeg diagnostic URL omitted]' : line
    ).join(String.fromCharCode(10)).trim();
    console.log(
      'SoundCloud FFmpeg closed:', 'code=' + code, 'signal=' + signal,
      'pcmBytes=' + child.audioBytes, 'track=' + trackTitle
    );
    if (code !== 0 || child.audioBytes === 0) {
      console.error('SoundCloud FFmpeg diagnostic:', safeDetails || '(FFmpeg returned no stderr)');
    }
  });

  return { stream: child.stdout, process: child };
}
async function findSoundCloudTrack(query, requestedBy) {
  await ensureSoundCloudReady();
  const results = await play.search(query, {
    limit: 5,
    source: { soundcloud: 'tracks' },
  });
  if (!Array.isArray(results) || !results.length) return null;

  const candidates = results
    .filter(item => item && (item.permalink || item.permalink_url || item.url))
    .map(item => ({
      title: item.name || item.title || query,
      url: item.permalink || item.permalink_url || item.url,
      duration: item.durationRaw || durationText(item.durationInSec || 0),
      requestedBy,
      searchQuery: query,
      source: 'soundcloud',
      fallbackAttempted: true,
      soundCloudInfo: preferModernSoundCloudFormats(item, item.name || item.title || query),
    }));

  if (!candidates.length) return null;
  candidates[0].alternatives = candidates.slice(1);
  return candidates[0];
}

async function findTrack(query, requestedBy) {
  const input = query.trim();

  if (/^https?:\/\//i.test(input)) {
    if (play.yt_validate(input) === 'video') {
      const info = await play.video_basic_info(input);
      const video = info.video_details;
      return {
        title: video.title || 'YouTube track',
        url: video.url || input,
        duration: video.durationRaw || durationText(video.durationInSec),
        requestedBy,
        searchQuery: video.title || input,
        source: 'youtube',
      };
    }

    if (/soundcloud\.com|snd\.sc/i.test(input)) {
      await ensureSoundCloudReady();
    }

    if (play.so_validate(input) === 'track') {
      const sound = await play.soundcloud(input);
      return {
        title: sound.name || sound.title || 'SoundCloud track',
        url: sound.permalink || input,
        duration: durationText(sound.durationInSec || 0),
        requestedBy,
        searchQuery: sound.name || sound.title || input,
        source: 'soundcloud',
        fallbackAttempted: true,
        soundCloudInfo: preferModernSoundCloudFormats(sound, sound.name || sound.title || input),
      };
    }

    throw new Error('Unsupported link. Provide a YouTube or SoundCloud track URL.');
  }

  const results = await play.search(input, { limit: 1 });
  const item = Array.isArray(results) ? results[0] : null;
  if (!item || !item.url) {
    throw new Error('No track found. Try a more specific title or provide a YouTube or SoundCloud URL.');
  }

  return {
    title: item.title || input,
    url: item.url,
    duration: item.durationRaw || 'Unknown',
    requestedBy,
    searchQuery: input,
    source: 'youtube',
  };
}

async function connectVoice(guild, channel, queue) {
  if (
    queue.connection &&
    queue.voiceChannelId === channel.id &&
    queue.connection.state.status !== VoiceConnectionStatus.Destroyed
  ) return queue.connection;

  if (queue.connection) {
    try { queue.connection.destroy(); } catch (_) {}
    queue.connection = null;
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
  });
  queue.connection = connection;
  queue.voiceChannelId = channel.id;
  const subscription = connection.subscribe(queue.player);
  console.log('Voice player subscription:', subscription ? 'attached' : 'FAILED');
  connection.on('stateChange', (oldState, newState) => {
    console.log('Voice connection state:', oldState.status, '->', newState.status);
  });
  connection.on('error', (error) => {
    console.error('Voice connection error:', error.message || error);
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20000);
  } catch (_) {
    try { connection.destroy(); } catch (_) {}
    queue.connection = null;
    queue.voiceChannelId = null;
    throw new Error('Could not connect to voice. Make sure the bot has Connect and Speak permissions.');
  }
  return connection;
}

async function playNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue || queue.starting || queue.current || !queue.tracks.length || !queue.connection) return;

  queue.starting = true;
  const track = queue.tracks.shift();
  queue.current = track;

  try {
    console.log('Starting track:', track.title);
    let resource;
    let soundCloudProcess = null;

    if (track.source === 'soundcloud' && track.soundCloudInfo) {
      // Explicitly decode SoundCloud AAC HLS to PCM so FFmpeg diagnostics
      // and the number of decoded audio bytes are visible in runtime logs.
      const direct = await createSoundCloudPcmStream(track.soundCloudInfo, track.title);
      soundCloudProcess = direct.process;
      resource = createAudioResource(direct.stream, {
        metadata: track,
        inputType: StreamType.Raw,
      });
      track.ffmpegProcess = soundCloudProcess;
    } else {
      const result = await play.stream(track.url);
      resource = createAudioResource(result.stream, {
        metadata: track,
        inputType: result.type || StreamType.Arbitrary,
      });
    }

    resource.playStream.on('error', error => {
      console.error('Audio resource stream error:', error.message || error);
    });
    queue.player.play(resource);
    console.log('Audio resource queued:', track.title);
    if (soundCloudProcess) console.log('SoundCloud PCM stream linked to Discord audio resource:', track.title);
  } catch (error) {
    console.error('Track failed:', track.title, error.stack || error);
    queue.current = null;

    let retryingOnSoundCloud = false;

    if (track.source === 'soundcloud' && Array.isArray(track.alternatives) && track.alternatives.length) {
      const [nextCandidate, ...remainingCandidates] = track.alternatives;
      nextCandidate.alternatives = remainingCandidates;
      queue.tracks.unshift(nextCandidate);
      retryingOnSoundCloud = true;
      console.warn('SoundCloud candidate failed; trying another result:', nextCandidate.title);
    }

    if (!retryingOnSoundCloud && track.source !== 'soundcloud' && !track.fallbackAttempted) {
      try {
        const fallback = await findSoundCloudTrack(track.searchQuery || track.title, track.requestedBy);
        if (fallback && fallback.url !== track.url) {
          queue.tracks.unshift(fallback);
          retryingOnSoundCloud = true;
          console.warn('YouTube playback failed; retrying from SoundCloud:', fallback.title);
        }
      } catch (fallbackError) {
        console.warn('SoundCloud fallback search failed:', fallbackError.message || fallbackError);
      }
    }

    if (!retryingOnSoundCloud && queue.textChannelId) {
      const channel = await client.channels.fetch(queue.textChannelId).catch(() => null);
      if (channel && channel.isTextBased()) {
        await channel.send('Failed to play "' + track.title.slice(0, 140) + '". Trying the next track.').catch(() => {});
      }
    }
    setTimeout(() => void playNext(guildId), 800);
  } finally {
    queue.starting = false;
  }
}

async function respond(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content });
  }
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function isBotOwner(userId) {
  if (BOT_OWNER_ID) return userId === BOT_OWNER_ID;

  try {
    const application = await client.application.fetch();
    const owner = application.owner;
    if (owner && owner.id && owner.constructor.name !== 'Team') {
      return userId === owner.id;
    }
  } catch (error) {
    console.warn('Could not verify the application owner automatically:', error.message || error);
  }
  return false;
}

async function userSharesVoice(interaction, queue) {
  if (!queue || !queue.voiceChannelId || !interaction.guild) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  return Boolean(member && member.voice.channelId === queue.voiceChannelId);
}

const moderatorPermissions = {
  kick: PermissionFlagsBits.KickMembers,
  ban: PermissionFlagsBits.BanMembers,
  timeout: PermissionFlagsBits.ModerateMembers,
  untimeout: PermissionFlagsBits.ModerateMembers,
  clear: PermissionFlagsBits.ManageMessages,
  slowmode: PermissionFlagsBits.ManageChannels,
  lock: PermissionFlagsBits.ManageChannels,
  unlock: PermissionFlagsBits.ManageChannels,
  warn: PermissionFlagsBits.ModerateMembers,
  warnings: PermissionFlagsBits.ModerateMembers,
  clearwarns: PermissionFlagsBits.ModerateMembers,
};

const commands = [
  new SlashCommandBuilder().setName('play').setDescription('Play a track by title or URL')
    .addStringOption(o => o.setName('query').setDescription('Track title or YouTube / SoundCloud URL').setRequired(true).setMaxLength(300)),
  new SlashCommandBuilder().setName('join').setDescription('Join your current voice channel'),
  new SlashCommandBuilder().setName('queue').setDescription('Show the music queue'),
  new SlashCommandBuilder().setName('skip').setDescription('Skip the current track'),
  new SlashCommandBuilder().setName('pause').setDescription('Pause playback'),
  new SlashCommandBuilder().setName('resume').setDescription('Resume playback'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear the queue'),
  new SlashCommandBuilder().setName('leave').setDescription('Leave the voice channel'),

  new SlashCommandBuilder().setName('kick').setDescription('Kick a server member')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the action').setMaxLength(400)),
  new SlashCommandBuilder().setName('ban').setDescription('Ban a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the action').setMaxLength(400)),
  new SlashCommandBuilder().setName('timeout').setDescription('Temporarily time out a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member to time out').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('Duration in minutes').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the action').setMaxLength(400)),
  new SlashCommandBuilder().setName('untimeout').setDescription('Remove a member timeout')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member to untimeout').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the action').setMaxLength(400)),
  new SlashCommandBuilder().setName('clear').setDescription('Delete 1 to 100 recent messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName('amount').setDescription('Number of messages to delete').setRequired(true).setMinValue(1).setMaxValue(100)),
  new SlashCommandBuilder().setName('slowmode').setDescription('Set this channel slowmode')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption(o => o.setName('seconds').setDescription('Seconds; use 0 to disable').setRequired(true).setMinValue(0).setMaxValue(21600)),
  new SlashCommandBuilder().setName('lock').setDescription('Lock this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('unlock').setDescription('Unlock this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('warn').setDescription('Add a warning to a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member to warn').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Warning reason').setRequired(true).setMaxLength(400)),
  new SlashCommandBuilder().setName('warnings').setDescription('List warnings for a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member to check').setRequired(true)),
  new SlashCommandBuilder().setName('clearwarns').setDescription('Clear warnings for a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member whose warnings will be cleared').setRequired(true)),

  new SlashCommandBuilder().setName('activity').setDescription('Change the bot activity (bot owner only)')
    .addStringOption(o => o.setName('type').setDescription('Activity type').setRequired(true).addChoices(
      { name: 'Playing', value: 'playing' },
      { name: 'Listening to', value: 'listening' },
      { name: 'Watching', value: 'watching' },
      { name: 'Competing in', value: 'competing' },
      { name: 'Clear activity', value: 'clear' },
    ))
    .addStringOption(o => o.setName('text').setDescription('Activity text (up to 128 characters)').setMaxLength(128)),
  new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
  new SlashCommandBuilder().setName('help').setDescription('Show the command list'),
].map(command => command.toJSON());

async function registerCommands() {
  const appId = CLIENT_ID || client.user.id;
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(appId, GUILD_ID), { body: commands });
    console.log('Registered ' + commands.length + ' slash commands for guild ' + GUILD_ID + '.');
  } else {
    await rest.put(Routes.applicationCommands(appId), { body: commands });
    console.log('Registered ' + commands.length + ' global slash commands.');
    console.log('For faster command updates while testing, set DISCORD_GUILD_ID in Infrlo.');
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log('Runtime process ID:', process.pid);
  logFfmpegVersion();
  console.log('Logged in as ' + readyClient.user.tag);
  readyClient.user.setActivity(null);
  console.log('Bot activity is cleared. Use /activity to set it.');
  try {
    await registerCommands();
  } catch (error) {
    console.error('Slash command registration failed:', error.stack || error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const permission = moderatorPermissions[interaction.commandName];
    if (permission && (!interaction.memberPermissions || !interaction.memberPermissions.has(permission))) {
      return respond(interaction, 'You do not have permission to use this command.');
    }

    const serverCommands = [
      'play', 'join', 'queue', 'skip', 'pause', 'resume', 'stop', 'leave',
      'kick', 'ban', 'timeout', 'untimeout', 'clear', 'slowmode', 'lock',
      'unlock', 'warn', 'warnings', 'clearwarns',
    ];
    if (serverCommands.includes(interaction.commandName) && !interaction.guild) {
      return respond(interaction, 'This command can only be used in a server.');
    }

    switch (interaction.commandName) {
      case 'ping':
        return interaction.reply({ content: 'Pong! ' + client.ws.ping + ' ms', flags: MessageFlags.Ephemeral });

      case 'activity': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!(await isBotOwner(interaction.user.id))) {
          return respond(interaction, 'Only the bot owner can change the global activity. Set BOT_OWNER_ID in Infrlo if automatic owner detection does not work.');
        }

        const type = interaction.options.getString('type', true);
        const text = (interaction.options.getString('text') || '').trim();
        if (type === 'clear') {
          client.user.setActivity(null);
          return respond(interaction, 'Bot activity cleared.');
        }
        if (!text) return respond(interaction, 'Enter activity text, for example: /activity type:Playing text:Chess.');

        const activityTypes = {
          playing: ActivityType.Playing,
          listening: ActivityType.Listening,
          watching: ActivityType.Watching,
          competing: ActivityType.Competing,
        };
        const activityType = activityTypes[type];
        if (!activityType) return respond(interaction, 'Unsupported activity type.');

        client.user.setActivity(text, { type: activityType });
        const label = type === 'listening' ? 'Listening to' :
          type === 'watching' ? 'Watching' :
          type === 'competing' ? 'Competing in' : 'Playing';
        return respond(interaction, 'Bot activity updated: ' + label + ' ' + text);
      }

      case 'help': {
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Music and Moderation Bot')
          .addFields(
            { name: 'Music', value: '/play /join /queue /skip /pause /resume /stop /leave' },
            { name: 'Moderation', value: '/kick /ban /timeout /untimeout /clear /slowmode /lock /unlock /warn /warnings /clearwarns' },
          )
          .setFooter({ text: 'Moderation commands require the matching Discord permissions.' });
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      case 'join': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.voice.channel) return respond(interaction, 'Join a voice channel first.');
        const queue = getQueue(interaction.guildId);
        await connectVoice(interaction.guild, member.voice.channel, queue);
        queue.textChannelId = interaction.channelId;
        return respond(interaction, 'Joined your voice channel.');
      }

      case 'play': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.voice.channel) return respond(interaction, 'Join a voice channel first, then run /play.');
        const track = await findTrack(interaction.options.getString('query', true), interaction.user.tag || interaction.user.username);
        const queue = getQueue(interaction.guildId);
        await connectVoice(interaction.guild, member.voice.channel, queue);
        queue.textChannelId = interaction.channelId;
        const position = queue.tracks.length + (queue.current ? 1 : 0);
        queue.tracks.push(track);
        if (!queue.current) void playNext(interaction.guildId);
        return respond(interaction, 'Queued: ' + track.title.slice(0, 170) + '\nDuration: ' + track.duration + '\nQueue position: ' + (position + 1));
      }

      case 'queue': {
        const queue = getQueue(interaction.guildId);
        const lines = [];
        if (queue.current) lines.push('🎵 Now playing: ' + queue.current.title + ' — ' + queue.current.duration);
        queue.tracks.slice(0, 15).forEach((track, index) => {
          lines.push((index + 1) + '. ' + track.title + ' — ' + track.duration);
        });
        return respond(interaction, lines.length ? lines.join('\n').slice(0, 1900) : 'The queue is empty.');
      }

      case 'skip': {
        const queue = queues.get(interaction.guildId);
        if (!queue || !queue.current) return respond(interaction, 'No track is currently playing.');
        if (!(await userSharesVoice(interaction, queue))) return respond(interaction, 'Join the same voice channel as the bot to control playback.');
        queue.player.stop(true);
        return respond(interaction, 'Skipped to the next track.');
      }

      case 'pause': {
        const queue = queues.get(interaction.guildId);
        if (!queue || !queue.current) return respond(interaction, 'No track is currently playing.');
        if (!(await userSharesVoice(interaction, queue))) return respond(interaction, 'Join the same voice channel as the bot to control playback.');
        return respond(interaction, queue.player.pause(true) ? 'Playback paused.' : 'Playback cannot be paused.');
      }

      case 'resume': {
        const queue = queues.get(interaction.guildId);
        if (!queue || !queue.current) return respond(interaction, 'There is no track to resume.');
        if (!(await userSharesVoice(interaction, queue))) return respond(interaction, 'Join the same voice channel as the bot to control playback.');
        return respond(interaction, queue.player.unpause() ? 'Playback resumed.' : 'Playback is not paused.');
      }

      case 'stop': {
        const queue = queues.get(interaction.guildId);
        if (!queue) return respond(interaction, 'The queue is empty.');
        if (!(await userSharesVoice(interaction, queue))) return respond(interaction, 'Join the same voice channel as the bot to control playback.');
        queue.tracks = [];
        queue.current = null;
        queue.player.stop(true);
        return respond(interaction, 'Playback stopped and the queue was cleared.');
      }

      case 'leave': {
        const queue = queues.get(interaction.guildId);
        if (!queue || !queue.connection) return respond(interaction, 'The bot is not in a voice channel.');
        if (!(await userSharesVoice(interaction, queue))) return respond(interaction, 'Join the bot’s voice channel to disconnect it.');
        queue.tracks = [];
        queue.current = null;
        queue.player.stop(true);
        queue.connection.destroy();
        queue.connection = null;
        queue.voiceChannelId = null;
        return respond(interaction, 'Left the voice channel.');
      }

      case 'kick': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const member = await interaction.guild.members.fetch(user.id);
        await member.kick(reason);
        return respond(interaction, 'Kicked ' + user.tag + '.');
      }

      case 'ban': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'No reason provided';
        await interaction.guild.members.ban(user.id, { reason });
        return respond(interaction, 'Banned ' + user.tag + '.');
      }

      case 'timeout': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user', true);
        const minutes = interaction.options.getInteger('minutes', true);
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const member = await interaction.guild.members.fetch(user.id);
        await member.timeout(minutes * 60 * 1000, reason);
        return respond(interaction, 'Timed out ' + user.tag + ' for ' + minutes + ' minutes.');
      }

      case 'untimeout': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'Timeout removed by moderator';
        const member = await interaction.guild.members.fetch(user.id);
        await member.timeout(null, reason);
        return respond(interaction, 'Removed the timeout for ' + user.tag + '.');
      }

      case 'clear': {
        const amount = interaction.options.getInteger('amount', true);
        if (!interaction.channel || !interaction.channel.isTextBased() || !interaction.channel.bulkDelete) {
          return respond(interaction, 'This command cannot be used in this channel.');
        }
        const deleted = await interaction.channel.bulkDelete(amount, true);
        return respond(interaction, deleted.size + ' messages deleted. (Messages older than 14 days cannot be bulk-deleted.)');
      }

      case 'slowmode': {
        const seconds = interaction.options.getInteger('seconds', true);
        if (!interaction.channel || typeof interaction.channel.setRateLimitPerUser !== 'function') {
          return respond(interaction, 'This command cannot be used in this channel.');
        }
        await interaction.channel.setRateLimitPerUser(seconds, 'Changed by ' + interaction.user.tag);
        return respond(interaction, seconds === 0 ? 'Slowmode disabled.' : 'Slowmode set to ' + seconds + ' seconds.');
      }

      case 'lock': {
        if (!interaction.channel || !interaction.channel.permissionOverwrites) return respond(interaction, 'This command cannot be used in this channel.');
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false }, { reason: 'Locked by ' + interaction.user.tag });
        return respond(interaction, 'Channel locked.');
      }

      case 'unlock': {
        if (!interaction.channel || !interaction.channel.permissionOverwrites) return respond(interaction, 'This command cannot be used in this channel.');
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null }, { reason: 'Unlocked by ' + interaction.user.tag });
        return respond(interaction, 'Channel unlocked.');
      }

      case 'warn': {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason', true);
        const key = interaction.guildId + ':' + user.id;
        if (!Array.isArray(warnings[key])) warnings[key] = [];
        warnings[key].push({ reason, moderator: interaction.user.tag, at: new Date().toISOString() });
        saveWarnings();
        return respond(interaction, 'Added a warning for ' + user.tag + '. Total warnings: ' + warnings[key].length);
      }

      case 'warnings': {
        const user = interaction.options.getUser('user', true);
        const list = warnings[interaction.guildId + ':' + user.id] || [];
        if (!list.length) return respond(interaction, 'No warnings found for ' + user.tag + '.');
        const lines = list.slice(-10).map((item, index) => (index + 1) + '. ' + item.reason + ' — ' + item.moderator + ' — ' + item.at.slice(0, 10));
        return respond(interaction, ('Warnings for ' + user.tag + ':\n' + lines.join('\n')).slice(0, 1900));
      }

      case 'clearwarns': {
        const user = interaction.options.getUser('user', true);
        delete warnings[interaction.guildId + ':' + user.id];
        saveWarnings();
        return respond(interaction, 'Cleared warnings for ' + user.tag + '.');
      }

      default:
        return respond(interaction, 'Unknown command.');
    }
  } catch (error) {
    console.error('Command /' + interaction.commandName + ' failed:', error.stack || error);
    let message = 'The command failed. Check the bot permissions and configuration.';
    if (error && error.message && /YouTube|SoundCloud|voice|URL|Unsupported link/i.test(error.message)) message = error.message;
    try { await respond(interaction, message); }
    catch (replyError) { console.error('Could not respond:', replyError.message || replyError); }
  }
});

client.on(Events.Error, (error) => console.error('Discord client error:', error));
process.on('unhandledRejection', (error) => console.error('Unhandled promise rejection:', error));

client.login(TOKEN).catch((error) => {
  console.error('Login failed. Check DISCORD_TOKEN:', error.message || error);
  process.exit(1);
});
