const path    = require('path');
const Database = require('better-sqlite3');
const characters      = require('./data/characters');
const charactersExtra = require('./data/characters_extra');
const allCharacters   = [...characters, ...charactersExtra];

// Kalau di Railway (ada folder /data), simpan di sana biar kena Volume
// Kalau lokal, simpan di folder project biasa
const DB_PATH = process.env.RAILWAY_ENVIRONMENT
  ? '/data/gacha.db'
  : path.join(__dirname, 'gacha.db');

const db = new Database(DB_PATH);

function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      full_name TEXT,
      franchise TEXT,
      series TEXT,
      rarity TEXT,
      hp INTEGER,
      atk INTEGER,
      def INTEGER,
      skill_name TEXT,
      skill_desc TEXT,
      skill_multiplier REAL
    );

    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      coins INTEGER DEFAULT 1000,
      last_gacha INTEGER DEFAULT 0,
      last_daily INTEGER DEFAULT 0,
      pity_legendary INTEGER DEFAULT 0,
      pity_sr INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      character_id INTEGER NOT NULL,
      obtained_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (character_id) REFERENCES characters(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      guild_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (guild_id, key)
    );
  `);

  // Migrasi buat database lama yang belum punya kolom pity
  for (const col of ['pity_legendary', 'pity_sr']) {
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} INTEGER DEFAULT 0`);
    } catch (e) {
      if (!/duplicate column/i.test(e.message)) throw e;
    }
  }

  // Seed characters kalau table masih kosong
  const count = db.prepare('SELECT COUNT(*) as c FROM characters').get();
  if (count.c === 0) {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO characters
        (name, full_name, franchise, series, rarity, hp, atk, def, skill_name, skill_desc, skill_multiplier)
      VALUES
        (@name, @full_name, @franchise, @series, @rarity, @hp, @atk, @def, @skill_name, @skill_desc, @skill_multiplier)
    `);
    const insertMany = db.transaction((chars) => {
      for (const c of chars) insert.run(c);
    });
    insertMany(allCharacters);
    console.log(`[DB] Seeded ${allCharacters.length} karakter.`);
  }

  // Migrasi: sync rarity/stat karakter yang di-promote ke tier baru (Mythic dkk)
  // biar database yang udah ke-seed sebelumnya ikut ke-update, bukan cuma DB baru.
  const updateChar = db.prepare(`
    UPDATE characters SET
      rarity = @rarity, hp = @hp, atk = @atk, def = @def,
      skill_name = @skill_name, skill_desc = @skill_desc, skill_multiplier = @skill_multiplier
    WHERE name = @name
  `);
  const syncMany = db.transaction((chars) => {
    for (const c of chars) updateChar.run(c);
  });
  syncMany(allCharacters);

  console.log('[DB] Database siap!');
}

// ── User ──────────────────────────────────────────
function getUser(userId) {
  let user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  if (!user) {
    db.prepare('INSERT OR IGNORE INTO users (user_id) VALUES (?)').run(userId);
    user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  }
  return user;
}

function setLastGacha(userId) {
  db.prepare('UPDATE users SET last_gacha = ? WHERE user_id = ?').run(Date.now(), userId);
}

function setLastDaily(userId) {
  db.prepare('UPDATE users SET last_daily = ? WHERE user_id = ?').run(Date.now(), userId);
}

function addCoins(userId, amount) {
  db.prepare('UPDATE users SET coins = coins + ? WHERE user_id = ?').run(amount, userId);
}

function deductCoins(userId, amount) {
  db.prepare('UPDATE users SET coins = coins - ? WHERE user_id = ?').run(amount, userId);
}

// ── Gacha (dengan pity system) ─────────────────────
const MYTHIC_CHANCE            = 0.5; // % — independen dari pity, gak ada jaminan
const HARD_PITY_LEGENDARY      = 50; // dijamin Legendary di pull ke-50 sejak terakhir dapet
const SOFT_PITY_LEGENDARY_START = 30; // mulai pull ke-31, chance Legendary naik tiap pull
const HARD_PITY_SR             = 10; // dijamin minimal Super Rare tiap 10 pull

function rollRarity(pityLegendary, pitySR) {
  // Mythic — tier paling langka, chance flat, TIDAK kena pity/jaminan apapun
  if (Math.random() * 100 < MYTHIC_CHANCE) {
    return { rarity: 'Mythic', forced: null };
  }

  // Hard pity Legendary — kalau pull ini bakal jadi pull ke-50, paksa Legendary
  if (pityLegendary + 1 >= HARD_PITY_LEGENDARY) {
    return { rarity: 'Legendary', forced: 'legendary' };
  }

  const guaranteeSR = pitySR + 1 >= HARD_PITY_SR;

  // Soft pity Legendary — makin lama gak dapet, chance-nya makin naik
  let legendaryChance = 3;
  if (pityLegendary >= SOFT_PITY_LEGENDARY_START) {
    legendaryChance += (pityLegendary - SOFT_PITY_LEGENDARY_START + 1) * 5;
  }
  const srChance = 12;

  const roll = Math.random() * 100;
  if (roll < legendaryChance)              return { rarity: 'Legendary',  forced: null };
  if (roll < legendaryChance + srChance)   return { rarity: 'Super Rare', forced: null };
  if (guaranteeSR)                         return { rarity: 'Super Rare', forced: 'sr' };
  if (roll < legendaryChance + srChance + 25) return { rarity: 'Rare',    forced: null };
  return { rarity: 'Common', forced: null };
}

function getRandomCharacter(userId) {
  const user = getUser(userId);
  const pityLegendaryBefore = user.pity_legendary || 0;
  const pitySRBefore        = user.pity_sr || 0;

  const { rarity, forced } = rollRarity(pityLegendaryBefore, pitySRBefore);

  const pool = db.prepare('SELECT * FROM characters WHERE rarity = ?').all(rarity);
  const char = pool[Math.floor(Math.random() * pool.length)];
  if (!char) return null;

  let pityLegendaryAfter, pitySRAfter;
  if (rarity === 'Mythic' || rarity === 'Legendary') {
    pityLegendaryAfter = 0;
    pitySRAfter = 0;
  } else if (rarity === 'Super Rare') {
    pityLegendaryAfter = pityLegendaryBefore + 1;
    pitySRAfter = 0;
  } else {
    pityLegendaryAfter = pityLegendaryBefore + 1;
    pitySRAfter = pitySRBefore + 1;
  }

  db.prepare('UPDATE users SET pity_legendary = ?, pity_sr = ? WHERE user_id = ?')
    .run(pityLegendaryAfter, pitySRAfter, userId);

  return {
    ...char,
    _pity: {
      forced,
      pityLegendary: pityLegendaryAfter,
      pitySR: pitySRAfter,
      hardPityLegendary: HARD_PITY_LEGENDARY,
      hardPitySR: HARD_PITY_SR,
    },
  };
}

function getPityStatus(userId) {
  const user = getUser(userId);
  return {
    pityLegendary: user.pity_legendary || 0,
    pitySR: user.pity_sr || 0,
    hardPityLegendary: HARD_PITY_LEGENDARY,
    hardPitySR: HARD_PITY_SR,
    softPityLegendaryStart: SOFT_PITY_LEGENDARY_START,
  };
}

function addToInventory(userId, characterId) {
  db.prepare('INSERT INTO inventory (user_id, character_id) VALUES (?, ?)').run(userId, characterId);
}

function getInventory(userId) {
  return db.prepare(`
    SELECT c.*, i.id as inv_id, i.obtained_at
    FROM inventory i
    JOIN characters c ON i.character_id = c.id
    WHERE i.user_id = ?
    ORDER BY
      CASE c.rarity
        WHEN 'Mythic' THEN 1
        WHEN 'Legendary' THEN 2
        WHEN 'Super Rare' THEN 3
        WHEN 'Rare' THEN 4
        ELSE 5
      END, c.name ASC
  `).all(userId);
}

function getCharacterByName(name) {
  return db.prepare(`
    SELECT * FROM characters WHERE LOWER(name) LIKE ?
  `).get(`%${name.toLowerCase()}%`);
}

function getUserCharacterByName(userId, name) {
  return db.prepare(`
    SELECT c.* FROM inventory i
    JOIN characters c ON i.character_id = c.id
    WHERE i.user_id = ? AND LOWER(c.name) LIKE ?
    LIMIT 1
  `).get(userId, `%${name.toLowerCase()}%`);
}

// ── Admin ─────────────────────────────────────────
function addCharacter(charData) {
  try {
    db.prepare(`
      INSERT INTO characters
        (name, full_name, franchise, series, rarity, hp, atk, def, skill_name, skill_desc, skill_multiplier)
      VALUES
        (@name, @full_name, @franchise, @series, @rarity, @hp, @atk, @def, @skill_name, @skill_desc, @skill_multiplier)
    `).run(charData);
    return true;
  } catch {
    return false;
  }
}

function getAllCharacters() {
  return db.prepare('SELECT * FROM characters ORDER BY rarity, name').all();
}

// ── Settings (per server) ──────────────────────────
function getSetting(guildId, key) {
  const row = db.prepare('SELECT value FROM settings WHERE guild_id = ? AND key = ?').get(guildId, key);
  return row ? row.value : null;
}

function setSetting(guildId, key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (guild_id, key, value) VALUES (?, ?, ?)').run(guildId, key, value);
}

module.exports = {
  initDB,
  getUser, setLastGacha, setLastDaily, addCoins, deductCoins,
  getRandomCharacter, getPityStatus, addToInventory, getInventory,
  getCharacterByName, getUserCharacterByName,
  addCharacter, getAllCharacters,
  getSetting, setSetting,
};