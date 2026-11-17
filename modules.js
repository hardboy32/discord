
const {
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

function ticketDashboardConfig(){try{const fs=require('node:fs');const file=process.env.DASHBOARD_SETTINGS_FILE||'/app/data/dashboard-settings.json';return JSON.parse(fs.readFileSync(file,'utf8')).communityConfig?.tickets||{}}catch{return {}}}
function ticketsEnabled(guildId){try{const fs=require('node:fs');const file=process.env.DASHBOARD_SETTINGS_FILE||'/app/data/dashboard-settings.json';const settings=JSON.parse(fs.readFileSync(file,'utf8'));return settings.community?.tickets!==false}catch{return true}}
function getCoreCommands() {
  return [
    new SlashCommandBuilder()
      .setName('ticket-setup')
      .setDescription('Create a support ticket panel')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption(option => option.setName('panel_channel').setDescription('Where users open tickets').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addRoleOption(option => option.setName('staff_role').setDescription('Role that can view and manage tickets').setRequired(true))
      .addChannelOption(option => option.setName('transcript_channel').setDescription('Where closed ticket transcripts are sent').addChannelTypes(ChannelType.GuildText).setRequired(true))
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
    const panelChannel = interaction.options.getChannel('panel_channel', true);
    const staffRole = interaction.options.getRole('staff_role', true);
    const transcriptChannel = interaction.options.getChannel('transcript_channel', true);
    const category = interaction.options.getChannel('category');
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Support Center')
      .setDescription('Need help? Press the button below to open a private support ticket.')
      .setFooter({ text: 'ticket-config|' + staffRole.id + '|' + transcriptChannel.id + '|' + (category ? category.id : '') });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:open').setLabel(cfg.buttonLabel || 'Open a ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫')
    );
    await panelChannel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: 'Ticket panel created in ' + panelChannel.toString() + '. Staff: ' + staffRole.toString() + '. Transcripts: ' + transcriptChannel.toString() + (category ? ' Category: ' + category.name : ''), flags: MessageFlags.Ephemeral });
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
    if (!setup || !/^\\d{17,20}$/.test(setup.staffRoleId) || !/^\\d{17,20}$/.test(setup.transcriptChannelId)) {
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
    const isStaff = staffRoleId && interaction.member.roles?.cache?.has(staffRoleId);
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
  async function sendLog(guild, title, description, color = 0x7887ff) {
    const config = getSettings(guild.id);
    const logging = config.logging || {};
    const channelId = logging.channelId || (config.moderation && config.moderation.logChannelId);
    if (logging.enabled === false || !channelId) return;
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
    await message.delete().catch(() => {});
    await sendLog(message.guild, 'AutoMod action', message.author.tag + ' (' + message.author.id + ') — ' + reason, 0xe0a04b);
  });
  client.on(Events.MessageDelete, async message => {
    if (!message.guild || message.author && message.author.bot) return;
    const author = message.author ? message.author.tag + ' (' + message.author.id + ')' : 'Unknown author';
    await sendLog(message.guild, 'Message deleted', 'Author: ' + author + '\nChannel: <#' + message.channelId + '>\nMessage content was not recorded.', 0xd65b70);
  });
  client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    if (!newMessage.guild || newMessage.author && newMessage.author.bot || oldMessage.content === newMessage.content) return;
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
    if (config.logging && config.logging.enabled !== false) await sendLog(member.guild, 'Member joined', member.user.tag + ' (' + member.id + ') joined the server.', 0x55bd91);
    if (!goodbye.enabled || !goodbye.channelId) return;
    const channel = member.guild.channels.cache.get(goodbye.channelId);
    if (!channel || !channel.isTextBased()) return;
    const text = String(goodbye.message || 'Goodbye {user}! We will miss you.')
      .replace(/\{user\}/g, member.user.username).replace(/\{username\}/g, member.user.username)
      .replace(/\{server\}/g, member.guild.name).replace(/\{count\}/g, String(member.guild.memberCount || 0));
    await channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
  });
  client.on(Events.GuildMemberRemove, async member => sendLog(member.guild, 'Member left', member.user.tag + ' (' + member.id + ') left the server.', 0xd69a4b));
  client.on(Events.GuildBanAdd, async ban => sendLog(ban.guild, 'Member banned', ban.user.tag + ' (' + ban.user.id + ') was banned.', 0xd65b70));
  client.on(Events.GuildBanRemove, async ban => sendLog(ban.guild, 'Member unbanned', ban.user.tag + ' (' + ban.user.id + ') was unbanned.', 0x55bd91));
  client.on(Events.ChannelCreate, async channel => { if (channel.guild) await sendLog(channel.guild, 'Channel created', '#' + channel.name + ' (' + channel.id + ') was created.'); });
  client.on(Events.ChannelDelete, async channel => { if (channel.guild) await sendLog(channel.guild, 'Channel deleted', '#' + channel.name + ' (' + channel.id + ') was deleted.', 0xd65b70); });
  client.on(Events.GuildRoleCreate, async role => sendLog(role.guild, 'Role created', role.name + ' (' + role.id + ') was created.'));
  client.on(Events.GuildRoleDelete, async role => sendLog(role.guild, 'Role deleted', role.name + ' (' + role.id + ') was deleted.', 0xd65b70));
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
