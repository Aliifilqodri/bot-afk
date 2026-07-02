const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database');
const { RARITY_EMOJI, RARITY_COLOR } = require('./gacha');

const pendingDuels = new Map();
const activeDuels  = new Map();

const SEAT_COLOR = { red: 0xf44336, blue: 0x2196f3 };
const SEAT_EMOJI = { red: '🔴', blue: '🔵' };

function combatButtons(userId, skillUsed, ultimateUsed) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`duel_attack_${userId}`).setLabel('Attack').setEmoji('👊').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`duel_skill_${userId}`).setLabel('Skill').setEmoji('✨').setStyle(ButtonStyle.Success).setDisabled(skillUsed),
    new ButtonBuilder().setCustomId(`duel_ultimate_${userId}`).setLabel('Ultimate').setEmoji('💀').setStyle(ButtonStyle.Danger).setDisabled(ultimateUsed),
    new ButtonBuilder().setCustomId(`duel_surrender_${userId}`).setLabel('Surrender').setEmoji('🏳️').setStyle(ButtonStyle.Secondary),
  );
}

// Wrapper aman buat respond ke interaction — gak pernah throw walau
// interaction-nya udah expired/kejawab duluan (misal karena bot restart
// pas ada dropdown/tombol lama yang masih nongol di Discord)
async function safeReply(interaction, payload) {
  try {
    if (!interaction.isRepliable()) return;
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (err) {
    console.error('[interaction] Gagal reply (kemungkinan interaction expired):', err.message);
  }
}

async function safeUpdate(interaction, payload) {
  try {
    if (!interaction.isRepliable()) return;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
    } else {
      await interaction.update(payload);
    }
  } catch (err) {
    console.error('[interaction] Gagal update (kemungkinan interaction expired):', err.message);
  }
}

// Matiin tombol di pesan giliran sebelumnya biar gak bisa diklik dobel/telat
async function clearPrompt(session) {
  if (session.lastPromptMessage) {
    await session.lastPromptMessage.edit({ components: [] }).catch(() => {});
    session.lastPromptMessage = null;
  }
}

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
  return `${color.repeat(filled)}${'⬛'.repeat(empty)} **${current}/${max}**`;
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
      [challengerId]: {
        userId: challengerId, username: challenger.user.username,
        avatar: challenger.user.displayAvatarURL({ size: 128 }),
        seat: 'red', char: null, hp: 0, maxHp: 0, skillUsed: false, ultimateUsed: false,
      },
      [userId]: {
        userId, username: message.author.username,
        avatar: message.author.displayAvatarURL({ size: 128 }),
        seat: 'blue', char: null, hp: 0, maxHp: 0, skillUsed: false, ultimateUsed: false,
      },
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
  ], 700);

  await sendPickMenus(message.channel, session);
}

// ── Kirim dropdown pilih karakter (tap, gak perlu ketik) ──
const MAX_MENU_OPTIONS = 25; // batas Discord select menu

async function sendPickMenus(channel, session) {
  for (const [uid, player] of Object.entries(session.players)) {
    const cards = db.getInventory(uid);

    if (cards.length === 0) continue; // seharusnya gak terjadi (sudah dicek di !duel)

    if (cards.length > MAX_MENU_OPTIONS) {
      // Koleksi kebanyakan buat 1 dropdown — fallback ke !pick manual
      await channel.send(
        `📦 **${player.username}**, koleksi kamu lebih dari ${MAX_MENU_OPTIONS} kartu, ` +
        `ketik **\`!pick [nama karakter]\`** buat pilih. Lihat koleksi: \`!inv\``
      );
      continue;
    }

    const nameCount = {};
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`pick_${uid}`)
      .setPlaceholder(`${player.username} — pilih karaktermu...`)
      .addOptions(
        cards.map((c) => {
          nameCount[c.id] = (nameCount[c.id] || 0) + 1;
          const dupeSuffix = nameCount[c.id] > 1 ? ` (#${nameCount[c.id]})` : '';
          return {
            label: `${c.full_name?.slice(0, 95) || c.name}${dupeSuffix}`,
            description: `${c.rarity} • ATK ${c.atk} / DEF ${c.def} / HP ${c.hp}`.slice(0, 100),
            value: String(c.inv_id),
            emoji: RARITY_EMOJI[c.rarity],
          };
        })
      );

    const row = new ActionRowBuilder().addComponents(menu);

    const embed = new EmbedBuilder()
      .setColor(SEAT_COLOR[player.seat])
      .setAuthor({ name: player.username, iconURL: player.avatar })
      .setTitle(`${SEAT_EMOJI[player.seat]} Pilih karaktermu`)
      .setDescription(`Punya **${cards.length}** kartu di koleksi. Pilih lewat dropdown di bawah ⬇️`)
      .setThumbnail(player.avatar)
      .setFooter({ text: 'Cuma kamu yang bisa milih di dropdown ini' });

    await channel.send({ embeds: [embed], components: [row] });
  }
}

// ── Handler dropdown pick (interactionCreate) ──────
async function handlePickSelect(interaction) {
  const [, ownerId] = interaction.customId.split('_'); // "pick_<userId>"

  if (interaction.user.id !== ownerId) {
    return safeReply(interaction, { content: '❌ Ini bukan pilihan kartu kamu!', ephemeral: true });
  }

  const session = activeDuels.get(ownerId);
  if (!session || !session.picking) {
    return safeUpdate(interaction, { content: '❓ Duel ini udah gak aktif lagi (mungkin bot sempet restart). Coba `!duel` baru ya.', embeds: [], components: [] });
  }
  if (session.picked[ownerId]) {
    return safeReply(interaction, { content: '✅ Kamu sudah memilih karakter!', ephemeral: true });
  }

  const invId = Number(interaction.values[0]);
  const cards  = db.getInventory(ownerId);
  const char   = cards.find((c) => c.inv_id === invId);
  if (!char) {
    return safeReply(interaction, { content: '❌ Karakter gak ditemukan di koleksi kamu.', ephemeral: true });
  }

  session.picked[ownerId]        = true;
  session.players[ownerId].char  = char;
  session.players[ownerId].hp    = char.hp;
  session.players[ownerId].maxHp = char.hp;

  const confirmEmbed = new EmbedBuilder()
    .setColor(RARITY_COLOR[char.rarity])
    .setAuthor({ name: session.players[ownerId].username, iconURL: session.players[ownerId].avatar })
    .setTitle(`✅ ${char.full_name} ${RARITY_EMOJI[char.rarity]}`)
    .addFields(
      { name: '❤️ HP',  value: `\`${char.hp}\``,  inline: true },
      { name: '⚔️ ATK', value: `\`${char.atk}\``, inline: true },
      { name: '🛡️ DEF', value: `\`${char.def}\``, inline: true },
      { name: `✨ ${char.skill_name}`, value: char.skill_desc, inline: false },
    );

  await safeUpdate(interaction, { content: null, embeds: [confirmEmbed], components: [] });

  const bothPicked = Object.values(session.players).every((p) => p.char !== null);
  if (bothPicked) {
    session.picking = false;
    await startDuel(interaction.channel, session);
  }
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

  const confirmEmbed = new EmbedBuilder()
    .setColor(RARITY_COLOR[char.rarity])
    .setAuthor({ name: session.players[userId].username, iconURL: session.players[userId].avatar })
    .setTitle(`✅ ${char.full_name} ${RARITY_EMOJI[char.rarity]}`)
    .addFields(
      { name: '❤️ HP',  value: `\`${char.hp}\``,  inline: true },
      { name: '⚔️ ATK', value: `\`${char.atk}\``, inline: true },
      { name: '🛡️ DEF', value: `\`${char.def}\``, inline: true },
      { name: `✨ ${char.skill_name}`, value: char.skill_desc, inline: false },
    );

  await message.reply({ embeds: [confirmEmbed] });

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
    `${SEAT_EMOJI[p1.seat]} **${p1.username}** → ${RARITY_EMOJI[p1.char.rarity]} **${p1.char.full_name}**`,
    `🆚`,
    `${SEAT_EMOJI[p2.seat]} **${p2.username}** → ${RARITY_EMOJI[p2.char.rarity]} **${p2.char.full_name}**`,
    `**═══════════════════════════════**`,
  ], 600);

  const statusEmbed = (p) => new EmbedBuilder()
    .setColor(SEAT_COLOR[p.seat])
    .setAuthor({ name: p.username, iconURL: p.avatar })
    .setTitle(`${SEAT_EMOJI[p.seat]} ${p.char.name}`)
    .setThumbnail(p.avatar)
    .setDescription(
      `❤️ ${hpBar(p.hp, p.maxHp)}\n` +
      `⚔️ ATK: **${p.char.atk}**  |  🛡️ DEF: **${p.char.def}**\n` +
      `✨ Skill: **${p.char.skill_name}**`
    );

  await channel.send({ embeds: [statusEmbed(p1), statusEmbed(p2)] });
  await new Promise(r => setTimeout(r, 1000));
  await promptTurn(channel, session);
}

async function promptTurn(channel, session) {
  const currentId = session.turnOrder[session.currentTurn % 2];
  const current   = session.players[currentId];
  const otherId   = session.turnOrder.find(id => id !== currentId);
  const other     = session.players[otherId];

  // Auto-end kalau turn udah kebanyakan (lebih dari 30 turn)
  if (session.currentTurn >= 30) {
    const [p1, p2]  = Object.values(session.players);
    const winnerId  = p1.hp >= p2.hp ? p1.userId : p2.userId;
    const loserId   = p1.hp >= p2.hp ? p2.userId : p1.userId;
    await channel.send(`⏱️ *Duel sudah terlalu lama! Pemenang ditentukan dari sisa HP...*`);
    return endDuel(channel, session, winnerId, loserId);
  }

  const embed = new EmbedBuilder()
    .setColor(SEAT_COLOR[current.seat])
    .setAuthor({ name: `${current.username} — giliranmu!`, iconURL: current.avatar })
    .setTitle(`🎮 Turn ${session.currentTurn + 1} — ${current.char.name}`)
    .setThumbnail(current.avatar)
    .addFields(
      { name: `${SEAT_EMOJI[current.seat]} ${current.username}`, value: hpBar(current.hp, current.maxHp), inline: true },
      { name: `${SEAT_EMOJI[other.seat]} ${other.username}`, value: hpBar(other.hp, other.maxHp), inline: true },
    )
    .setFooter({ text: `${current.skillUsed ? 'Skill terpakai' : 'Skill ✨ siap'} | ${current.ultimateUsed ? 'Ultimate terpakai' : 'Ultimate 💀 siap'}` });

  const row = combatButtons(currentId, current.skillUsed, current.ultimateUsed);
  session.lastPromptMessage = await channel.send({ content: `<@${currentId}>`, embeds: [embed], components: [row] });
}

// ── Attack ────────────────────────────────────────
async function doAttack(channel, session, userId) {
  await clearPrompt(session);

  const attacker   = session.players[userId];
  const defenderId = session.turnOrder.find(id => id !== userId);
  const defender   = session.players[defenderId];

  await sendCutscene(channel, attackAnimation(attacker.username, attacker.char.name), 700);

  const dmg = calcDamage(attacker.char.atk, defender.char.def);
  defender.hp = Math.max(0, defender.hp - dmg);
  session.currentTurn++;

  const embed = new EmbedBuilder()
    .setColor(0xff9800)
    .setAuthor({ name: attacker.username, iconURL: attacker.avatar })
    .setTitle('👊 Serangan Normal!')
    .setThumbnail(attacker.avatar)
    .addFields(
      { name: `${SEAT_EMOJI[attacker.seat]} ${attacker.username}`, value: hpBar(attacker.hp, attacker.maxHp), inline: true },
      { name: `${SEAT_EMOJI[defender.seat]} ${defender.username}`, value: `${hpBar(defender.hp, defender.maxHp)}\n*-${dmg} HP!*`, inline: true },
    )
    .setFooter({ text: `Turn ${session.currentTurn}` });

  await channel.send({ embeds: [embed] });

  if (defender.hp <= 0) return endDuel(channel, session, userId, defenderId);
  await new Promise(r => setTimeout(r, 500));
  await promptTurn(channel, session);
}

async function handleAttack(message) {
  const userId  = message.author.id;
  const session = activeDuels.get(userId);
  if (!session || session.picking) return;
  if (session.turnOrder[session.currentTurn % 2] !== userId) return message.reply('⏳ Bukan giliran kamu!');
  if (session.actionLock) return;
  session.actionLock = true;
  try { await doAttack(message.channel, session, userId); } finally { session.actionLock = false; }
}

// ── Skill ─────────────────────────────────────────
async function doSkill(channel, session, userId) {
  await clearPrompt(session);

  const attacker   = session.players[userId];
  const defenderId = session.turnOrder.find(id => id !== userId);
  const defender   = session.players[defenderId];

  await sendCutscene(channel, skillAnimation(attacker.username, attacker.char.name, attacker.char.skill_name), 750);

  const baseDmg  = calcDamage(attacker.char.atk, defender.char.def);
  const skillDmg = Math.floor(baseDmg * attacker.char.skill_multiplier);
  defender.hp    = Math.max(0, defender.hp - skillDmg);
  attacker.skillUsed = true;
  session.currentTurn++;

  const embed = new EmbedBuilder()
    .setColor(0x9c27b0)
    .setAuthor({ name: attacker.username, iconURL: attacker.avatar })
    .setTitle(`✨ SKILL: ${attacker.char.skill_name}!`)
    .setDescription(`*${attacker.char.skill_desc}*`)
    .setThumbnail(attacker.avatar)
    .addFields(
      { name: `${SEAT_EMOJI[attacker.seat]} ${attacker.username}`, value: hpBar(attacker.hp, attacker.maxHp), inline: true },
      { name: `${SEAT_EMOJI[defender.seat]} ${defender.username}`, value: `${hpBar(defender.hp, defender.maxHp)}\n*-${skillDmg} HP! (x${attacker.char.skill_multiplier})*`, inline: true },
    )
    .setFooter({ text: `Turn ${session.currentTurn}` });

  await channel.send({ embeds: [embed] });

  if (defender.hp <= 0) return endDuel(channel, session, userId, defenderId);
  await new Promise(r => setTimeout(r, 500));
  await promptTurn(channel, session);
}

async function handleSkill(message) {
  const userId  = message.author.id;
  const session = activeDuels.get(userId);
  if (!session || session.picking) return;
  if (session.turnOrder[session.currentTurn % 2] !== userId) return message.reply('⏳ Bukan giliran kamu!');
  if (session.players[userId].skillUsed) return message.reply('❌ Skill sudah dipakai! Gunakan `!attack`.');
  if (session.actionLock) return;
  session.actionLock = true;
  try { await doSkill(message.channel, session, userId); } finally { session.actionLock = false; }
}

// ── Ultimate ──────────────────────────────────────
async function doUltimate(channel, session, userId) {
  await clearPrompt(session);

  const attacker   = session.players[userId];
  const defenderId = session.turnOrder.find(id => id !== userId);
  const defender   = session.players[defenderId];

  await sendCutscene(channel, ultimateAnimation(attacker.username, attacker.char.name), 800);

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

    await channel.send(`💥 **BACKFIRE!!** Serangan ultimate **${attacker.char.name}** berbalik!\n**-${selfDmg} HP** ke **${attacker.username}** sendiri! 😱`);

    const embed = new EmbedBuilder()
      .setColor(0xff1744)
      .setAuthor({ name: attacker.username, iconURL: attacker.avatar })
      .setTitle('💀 ULTIMATE — BACKFIRE!')
      .setThumbnail(attacker.avatar)
      .addFields(
        { name: `${SEAT_EMOJI[attacker.seat]} ${attacker.username}`, value: `${hpBar(attacker.hp, attacker.maxHp)}\n*-${selfDmg} HP (backfire!)*`, inline: true },
        { name: `${SEAT_EMOJI[defender.seat]} ${defender.username}`, value: hpBar(defender.hp, defender.maxHp), inline: true },
      )
      .setFooter({ text: `Turn ${session.currentTurn}` });
    await channel.send({ embeds: [embed] });

    if (attacker.hp <= 0) return endDuel(channel, session, defenderId, userId);
  } else {
    // Hit normal
    defender.hp = Math.max(0, defender.hp - ultDmg);

    const embed = new EmbedBuilder()
      .setColor(0x000000)
      .setAuthor({ name: attacker.username, iconURL: attacker.avatar })
      .setTitle('💀 ULTIMATE HIT!')
      .setThumbnail(attacker.avatar)
      .addFields(
        { name: `${SEAT_EMOJI[attacker.seat]} ${attacker.username}`, value: hpBar(attacker.hp, attacker.maxHp), inline: true },
        { name: `${SEAT_EMOJI[defender.seat]} ${defender.username}`, value: `${hpBar(defender.hp, defender.maxHp)}\n*-${ultDmg} HP!!!*`, inline: true },
      )
      .setFooter({ text: `Turn ${session.currentTurn}` });
    await channel.send({ embeds: [embed] });

    if (defender.hp <= 0) return endDuel(channel, session, userId, defenderId);
  }

  await new Promise(r => setTimeout(r, 500));
  await promptTurn(channel, session);
}

async function handleUltimate(message) {
  const userId  = message.author.id;
  const session = activeDuels.get(userId);
  if (!session || session.picking) return;
  if (session.turnOrder[session.currentTurn % 2] !== userId) return message.reply('⏳ Bukan giliran kamu!');
  if (session.players[userId].ultimateUsed) return message.reply('❌ Ultimate sudah dipakai! Hanya bisa sekali per duel.');
  if (session.actionLock) return;
  session.actionLock = true;
  try { await doUltimate(message.channel, session, userId); } finally { session.actionLock = false; }
}

// ── Surrender ─────────────────────────────────────
async function doSurrender(channel, session, userId) {
  await clearPrompt(session);
  const defenderId = session.turnOrder.find(id => id !== userId);
  await channel.send(`🏳️ **${session.players[userId].username}** menyerah!`);
  return endDuel(channel, session, defenderId, userId);
}

async function handleSurrender(message) {
  const userId  = message.author.id;
  const session = activeDuels.get(userId);
  if (!session || session.picking) return message.reply('❓ Kamu gak lagi dalam duel.');
  return doSurrender(message.channel, session, userId);
}

// ── Handler tombol serangan (interactionCreate) ────
async function handleCombatButton(interaction) {
  const [, action, ownerId] = interaction.customId.split('_'); // "duel_<action>_<userId>"

  if (interaction.user.id !== ownerId) {
    return safeReply(interaction, { content: '❌ Ini bukan giliran kamu!', ephemeral: true });
  }

  const session = activeDuels.get(ownerId);
  if (!session || session.picking) {
    return safeUpdate(interaction, { content: '❓ Duel ini udah gak aktif lagi (mungkin bot sempet restart). Coba `!duel` baru ya.', embeds: [], components: [] });
  }
  if (action !== 'surrender' && session.turnOrder[session.currentTurn % 2] !== ownerId) {
    return safeReply(interaction, { content: '⏳ Bukan giliran kamu!', ephemeral: true });
  }
  if (action === 'skill' && session.players[ownerId].skillUsed) {
    return safeReply(interaction, { content: '❌ Skill sudah dipakai!', ephemeral: true });
  }
  if (action === 'ultimate' && session.players[ownerId].ultimateUsed) {
    return safeReply(interaction, { content: '❌ Ultimate sudah dipakai!', ephemeral: true });
  }
  if (session.actionLock) {
    return safeReply(interaction, { content: '⏳ Tunggu bentar, masih proses...', ephemeral: true });
  }

  // Matiin tombol di pesan ini dulu biar gak bisa diklik dobel
  await safeUpdate(interaction, { components: [] });
  session.lastPromptMessage = null;

  session.actionLock = true;
  try {
    switch (action) {
      case 'attack':    await doAttack(interaction.channel, session, ownerId); break;
      case 'skill':     await doSkill(interaction.channel, session, ownerId); break;
      case 'ultimate':  await doUltimate(interaction.channel, session, ownerId); break;
      case 'surrender': await doSurrender(interaction.channel, session, ownerId); break;
    }
  } finally {
    session.actionLock = false;
  }
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
    .setAuthor({ name: `${winner.username} menang!`, iconURL: winner.avatar })
    .setTitle('🏆 DUEL SELESAI!')
    .setThumbnail(winner.avatar)
    .addFields(
      { name: `🏆 ${winner.username}`, value: `${RARITY_EMOJI[winner.char.rarity]} **${winner.char.name}** — MENANG!`, inline: true },
      { name: `💀 ${loser.username}`, value: `${RARITY_EMOJI[loser.char.rarity]} **${loser.char.name}** — Kalah`, inline: true },
    )
    .setFooter({ text: `+${REWARD} koin untuk ${winner.username} 💰` });

  return channel.send({ embeds: [embed] });
}

module.exports = { handleDuel, handleAccept, handleDecline, handlePick, handlePickSelect, handleAttack, handleSkill, handleUltimate, handleSurrender, handleCombatButton };