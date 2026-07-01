const { EmbedBuilder } = require('discord.js');
const db = require('../database');
const { RARITY_EMOJI, RARITY_COLOR } = require('./gacha');

const pendingDuels = new Map();
const activeDuels  = new Map();

// ── Animasi cutscene ──────────────────────────────
async function sendCutscene(channel, lines, delayMs = 900) {
  for (const line of lines) {
    await channel.send(line);
    await new Promise(r => setTimeout(r, delayMs));
  }
}

function hpBar(current, max) {
  const pct    = Math.max(0, current / max);
  const filled = Math.round(pct * 10);
  const empty  = 10 - filled;
  const color  = pct > 0.5 ? '🟩' : pct > 0.25 ? '🟨' : '🟥';
  return `${color.repeat(filled)}⬛`.repeat(0) + `${color.repeat(filled)}${'⬛'.repeat(empty)} **${current}/${max}**`;
}

function calcDamage(atk, def) {
  const base     = Math.max(1, atk - Math.floor(def * 0.4));
  const variance = Math.floor(base * 0.2);
  return base + Math.floor(Math.random() * variance * 2) - variance;
}

function attackAnimation(attackerName, charName) {
  const anims = [
    [`⚡ *${attackerName} bersiap...*`, `💨 **${charName}** melompat maju!`, `💥 **SMASH!!**`],
    [`🌀 *${attackerName} mengumpulkan energi...*`, `🔥 **${charName}** menyerang!`, `💥 **HIT!!**`],
    [`👊 *${attackerName} mengambil ancang-ancang...*`, `⚡ **${charName}** menghantam!`, `💢 **CRASH!!**`],
    [`🏃 *${attackerName} berlari kencang...*`, `🌟 **${charName}** melancarkan serangan!`, `💥 **BANG!!**`],
  ];
  return anims[Math.floor(Math.random() * anims.length)];
}

function skillAnimation(attackerName, charName, skillName) {
  return [
    `🎬 *${attackerName} mengambil kuda-kuda...*`,
    `✨ **"${skillName.toUpperCase()}!!"**`,
    `🌈 *Energi meledak dari tubuh ${charName}!*`,
    `💥💥💥 **FINISHER!!!** 💥💥💥`,
  ];
}

function ultimateAnimation(attackerName, charName) {
  return [
    `⚠️ *${attackerName} diam sejenak...*`,
    `🌑 *Kegelapan menyelimuti arena...*`,
    `⚡⚡⚡ *KEKUATAN ULTIMATE TERBANGKIT!!* ⚡⚡⚡`,
    `🔥💀 **${charName.toUpperCase()} — U L T I M A T E!!!** 💀🔥`,
  ];
}

// ── !duel @user ───────────────────────────────────
async function handleDuel(message) {
  const challenger = message.author;
  const target     = message.mentions.users.first();

  if (!target)                         return message.reply('❓ Tag siapa yang mau diduel! Contoh: `!duel @user`');
  if (target.id === challenger.id)     return message.reply('😅 Masa duel sendiri?');
  if (target.bot)                      return message.reply('🤖 Gak bisa duel sama bot!');
  if (activeDuels.has(challenger.id))  return message.reply('⚔️ Kamu masih dalam duel!');
  if (activeDuels.has(target.id))      return message.reply('⚔️ Target kamu lagi dalam duel lain!');
  if (pendingDuels.has(challenger.id)) return message.reply('⏳ Kamu sudah ada challenge yang pending!');

  const challengerCards = db.getInventory(challenger.id);
  const targetCards     = db.getInventory(target.id);
  if (challengerCards.length === 0) return message.reply('📦 Inventori kamu kosong! Gacha dulu.');
  if (targetCards.length === 0)     return message.reply(`📦 Inventori ${target.username} kosong, gak bisa duel.`);

  pendingDuels.set(challenger.id, { targetId: target.id, channelId: message.channel.id });

  await sendCutscene(message.channel, [
    `🎺 *Suara trompet kemenangan bergema...*`,
    `⚔️ **${challenger.username}** menantang **${target.username}** untuk DUEL!`,
    `${target} — ketik **\`!accept\`** untuk menerima atau **\`!decline\`** untuk menolak! *(60 detik)*`,
  ], 800);

  setTimeout(() => {
    if (pendingDuels.has(challenger.id)) {
      pendingDuels.delete(challenger.id);
      message.channel.send(`⏰ Challenge dari **${challenger.username}** sudah expired.`).catch(() => {});
    }
  }, 60000);
}

// ── !accept ───────────────────────────────────────
async function handleAccept(message) {
  const userId = message.author.id;
  let challengerId = null;
  for (const [cId, data] of pendingDuels.entries()) {
    if (data.targetId === userId && data.channelId === message.channel.id) {
      challengerId = cId;
      break;
    }
  }
  if (!challengerId) return message.reply('❓ Gak ada challenge buat kamu di channel ini.');

  pendingDuels.delete(challengerId);
  const challenger = await message.guild.members.fetch(challengerId);

  const session = {
    channelId: message.channel.id,
    players: {
      [challengerId]: { userId: challengerId, username: challenger.user.username, char: null, hp: 0, maxHp: 0, skillUsed: false, ultimateUsed: false },
      [userId]:       { userId, username: message.author.username, char: null, hp: 0, maxHp: 0, skillUsed: false, ultimateUsed: false },
    },
    turnOrder: [challengerId, userId],
    currentTurn: 0,
    picking: true,
    picked: {},
  };

  activeDuels.set(challengerId, session);
  activeDuels.set(userId, session);

  await sendCutscene(message.channel, [
    `✅ **${message.author.username}** menerima tantangan!`,
    `🥊 **${challenger.user.username}** VS **${message.author.username}**`,
    `📦 Keduanya — ketik **\`!pick [nama karakter]\`** untuk memilih!`,
    `Contoh: \`!pick GokaiRed\` atau \`!pick KR Decade\` | Lihat koleksi: \`!inv\``,
  ], 700);
}

// ── !decline ──────────────────────────────────────
async function handleDecline(message) {
  const userId = message.author.id;
  let challengerId = null;
  for (const [cId, data] of pendingDuels.entries()) {
    if (data.targetId === userId) { challengerId = cId; break; }
  }
  if (!challengerId) return;
  pendingDuels.delete(challengerId);
  return message.reply('❌ Challenge ditolak.');
}

// ── !pick ─────────────────────────────────────────
async function handlePick(message, args) {
  const userId  = message.author.id;
  const session = activeDuels.get(userId);
  if (!session || !session.picking) return message.reply('❓ Kamu gak lagi dalam fase pilih karakter.');
  if (session.picked[userId])        return message.reply('✅ Kamu sudah memilih karakter!');

  const name = args.join(' ');
  if (!name) return message.reply('❓ Tulis nama karakter. Contoh: `!pick GokaiRed`');

  const char = db.getUserCharacterByName(userId, name);
  if (!char) return message.reply(`❌ **${name}** gak ada di inventori kamu.\nKetik \`!inv\` buat lihat koleksi.`);

  session.picked[userId]        = true;
  session.players[userId].char  = char;
  session.players[userId].hp    = char.hp;
  session.players[userId].maxHp = char.hp;

  await message.reply(`✅ **${message.author.username}** memilih **${char.full_name}** ${RARITY_EMOJI[char.rarity]}!`);

  const bothPicked = Object.values(session.players).every(p => p.char !== null);
  if (bothPicked) {
    session.picking = false;
    await startDuel(message.channel, session);
  }
}

async function startDuel(channel, session) {
  const [p1, p2] = Object.values(session.players);

  await sendCutscene(channel, [
    `🎬 **═══════════ DUEL DIMULAI! ═══════════**`,
    `🔴 **${p1.username}** → ${RARITY_EMOJI[p1.char.rarity]} **${p1.char.full_name}**`,
    `🆚`,
    `🔵 **${p2.username}** → ${RARITY_EMOJI[p2.char.rarity]} **${p2.char.full_name}**`,
    `**═══════════════════════════════**`,
  ], 600);

  const embed = new EmbedBuilder()
    .setColor(0xf44336)
    .setTitle('⚔️ STATUS AWAL DUEL')
    .addFields(
      { name: `🔴 ${p1.username} — ${p1.char.name}`, value: `❤️ ${hpBar(p1.hp, p1.maxHp)}\n⚔️ ATK: **${p1.char.atk}** | 🛡️ DEF: **${p1.char.def}**\n✨ Skill: **${p1.char.skill_name}**`, inline: false },
      { name: `🔵 ${p2.username} — ${p2.char.name}`, value: `❤️ ${hpBar(p2.hp, p2.maxHp)}\n⚔️ ATK: **${p2.char.atk}** | 🛡️ DEF: **${p2.char.def}**\n✨ Skill: **${p2.char.skill_name}**`, inline: false },
    )
    .setFooter({ text: 'Perintah: !attack | !skill (1x) | !ultimate (1x, high risk!) | !surrender' });

  await channel.send({ embeds: [embed] });
  await new Promise(r => setTimeout(r, 1000));
  await promptTurn(channel, session);
}

async function promptTurn(channel, session) {
  const currentId = session.turnOrder[session.currentTurn % 2];
  const current   = session.players[currentId];
  const skillNote    = current.skillUsed    ? '~~!skill~~'    : '**!skill** ✨';
  const ultimateNote = current.ultimateUsed ? '~~!ultimate~~' : '**!ultimate** 💀';

  // Auto-end kalau turn udah kebanyakan (lebih dari 30 turn)
  if (session.currentTurn >= 30) {
    const [p1, p2]  = Object.values(session.players);
    const winnerId  = p1.hp >= p2.hp ? p1.userId : p2.userId;
    const loserId   = p1.hp >= p2.hp ? p2.userId : p1.userId;
    await channel.send(`⏱️ *Duel sudah terlalu lama! Pemenang ditentukan dari sisa HP...*`);
    return endDuel(channel, session, winnerId, loserId);
  }

  await channel.send(
    `🎮 Giliran **${current.username}** (**${current.char.name}**) — Turn ${session.currentTurn + 1}\n` +
    `→ **!attack** 👊 | ${skillNote} | ${ultimateNote} | **!surrender** 🏳️`
  );
}

// ── !attack ───────────────────────────────────────
async function handleAttack(message) {
  const userId  = message.author.id;
  const session = activeDuels.get(userId);
  if (!session || session.picking) return;
  if (session.turnOrder[session.currentTurn % 2] !== userId) return message.reply('⏳ Bukan giliran kamu!');

  const attacker   = session.players[userId];
  const defenderId = session.turnOrder.find(id => id !== userId);
  const defender   = session.players[defenderId];

  // Animasi serangan
  await sendCutscene(message.channel, attackAnimation(attacker.username, attacker.char.name), 700);

  const dmg = calcDamage(attacker.char.atk, defender.char.def);
  defender.hp = Math.max(0, defender.hp - dmg);
  session.currentTurn++;

  const embed = new EmbedBuilder()
    .setColor(0xff9800)
    .setTitle('👊 Serangan Normal!')
    .addFields(
      { name: `🔴 ${attacker.username}`, value: `❤️ ${hpBar(attacker.hp, attacker.maxHp)}`, inline: true },
      { name: `🔵 ${defender.username}`, value: `❤️ ${hpBar(defender.hp, defender.maxHp)}\n*-${dmg} HP!*`, inline: true },
    );

  await message.channel.send({ embeds: [embed] });

  if (defender.hp <= 0) return endDuel(message.channel, session, userId, defenderId);
  await new Promise(r => setTimeout(r, 500));
  await promptTurn(message.channel, session);
}

// ── !skill ────────────────────────────────────────
async function handleSkill(message) {
  const userId  = message.author.id;
  const session = activeDuels.get(userId);
  if (!session || session.picking) return;
  if (session.turnOrder[session.currentTurn % 2] !== userId) return message.reply('⏳ Bukan giliran kamu!');

  const attacker = session.players[userId];
  if (attacker.skillUsed) return message.reply('❌ Skill sudah dipakai! Gunakan `!attack`.');

  const defenderId = session.turnOrder.find(id => id !== userId);
  const defender   = session.players[defenderId];

  // Animasi skill — lebih dramatis
  await sendCutscene(message.channel, skillAnimation(attacker.username, attacker.char.name, attacker.char.skill_name), 750);

  const baseDmg  = calcDamage(attacker.char.atk, defender.char.def);
  const skillDmg = Math.floor(baseDmg * attacker.char.skill_multiplier);
  defender.hp    = Math.max(0, defender.hp - skillDmg);
  attacker.skillUsed = true;
  session.currentTurn++;

  const embed = new EmbedBuilder()
    .setColor(0x9c27b0)
    .setTitle(`✨ SKILL: ${attacker.char.skill_name}!`)
    .setDescription(`*${attacker.char.skill_desc}*`)
    .addFields(
      { name: `🔴 ${attacker.username}`, value: `❤️ ${hpBar(attacker.hp, attacker.maxHp)}`, inline: true },
      { name: `🔵 ${defender.username}`, value: `❤️ ${hpBar(defender.hp, defender.maxHp)}\n*-${skillDmg} HP! (x${attacker.char.skill_multiplier})*`, inline: true },
    );

  await message.channel.send({ embeds: [embed] });

  if (defender.hp <= 0) return endDuel(message.channel, session, userId, defenderId);
  await new Promise(r => setTimeout(r, 500));
  await promptTurn(message.channel, session);
}

// ── !ultimate ─────────────────────────────────────
async function handleUltimate(message) {
  const userId  = message.author.id;
  const session = activeDuels.get(userId);
  if (!session || session.picking) return;
  if (session.turnOrder[session.currentTurn % 2] !== userId) return message.reply('⏳ Bukan giliran kamu!');

  const attacker = session.players[userId];
  if (attacker.ultimateUsed) return message.reply('❌ Ultimate sudah dipakai! Hanya bisa sekali per duel.');

  const defenderId = session.turnOrder.find(id => id !== userId);
  const defender   = session.players[defenderId];

  await sendCutscene(message.channel, ultimateAnimation(attacker.username, attacker.char.name), 800);

  // Ultimate: damage sangat besar TAPI ada chance 25% backfire (balik ke diri sendiri)
  const roll      = Math.random();
  const isBackfire = roll < 0.25;
  const baseDmg   = calcDamage(attacker.char.atk, defender.char.def);
  const ultDmg    = Math.floor(baseDmg * attacker.char.skill_multiplier * 2.0);

  attacker.ultimateUsed = true;
  session.currentTurn++;

  if (isBackfire) {
    // Backfire — kena diri sendiri separuh damage
    const selfDmg = Math.floor(ultDmg * 0.5);
    attacker.hp = Math.max(0, attacker.hp - selfDmg);

    await message.channel.send(`💥 **BACKFIRE!!** Serangan ultimate **${attacker.char.name}** berbalik!\n**-${selfDmg} HP** ke **${attacker.username}** sendiri! 😱`);

    const embed = new EmbedBuilder()
      .setColor(0xff1744)
      .setTitle('💀 ULTIMATE — BACKFIRE!')
      .addFields(
        { name: `🔴 ${attacker.username}`, value: `❤️ ${hpBar(attacker.hp, attacker.maxHp)}\n*-${selfDmg} HP (backfire!)*`, inline: true },
        { name: `🔵 ${defender.username}`, value: `❤️ ${hpBar(defender.hp, defender.maxHp)}`, inline: true },
      );
    await message.channel.send({ embeds: [embed] });

    if (attacker.hp <= 0) return endDuel(message.channel, session, defenderId, userId);
  } else {
    // Hit normal
    defender.hp = Math.max(0, defender.hp - ultDmg);

    const embed = new EmbedBuilder()
      .setColor(0x000000)
      .setTitle('💀 ULTIMATE HIT!')
      .addFields(
        { name: `🔴 ${attacker.username}`, value: `❤️ ${hpBar(attacker.hp, attacker.maxHp)}`, inline: true },
        { name: `🔵 ${defender.username}`, value: `❤️ ${hpBar(defender.hp, defender.maxHp)}\n*-${ultDmg} HP!!!*`, inline: true },
      );
    await message.channel.send({ embeds: [embed] });

    if (defender.hp <= 0) return endDuel(message.channel, session, userId, defenderId);
  }

  await new Promise(r => setTimeout(r, 500));
  await promptTurn(message.channel, session);
}

// ── !surrender ────────────────────────────────────
async function handleSurrender(message) {
  const userId  = message.author.id;
  const session = activeDuels.get(userId);
  if (!session || session.picking) return message.reply('❓ Kamu gak lagi dalam duel.');

  const defenderId = session.turnOrder.find(id => id !== userId);
  await message.channel.send(`🏳️ **${message.author.username}** menyerah!`);
  return endDuel(message.channel, session, defenderId, userId);
}

async function endDuel(channel, session, winnerId, loserId) {
  const winner = session.players[winnerId];
  const loser  = session.players[loserId];

  activeDuels.delete(winnerId);
  activeDuels.delete(loserId);

  const REWARD = 200;
  db.addCoins(winnerId, REWARD);

  await sendCutscene(channel, [
    `💥 **${loser.char.name}** jatuh tersungkur!`,
    `🌟 **${winner.char.name}** berdiri tegak sebagai pemenang!`,
    `🏆 **${winner.username} MENANG!!!** 🏆`,
  ], 900);

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle('🏆 DUEL SELESAI!')
    .setDescription(
      `**${winner.username}** (${winner.char.name}) **MENANG!** ${RARITY_EMOJI[winner.char.rarity]}\n` +
      `**${loser.username}** (${loser.char.name}) kalah!\n\n` +
      `🎉 **+${REWARD} koin** untuk **${winner.username}**!`
    );

  return channel.send({ embeds: [embed] });
}

module.exports = { handleDuel, handleAccept, handleDecline, handlePick, handleAttack, handleSkill, handleUltimate, handleSurrender };