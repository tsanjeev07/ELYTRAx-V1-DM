require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const PREFIX = process.env.PREFIX || '!';
const CONFIG_PATH = path.join(__dirname, 'dm_config.json');

// Load or initialize server setup and active chat data
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify({ guilds: {}, userActiveGuild: {} }, null, 2)
    );
  }
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!data.guilds) data.guilds = {};
    if (!data.userActiveGuild) data.userActiveGuild = {};
    return data;
  } catch {
    return { guilds: {}, userActiveGuild: {} };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Build the "Chat with Management" button attached to outgoing DMs
function createChatButton(guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`open_chat_${guildId}`)
      .setLabel('Chat with Management')
      .setStyle(ButtonStyle.Secondary)
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once('ready', () => {
  console.log(`ELYTRAx V1 is online as ${client.user.tag}`);
});

// Handle button click inside user DM to create/open the private channel
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('open_chat_')) return;

  const guildId = interaction.customId.replace('open_chat_', '');
  const userId = interaction.user.id;
  const config = loadConfig();

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    await interaction.reply({
      content: 'Server not found.',
      ephemeral: true,
    });
    return;
  }

  if (!config.guilds[guildId]) {
    config.guilds[guildId] = { activeChats: {} };
  }
  if (!config.guilds[guildId].activeChats) {
    config.guilds[guildId].activeChats = {};
  }

  // Check if a private channel already exists for this user
  const existingChannelId = config.guilds[guildId].activeChats[userId];
  if (existingChannelId) {
    const existingChannel = await guild.channels
      .fetch(existingChannelId)
      .catch(() => null);
    if (existingChannel) {
      config.userActiveGuild[userId] = guildId;
      saveConfig(config);
      await interaction.reply({
        content: `Your chat with ${guild.name} Management is already open. Type your message below in this DM to send it.`,
      });
      return;
    }
  }

  try {
    const botMember = await guild.members.fetchMe();
    const cleanName =
      interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '') ||
      userId;

    const chatChannel = await guild.channels.create({
      name: `dm-${cleanName}`,
      type: ChannelType.GuildText,
      parent: config.guilds[guildId].categoryId || null,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: botMember.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ManageChannels,
          ],
        },
      ],
    });

    config.guilds[guildId].activeChats[userId] = chatChannel.id;
    config.userActiveGuild[userId] = guildId;
    saveConfig(config);

    await chatChannel.send(
      [
        `DM Chat Opened`,
        `User: ${interaction.user.tag} (${userId})`,
        ``,
        `How to reply from this channel:`,
        `- Type normally in this channel to send a DM signed as: - ${guild.name} Management`,
        `- Start with ${PREFIX}n <message> to include your name: - <Your Name>, ${guild.name} Management`,
        `- Type ${PREFIX}close to close and delete this channel.`,
      ].join('\n')
    );

    await interaction.reply({
      content: `Chat connected with ${guild.name} Management. Send your message here in DM and it will go to the team.`,
    });
  } catch (err) {
    console.error('Error creating private DM channel:', err.message);
    await interaction.reply({
      content: 'Could not open chat channel. Please try again later.',
    });
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const config = loadConfig();

  // 1. USER SENDS A MESSAGE IN DM -> Forward to their private server channel
  if (!message.guild) {
    const userId = message.author.id;
    const activeGuildId = config.userActiveGuild[userId];

    if (!activeGuildId || !config.guilds[activeGuildId]?.activeChats?.[userId]) {
      await message.reply(
        'Click the "Chat with Management" button on the message you received first to open a chat.'
      );
      return;
    }

    const guild = await client.guilds.fetch(activeGuildId).catch(() => null);
    if (!guild) return;

    const channelId = config.guilds[activeGuildId].activeChats[userId];
    const chatChannel = await guild.channels.fetch(channelId).catch(() => null);

    if (!chatChannel) {
      await message.reply(
        'This chat session was closed. Click the "Chat with Management" button on a message to open a new chat.'
      );
      return;
    }

    const attachments = message.attachments.map((a) => a.url).join('\n');
    const contentToSend = [
      `From ${message.author.tag}:`,
      message.content || '',
      attachments,
    ]
      .filter(Boolean)
      .join('\n');

    await chatChannel.send(contentToSend);
    return;
  }

  // Only server Administrators can use the bot or reply in private DM channels
  if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return;
  }

  const guildId = message.guild.id;
  const guildConfig = config.guilds[guildId];

  // 2. MOD SENDS MESSAGE INSIDE AN ACTIVE PRIVATE USER CHANNEL -> Relay to User DM
  if (guildConfig && guildConfig.activeChats) {
    const matchedUserId = Object.keys(guildConfig.activeChats).find(
      (uid) => guildConfig.activeChats[uid] === message.channel.id
    );

    if (matchedUserId) {
      const rawContent = message.content.trim();

      // Close command inside the private chat channel
      if (rawContent.toLowerCase() === `${PREFIX}close`) {
        const targetUser = await client.users.fetch(matchedUserId).catch(() => null);
        if (targetUser) {
          await targetUser
            .send(
              `Chat session closed by ${message.guild.name} Management.`
            )
            .catch(() => null);
        }
        delete guildConfig.activeChats[matchedUserId];
        if (config.userActiveGuild[matchedUserId] === guildId) {
          delete config.userActiveGuild[matchedUserId];
        }
        saveConfig(config);
        await message.channel.delete().catch(() => null);
        return;
      }

      // Ignore other bot commands if typed inside the ticket channel
      if (
        rawContent.startsWith(`${PREFIX}setupdm`) ||
        rawContent.startsWith(`${PREFIX}dm`)
      ) {
        // Let the command handler below process it
      } else {
        const includeSenderName = rawContent
          .toLowerCase()
          .startsWith(`${PREFIX}n `);
        const msgBody = includeSenderName
          ? rawContent.slice(`${PREFIX}n `.length).trim()
          : rawContent;

        const attachments = message.attachments.map((a) => a.url).join('\n');
        const fullBody = [msgBody, attachments].filter(Boolean).join('\n');

        if (!fullBody) return;

        const senderName =
          message.member.displayName || message.author.username;
        const footer = includeSenderName
          ? `- ${senderName}, ${message.guild.name} Management`
          : `- ${message.guild.name} Management`;

        const targetUser = await client.users
          .fetch(matchedUserId)
          .catch(() => null);
        if (!targetUser) {
          await message.reply('User could not be found.');
          return;
        }

        try {
          await targetUser.send(`${fullBody}\n\n${footer}`);
          await message.channel.send(`Sent to user (${footer})`);
        } catch {
          await message.reply(
            'Failed to send DM. The user closed their DMs or blocked the bot.'
          );
        }
        return;
      }
    }
  }

  // 3. PREFIX COMMANDS
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  // SETUP COMMAND: Creates private category, #how-to-use, and #dm-console
  if (command === 'setupdm') {
    try {
      const guild = message.guild;
      const botMember = await guild.members.fetchMe();

      const category = await guild.channels.create({
        name: 'ELYTRAX DM SYSTEM',
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
          {
            id: botMember.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ManageChannels,
            ],
          },
          {
            id: message.author.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
            ],
          },
        ],
      });

      const howToChannel = await guild.channels.create({
        name: 'how-to-use',
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
          {
            id: botMember.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
            ],
          },
          {
            id: message.author.id,
            allow: [PermissionsBitField.Flags.ViewChannel],
          },
        ],
      });

      const consoleChannel = await guild.channels.create({
        name: 'dm-console',
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
          {
            id: botMember.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
            ],
          },
          {
            id: message.author.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
            ],
          },
        ],
      });

      const guideText = [
        `ELYTRAX V1 - ADMIN DM GUIDE`,
        ``,
        `Prefix: ${PREFIX}`,
        `Use all initial DM commands inside <#${consoleChannel.id}>.`,
        ``,
        `1. Send DM without your personal name:`,
        `Command: ${PREFIX}dm @user <message>`,
        `Or with ID: ${PREFIX}dm <user_id> <message>`,
        `Sign-off: - ${guild.name} Management`,
        ``,
        `2. Send DM with your name included:`,
        `Command: ${PREFIX}dmn @user <message>`,
        `Or with ID: ${PREFIX}dmn <user_id> <message>`,
        `Sign-off: - <Your Name>, ${guild.name} Management`,
        ``,
        `3. Send DM to an entire role:`,
        `Without your name: ${PREFIX}dmrole @role <message>`,
        `With your name: ${PREFIX}dmnrole @role <message>`,
        ``,
        `4. Two-Way Private Chat (Button in DM):`,
        `- Every DM includes a "Chat with Management" button.`,
        `- When the user clicks the button, the bot creates a private channel (dm-username) under this category.`,
        `- Anything the user types in DM appears inside that private channel.`,
        `- Type normally in that private channel to reply as "- ${guild.name} Management".`,
        `- Start your message with "${PREFIX}n <message>" in that private channel to reply with your name included.`,
        `- Type "${PREFIX}close" in that private channel to close and delete it.`,
      ].join('\n');

      await howToChannel.send(guideText);
      await consoleChannel.send(
        `DM console is ready. Check <#${howToChannel.id}> for commands.`
      );

      config.guilds[guild.id] = {
        categoryId: category.id,
        howToChannelId: howToChannel.id,
        consoleChannelId: consoleChannel.id,
        activeChats: config.guilds[guild.id]?.activeChats || {},
      };
      saveConfig(config);

      await message.reply(
        `Setup complete. Created private category with <#${howToChannel.id}> and <#${consoleChannel.id}>.`
      );
    } catch (err) {
      console.error('Setup error:', err);
      await message.reply(
        `Setup failed: ${err.message}. Make sure the bot has Administrator or Manage Channels permission.`
      );
    }
    return;
  }

  // SINGLE USER DM: !dm (management only) or !dmn (sender name + management)
  if (command === 'dm' || command === 'dmn') {
    const targetArg = args.shift();
    const text = args.join(' ').trim();

    if (!targetArg || !text) {
      await message.reply(
        `Usage: ${PREFIX}${command} <@user or user_id> <message>`
      );
      return;
    }

    const userId = targetArg.replace(/[<@!>]/g, '');
    const targetMember = await message.guild.members
      .fetch(userId)
      .catch(() => null);

    if (!targetMember) {
      await message.reply(`User not found in this server: ${targetArg}`);
      return;
    }

    const senderName = message.member.displayName || message.author.username;
    const footer =
      command === 'dmn'
        ? `- ${senderName}, ${message.guild.name} Management`
        : `- ${message.guild.name} Management`;

    const fullMessage = `${text}\n\n${footer}`;

    try {
      await targetMember.send({
        content: fullMessage,
        components: [createChatButton(message.guild.id)],
      });
      await message.reply(
        `Sent to ${targetMember.user.tag} (${targetMember.id}).\nSign-off used: ${footer}`
      );
    } catch {
      await message.reply(
        `Failed to send DM to ${targetMember.user.tag} (${targetMember.id}). Their DMs are closed or the bot is blocked.`
      );
    }
    return;
  }

  // ROLE DM: !dmrole (management only) or !dmnrole (sender name + management)
  if (command === 'dmrole' || command === 'dmnrole') {
    const roleArg = args.shift();
    const text = args.join(' ').trim();

    if (!roleArg || !text) {
      await message.reply(
        `Usage: ${PREFIX}${command} <@role or role_id> <message>`
      );
      return;
    }

    const roleId = roleArg.replace(/[<@&>]/g, '');
    const role = await message.guild.roles.fetch(roleId).catch(() => null);

    if (!role) {
      await message.reply(`Role not found: ${roleArg}`);
      return;
    }

    await message.guild.members.fetch();
    const members = role.members.filter((m) => !m.user.bot);

    if (members.size === 0) {
      await message.reply(`No human members found with role ${role.name}.`);
      return;
    }

    const senderName = message.member.displayName || message.author.username;
    const footer =
      command === 'dmnrole'
        ? `- ${senderName}, ${message.guild.name} Management`
        : `- ${message.guild.name} Management`;

    const fullMessage = `${text}\n\n${footer}`;
    const row = createChatButton(message.guild.id);

    await message.reply(
      `Sending DM to ${members.size} member(s) in role ${role.name}. Please wait...`
    );

    let sentCount = 0;
    let failedCount = 0;

    for (const [, member] of members) {
      try {
        await member.send({
          content: fullMessage,
          components: [row],
        });
        sentCount++;
      } catch {
        failedCount++;
      }
      // 1.5s delay between DMs to avoid Discord rate limits
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    await message.channel.send(
      `Role DM complete for ${role.name}.\nSent: ${sentCount}\nFailed: ${failedCount}\nSign-off used: ${footer}`
    );
  }
});

client.login(process.env.DISCORD_TOKEN);