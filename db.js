const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, 'data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

const dbPath = path.join(dataDir, 'app.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS role_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    price REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

function createRoleIfNotExists(role, title, password) {
  const existingRole = db.prepare(`
    SELECT id FROM role_accounts WHERE role = ?
  `).get(role);

  if (existingRole) {
    return;
  }

  const passwordHash = bcrypt.hashSync(password, 12);

  db.prepare(`
    INSERT INTO role_accounts (role, title, password_hash)
    VALUES (?, ?, ?)
  `).run(role, title, passwordHash);
}

createRoleIfNotExists('user', 'Пользователь', 'user123');
createRoleIfNotExists('manager', 'Менеджер', 'manager123');
createRoleIfNotExists('cladman', 'Кладовщик', 'cladman123');
createRoleIfNotExists('driver', 'Водитель', 'driver123');

function createProductIfNotExists(name, description, category, price) {
  const existingProduct = db.prepare(`
    SELECT id FROM products WHERE name = ?
  `).get(name);

  if (existingProduct) {
    return;
  }

  db.prepare(`
    INSERT INTO products (name, description, category, price)
    VALUES (?, ?, ?, ?)
  `).run(name, description, category, price);
}

createProductIfNotExists(
  'Суповые концентраты',
  'Быстрорастворимые основы для первых блюд разных вкусов.',
  'Супы',
  450
);
createProductIfNotExists(
  'Соусы и заправки',
  'Готовые смеси для горячих и холодных блюд.',
  'Соусы',
  380
);
createProductIfNotExists(
  'Приправы и специи',
  'Сбалансированные композиции для мяса, рыбы и овощей.',
  'Приправы',
  290
);

module.exports = db;