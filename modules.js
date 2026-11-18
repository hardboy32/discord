
const {
  AuditLogEvent,
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const DASHBOARD_GUILD_ID=(process.env.DASHBOARD_GUILD_ID||'686002315148394502').trim();
function ticketDashboardConfig(guildId){
  if(guildId!==DASHBOARD_GUILD_ID)return {};
  try{
    const fs=require('node:fs');
    const file=process.env.DASHBOARD_SETTINGS_FILE||'/app/data/dashboard-settings.json';
    return JSON.parse(fs.readFileSync(file,'utf8')).communityConfig?.tickets||{};
  }catch{return {}}
}
function ticketsEnabled(guildId){
  if(guildId!==DASHBOARD_GUILD_ID)return true;
  try{
    const fs=require('node:fs');
    const file=process.env.DASHBOARD_SETTINGS_FILE||'/app/data/dashboard-settings.json';
    const settings=JSON.parse(fs.readFileSync(file,'utf8'));
    return settings.community?.tickets!==false;
  }catch{return true}
}
function getCoreCommands() {
  return [
    new SlashCommandBuilder()
      .setName('ticket-setup')
      .setDescription('Create a support ticket panel')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption(option => option.setName('panel_channel').setDescription('Where users open tickets (or use dashboard default)').addChannelTypes(ChannelType.GuildText))
      .addRoleOption(option => option.setName('staff_role').setDescription('Role that can view and manage tickets (or dashboard default)'))
      .addChannelOption(option => option.setName('transcript_channel').setDescription('Where closed ticket transcripts are sent (or dashboard default)').addChannelTypes(ChannelType.GuildText))
      .addChannelOption(option => option.setName('category').setDescription('Optional category for ticket channels').addChannelTypes(ChannelType.GuildCategory)),
  ];
}

async function handleCoreInteraction(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'ticket-setup') {
    if (!ticketsEnabled(interaction.guildId)) { await interaction.reply({ content: 'Tickets are disabled in the dashboard.', flags: MessageFlags.Ephemeral }); return true; }
    if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: 'You need Manage Server permission to set up tickets.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const cfg = ticketDashboardConfig(interaction.guildId);
    const panelChannel = interaction.options.getChannel('panel_channel') ||
      (cfg.panelChannelId ? await interaction.guild.channels.fetch(cfg.panelChannelId).catch(() => null) : null);
    const staffRole = interaction.options.getRole('staff_role') ||
      (cfg.staffRoleId ? await interaction.guild.roles.fetch(cfg.staffRoleId).catch(() => null) : null);
    const transcriptChannel = interaction.options.getChannel('transcript_channel') ||
      (cfg.transcriptChannelId ? await interaction.guild.channels.fetch(cfg.transcriptChannelId).catch(() => null) : null);
    const category = interaction.options.getChannel('category') ||
      (cfg.categoryId ? await interaction.guild.channels.fetch(cfg.categoryId).catch(() => null) : null);
    if (!panelChannel?.isTextBased() || !transcriptChannel?.isTextBased() || !staffRole || (category && category.type !== ChannelType.GuildCategory)) {
      await interaction.reply({ content: 'Choose panel channel, staff role, transcript channel and an optional category in the command or dashboard.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(String(cfg.title || 'Support Center').slice(0, 256))
      .setDescription(String(cfg.description || 'Need help? Press the button below to open a private support ticket.').slice(0, 4000))
      .setFooter({ text: 'ticket-config|' + staffRole.id + '|' + transcriptChannel.id + '|' + (category ? category.id : '') });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:open').setLabel(String(cfg.buttonLabel || 'Open a ticket').slice(0, 80)).setStyle(ButtonStyle.Primary).setEmoji('🎫')
    );
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await panelChannel.send({ embeds: [embed], components: [row] });
    await interaction.editReply({ content: 'Ticket panel created in ' + panelChannel.toString() + '. Staff: ' + staffRole.toString() + '. Transcripts: ' + transcriptChannel.toString() + (category ? ' Category: ' + category.name : '') });
    return true;
  }

  if (!interaction.isButton() || !interaction.customId.startsWith('ticket:')) return false;
  if (!ticketsEnabled(interaction.guildId)) { await interaction.reply({ content: 'Tickets are disabled in the dashboard.', flags: MessageFlags.Ephemeral }); return true; }
  if (!interaction.guild) {
    await interaction.reply({ content: 'Tickets can only be used inside a server.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.customId === 'ticket:open') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const existing = interaction.guild.channels.cache.find(channel =>
      channel.type === ChannelType.GuildText &&
      channel.topic &&
      channel.topic.includes('ticket-owner=' + interaction.user.id) &&
      !channel.topic.includes('ticket-closed=true')
    );
    if (existing) {
      await interaction.editReply({ content: 'You already have an open ticket: ' + existing.toString() });
      return true;
    }

    const setupLine = interaction.message.embeds[0]?.footer?.text || '';
    const setupParts = setupLine.split('|');
    const setup = setupParts[0] === 'ticket-config' && setupParts.length >= 4
      ? { staffRoleId: setupParts[1], transcriptChannelId: setupParts[2], categoryId: setupParts[3] || null }
      : null;
    if (!setup || !/^\d{17,20}$/.test(setup.staffRoleId) || !/^\d{17,20}$/.test(setup.transcriptChannelId)) {
      await interaction.editReply({ content: 'This ticket panel is missing its setup information. Please create a new panel with /ticket-setup.' });
      return true;
    }
    const botMember = interaction.guild.members.me;
    const overwrites = [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.AttachFiles] },
      { id: setup.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    ];
    const channel = await interaction.guild.channels.create({
      name: 'ticket-' + interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 18),
      type: ChannelType.GuildText,
      parent: setup.categoryId || undefined,
      topic: 'ticket-owner=' + interaction.user.id + ';ticket-staff=' + setup.staffRoleId + ';ticket-transcript=' + setup.transcriptChannelId,
      permissionOverwrites: overwrites,
      reason: 'Support ticket opened by ' + interaction.user.tag,
    });
    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:close').setLabel('Close ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒')
    );
    const intro = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Support ticket')
      .setDescription('Hello ' + interaction.user.toString() + '! Please describe your issue. A staff member will be with you soon.')
      .setFooter({ text: 'Ticket owner: ' + interaction.user.id });
    await channel.send({ content: '<@' + interaction.user.id + '> <@&' + setup.staffRoleId + '>', embeds: [intro], components: [closeRow], allowedMentions: { users: [interaction.user.id], roles: [setup.staffRoleId] } });
    await interaction.editReply({ content: 'Your private ticket is ready: ' + channel.toString() });
    return true;
  }

  if (interaction.customId === 'ticket:close') {
    const channel = interaction.channel;
    const topic = String(channel?.topic || '');
    const ownerId = (topic.match(/ticket-owner=(\d{17,20})/) || [])[1];
    const staffRoleId = (topic.match(/ticket-staff=(\d{17,20})/) || [])[1];
    const transcriptChannelId = (topic.match(/ticket-transcript=(\d{17,20})/) || [])[1];
    const closingMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const isStaff = Boolean(staffRoleId && closingMember?.roles.cache.has(staffRoleId));
    if (!ownerId || (!isStaff && interaction.user.id !== ownerId && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels))) {
      await interaction.reply({ content: 'Only the ticket owner or support staff can close this ticket.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (topic.includes('ticket-closed=true')) {
      await interaction.reply({ content: 'This ticket is already closed.', flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.deferReply();
    const messages = [];
    let before;
    for (let page = 0; page < 10; page++) {
      const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
      if (!batch || !batch.size) break;
      const sorted = [...batch.values()].sort((a,b) => a.createdTimestamp - b.createdTimestamp);
      messages.unshift(...sorted);
      before = sorted[0].id;
      if (batch.size < 100) break;
    }
    const transcript = messages.map(message => {
      const stamp = new Date(message.createdTimestamp).toISOString();
      const files = [...message.attachments.values()].map(file => file.url).join(' ');
      return '[' + stamp + '] ' + message.author.tag + ': ' + (message.content || '[no text]') + (files ? ' | Attachments: ' + files : '');
    }).join('\n');
    const attachment = new AttachmentBuilder(Buffer.from(transcript || 'No messages were found.', 'utf8'), { name: 'ticket-' + channel.id + '-transcript.txt' });
    const transcriptChannel = await interaction.guild.channels.fetch(transcriptChannelId).catch(() => null);
    if (transcriptChannel?.isTextBased()) {
      await transcriptChannel.send({
        content: 'Transcript for #' + channel.name + ' — opened by <@' + ownerId + '> — closed by ' + interaction.user.toString(),
        files: [attachment],
        allowedMentions: { parse: [] },
      });
    }
    await channel.setTopic(topic + ';ticket-closed=true');
    await channel.permissionOverwrites.edit(ownerId, { SendMessages: false, ViewChannel: true }).catch(() => {});
    await channel.send({ content: 'This ticket has been closed by ' + interaction.user.toString() + '. A transcript was ' + (transcriptChannel?.isTextBased() ? 'saved.' : 'not saved: transcript channel is unavailable.') , allowedMentions: { parse: [] } });
    await interaction.editReply({ content: 'Ticket closed. Transcript ' + (transcriptChannel?.isTextBased() ? 'saved.' : 'could not be saved.') });
    return true;
  }
  return false;
}

function attachCoreModules(client, getSettings) {
  const messageWindows = new Map();
  async function sendLog(guild, eventType, title, description, color = 0x7887ff) {
    if (!guild || !guild.id) return;
    const config = getSettings(guild.id);
    const logging = config.logging || {};
    const eventSettings = logging.events || {};
    const channelId = logging.channelId || (config.moderation && config.moderation.logChannelId);
    if (logging.enabled === false || eventSettings[eventType] === false || !channelId) return;
    const channel = guild.channels.cache.get(channelId) ||
      await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    const embed = new EmbedBuilder().setColor(color).setTitle(String(title).slice(0, 256))
      .setDescription(String(description).slice(0, 3500)).setTimestamp();
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
  }
  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot || !message.member) return;
    const config = getSettings(message.guild.id);
    const mod = config.moderation || {};
    if (!mod.enabled) return;
    if (message.member.permissions.has(PermissionFlagsBits.Administrator) || message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
    let reason = '';
    const content = String(message.content || '');
    if (mod.antiLink && /(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)/i.test(content)) reason = 'Discord invite link';
    const blockedWords = Array.isArray(mod.blockedWords) ? mod.blockedWords : [];
    if (!reason && blockedWords.some(word => {
      const term = String(word || '').trim();
      return term && content.toLocaleLowerCase().includes(term.toLocaleLowerCase());
    })) reason = 'Blocked word';
    const now = Date.now();
    const key = message.guild.id + ':' + message.author.id;
    if (!reason && mod.antiSpam) {
      const recent = (messageWindows.get(key) || []).filter(time => now - time < 5000);
      recent.push(now);
      messageWindows.set(key, recent);
      if (recent.length >= 5) { reason = 'Message spam (5 messages in 5 seconds)'; messageWindows.set(key, []); }
    }
    if (!reason && mod.antiMentionSpam && message.mentions.users.size > 5) reason = 'Mass mention (more than 5 users)';
    if (!reason) return;
    message.__autoModBlocked = true;
    await message.delete().catch(() => {});
    await sendLog(message.guild, 'automod', 'AutoMod action', message.author.tag + ' (' + message.author.id + ') — ' + reason, 0xe0a04b);
  });
  client.on(Events.MessageCreate, async message => {
    if (!message.guild || message.author.bot) return;
    await sendLog(message.guild, 'messageCreate', 'Message sent',
      'Member: ' + message.author.tag + ' (' + message.author.id + ')\nChannel: <#' + message.channelId + '>\nMessage text is not recorded.');
  });
  client.on(Events.MessageDelete, async message => {
    if (!message.guild || message.author && message.author.bot) return;
    const author = message.author ? message.author.tag + ' (' + message.author.id + ')' : 'Unknown author';
    await sendLog(message.guild, 'messageDelete', 'Message deleted',
      'Author: ' + author + '\nChannel: <#' + message.channelId + '>\nMessage content was not recorded.', 0xd65b70);
  });
  client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    if (!newMessage.guild || newMessage.author && newMessage.author.bot || oldMessage.content === newMessage.content) return;
    const author = newMessage.author ? newMessage.author.tag + ' (' + newMessage.author.id + ')' : 'Unknown author';
    await sendLog(newMessage.guild, 'messageEdit', 'Message edited',
      'Author: ' + author + '\nChannel: <#' + newMessage.channelId + '>\nMessage content was not recorded.', 0xd69a4b);
  });
  client.on(Events.MessageBulkDelete, async (messages, channel) => {
    const guild = channel && channel.guild || messages.first()?.guild;
    if (!guild) return;
    await sendLog(guild, 'messageDeleteBulk', 'Messages deleted in bulk',
      'Channel: <#' + channel.id + '>\nMessages removed: ' + messages.size, 0xd65b70);
  });
  client.on(Events.ChannelPinsUpdate, async (channel) => {
    if (!channel.guild) return;
    await sendLog(channel.guild, 'messagePin', 'Pinned messages changed',
      'Channel: <#' + channel.id + '>');
  });
  client.on('messageReactionAdd', async (reaction, user) => {
    const message = reaction && reaction.message;
    if (!message || !message.guild || !user || user.bot) return;
    await sendLog(message.guild, 'messageReactionAdd', 'Reaction added',
      'Member: ' + (user.tag || user.username || user.id) + '\nChannel: <#' + message.channelId + '>\nEmoji: ' + String(reaction.emoji));
  });
  client.on('messageReactionRemove', async (reaction, user) => {
    const message = reaction && reaction.message;
    if (!message || !message.guild || !user || user.bot) return;
    await sendLog(message.guild, 'messageReactionRemove', 'Reaction removed',
      'Member: ' + (user.tag || user.username || user.id) + '\nChannel: <#' + message.channelId + '>\nEmoji: ' + String(reaction.emoji));
  });
  client.on('messageReactionRemoveAll', async message => {
    if (!message.guild) return;
    await sendLog(message.guild, 'messageReactionClear', 'All reactions removed',
      'Channel: <#' + message.channelId + '>\nMessage: ' + message.id, 0xd69a4b);
  });
  client.on('messageReactionRemoveEmoji', async reaction => {
    const message = reaction && reaction.message;
    if (!message || !message.guild) return;
    await sendLog(message.guild, 'messageReactionClear', 'Emoji reactions cleared',
      'Channel: <#' + message.channelId + '>\nEmoji: ' + String(reaction.emoji), 0xd69a4b);
  });
  client.on(Events.MessagePollVoteAdd, async (pollAnswer, userId) => {
    const message = pollAnswer && pollAnswer.poll && pollAnswer.poll.message;
    if (!message || !message.guild) return;
    const answer = pollAnswer.text || (pollAnswer.emoji ? String(pollAnswer.emoji) : 'Answer #' + pollAnswer.id);
    await sendLog(message.guild, 'pollVoteAdd', 'Poll vote added',
      'Member ID: ' + userId + '\nChannel: <#' + message.channelId + '>\nAnswer: ' + answer);
  });
  client.on(Events.MessagePollVoteRemove, async (pollAnswer, userId) => {
    const message = pollAnswer && pollAnswer.poll && pollAnswer.poll.message;
    if (!message || !message.guild) return;
    const answer = pollAnswer.text || (pollAnswer.emoji ? String(pollAnswer.emoji) : 'Answer #' + pollAnswer.id);
    await sendLog(message.guild, 'pollVoteRemove', 'Poll vote removed',
      'Member ID: ' + userId + '\nChannel: <#' + message.channelId + '>\nAnswer: ' + answer);
  });

  client.on(Events.GuildMemberAdd, async member => {
    const config = getSettings(member.guild.id);
    const autorole = config.autorole || {};
    if (autorole.enabled && autorole.roleId) {
      const role = member.guild.roles.cache.get(autorole.roleId) || await member.guild.roles.fetch(autorole.roleId).catch(() => null);
      if (role && role.editable) await member.roles.add(role, 'Configured automatic member role').catch(error => console.warn('Auto-role assignment failed:', error.message || error));
    }
    await sendLog(member.guild, 'memberJoin', 'Member joined',
      member.user.tag + ' (' + member.id + ') joined the server.', 0x55bd91);
  });
  client.on(Events.GuildMemberRemove, async member => {
    await sendLog(member.guild, 'memberLeave', 'Member left',
      member.user.tag + ' (' + member.id + ') left the server.', 0xd69a4b);
    const config = getSettings(member.guild.id);
    const goodbye = config.goodbye || {};
    if (!goodbye.enabled || !goodbye.channelId) return;
    const channel = member.guild.channels.cache.get(goodbye.channelId) ||
      await member.guild.channels.fetch(goodbye.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    const text = String(goodbye.message || 'Goodbye {user}! We will miss you.')
      .replace(/\{user\}/g, member.user.username).replace(/\{username\}/g, member.user.username)
      .replace(/\{server\}/g, member.guild.name).replace(/\{count\}/g, String(member.guild.memberCount || 0));
    await channel.send({ content: text, allowedMentions: { parse: [] } })
      .catch(error => console.warn('Goodbye message failed:', error.message || error));
  });
  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const identity = (newMember.user && newMember.user.tag || newMember.id) + ' (' + newMember.id + ')';
    if (oldMember.nickname !== newMember.nickname) {
      await sendLog(newMember.guild, 'memberNicknameUpdate', 'Member nickname changed',
        identity + '\nBefore: ' + (oldMember.nickname || 'none') + '\nAfter: ' + (newMember.nickname || 'none'));
    }
    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;
    const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
    const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));
    if (addedRoles.size || removedRoles.size) {
      const added = addedRoles.map(role => role.name).slice(0, 12);
      const removed = removedRoles.map(role => role.name).slice(0, 12);
      await sendLog(newMember.guild, 'memberRolesUpdate', 'Member roles changed',
        identity + '\nAdded: ' + (added.join(', ') || 'none') + '\nRemoved: ' + (removed.join(', ') || 'none'));
    }
    if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
      const until = newMember.communicationDisabledUntilTimestamp;
      await sendLog(newMember.guild, 'memberTimeoutUpdate', until ? 'Member timed out' : 'Member timeout removed',
        identity + '\n' + (until ? 'Until: ' + new Date(until).toISOString() : 'Timeout is no longer active.'), until ? 0xd69a4b : 0x55bd91);
    }
    if (oldMember.premiumSinceTimestamp !== newMember.premiumSinceTimestamp) {
      await sendLog(newMember.guild, 'memberBoost', newMember.premiumSinceTimestamp ? 'Member started boosting' : 'Member stopped boosting',
        identity, newMember.premiumSinceTimestamp ? 0x55bd91 : 0xd69a4b);
    }
    if (oldMember.avatar !== newMember.avatar) {
      await sendLog(newMember.guild, 'memberAvatarUpdate', 'Server profile avatar changed', identity);
    }
  });
  client.on(Events.GuildBanAdd, async ban => sendLog(ban.guild, 'memberBan', 'Member banned',
    ban.user.tag + ' (' + ban.user.id + ') was banned.', 0xd65b70));
  client.on(Events.GuildBanRemove, async ban => sendLog(ban.guild, 'memberUnban', 'Member unbanned',
    ban.user.tag + ' (' + ban.user.id + ') was unbanned.', 0x55bd91));

  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const guild = newState.guild || oldState.guild;
    const member = newState.member || oldState.member;
    if (!guild || !member || member.user && member.user.bot) return;
    const name = member.user && (member.user.tag || member.user.username) || member.id;
    const channelMention = id => id ? '<#' + id + '>' : 'none';
    if (oldState.channelId !== newState.channelId) {
      if (!oldState.channelId && newState.channelId) {
        await sendLog(guild, 'voiceJoin', 'Member joined a voice channel', name + '\nChannel: ' + channelMention(newState.channelId), 0x55bd91);
      } else if (oldState.channelId && !newState.channelId) {
        await sendLog(guild, 'voiceLeave', 'Member left a voice channel', name + '\nChannel: ' + channelMention(oldState.channelId), 0xd69a4b);
      } else if (oldState.channelId && newState.channelId) {
        await sendLog(guild, 'voiceMove', 'Member moved voice channels', name + '\nFrom: ' + channelMention(oldState.channelId) + '\nTo: ' + channelMention(newState.channelId));
      }
    }
    if (oldState.serverMute !== newState.serverMute || oldState.selfMute !== newState.selfMute) {
      await sendLog(guild, 'voiceMute', newState.serverMute || newState.selfMute ? 'Member muted' : 'Member unmuted',
        name + '\nChannel: ' + channelMention(newState.channelId || oldState.channelId));
    }
    if (oldState.serverDeaf !== newState.serverDeaf || oldState.selfDeaf !== newState.selfDeaf) {
      await sendLog(guild, 'voiceDeafen', newState.serverDeaf || newState.selfDeaf ? 'Member deafened' : 'Member undeafened',
        name + '\nChannel: ' + channelMention(newState.channelId || oldState.channelId));
    }
    if (oldState.selfVideo !== newState.selfVideo) {
      await sendLog(guild, 'voiceVideo', newState.selfVideo ? 'Member enabled camera' : 'Member disabled camera',
        name + '\nChannel: ' + channelMention(newState.channelId || oldState.channelId));
    }
    if (oldState.streaming !== newState.streaming) {
      await sendLog(guild, 'voiceStream', newState.streaming ? 'Member started streaming' : 'Member stopped streaming',
        name + '\nChannel: ' + channelMention(newState.channelId || oldState.channelId));
    }
    if (oldState.suppress !== newState.suppress) {
      await sendLog(guild, 'voiceStage', newState.suppress ? 'Member became an audience member' : 'Member became a stage speaker',
        name + '\nChannel: ' + channelMention(newState.channelId || oldState.channelId));
    }
  });

  client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
    const changes = [];
    for (const [key, label] of [['name', 'Name'], ['description', 'Description'], ['verificationLevel', 'Verification level'], ['explicitContentFilter', 'Explicit content filter'], ['defaultMessageNotifications', 'Default notifications'], ['preferredLocale', 'Preferred language']]) {
      if (oldGuild[key] !== newGuild[key]) changes.push(label + ': ' + String(oldGuild[key] || 'none') + ' → ' + String(newGuild[key] || 'none'));
    }
    if (oldGuild.icon !== newGuild.icon) changes.push('Server icon changed');
    if (oldGuild.banner !== newGuild.banner) changes.push('Server banner changed');
    if (oldGuild.splash !== newGuild.splash) changes.push('Invite splash changed');
    if (changes.length) await sendLog(newGuild, 'guildUpdate', 'Server settings changed', changes.join('\n'));
  });
  client.on(Events.ChannelCreate, async channel => {
    if (channel.guild) await sendLog(channel.guild, 'channelCreate', 'Channel created', '#' + channel.name + ' (' + channel.id + ') was created.');
  });
  client.on(Events.ChannelDelete, async channel => {
    if (channel.guild) await sendLog(channel.guild, 'channelDelete', 'Channel deleted', '#' + channel.name + ' (' + channel.id + ') was deleted.', 0xd65b70);
  });
  client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    const changes = [];
    for (const [key, label] of [['name', 'Name'], ['topic', 'Topic'], ['nsfw', 'NSFW'], ['rateLimitPerUser', 'Slowmode'], ['bitrate', 'Bitrate'], ['userLimit', 'User limit'], ['parentId', 'Category']]) {
      if (oldChannel[key] !== newChannel[key]) changes.push(label + ' changed');
    }
    if (changes.length) await sendLog(newChannel.guild, 'channelUpdate', 'Channel settings changed',
      '#' + newChannel.name + ' (' + newChannel.id + ')\n' + changes.join(', '));
  });
  client.on(Events.GuildRoleCreate, async role => sendLog(role.guild, 'roleCreate', 'Role created', role.name + ' (' + role.id + ') was created.'));
  client.on(Events.GuildRoleDelete, async role => sendLog(role.guild, 'roleDelete', 'Role deleted', role.name + ' (' + role.id + ') was deleted.', 0xd65b70));
  client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
    const changes = [];
    for (const [key, label] of [['name', 'Name'], ['color', 'Color'], ['hoist', 'Displayed separately'], ['mentionable', 'Mentionable'], ['unicodeEmoji', 'Emoji']]) {
      if (oldRole[key] !== newRole[key]) changes.push(label + ' changed');
    }
    if (!oldRole.permissions.equals(newRole.permissions)) changes.push('Permissions changed');
    if (changes.length) await sendLog(newRole.guild, 'roleUpdate', 'Role updated',
      newRole.name + ' (' + newRole.id + ')\n' + changes.join(', '));
  });

  client.on(Events.ThreadCreate, async thread => {
    if (thread.guild) await sendLog(thread.guild, 'threadCreate', 'Thread created',
      thread.name + ' in <#' + thread.parentId + '>');
  });
  client.on(Events.ThreadUpdate, async (oldThread, newThread) => {
    if (newThread.guild && (oldThread.name !== newThread.name || oldThread.archived !== newThread.archived || oldThread.locked !== newThread.locked)) {
      await sendLog(newThread.guild, 'threadUpdate', 'Thread updated', newThread.name + ' in <#' + newThread.parentId + '>');
    }
  });
  client.on(Events.ThreadDelete, async thread => {
    if (thread.guild) await sendLog(thread.guild, 'threadDelete', 'Thread deleted', thread.name + ' in <#' + thread.parentId + '>', 0xd65b70);
  });
  client.on(Events.ThreadMembersUpdate, async (addedMembers, removedMembers, thread) => {
    if (!thread.guild || (!addedMembers.size && !removedMembers.size)) return;
    await sendLog(thread.guild, 'threadMembersUpdate', 'Thread members changed',
      thread.name + '\nAdded: ' + addedMembers.size + ' • Removed: ' + removedMembers.size);
  });

  client.on(Events.GuildEmojiCreate, async emoji => sendLog(emoji.guild, 'emojiUpdate', 'Emoji created',
    emoji.name + ' (' + emoji.id + ')'));
  client.on(Events.GuildEmojiDelete, async emoji => sendLog(emoji.guild, 'emojiUpdate', 'Emoji deleted',
    emoji.name + ' (' + emoji.id + ')', 0xd65b70));
  client.on(Events.GuildEmojiUpdate, async (oldEmoji, newEmoji) => sendLog(newEmoji.guild, 'emojiUpdate', 'Emoji updated',
    newEmoji.name + ' (' + newEmoji.id + ')'));
  client.on(Events.GuildStickerCreate, async sticker => sendLog(sticker.guild, 'stickerUpdate', 'Sticker created',
    sticker.name + ' (' + sticker.id + ')'));
  client.on(Events.GuildStickerDelete, async sticker => sendLog(sticker.guild, 'stickerUpdate', 'Sticker deleted',
    sticker.name + ' (' + sticker.id + ')', 0xd65b70));
  client.on(Events.GuildStickerUpdate, async (oldSticker, newSticker) => sendLog(newSticker.guild, 'stickerUpdate', 'Sticker updated',
    newSticker.name + ' (' + newSticker.id + ')'));
  client.on(Events.GuildSoundboardSoundsUpdate, async (sounds, guild) => sendLog(guild, 'soundboardBulkUpdate', 'Soundboard sounds changed',
    'Updated soundboard items: ' + sounds.size));
  client.on(Events.VoiceChannelEffectSend, async effect => {
    const detail = effect.soundboardSound ? 'Sound: ' + effect.soundboardSound.name :
      'Emoji: ' + (effect.emoji ? String(effect.emoji) : 'voice effect');
    await sendLog(effect.guild, 'voiceEffect', 'Voice channel effect used',
      'Member ID: ' + effect.userId + '\nChannel: <#' + effect.channelId + '>\n' + detail);
  });
  client.on(Events.TypingStart, async typing => {
    if (!typing.guild || !typing.user || typing.user.bot) return;
    await sendLog(typing.guild, 'typingStart', 'Member started typing',
      'Member: ' + (typing.user.tag || typing.user.username) + '\nChannel: <#' + typing.channel.id + '>');
  });
  client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
    const presence = newPresence || oldPresence;
    if (!presence || !presence.guild || !presence.user || presence.user.bot) return;
    const oldStatus = oldPresence && oldPresence.status || 'offline';
    const newStatus = newPresence && newPresence.status || 'offline';
    const oldActivities = (oldPresence && oldPresence.activities || []).map(activity => activity.name + (activity.details ? ': ' + activity.details : '')).join(', ') || 'none';
    const newActivities = (newPresence && newPresence.activities || []).map(activity => activity.name + (activity.details ? ': ' + activity.details : '')).join(', ') || 'none';
    if (oldStatus === newStatus && oldActivities === newActivities) return;
    await sendLog(presence.guild, 'presenceUpdate', 'Member status or activity changed',
      'Member: ' + (presence.user.tag || presence.user.username) + ' (' + presence.user.id + ')' +
      '\nStatus: ' + oldStatus + ' → ' + newStatus +
      (oldActivities !== newActivities ? '\nActivity: ' + oldActivities + ' → ' + newActivities : ''));
  });
  client.on(Events.ApplicationCommandPermissionsUpdate, async update => {
    const guild = client.guilds.cache.get(update.guildId);
    if (!guild) return;
    await sendLog(guild, 'applicationCommandPermissionsUpdate', 'Slash-command permissions changed',
      'Command ID: ' + update.id + '\nApplication ID: ' + update.applicationId +
      '\nPermission entries: ' + update.permissions.length);
  });
  client.on('guildSoundboardSoundCreate', async sound => sendLog(sound.guild, 'soundboardCreate', 'Soundboard sound created', sound.name + ' (' + sound.id + ')'));
  client.on('guildSoundboardSoundUpdate', async (oldSound, newSound) => sendLog(newSound.guild, 'soundboardUpdate', 'Soundboard sound updated', newSound.name + ' (' + newSound.id + ')'));
  client.on('guildSoundboardSoundDelete', async sound => sendLog(sound.guild, 'soundboardDelete', 'Soundboard sound deleted', sound.name + ' (' + sound.id + ')', 0xd65b70));

  client.on(Events.InviteCreate, async invite => {
    if (invite.guild) await sendLog(invite.guild, 'inviteCreate', 'Invite created',
      'Code: ' + invite.code + '\nChannel: ' + (invite.channel ? '<#' + invite.channel.id + '>' : 'unknown') + '\nCreator: ' + (invite.inviter ? invite.inviter.tag : 'unknown'));
  });
  client.on(Events.InviteDelete, async invite => {
    if (invite.guild) await sendLog(invite.guild, 'inviteDelete', 'Invite deleted',
      'Code: ' + invite.code + '\nChannel: ' + (invite.channel ? '<#' + invite.channel.id + '>' : 'unknown'), 0xd65b70);
  });
  client.on(Events.WebhooksUpdate, async channel => {
    if (channel.guild) await sendLog(channel.guild, 'webhookUpdate', 'Webhooks changed',
      'Webhook configuration changed in <#' + channel.id + '>.');
  });
  client.on(Events.GuildIntegrationsUpdate, async guild => sendLog(guild, 'integrationUpdate', 'Server integrations changed',
    'The server integration list was updated.'));

  client.on(Events.GuildScheduledEventCreate, async event => sendLog(event.guild, 'scheduledEventCreate', 'Scheduled event created',
    event.name + ' (' + event.id + ')'));
  client.on(Events.GuildScheduledEventUpdate, async (oldEvent, newEvent) => sendLog(newEvent.guild, 'scheduledEventUpdate', 'Scheduled event updated',
    newEvent.name + ' (' + newEvent.id + ')'));
  client.on(Events.GuildScheduledEventDelete, async event => sendLog(event.guild, 'scheduledEventDelete', 'Scheduled event deleted',
    event.name + ' (' + event.id + ')', 0xd65b70));
  client.on(Events.GuildScheduledEventUserAdd, async (event, user) => sendLog(event.guild, 'scheduledEventUserAdd', 'Member subscribed to scheduled event',
    event.name + '\nMember: ' + (user && (user.tag || user.username || user.id) || 'unknown')));
  client.on(Events.GuildScheduledEventUserRemove, async (event, user) => sendLog(event.guild, 'scheduledEventUserRemove', 'Member unsubscribed from scheduled event',
    event.name + '\nMember: ' + (user && (user.tag || user.username || user.id) || 'unknown')));

  client.on(Events.StageInstanceCreate, async stage => sendLog(stage.guild, 'stageInstanceCreate', 'Stage started',
    stage.topic + ' in <#' + stage.channelId + '>'));
  client.on(Events.StageInstanceUpdate, async (oldStage, newStage) => sendLog(newStage.guild, 'stageInstanceUpdate', 'Stage updated',
    newStage.topic + ' in <#' + newStage.channelId + '>'));
  client.on(Events.StageInstanceDelete, async stage => sendLog(stage.guild, 'stageInstanceDelete', 'Stage ended',
    stage.topic + ' in <#' + stage.channelId + '>', 0xd69a4b));

  client.on('autoModerationRuleCreate', async rule => sendLog(rule.guild, 'autoModerationRuleCreate', 'AutoMod rule created', rule.name + ' (' + rule.id + ')'));
  client.on('autoModerationRuleUpdate', async (oldRule, newRule) => sendLog(newRule.guild, 'autoModerationRuleUpdate', 'AutoMod rule updated', newRule.name + ' (' + newRule.id + ')'));
  client.on('autoModerationRuleDelete', async rule => sendLog(rule.guild, 'autoModerationRuleDelete', 'AutoMod rule deleted', rule.name + ' (' + rule.id + ')', 0xd65b70));
  client.on('autoModerationActionExecution', async execution => {
    const guild = execution.guild;
    if (!guild) return;
    await sendLog(guild, 'automod', 'AutoMod action executed',
      'Rule ID: ' + execution.ruleId + '\nUser ID: ' + execution.userId + '\nChannel: ' + (execution.channelId ? '<#' + execution.channelId + '>' : 'unknown') + '\nAction: ' + (execution.action && execution.action.type));
  });

  client.on('guildAuditLogEntryCreate', async (entry, guild) => {
    if (!guild) return;
    const action = AuditLogEvent[entry.action] || String(entry.action);
    const actor = entry.executor ? (entry.executor.tag || entry.executor.username || entry.executor.id) : (entry.executorId || 'unknown');
    const target = entry.target ? (entry.target.tag || entry.target.username || entry.target.name || entry.target.id) : (entry.targetId || 'unknown');
    const changes = Array.isArray(entry.changes) ? entry.changes.slice(0, 8).map(change => change.key).join(', ') : '';
    await sendLog(guild, 'auditLogEntry', 'Server audit-log action',
      'Action: ' + action + '\nBy: ' + actor + '\nTarget: ' + target +
      (entry.reason ? '\nReason: ' + entry.reason : '') +
      (changes ? '\nChanged fields: ' + changes : ''), 0xd69a4b);
  });
  const cleanup = setInterval(() => {
    const cutoff = Date.now() - 60000;
    for (const [key, times] of messageWindows) {
      const recent = times.filter(time => time > cutoff);
      if (recent.length) messageWindows.set(key, recent); else messageWindows.delete(key);
    }
  }, 60000);
  if (cleanup.unref) cleanup.unref();
  console.log('Core modules attached: AutoMod, ticket interactions, member events and server event logging.');
}

module.exports = { attachCoreModules, getCoreCommands, handleCoreInteraction };
