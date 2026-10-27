require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
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

async function ensureSoundCloudReady() {
  if (!soundCloudInitPromise) {
    soundCloudInitPromise = (async () => {
      const clientId = await play.getFreeClientID();
      if (!clientId) throw new Error('SoundCloud did not return a client ID.');
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

  queue.player.on(AudioPlayerStatus.Idle, () => {
    queue.current = null;
    setImmediate(() => void playNext(guildId));
  });

  queue.player.on('error', (error) => {
    console.error('Audio player error:', error.message || error);
    queue.current = null;
    setTimeout(() => void playNext(guildId), 800);
  });

  queues.set(guildId, queue);
  return queue;
}

function durationText(input) {
  const number = Number(input);
  if (!Number.isFinite(number) || number < 0) return 'نامشخص';
  const total = Math.floor(number);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  return minutes + ':' + String(seconds).padStart(2, '0');
}

async function findSoundCloudTrack(query, requestedBy) {
  await ensureSoundCloudReady();
  const results = await play.search(query, {
    limit: 1,
    source: { soundcloud: 'tracks' },
  });
  const item = Array.isArray(results) ? results[0] : null;
  if (!item || !item.url) return null;

  return {
    title: item.title || query,
    url: item.permalink || item.permalink_url || item.url,
    duration: item.durationRaw || durationText(item.durationInSec || 0),
    requestedBy,
    searchQuery: query,
    source: 'soundcloud',
    fallbackAttempted: true,
  };
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
      };
    }

    throw new Error('این لینک پشتیبانی نمی‌شود؛ لینک آهنگ YouTube یا SoundCloud را بده.');
  }

  const results = await play.search(input, { limit: 1 });
  const item = Array.isArray(results) ? results[0] : null;
  if (!item || !item.url) {
    throw new Error('آهنگی پیدا نشد؛ اسم آهنگ را دقیق‌تر بنویس یا لینک بده.');
  }

  return {
    title: item.title || input,
    url: item.url,
    duration: item.durationRaw || 'نامشخص',
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
  connection.subscribe(queue.player);
  connection.on('error', (error) => {
    console.error('Voice connection error:', error.message || error);
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20000);
  } catch (_) {
    try { connection.destroy(); } catch (_) {}
    queue.connection = null;
    queue.voiceChannelId = null;
    throw new Error('اتصال به Voice موفق نشد. مجوز Connect و Speak را به ربات بده.');
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
    const result = await play.stream(track.url);
    const options = { metadata: track };
    if (result.type) options.inputType = result.type;
    queue.player.play(createAudioResource(result.stream, options));
    console.log('Now playing:', track.title);
  } catch (error) {
    console.error('Track failed:', track.title, error.stack || error);
    queue.current = null;

    let retryingOnSoundCloud = false;
    if (track.source !== 'soundcloud' && !track.fallbackAttempted) {
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
        await channel.send('پخش آهنگ «' + track.title.slice(0, 140) + '» ناموفق بود؛ آهنگ بعدی را امتحان می‌کنم.').catch(() => {});
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
  new SlashCommandBuilder().setName('play').setDescription('پخش آهنگ با نام یا لینک')
    .addStringOption(o => o.setName('query').setDescription('نام آهنگ یا لینک YouTube / SoundCloud').setRequired(true).setMaxLength(300)),
  new SlashCommandBuilder().setName('join').setDescription('ورود به Voice Channel شما'),
  new SlashCommandBuilder().setName('queue').setDescription('نمایش صف آهنگ‌ها'),
  new SlashCommandBuilder().setName('skip').setDescription('رفتن به آهنگ بعدی'),
  new SlashCommandBuilder().setName('pause').setDescription('مکث پخش آهنگ'),
  new SlashCommandBuilder().setName('resume').setDescription('ادامه پخش آهنگ'),
  new SlashCommandBuilder().setName('stop').setDescription('توقف پخش و خالی کردن صف'),
  new SlashCommandBuilder().setName('leave').setDescription('خروج ربات از Voice'),

  new SlashCommandBuilder().setName('kick').setDescription('اخراج عضو از سرور')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('user').setDescription('عضو موردنظر').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('دلیل').setMaxLength(400)),
  new SlashCommandBuilder().setName('ban').setDescription('بن کردن کاربر')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('user').setDescription('کاربر موردنظر').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('دلیل').setMaxLength(400)),
  new SlashCommandBuilder().setName('timeout').setDescription('محدودیت موقت عضو')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('عضو موردنظر').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('مدت به دقیقه').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName('reason').setDescription('دلیل').setMaxLength(400)),
  new SlashCommandBuilder().setName('untimeout').setDescription('برداشتن محدودیت عضو')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('عضو موردنظر').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('دلیل').setMaxLength(400)),
  new SlashCommandBuilder().setName('clear').setDescription('پاک کردن ۱ تا ۱۰۰ پیام اخیر')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName('amount').setDescription('تعداد پیام').setRequired(true).setMinValue(1).setMaxValue(100)),
  new SlashCommandBuilder().setName('slowmode').setDescription('تنظیم کندکننده پیام کانال')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption(o => o.setName('seconds').setDescription('ثانیه؛ صفر برای خاموش کردن').setRequired(true).setMinValue(0).setMaxValue(21600)),
  new SlashCommandBuilder().setName('lock').setDescription('قفل کردن کانال')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('unlock').setDescription('باز کردن قفل کانال')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('warn').setDescription('ثبت اخطار برای عضو')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('عضو موردنظر').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('دلیل اخطار').setRequired(true).setMaxLength(400)),
  new SlashCommandBuilder().setName('warnings').setDescription('نمایش اخطارهای عضو')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('عضو موردنظر').setRequired(true)),
  new SlashCommandBuilder().setName('clearwarns').setDescription('پاک کردن اخطارهای عضو')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('عضو موردنظر').setRequired(true)),

  new SlashCommandBuilder().setName('ping').setDescription('بررسی وضعیت ربات'),
  new SlashCommandBuilder().setName('help').setDescription('نمایش فهرست دستورات'),
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
  console.log('Logged in as ' + readyClient.user.tag);
  readyClient.user.setActivity('music + moderation', { type: ActivityType.Playing });
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
      return respond(interaction, 'برای این دستور مجوز لازم را نداری.');
    }

    const serverCommands = [
      'play', 'join', 'queue', 'skip', 'pause', 'resume', 'stop', 'leave',
      'kick', 'ban', 'timeout', 'untimeout', 'clear', 'slowmode', 'lock',
      'unlock', 'warn', 'warnings', 'clearwarns',
    ];
    if (serverCommands.includes(interaction.commandName) && !interaction.guild) {
      return respond(interaction, 'این دستور فقط داخل سرور قابل استفاده است.');
    }

    switch (interaction.commandName) {
      case 'ping':
        return interaction.reply({ content: 'Pong! ' + client.ws.ping + ' ms', flags: MessageFlags.Ephemeral });

      case 'help': {
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('ربات موزیک و مدیریت')
          .addFields(
            { name: 'موزیک', value: '/play /join /queue /skip /pause /resume /stop /leave' },
            { name: 'مدیریت', value: '/kick /ban /timeout /untimeout /clear /slowmode /lock /unlock /warn /warnings /clearwarns' },
          )
          .setFooter({ text: 'مجوز دستورات مدیریتی طبق تنظیمات Discord بررسی می‌شود.' });
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      case 'join': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.voice.channel) return respond(interaction, 'اول وارد Voice Channel شو.');
        const queue = getQueue(interaction.guildId);
        await connectVoice(interaction.guild, member.voice.channel, queue);
        queue.textChannelId = interaction.channelId;
        return respond(interaction, 'وارد Voice شدم.');
      }

      case 'play': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.voice.channel) return respond(interaction, 'اول وارد Voice Channel شو، بعد /play را بزن.');
        const track = await findTrack(interaction.options.getString('query', true), interaction.user.tag || interaction.user.username);
        const queue = getQueue(interaction.guildId);
        await connectVoice(interaction.guild, member.voice.channel, queue);
        queue.textChannelId = interaction.channelId;
        const position = queue.tracks.length + (queue.current ? 1 : 0);
        queue.tracks.push(track);
        if (!queue.current) void playNext(interaction.guildId);
        return respond(interaction, 'به صف اضافه شد: ' + track.title.slice(0, 170) + '\nمدت: ' + track.duration + '\nجایگاه صف: ' + (position + 1));
      }

      case 'queue': {
        const queue = getQueue(interaction.guildId);
        const lines = [];
        if (queue.current) lines.push('🎵 در حال پخش: ' + queue.current.title + ' — ' + queue.current.duration);
        queue.tracks.slice(0, 15).forEach((track, index) => {
          lines.push((index + 1) + '. ' + track.title + ' — ' + track.duration);
        });
        return respond(interaction, lines.length ? lines.join('\n').slice(0, 1900) : 'صف آهنگ خالی است.');
      }

      case 'skip': {
        const queue = queues.get(interaction.guildId);
        if (!queue || !queue.current) return respond(interaction, 'آهنگی در حال پخش نیست.');
        if (!(await userSharesVoice(interaction, queue))) return respond(interaction, 'برای کنترل پخش باید در همان Voice Channel ربات باشی.');
        queue.player.stop(true);
        return respond(interaction, 'رفتم به آهنگ بعدی.');
      }

      case 'pause': {
        const queue = queues.get(interaction.guildId);
        if (!queue || !queue.current) return respond(interaction, 'آهنگی در حال پخش نیست.');
        if (!(await userSharesVoice(interaction, queue))) return respond(interaction, 'برای کنترل پخش باید در همان Voice Channel ربات باشی.');
        return respond(interaction, queue.player.pause(true) ? 'پخش مکث شد.' : 'پخش قابل مکث نیست.');
      }

      case 'resume': {
        const queue = queues.get(interaction.guildId);
        if (!queue || !queue.current) return respond(interaction, 'آهنگی برای ادامه نیست.');
        if (!(await userSharesVoice(interaction, queue))) return respond(interaction, 'برای کنترل پخش باید در همان Voice Channel ربات باشی.');
        return respond(interaction, queue.player.unpause() ? 'پخش ادامه پیدا کرد.' : 'پخش در حالت مکث نیست.');
      }

      case 'stop': {
        const queue = queues.get(interaction.guildId);
        if (!queue) return respond(interaction, 'صف پخش خالی است.');
        if (!(await userSharesVoice(interaction, queue))) return respond(interaction, 'برای کنترل پخش باید در همان Voice Channel ربات باشی.');
        queue.tracks = [];
        queue.current = null;
        queue.player.stop(true);
        return respond(interaction, 'پخش متوقف شد و صف خالی شد.');
      }

      case 'leave': {
        const queue = queues.get(interaction.guildId);
        if (!queue || !queue.connection) return respond(interaction, 'ربات داخل Voice نیست.');
        if (!(await userSharesVoice(interaction, queue))) return respond(interaction, 'برای بیرون بردن ربات باید در همان Voice Channel باشی.');
        queue.tracks = [];
        queue.current = null;
        queue.player.stop(true);
        queue.connection.destroy();
        queue.connection = null;
        queue.voiceChannelId = null;
        return respond(interaction, 'از Voice خارج شدم.');
      }

      case 'kick': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const member = await interaction.guild.members.fetch(user.id);
        await member.kick(reason);
        return respond(interaction, 'عضو ' + user.tag + ' اخراج شد.');
      }

      case 'ban': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'No reason provided';
        await interaction.guild.members.ban(user.id, { reason });
        return respond(interaction, 'کاربر ' + user.tag + ' بن شد.');
      }

      case 'timeout': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user', true);
        const minutes = interaction.options.getInteger('minutes', true);
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const member = await interaction.guild.members.fetch(user.id);
        await member.timeout(minutes * 60 * 1000, reason);
        return respond(interaction, 'محدودیت ' + user.tag + ' برای ' + minutes + ' دقیقه ثبت شد.');
      }

      case 'untimeout': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason') || 'Timeout removed by moderator';
        const member = await interaction.guild.members.fetch(user.id);
        await member.timeout(null, reason);
        return respond(interaction, 'محدودیت ' + user.tag + ' برداشته شد.');
      }

      case 'clear': {
        const amount = interaction.options.getInteger('amount', true);
        if (!interaction.channel || !interaction.channel.isTextBased() || !interaction.channel.bulkDelete) {
          return respond(interaction, 'این دستور در این کانال قابل استفاده نیست.');
        }
        const deleted = await interaction.channel.bulkDelete(amount, true);
        return respond(interaction, deleted.size + ' پیام پاک شد. (پیام‌های قدیمی‌تر از ۱۴ روز حذف گروهی نمی‌شوند.)');
      }

      case 'slowmode': {
        const seconds = interaction.options.getInteger('seconds', true);
        if (!interaction.channel || typeof interaction.channel.setRateLimitPerUser !== 'function') {
          return respond(interaction, 'این دستور در این کانال قابل استفاده نیست.');
        }
        await interaction.channel.setRateLimitPerUser(seconds, 'Changed by ' + interaction.user.tag);
        return respond(interaction, seconds === 0 ? 'کندکننده پیام خاموش شد.' : 'کندکننده روی ' + seconds + ' ثانیه تنظیم شد.');
      }

      case 'lock': {
        if (!interaction.channel || !interaction.channel.permissionOverwrites) return respond(interaction, 'این دستور در این کانال قابل استفاده نیست.');
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false }, { reason: 'Locked by ' + interaction.user.tag });
        return respond(interaction, 'کانال قفل شد.');
      }

      case 'unlock': {
        if (!interaction.channel || !interaction.channel.permissionOverwrites) return respond(interaction, 'این دستور در این کانال قابل استفاده نیست.');
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null }, { reason: 'Unlocked by ' + interaction.user.tag });
        return respond(interaction, 'قفل کانال برداشته شد.');
      }

      case 'warn': {
        const user = interaction.options.getUser('user', true);
        const reason = interaction.options.getString('reason', true);
        const key = interaction.guildId + ':' + user.id;
        if (!Array.isArray(warnings[key])) warnings[key] = [];
        warnings[key].push({ reason, moderator: interaction.user.tag, at: new Date().toISOString() });
        saveWarnings();
        return respond(interaction, 'برای ' + user.tag + ' اخطار ثبت شد. تعداد اخطارها: ' + warnings[key].length);
      }

      case 'warnings': {
        const user = interaction.options.getUser('user', true);
        const list = warnings[interaction.guildId + ':' + user.id] || [];
        if (!list.length) return respond(interaction, 'برای ' + user.tag + ' اخطاری ثبت نشده است.');
        const lines = list.slice(-10).map((item, index) => (index + 1) + '. ' + item.reason + ' — ' + item.moderator + ' — ' + item.at.slice(0, 10));
        return respond(interaction, ('اخطارهای ' + user.tag + ':\n' + lines.join('\n')).slice(0, 1900));
      }

      case 'clearwarns': {
        const user = interaction.options.getUser('user', true);
        delete warnings[interaction.guildId + ':' + user.id];
        saveWarnings();
        return respond(interaction, 'اخطارهای ' + user.tag + ' پاک شد.');
      }

      default:
        return respond(interaction, 'این دستور شناخته نشد.');
    }
  } catch (error) {
    console.error('Command /' + interaction.commandName + ' failed:', error.stack || error);
    let message = 'دستور با خطا مواجه شد؛ مجوزهای ربات و تنظیمات را بررسی کن.';
    if (error && error.message && /YouTube|SoundCloud|آهنگ|Voice|لینک|پشتیبانی نمی‌شود/.test(error.message)) message = error.message;
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
