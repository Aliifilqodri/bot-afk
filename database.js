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
      last_daily INTEGER DEFAULT 0
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

// ── Gacha ─────────────────────────────────────────
function getRandomCharacter() {
  const roll = Math.random() * 100;
  let rarity;
  if (roll < 3)       rarity = 'Legendary';
  else if (roll < 15) rarity = 'Super Rare';
  else if (roll < 40) rarity = 'Rare';
  else                rarity = 'Common';

  const pool = db.prepare('SELECT * FROM characters WHERE rarity = ?').all(rarity);
  return pool[Math.floor(Math.random() * pool.length)];
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
        WHEN 'Legendary' THEN 1
        WHEN 'Super Rare' THEN 2
        WHEN 'Rare' THEN 3
        ELSE 4
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
  getRandomCharacter, addToInventory, getInventory,
  getCharacterByName, getUserCharacterByName,
  addCharacter, getAllCharacters,
  getSetting, setSetting,
};