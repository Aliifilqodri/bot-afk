require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');

const { initDB }                              = require('./database');
const { handleGacha, handleDaily }            = require('./commands/gacha');
const { handleInventory, handleCardInfo }     = require('./commands/inventory');
const { handleDuel, handleAccept, handleDecline,
        handlePick, handleAttack, handleSkill,
        handleUltimate, handleSurrender } = require('./commands/duel');
const { handleAddChar, handleCharList, handleBroadcast } = require('./commands/admin');

// Init database sebelum bot nyala
initDB();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ── Voice AFK ─────────────────────────────────────
function findAfkChannel(guild) {
  return guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildVoice && ch.name.toLowerCase() === 'afk'
  );
}

function joinAfkChannel(guild) {
  const afkChannel = findAfkChannel(guild);
  if (!afkChannel) {
    console.log(`[${guild.name}] Gak nemu voice channel "AFK", dilewati.`);
    return;
  }
  try {
    const conn = joinVoiceChannel({
      channelId: afkChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true,
    });
    // Tangani error voice biar bot gak crash
    conn.on('error', (err) => {
      console.warn(`[${guild.name}] Voice error (ignored):`, err.message);
    });
    console.log(`[${guild.name}] Bot join voice channel AFK.`);
  } catch (err) {
    console.warn(`[${guild.name}] Gagal join AFK voice:`, err.message);
  }
}

client.once('ready', () => {
  console.log(`Bot online sebagai ${client.user.tag}`);
  client.guilds.cache.forEach((guild) => {
    try { joinAfkChannel(guild); } catch (err) { console.error(err); }
  });
});

client.on('guildCreate', (guild) => joinAfkChannel(guild));

// ── Commands ──────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild)     return;

  const content = message.content.trim();
  const args    = content.split(/\s+/).slice(1);
  const cmd     = content.split(/\s+/)[0].toLowerCase();

  try {
    switch (cmd) {
      // AFK
      case '!afk': {
        const member = message.member;
        if (!member.voice.channel)
          return message.reply('Kamu harus ada di voice channel dulu!');
        const afkCh = findAfkChannel(message.guild);
        if (!afkCh)
          return message.reply('Server ini belum punya voice channel bernama "AFK".');
        await member.voice.setChannel(afkCh.id);
        return message.reply('Berhasil dipindah ke channel AFK 👋');
      }

      // Gacha
      case '!gacha':  return await handleGacha(message);
      case '!daily':  return await handleDaily(message);

      // Inventory
      case '!inv':
      case '!inventory': return await handleInventory(message);
      case '!info':      return await handleCardInfo(message, args);

      // Duel
      case '!duel':    return await handleDuel(message);
      case '!accept':  return await handleAccept(message);
      case '!decline': return await handleDecline(message);
      case '!pick':    return await handlePick(message, args);
      case '!attack':   return await handleAttack(message);
      case '!skill':    return await handleSkill(message);
      case '!ultimate': return await handleUltimate(message);
      case '!surrender':return await handleSurrender(message);

      // Admin
      case '!addchar':   return await handleAddChar(message, args);
      case '!charlist':  return await handleCharList(message, args);
      case '!broadcast': return await handleBroadcast(message, args);

      // Help
      case '!help': {
        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
          .setColor(0x2196f3)
          .setTitle('📖 Daftar Command Bot')
          .addFields(
            { name: '🎮 Gacha',
              value: '`!gacha` — Tarik karakter (100 koin, cooldown 1 jam)\n`!daily` — Klaim 300 koin harian\n`!inv` — Lihat koleksi karakter\n`!info [nama]` — Info detail karakter',
              inline: false },
            { name: '⚔️ Duel',
              value: '`!duel @user` — Tantang duel\n`!accept` — Terima tantangan\n`!decline` — Tolak tantangan\n`!pick [nama]` — Pilih karakter untuk duel\n`!attack` — Serangan normal\n`!skill` — Gunakan skill khusus (1x per duel)',
              inline: false },
            { name: '🔊 AFK',
              value: '`!afk` — Pindah ke voice channel AFK',
              inline: false },
            { name: '🛠️ Admin',
              value: '`!addchar` — Tambah karakter baru\n`!charlist` — Lihat semua karakter',
              inline: false },
          );
        return message.reply({ embeds: [embed] });
      }
    }
  } catch (err) {
    console.error(`Error pada command ${cmd}:`, err);
    message.reply('❌ Terjadi error, coba lagi ya.').catch(() => {});
  }
});

client.login(process.env.TOKEN);