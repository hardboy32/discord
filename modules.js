const {
  EmbedBuilder,
  Events,
  PermissionFlagsBits,
} = require('discord.js');

function attachCoreModules(client, getSettings) {
  const messageWindows = new Map();
  const lastLogAt = new Map();

  async function sendLog(guild, title, description, color = 0x7887ff) {
    const config = getSettings(guild.id);
    const logging = config.logging || {};
    const channelId = logging.channelId || (config.moderation && config.moderation.logChannelId);
    if (logging.enabled === false || !channelId) return;
    const channel = guild.channels.cache.get(channelId) ||
      await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(String(title).slice(0, 256))
      .setDescription(String(description).slice(0, 3500))
      .setTimestamp();
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
  }

  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || !message.member) return;
    const config = getSettings(message.guild.id);
    const mod = config.moderation || {};
    if (!mod.enabled) return;
    if (message.member.permissions.has(PermissionFlagsBits.Administrator) ||
        message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

    let reason = '';
    const content = String(message.content || '');
    if (mod.antiLink && /(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)/i.test(content)) {
      reason = 'Discord invite link';
    }

    const blockedWords = Array.isArray(mod.blockedWords) ? mod.blockedWords : [];
    if (!reason && blockedWords.some(word => {
      const term = String(word || '').trim();
      if (!term) return false;
      return content.toLocaleLowerCase().includes(term.toLocaleLowerCase());
    })) reason = 'Blocked word';

    const now = Date.now();
    const key = message.guild.id + ':' + message.author.id;
    if (!reason && mod.antiSpam) {
      const recent = (messageWindows.get(key) || []).filter(time => now - time < 5000);
      recent.push(now);
      messageWindows.set(key, recent);
      if (recent.length >= 5) {
        reason = 'Message spam (5 messages in 5 seconds)';
        messageWindows.set(key, []);
      }
    }

    if (!reason && mod.antiMentionSpam && message.mentions.users.size > 5) {
      reason = 'Mass mention (more than 5 users)';
    }

    if (!reason) return;
    await message.delete().catch(() => {});
    await sendLog(message.guild, 'AutoMod action', message.author.tag + ' (' + message.author.id + ') — ' + reason, 0xe0a04b);
  });

  client.on(Events.MessageDelete, async message => {
    if (!message.guild || message.author && message.author.bot) return;
    const author = message.author ? message.author.tag + ' (' + message.author.id + ')' : 'Unknown author';
    await sendLog(message.guild, 'Message deleted', 'Author: ' + author + '\nChannel: <#' + message.channelId + '>\nMessage content was not recorded.', 0xd65b70);
  });

  client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    if (!newMessage.guild || newMessage.author && newMessage.author.bot) return;
    if (oldMessage.content === newMessage.content) return;
    const author = newMessage.author ? newMessage.author.tag + ' (' + newMessage.author.id + ')' : 'Unknown author';
    await sendLog(newMessage.guild, 'Message edited', 'Author: ' + author + '\nChannel: <#' + newMessage.channelId + '>\nMessage content was not recorded.', 0xd69a4b);
  });

  client.on(Events.GuildMemberAdd, async member => {
    const config = getSettings(member.guild.id);
    const autorole = config.autorole || {};
    if (autorole.enabled && autorole.roleId) {
      const role = member.guild.roles.cache.get(autorole.roleId) || await member.guild.roles.fetch(autorole.roleId).catch(() => null);
      if (role && role.editable) await member.roles.add(role, 'Configured automatic member role').catch(error => console.warn('Auto-role assignment failed:', error.message || error));
    }
    const goodbye = config.goodbye || {};
    if (config.logging && config.logging.enabled !== false) {
      await sendLog(member.guild, 'Member joined', member.user.tag + ' (' + member.id + ') joined the server.', 0x55bd91);
    }
    if (!goodbye.enabled || !goodbye.channelId) return;
    const channel = member.guild.channels.cache.get(goodbye.channelId);
    if (!channel || !channel.isTextBased()) return;
    const text = String(goodbye.message || 'Goodbye {user}! We will miss you.')
      .replace(/\{user\}/g, member.user.username)
      .replace(/\{username\}/g, member.user.username)
      .replace(/\{server\}/g, member.guild.name)
      .replace(/\{count\}/g, String(member.guild.memberCount || 0));
    await channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
  });

  client.on(Events.GuildMemberRemove, async member => {
    await sendLog(member.guild, 'Member left', member.user.tag + ' (' + member.id + ') left the server.', 0xd69a4b);
  });

  client.on(Events.GuildBanAdd, async ban => {
    await sendLog(ban.guild, 'Member banned', ban.user.tag + ' (' + ban.user.id + ') was banned.', 0xd65b70);
  });

  client.on(Events.GuildBanRemove, async ban => {
    await sendLog(ban.guild, 'Member unbanned', ban.user.tag + ' (' + ban.user.id + ') was unbanned.', 0x55bd91);
  });

  client.on(Events.ChannelCreate, async channel => {
    if (channel.guild) await sendLog(channel.guild, 'Channel created', '#' + channel.name + ' (' + channel.id + ') was created.');
  });

  client.on(Events.ChannelDelete, async channel => {
    if (channel.guild) await sendLog(channel.guild, 'Channel deleted', '#' + channel.name + ' (' + channel.id + ') was deleted.', 0xd65b70);
  });

  client.on(Events.GuildRoleCreate, async role => {
    await sendLog(role.guild, 'Role created', role.name + ' (' + role.id + ') was created.');
  });

  client.on(Events.GuildRoleDelete, async role => {
    await sendLog(role.guild, 'Role deleted', role.name + ' (' + role.id + ') was deleted.', 0xd65b70);
  });

  const cleanup = setInterval(() => {
    const cutoff = Date.now() - 60000;
    for (const [key, times] of messageWindows) {
      const recent = times.filter(time => time > cutoff);
      if (recent.length) messageWindows.set(key, recent);
      else messageWindows.delete(key);
    }
  }, 60000);
  if (cleanup.unref) cleanup.unref();

  console.log('Core automation modules attached: AutoMod, member events and server event logging.');
}

module.exports = { attachCoreModules };
