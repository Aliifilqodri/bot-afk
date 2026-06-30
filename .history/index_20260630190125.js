require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType, PermissionsBitField } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');

// Regex sederhana buat deteksi link (http/https/discord invite/www)
const LINK_REGEX = /(https?:\/\/|www\.|discord\.gg\/)/i;

// Nyimpen riwayat waktu pesan tiap user, buat deteksi spam beruntun
// format: Map<userId, array of timestamps>
const messageHistory = new Map();
const SPAM_LIMIT = 3; // lebih dari 3 pesan
const SPAM_WINDOW_MS = 5000; // dalam 5 detik
const TIMEOUT_DURATION_MS = 5 * 60 * 1000; // timeout 5 menit

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ],
});

// Cari voice channel bernama "afk" di satu server tertentu
function findAfkChannel(guild) {
  return guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildVoice && ch.name.toLowerCase() === 'afk'
  );
}

// Bikin bot join ke channel AFK di satu server
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
  if (!message.guild) return; // abaikan DM

  const member = message.member;

  // Admin/orang yang punya izin Manage Messages dianggap aman, dilewati dari proteksi
  const isTrusted = member.permissions.has(PermissionsBitField.Flags.ManageMessages);

  if (!isTrusted) {
    // --- 1. Hapus pesan yang mengandung link ---
    if (LINK_REGEX.test(message.content)) {
      try {
        await message.delete();
      } catch (err) {
        console.error('Gagal hapus pesan link:', err);
      }
      // Tetap lanjut cek spam di bawah, siapa tau dia juga spam beruntun
    }

    // --- 2. Deteksi spam beruntun (>3 pesan dalam 5 detik) ---
    const now = Date.now();
    const userId = message.author.id;
    const timestamps = messageHistory.get(userId) || [];

    // Buang timestamp yang udah lewat dari window waktu
    const recentTimestamps = timestamps.filter((t) => now - t < SPAM_WINDOW_MS);
    recentTimestamps.push(now);
    messageHistory.set(userId, recentTimestamps);

    if (recentTimestamps.length > SPAM_LIMIT) {
      try {
        await member.timeout(TIMEOUT_DURATION_MS, 'Terdeteksi spam beruntun');
        await message.channel.send(
          `🔇 ${member.user.tag} di-timeout 5 menit karena spam.`
        );
        messageHistory.set(userId, []); // reset histori biar gak ke-timeout berkali-kali
      } catch (err) {
        console.error('Gagal timeout user spam:', err);
      }
    }
  }

  // --- Command !afk (tetap berjalan seperti biasa) ---
  if (message.content.trim().toLowerCase() === '!afk') {
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