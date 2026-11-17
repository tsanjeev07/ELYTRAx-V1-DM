require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionsBitField,
} = require('discord.js');

const PREFIX = process.env.PREFIX || '!';
const CONFIG_PATH = path.join(__dirname, 'dm_config.json');

// Load or initialize server setup data
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({}, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
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

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Forward user DM replies to the server's private DM console channel
  if (!message.guild) {
    const config = loadConfig();
    for (const guildId of Object.keys(config)) {
      const guildConfig = config[guildId];
      if (!guildConfig || !guildConfig.consoleChannelId) continue;

      try {
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) continue;

        const member = await guild.members.fetch(message.author.id).catch(() => null);
        if (!member) continue;

        const consoleChannel = await guild.channels
          .fetch(guildConfig.consoleChannelId)
          .catch(() => null);
        if (!consoleChannel) continue;

        await consoleChannel.send(
          `DM Reply Received\nFrom: ${message.author.tag} (${message.author.id})\nMessage: ${message.content || '[Attachment / No text]'}`
        );
      } catch (err) {
        console.error('Error forwarding DM:', err.message);
      }
    }
    return;
  }

  if (!message.content.startsWith(PREFIX)) return;

  // Admin check: only server Administrators can use the bot
  if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return;
  }

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  // 1. SETUP COMMAND: Creates private category, #how-to-use, and #dm-console
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
        `Use all DM commands inside <#${consoleChannel.id}>.`,
        ``,
        `1. Send DM without your personal name:`,
        `Command: ${PREFIX}dm @user <message>`,
        `Or with ID: ${PREFIX}dm <user_id> <message>`,
        `What the user receives:`,
        `<message>`,
        `- ${guild.name} Management`,
        ``,
        `2. Send DM with your name included:`,
        `Command: ${PREFIX}dmn @user <message>`,
        `Or with ID: ${PREFIX}dmn <user_id> <message>`,
        `What the user receives:`,
        `<message>`,
        `- <Your Name>, ${guild.name} Management`,
        ``,
        `3. Send DM to an entire role (without your name):`,
        `Command: ${PREFIX}dmrole @role <message>`,
        ``,
        `4. Send DM to an entire role (with your name):`,
        `Command: ${PREFIX}dmnrole @role <message>`,
        ``,
        `Notes:`,
        `- Only server administrators can see this category and run these commands.`,
        `- If a user has DMs closed or blocked the bot, the bot will report "Failed" in <#${consoleChannel.id}>.`,
        `- If a user replies to the bot in DM, their reply will be posted inside <#${consoleChannel.id}>.`,
      ].join('\n');

      await howToChannel.send(guideText);
      await consoleChannel.send(
        `DM console is ready. Check <#${howToChannel.id}> for commands.`
      );

      const config = loadConfig();
      config[guild.id] = {
        categoryId: category.id,
        howToChannelId: howToChannel.id,
        consoleChannelId: consoleChannel.id,
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

  // 2. SINGLE USER DM: !dm (management only) or !dmn (sender name + management)
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
    const targetMember = await message.guild.members.fetch(userId).catch(() => null);

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
      await targetMember.send(fullMessage);
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

  // 3. ROLE DM: !dmrole (management only) or !dmnrole (sender name + management)
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

    await message.reply(
      `Sending DM to ${members.size} member(s) in role ${role.name}. Please wait...`
    );

    let sentCount = 0;
    let failedCount = 0;

    for (const [, member] of members) {
      try {
        await member.send(fullMessage);
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