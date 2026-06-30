require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function findAfkChannel(guild) {
  return guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildVoice && ch.name.toLowerCase() === 'afk'
  );
}

function joinAfkChannel(guild) {
  const afkChannel = findAfkChannel(guild);
  if (!afkChannel) {
    console.log(`[${guild.name}] Gak nemu voice channel bernama "AFK", dilewati.`);
    return;
  }
  joinVoiceChannel({
    channelId: afkChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: true,
  });
  console.log(`[${guild.name}] Berhasil join channel AFK.`);
}

client.once('ready', async () => {
  console.log(`Bot online sebagai ${client.user.tag}`);

  // Loop ke SEMUA server tempat bot ada, join AFK channel di masing-masing
  client.guilds.cache.forEach((guild) => {
    try {
      joinAfkChannel(guild);
    } catch (err) {
      console.error(`[${guild.name}] Gagal join voice channel AFK:`, err);
    }
  });
});

// Kalau bot baru di-invite ke server baru pas dia udah online, langsung join juga
client.on('guildCreate', (guild) => {
  joinAfkChannel(guild);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.trim().toLowerCase() === '!afk') {
    const member = message.member;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      return message.reply('Kamu harus ada di voice channel dulu buat dipindah ke AFK.');
    }

    const afkChannel = findAfkChannel(message.guild);
    if (!afkChannel) {
      return message.reply('Server ini belum punya voice channel bernama "AFK".');
    }

    try {
      await member.voice.setChannel(afkChannel.id);
      message.reply('Berhasil dipindah ke channel AFK 👋');
    } catch (err) {
      console.error(err);
      message.reply('Gagal mindahin, cek lagi izin bot atau posisi role-nya.');
    }
  }
});

client.login(process.env.TOKEN);