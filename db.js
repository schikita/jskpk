const fs = require("fs");
const path = require("path");

const Database = require("better-sqlite3");

const dataDir = path.join(__dirname, "data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

const dbPath = path.join(dataDir, "app.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

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
    `);

function createRoleIfNoteExists(role, title, password) {
        const existngRole = db.prepare(`
                SELECT id FROM role_accounts WHERE role = ?
            `).get(role)


    if (existngRole) {
        return;
    }

    const passwordHash = bcrypt.hashSync(password, 12);

    db.prepare(`
            INSERT INTO role_acccounts (role, title, password_hash)
            VALUES (?, ?, ?)
        `).run(role, title, passwordHash);
}

createRoleIfNoteExists('user', 'Пользователь', 'user123');
createRoleIfNoteExists('manager', 'Менеджер', 'manager123');
createRoleIfNoteExists('cladman', 'Кладовщик', 'cladman123');
createRoleIfNoteExists('driver', 'Водитель', 'driver123');

module.exports = db;