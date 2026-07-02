require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');

const { initDB }                                = require('./database');
const { handleGacha, handleDaily }              = require('./commands/gacha');
const { handleInventory, handleCardInfo }        = require('./commands/inventory');
const { handleDuel, handleAccept, handleDecline,
        handlePick, handlePickSelect, handleAttack, handleSkill,
        handleUltimate, handleSurrender }        = require('./commands/duel');
const { handleAddChar, handleCharList,
        handleBroadcast, handleSetChannel }             = require('./commands/admin');

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

// ── Dropdown pick interaction ──────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId.startsWith('pick_')) {
    try {
      await handlePickSelect(interaction);
    } catch (err) {
      console.error('Error pick select:', err);
      interaction.reply({ content: '❌ Terjadi error, coba lagi ya.', ephemeral: true }).catch(() => {});
    }
  }
});

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
      case '!duel':      return await handleDuel(message);
      case '!accept':    return await handleAccept(message);
      case '!decline':   return await handleDecline(message);
      case '!pick':      return await handlePick(message, args);
      case '!attack':    return await handleAttack(message);
      case '!skill':     return await handleSkill(message);
      case '!ultimate':  return await handleUltimate(message);
      case '!surrender': return await handleSurrender(message);

      // Admin
      case '!addchar':    return await handleAddChar(message, args);
      case '!charlist':   return await handleCharList(message, args);
      case '!broadcast':  return await handleBroadcast(message, args);
      case '!setchannel': return await handleSetChannel(message, args);

      // Game Guide
      case '!gametoku':  return await handleGameToku(message, args);

      // Help
      case '!help': {
        const embed = new EmbedBuilder()
          .setColor(0x2196f3)
          .setTitle('📖 Daftar Command Nova Bot')
          .addFields(
            { name: '🎮 Gacha', value: '`!gacha` `!daily` `!inv` `!info [nama]`', inline: false },
            { name: '⚔️ Duel',  value: '`!duel @user` `!accept` `!decline`\n`!attack` `!skill` `!ultimate` `!surrender`', inline: false },
            { name: '📖 Info',  value: '`!charlist` `!charlist sentai` `!charlist kr`\n`!gametoku` — Panduan lengkap cara main', inline: false },
            { name: '🔊 AFK',   value: '`!afk`', inline: false },
          )
          .setFooter({ text: 'Ketik !gametoku untuk panduan lengkap!' });
        return message.reply({ embeds: [embed] });
      }
    }
  } catch (err) {
    console.error(`Error pada command ${cmd}:`, err);
    message.reply('❌ Terjadi error, coba lagi ya.').catch(() => {});
  }
});

// ── !gametoku ─────────────────────────────────────
async function handleGameToku(message, args) {
  const sub = args[0]?.toLowerCase();

  // !gametoku cara-main
  if (sub === 'cara-main' || sub === 'caramain' || sub === 'guide') {
    const embed = new EmbedBuilder()
      .setColor(0xe53935)
      .setTitle('📖 Cara Main — Toku Gacha & Duel')
      .addFields(
        {
          name: '1️⃣ Mulai dari !daily',
          value: 'Klaim **300 koin** gratis setiap hari. Koin dipakai buat gacha.',
          inline: false,
        },
        {
          name: '2️⃣ Gacha karakter dengan !gacha',
          value: 'Biaya **100 koin** per gacha. Cooldown **1 jam**.\nAda 4 tingkat rarity:\n🔥 Legendary (3%) • 🌟 Super Rare (12%) • 🔵 Rare (25%) • ⚪ Common (60%)',
          inline: false,
        },
        {
          name: '3️⃣ Cek koleksi dengan !inv',
          value: 'Lihat semua karakter yang kamu punya. Gunakan `!info [nama]` untuk detail stat karakter.',
          inline: false,
        },
        {
          name: '4️⃣ Tantang duel dengan !duel @user',
          value: 'Target harus punya minimal 1 karakter. Setelah diterima, **klik tombol** karakter yang mau dipakai.',
          inline: false,
        },
        {
          name: '5️⃣ Sistem duel turn-based',
          value: [
            '**!attack** 👊 — Serangan normal, damage stabil',
            '**!skill** ✨ — Skill khusus karakter, damage lebih besar (1x per duel)',
            '**!ultimate** 💀 — Serangan terkuat, damage 2x skill (1x per duel, 25% chance backfire!)',
            '**!surrender** 🏳️ — Menyerah',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🏆 Hadiah menang duel',
          value: 'Pemenang dapat **200 koin** otomatis.',
          inline: false,
        },
        {
          name: '⚠️ Tips',
          value: [
            '• Karakter Legendary/SR punya stat lebih tinggi, tapi Common tetap bisa menang kalau strategi bagus!',
            '• Ultimate punya **25% chance backfire** — damage balik ke diri sendiri setengahnya. Pakai di saat tepat!',
            '• Kumpulin karakter sebanyak mungkin buat lebih banyak pilihan saat duel.',
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter({ text: '!gametoku | !gametoku karakter | !gametoku upcoming' });
    return message.reply({ embeds: [embed] });
  }

  // !gametoku karakter
  if (sub === 'karakter' || sub === 'char') {
    const embed = new EmbedBuilder()
      .setColor(0x1565c0)
      .setTitle('🦸 Karakter Tersedia')
      .setDescription('Bot ini punya **300+ karakter** dari Super Sentai & Kamen Rider!\n\nGunakan command berikut untuk lihat daftar lengkap:')
      .addFields(
        { name: '📋 Semua karakter (ringkasan per serie)', value: '`!charlist`', inline: false },
        { name: '🔴 List karakter Super Sentai', value: '`!charlist sentai`', inline: false },
        { name: '🏍️ List karakter Kamen Rider', value: '`!charlist kr`', inline: false },
        { name: '🔍 Detail satu karakter', value: '`!info [nama karakter]`\nContoh: `!info GokaiRed` atau `!info KR Decade`', inline: false },
        {
          name: '🏆 Franchise yang ada',
          value: [
            '**Super Sentai:** Gorenger (1975) → King-Ohger (2023)',
            '**Kamen Rider:** KR 1 (1971) → KR Gavv (2024)',
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter({ text: '!gametoku upcoming — lihat karakter yang akan ditambahkan' });
    return message.reply({ embeds: [embed] });
  }

  // !gametoku upcoming
  if (sub === 'upcoming') {
    const embed = new EmbedBuilder()
      .setColor(0x6a1b9a)
      .setTitle('🔮 Upcoming — Karakter yang Akan Ditambahkan')
      .setDescription('Berikut karakter-karakter yang direncanakan untuk ditambahkan ke bot:')
      .addFields(
        {
          name: '🏍️ Kamen Rider (Female Riders)',
          value: [
            '• **KR Femme** (Miho Kirishima) — Ryuki',
            '• **KR Larc** (Larc) — Blade',
            '• **KR Nadeshiko** — Fourze',
            '• **KR Marika** (Yoko Minato) — Gaim',
            '• **KR Poppy** (Poppy Pipopapo) — Ex-Aid',
            '• **KR Valkyrie** *(sudah ada!)*',
            '• **KR Jeanne** *(sudah ada!)*',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🏍️ Kamen Rider (Evil/Villain Riders)',
          value: [
            '• **KR Ouja** (Takeshi Asakura) — Ryuki',
            '• **KR Ryuga** (Shadow Shinji) — Ryuki',
            '• **KR Tiger** — Ryuki',
            '• **KR Alternative** — Ryuki',
            '• **KR Glaive** — Blade',
            '• **KR Dark Kabuto** — Kabuto',
            '• **KR Dark Wing** — Kiva',
            '• **KR Eternal** (Katsumi Daido) — W',
            '• **KR Poseidon** — OOO',
            '• **KR Duke** (Ryoma Sengoku) — Gaim',
          ].join('\n'),
          inline: false,
        },
        {
          name: '🦸 Super Sentai (Extra Heroes)',
          value: [
            '• **DekaBright** (Marigold Utahime) — Dekaranger',
            '• **MagiMother** (Miyuki Ozu) — Magiranger',
            '• **GoseiKnight** *(sudah ada!)*',
            '• **AbareMax** — Abaranger',
            '• **SuperShinkenRed** — Shinkenger',
            '• **OhBlocker** — Ohranger',
            '• **GaoKnight** — Gaoranger',
          ].join('\n'),
          inline: false,
        },
        {
          name: '✨ Special / Crossover',
          value: [
            '• **Kamen Rider × Super Sentai** crossover chars',
            '• **KR Super-1** *(sudah ada!)*',
            '• **Amazon Alpha / Omega** — Amazons',
            '• **KR Brain** — Zero-One',
            '• **KR Ark-One** — Zero-One',
          ].join('\n'),
          inline: false,
        },
      )
      .setFooter({ text: 'Update karakter dilakukan secara berkala oleh admin server!' });
    return message.reply({ embeds: [embed] });
  }

  // Default: !gametoku (halaman utama)
  const embed = new EmbedBuilder()
    .setColor(0xf57f17)
    .setTitle('🎮 TOKU GACHA & DUEL — Game Guide')
    .setDescription(
      'Selamat datang di **Toku Gacha Bot**!\n' +
      'Kumpulkan karakter **Super Sentai** & **Kamen Rider**, lalu duel dengan member lain!\n\n' +
      '**Pilih panduan yang mau kamu lihat:**'
    )
    .addFields(
      { name: '📖 Cara Main',         value: '`!gametoku cara-main`\nPanduan lengkap dari awal sampai bisa duel', inline: false },
      { name: '🦸 Karakter',          value: '`!gametoku karakter`\nInfo karakter yang tersedia + cara cek list', inline: false },
      { name: '🔮 Upcoming',          value: '`!gametoku upcoming`\nKarakter yang akan ditambahkan berikutnya', inline: false },
      { name: '📋 Command Lengkap',   value: '`!help`', inline: false },
    )
    .setFooter({ text: 'Nova Bot — Toku Gacha & Duel System' });
  return message.reply({ embeds: [embed] });
}

client.login(process.env.TOKEN);