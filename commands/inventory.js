const { EmbedBuilder } = require('discord.js');
const db = require('../database');
const { RARITY_EMOJI } = require('./gacha');

async function handleInventory(message) {
  const userId = message.author.id;
  const cards  = db.getInventory(userId);

  if (cards.length === 0) {
    return message.reply('📦 Inventori kamu kosong! Ketik `!gacha` buat narik karakter pertama.');
  }

  // Kelompokkan per rarity
  const groups = {
    'Legendary': [],
    'Super Rare': [],
    'Rare': [],
    'Common': [],
  };
  for (const c of cards) {
    if (groups[c.rarity]) groups[c.rarity].push(c.name);
  }

  const fields = [];
  for (const [rarity, names] of Object.entries(groups)) {
    if (names.length === 0) continue;
    fields.push({
      name: `${RARITY_EMOJI[rarity]} ${rarity} (${names.length})`,
      value: names.join(', '),
      inline: false,
    });
  }

  const user = db.getUser(userId);
  const embed = new EmbedBuilder()
    .setColor(0x7e57c2)
    .setTitle(`📦 Inventori — ${message.author.username}`)
    .addFields(fields)
    .setFooter({ text: `Total kartu: ${cards.length} | Koin: ${user.coins} 💰` });

  return message.reply({ embeds: [embed] });
}

async function handleCardInfo(message, args) {
  if (!args[0]) return message.reply('❓ Ketik nama karakter. Contoh: `!info GokaiRed`');

  const name = args.join(' ');
  const char = db.getCharacterByName(name);
  if (!char) return message.reply(`❌ Karakter **${name}** gak ditemukan.`);

  const { RARITY_COLOR } = require('./gacha');
  const embed = new EmbedBuilder()
    .setColor(RARITY_COLOR[char.rarity])
    .setTitle(`${RARITY_EMOJI[char.rarity]} ${char.full_name}`)
    .addFields(
      { name: '📺 Series',    value: char.series,    inline: true },
      { name: '🏷️ Franchise', value: char.franchise, inline: true },
      { name: `${RARITY_EMOJI[char.rarity]} Rarity`, value: char.rarity, inline: true },
      { name: '❤️ HP',   value: `\`${char.hp}\``,   inline: true },
      { name: '⚔️ ATK',  value: `\`${char.atk}\``,  inline: true },
      { name: '🛡️ DEF',  value: `\`${char.def}\``,  inline: true },
      { name: `✨ Skill — ${char.skill_name}`, value: `${char.skill_desc}\n**Multiplier: x${char.skill_multiplier}**`, inline: false },
    );

  return message.reply({ embeds: [embed] });
}

module.exports = { handleInventory, handleCardInfo };