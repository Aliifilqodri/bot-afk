const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const db = require('../database');
const { RARITY_EMOJI } = require('./gacha');

// !addchar [name]|[full_name]|[franchise]|[series]|[rarity]|[hp]|[atk]|[def]|[skill_name]|[skill_desc]|[skill_multiplier]
async function handleAddChar(message, args) {
  if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return message.reply('❌ Cuma admin yang bisa pakai command ini!');
  }

  const raw = args.join(' ');
  const parts = raw.split('|').map(s => s.trim());

  if (parts.length < 11) {
    return message.reply(
      '❓ Format kurang! Gunakan:\n' +
      '`!addchar name|full_name|franchise|series|rarity|hp|atk|def|skill_name|skill_desc|skill_multiplier`\n\n' +
      '**Rarity valid:** `Common` / `Rare` / `Super Rare` / `Legendary` / `Mythic`\n' +
      '**Contoh:**\n' +
      '`!addchar KR Kabuto|Souji Tendou / KR Kabuto|Kamen Rider|Kamen Rider Kabuto|Super Rare|1010|158|105|Clock Up|Bergerak dengan kecepatan cahaya dan menghantam musuh!|2.3`'
    );
  }

  const [name, full_name, franchise, series, rarity, hp, atk, def_, skill_name, skill_desc, skill_multiplier] = parts;

  const validRarities = ['Common', 'Rare', 'Super Rare', 'Legendary', 'Mythic'];
  if (!validRarities.includes(rarity)) {
    return message.reply(`❌ Rarity tidak valid! Pilih: ${validRarities.join(', ')}`);
  }

  const charData = {
    name, full_name, franchise, series, rarity,
    hp: parseInt(hp),
    atk: parseInt(atk),
    def: parseInt(def_),
    skill_name, skill_desc,
    skill_multiplier: parseFloat(skill_multiplier),
  };

  const success = db.addCharacter(charData);
  if (!success) return message.reply(`❌ Gagal tambah karakter. Mungkin nama **${name}** sudah ada!`);

  const { RARITY_COLOR } = require('./gacha');
  const embed = new EmbedBuilder()
    .setColor(RARITY_COLOR[rarity])
    .setTitle('✅ Karakter Berhasil Ditambahkan!')
    .addFields(
      { name: '🦸 Nama',      value: full_name,   inline: false },
      { name: '📺 Series',    value: series,       inline: true  },
      { name: '🏷️ Franchise', value: franchise,   inline: true  },
      { name: `${RARITY_EMOJI[rarity]} Rarity`, value: rarity, inline: true },
      { name: '❤️ HP',        value: `${hp}`,      inline: true  },
      { name: '⚔️ ATK',       value: `${atk}`,     inline: true  },
      { name: '🛡️ DEF',       value: `${def_}`,    inline: true  },
      { name: `✨ ${skill_name}`, value: `${skill_desc} *(x${skill_multiplier})*`, inline: false },
    );

  return message.reply({ embeds: [embed] });
}

// !charlist - ringkasan per franchise
// !charlist sentai / !charlist kr - list nama per franchise
async function handleCharList(message, args) {
  const chars   = db.getAllCharacters();
  const filter  = args[0]?.toLowerCase();

  // Mode: list nama per franchise
  if (filter === 'sentai' || filter === 'kr') {
    const isSentai  = filter === 'sentai';
    const franchise = isSentai ? 'Super Sentai' : 'Kamen Rider';
    const filtered  = chars.filter(c => c.franchise === franchise);

    const groups = { 'Mythic': [], 'Legendary': [], 'Super Rare': [], 'Rare': [], 'Common': [] };
    for (const c of filtered) {
      if (groups[c.rarity]) groups[c.rarity].push(c.name);
    }

    // Kirim satu embed per rarity biar rapi
    for (const [rarity, names] of Object.entries(groups)) {
      if (names.length === 0) continue;
      // Bagi per 20 nama biar gak penuh
      const rows = [];
      for (let i = 0; i < names.length; i += 5) {
        rows.push(names.slice(i, i + 5).join(' • '));
      }
      const embed = new EmbedBuilder()
        .setColor(RARITY_COLOR[rarity])
        .setTitle(`${RARITY_EMOJI[rarity]} ${franchise} — ${rarity} (${names.length})`)
        .setDescription(rows.join('\n'));
      await message.channel.send({ embeds: [embed] });
      await new Promise(r => setTimeout(r, 400));
    }
    return;
  }

  // Mode default: ringkasan per serie
  const serieCount = {};
  const serieFranchise = {};
  const serieRarity = {};
  for (const c of chars) {
    if (!serieCount[c.series]) {
      serieCount[c.series]     = 0;
      serieFranchise[c.series] = c.franchise;
      serieRarity[c.series]    = { Mythic:0, Legendary:0, 'Super Rare':0, Rare:0, Common:0 };
    }
    serieCount[c.series]++;
    serieRarity[c.series][c.rarity]++;
  }

  const sentaiSeries = Object.entries(serieCount)
    .filter(([s]) => serieFranchise[s] === 'Super Sentai')
    .sort((a, b) => b[1] - a[1]);

  const krSeries = Object.entries(serieCount)
    .filter(([s]) => serieFranchise[s] === 'Kamen Rider')
    .sort((a, b) => b[1] - a[1]);

  function makeRows(seriesList) {
    return seriesList.map(([serie, count]) => {
      const r = serieRarity[serie];
      const badges = [
        r['Mythic']      ? `🌈${r['Mythic']}`      : '',
        r['Legendary']   ? `🔥${r['Legendary']}`   : '',
        r['Super Rare']  ? `🌟${r['Super Rare']}`  : '',
        r['Rare']        ? `🔵${r['Rare']}`         : '',
        r['Common']      ? `⚪${r['Common']}`       : '',
      ].filter(Boolean).join(' ');
      // Potong nama serie kalau kepanjangan
      const shortName = serie.replace('Himitsu Sentai ','').replace('Choujin Sentai ','')
        .replace('Kyoryu Sentai ','').replace('Ninja Sentai ','').replace('Tokusou Sentai ','')
        .replace('Mahou Sentai ','').replace('GoGo Sentai ','').replace('Juken Sentai ','')
        .replace('Engine Sentai ','').replace('Kaizoku Sentai ','').replace('Zyuden Sentai ','')
        .replace('Ressha Sentai ','').replace('Shuriken Sentai ','').replace('Uchu Sentai ','')
        .replace('Kikai Sentai ','').replace('Avataro Sentai ','').replace('Ohsama Sentai ','')
        .replace('Kamen Rider ','KR ');
      return `\`${String(count).padStart(2,'0')}\` **${shortName}** — ${badges}`;
    }).join('\n');
  }

  // Super Sentai embed
  const sentaiEmbed = new EmbedBuilder()
    .setColor(0xe53935)
    .setTitle('🦸 Super Sentai — Ringkasan Serie')
    .setDescription(makeRows(sentaiSeries) || '-')
    .setFooter({ text: `Total Sentai: ${sentaiSeries.reduce((a,[,v])=>a+v,0)} karakter` });

  // Kamen Rider embed
  const krEmbed = new EmbedBuilder()
    .setColor(0x1e88e5)
    .setTitle('🏍️ Kamen Rider — Ringkasan Serie')
    .setDescription(makeRows(krSeries) || '-')
    .setFooter({ text: `Total KR: ${krSeries.reduce((a,[,v])=>a+v,0)} karakter` });

  // Summary embed
  const totalMythic     = chars.filter(c => c.rarity === 'Mythic').length;
  const totalLegendary  = chars.filter(c => c.rarity === 'Legendary').length;
  const totalSR         = chars.filter(c => c.rarity === 'Super Rare').length;
  const totalRare       = chars.filter(c => c.rarity === 'Rare').length;
  const totalCommon     = chars.filter(c => c.rarity === 'Common').length;

  const summaryEmbed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle(`📊 Total Karakter: ${chars.length}`)
    .addFields(
      { name: '🌈 Mythic',     value: `${totalMythic} karakter`,    inline: true },
      { name: '🔥 Legendary',  value: `${totalLegendary} karakter`,  inline: true },
      { name: '🌟 Super Rare', value: `${totalSR} karakter`,         inline: true },
      { name: '🔵 Rare',       value: `${totalRare} karakter`,       inline: true },
      { name: '⚪ Common',      value: `${totalCommon} karakter`,     inline: true },
    )
    .setFooter({ text: '!charlist sentai — list nama Sentai | !charlist kr — list nama KR' });

  await message.channel.send({ embeds: [summaryEmbed] });
  await new Promise(r => setTimeout(r, 300));
  await message.channel.send({ embeds: [sentaiEmbed] });
  await new Promise(r => setTimeout(r, 300));
  await message.channel.send({ embeds: [krEmbed] });
}



// !broadcast #channel
async function handleBroadcast(message, args) {
  if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return message.reply('❌ Cuma admin yang bisa pakai command ini!');
  }

  const target = message.mentions.channels.first();
  if (!target) {
    return message.reply('❓ Tag channel tujuan! Contoh: `!broadcast #general`');
  }

  const embed = new EmbedBuilder()
    .setColor(0x7c4dff)
    .setTitle('🤖 Nova Bot — Sekarang Ada di Server Ini!')
    .setDescription(
      `Halo **${message.guild.name}**! 👋\n\n` +
      `Bot ini punya sistem **Gacha + Duel** karakter **Super Sentai** & **Kamen Rider**!\n` +
      `Ada **300+ karakter** dari era klasik sampai terbaru. Yuk cobain!`
    )
    .addFields(
      {
        name: '🎰 Gacha & Koleksi',
        value: [
          '`!daily` — Klaim **300 koin** harian',
          '`!gacha` — Tarik karakter (**100 koin**, cooldown 1 jam)',
          '`!inv` — Lihat koleksi karakter kamu',
          '`!info [nama]` — Detail karakter',
        ].join('\n'),
        inline: false,
      },
      {
        name: '⚔️ Duel',
        value: [
          '`!duel @user` — Tantang duel',
          '`!accept` / `!decline` — Terima/tolak tantangan',
          '`!pick [nama]` — Pilih karakter saat duel',
          '`!attack` — Serang normal',
          '`!skill` — Gunakan skill khusus *(1x per duel)*',
        ].join('\n'),
        inline: false,
      },
      {
        name: '📋 Info',
        value: [
          '`!charlist` — Lihat semua karakter tersedia',
          '`!charlist sentai` — List karakter Sentai',
          '`!charlist kr` — List karakter Kamen Rider',
          '`!help` — Semua command',
        ].join('\n'),
        inline: false,
      },
      {
        name: '🏆 Rarity',
        value: '🌈 Mythic • 🔥 Legendary • 🌟 Super Rare • 🔵 Rare • ⚪ Common',
        inline: false,
      },
    )
    .setFooter({ text: 'Ketik !daily sekarang buat mulai kumpulin koin!' })
    .setTimestamp();

  try {
    await target.send({ embeds: [embed] });
    return message.reply(`✅ Pesan berhasil dikirim ke ${target}!`);
  } catch (err) {
    return message.reply(`❌ Gagal kirim ke ${target}. Pastikan bot punya izin kirim pesan di channel itu.`);
  }
}

// !setchannel gacha-log #channel
async function handleSetChannel(message, args) {
  if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return message.reply('❌ Cuma admin yang bisa pakai command ini!');
  }

  const type    = args[0]?.toLowerCase();
  const channel = message.mentions.channels.first();

  if (!type || !channel) {
    return message.reply(
      '❓ Format: `!setchannel [tipe] #channel`\n' +
      'Tipe yang tersedia:\n' +
      '• `gacha-log` — channel notif hasil pull gacha\n\n' +
      'Contoh: `!setchannel gacha-log #gacha-notif`'
    );
  }

  const validTypes = { 'gacha-log': 'gacha_log_channel' };
  const dbKey = validTypes[type];
  if (!dbKey) {
    return message.reply(`❌ Tipe **${type}** tidak dikenal. Pilihan: \`gacha-log\``);
  }

  db.setSetting(message.guild.id, dbKey, channel.id);

  const embed = new EmbedBuilder()
    .setColor(0x4caf50)
    .setTitle('✅ Channel Berhasil Di-set!')
    .addFields(
      { name: 'Tipe',    value: type,            inline: true },
      { name: 'Channel', value: `${channel}`,    inline: true },
    )
    .setDescription(`Sekarang setiap ada yang gacha, notif otomatis dikirim ke ${channel}!`);

  return message.reply({ embeds: [embed] });
}

module.exports = { handleAddChar, handleCharList, handleBroadcast, handleSetChannel };