    const { EmbedBuilder } = require('discord.js');
const db = require('../database');

const GACHA_COST     = 100;
const GACHA_COOLDOWN = 60 * 60 * 1000;     // 1 jam
const DAILY_COINS    = 300;
const DAILY_COOLDOWN = 24 * 60 * 60 * 1000; // 24 jam

const RARITY_COLOR = {
  'Common':     0x9e9e9e,
  'Rare':       0x2196f3,
  'Super Rare': 0xffc107,
  'Legendary':  0xff5722,
};

const RARITY_EMOJI = {
  'Common':     '⚪',
  'Rare':       '🔵',
  'Super Rare': '🌟',
  'Legendary':  '🔥',
};

async function handleGacha(message) {
  const userId = message.author.id;
  const user   = db.getUser(userId);
  const now    = Date.now();

  // Cek cooldown
  const elapsed = now - user.last_gacha;
  if (elapsed < GACHA_COOLDOWN) {
    const mntLeft = Math.ceil((GACHA_COOLDOWN - elapsed) / 60000);
    return message.reply(`⏳ Cooldown gacha! Tunggu **${mntLeft} menit** lagi ya.`);
  }

  // Cek koin
  if (user.coins < GACHA_COST) {
    return message.reply(
      `💸 Koin kurang! Butuh **${GACHA_COST} koin**, kamu punya **${user.coins}**.\nKetik \`!daily\` buat klaim koin harian!`
    );
  }

  const char = db.getRandomCharacter();
  if (!char) return message.reply('❌ Gagal gacha, database kosong!');

  db.deductCoins(userId, GACHA_COST);
  db.setLastGacha(userId);
  db.addToInventory(userId, char.id);

  const updatedUser = db.getUser(userId);
  const embed = new EmbedBuilder()
    .setColor(RARITY_COLOR[char.rarity])
    .setTitle('🎰  G A C H A  R E S U L T')
    .setDescription(`${message.author} mendapatkan...`)
    .addFields(
      { name: '🦸 Karakter',                     value: `**${char.full_name}**`,               inline: false },
      { name: '📺 Series',                        value: char.series,                           inline: true  },
      { name: '🏷️ Franchise',                    value: char.franchise,                        inline: true  },
      { name: `${RARITY_EMOJI[char.rarity]} Rarity`, value: `**${char.rarity}**`,             inline: true  },
      { name: '❤️ HP',   value: `\`${char.hp}\``,   inline: true },
      { name: '⚔️ ATK',  value: `\`${char.atk}\``,  inline: true },
      { name: '🛡️ DEF',  value: `\`${char.def}\``,  inline: true },
      { name: `✨ Skill — ${char.skill_name}`, value: char.skill_desc, inline: false },
    )
    .setFooter({ text: `Sisa koin: ${updatedUser.coins} | Gacha lagi: 1 jam lagi` });

  return message.reply({ embeds: [embed] });
}

async function handleDaily(message) {
  const userId = message.author.id;
  const user   = db.getUser(userId);
  const now    = Date.now();

  const elapsed = now - user.last_daily;
  if (elapsed < DAILY_COOLDOWN) {
    const jamLeft = Math.ceil((DAILY_COOLDOWN - elapsed) / 3600000);
    return message.reply(`⏳ Daily sudah diklaim! Balik lagi **${jamLeft} jam** lagi ya.`);
  }

  db.addCoins(userId, DAILY_COINS);
  db.setLastDaily(userId);
  const updatedUser = db.getUser(userId);

  const embed = new EmbedBuilder()
    .setColor(0x4caf50)
    .setTitle('🎁 Daily Reward!')
    .setDescription(`${message.author} dapat **${DAILY_COINS} koin** hari ini!\nTotal koin: **${updatedUser.coins} 💰**`)
    .setFooter({ text: 'Balik lagi besok ya!' });

  return message.reply({ embeds: [embed] });
}

module.exports = { handleGacha, handleDaily, RARITY_COLOR, RARITY_EMOJI };