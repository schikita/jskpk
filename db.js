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

// ======= УСТАНАВЛИВАЕМ ЧАСОВОЙ ПОЯС =======
db.exec("PRAGMA timezone = 'Europe/Moscow';");

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ===== СОЗДАЁМ ТАБЛИЦЫ =====
db.exec(`
  CREATE TABLE IF NOT EXISTS role_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    price REAL,
    stock INTEGER NOT NULL DEFAULT 0,
    image_url TEXT NOT NULL DEFAULT '/images/products/no-image.svg',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    user_role TEXT NOT NULL,
    user_title TEXT NOT NULL,
    items TEXT NOT NULL,
    total_price REAL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    user_role TEXT NOT NULL,
    user_title TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);

function ensureProductIndexes() {
  if (tableExists('products') && tableHasColumn('products', 'is_active')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active)');
  }

  if (tableExists('products') && tableHasColumn('products', 'category')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)');
  }
}

function addColumnIfMissing(tableName, columnName, definition) {
  if (tableExists(tableName) && !tableHasColumn(tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function tableExists(tableName) {
  return Boolean(db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(tableName));
}

function tableHasColumn(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some(function (column) {
    return column.name === columnName;
  });
}

function migrateSchema() {
  if (tableExists('products') && !tableHasColumn('products', 'stock')) {
    db.exec(`
      ALTER TABLE products
      ADD COLUMN stock INTEGER NOT NULL DEFAULT 0
    `);
  }

  if (!tableExists('orders')) {
    return;
  }

  if (!tableHasColumn('orders', 'user_id')) {
    db.exec(`
      CREATE TABLE orders_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        user_role TEXT NOT NULL,
        user_title TEXT NOT NULL,
        items TEXT NOT NULL DEFAULT '[]',
        total_price REAL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      )
    `);

    if (tableHasColumn('orders', 'role')) {
      const oldOrders = db.prepare(`
        SELECT id, role, title, status, created_at
        FROM orders
      `).all();

      const insertOrder = db.prepare(`
        INSERT INTO orders_new (
          id, user_id, user_role, user_title, items, total_price, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const statusMap = {
        new: 'pending',
        in_work: 'approved',
        done: 'delivered',
        cancelled: 'rejected',
        pending: 'pending',
        approved: 'approved',
        rejected: 'rejected',
        shipped: 'shipped',
        delivered: 'delivered'
      };

      for (const order of oldOrders) {
        const account = db.prepare(`
          SELECT id, role, title
          FROM role_accounts
          WHERE role = ?
        `).get(order.role);

        const userId = account ? account.id : 1;
        const userRole = account ? account.role : order.role;
        const userTitle = account ? account.title : order.role;
        const items = JSON.stringify([
          {
            name: order.title,
            quantity: 1
          }
        ]);
        const status = statusMap[order.status] || 'pending';

        insertOrder.run(
          order.id,
          userId,
          userRole,
          userTitle,
          items,
          null,
          status,
          order.created_at,
          order.created_at
        );
      }
    }

    db.exec('DROP TABLE orders');
    db.exec('ALTER TABLE orders_new RENAME TO orders');
    return;
  }

  if (!tableHasColumn('orders', 'user_role')) {
    db.exec(`
      ALTER TABLE orders
      ADD COLUMN user_role TEXT NOT NULL DEFAULT 'user'
    `);
  }

  if (!tableHasColumn('orders', 'user_title')) {
    db.exec(`
      ALTER TABLE orders
      ADD COLUMN user_title TEXT NOT NULL DEFAULT ''
    `);
  }

  if (!tableHasColumn('orders', 'items')) {
    db.exec(`
      ALTER TABLE orders
      ADD COLUMN items TEXT NOT NULL DEFAULT '[]'
    `);
  }

  if (!tableHasColumn('orders', 'total_price')) {
    db.exec(`
      ALTER TABLE orders
      ADD COLUMN total_price REAL
    `);
  }

  if (!tableHasColumn('orders', 'updated_at')) {
    db.exec(`
      ALTER TABLE orders
      ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    `);
  }
}

migrateSchema();

addColumnIfMissing('products', 'category', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('products', 'description', `TEXT NOT NULL DEFAULT ''`);
addColumnIfMissing('products', 'price', `REAL NOT NULL DEFAULT 0`);
addColumnIfMissing('products', 'image_url', `TEXT NOT NULL DEFAULT '/images/products/no-image.svg'`);
addColumnIfMissing('products', 'is_active', `INTEGER NOT NULL DEFAULT 1`);
addColumnIfMissing('products', 'updated_at', `TEXT NOT NULL DEFAULT ''`);

if (tableExists('products') && tableHasColumn('products', 'updated_at')) {
  db.exec(`
    UPDATE products
    SET updated_at = datetime('now', 'localtime')
    WHERE updated_at = '' OR updated_at IS NULL
  `);
}

ensureProductIndexes();

function ensureProductStock(name, stock) {
  db.prepare(`
    UPDATE products
    SET stock = ?
    WHERE name = ? AND stock = 0
  `).run(stock, name);
}

ensureProductStock('Суповые концентраты', 50);
ensureProductStock('Соусы и заправки', 30);
ensureProductStock('Приправы и специи', 100);

// ===== СОЗДАЁМ РОЛИ =====
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

// ===== СОЗДАЁМ НАЧАЛЬНЫЕ ТОВАРЫ С ОСТАТКАМИ =====
function createProductIfNotExists(name, description, category, price, stock) {
  const existingProduct = db.prepare(`
    SELECT id FROM products WHERE name = ?
  `).get(name);

  if (existingProduct) {
    return;
  }

  db.prepare(`
    INSERT INTO products (name, description, category, price, stock)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, description, category, price, stock);
}

createProductIfNotExists(
  'Суповые концентраты',
  'Быстрорастворимые основы для первых блюд разных вкусов.',
  'Супы',
  450,
  50
);
createProductIfNotExists(
  'Соусы и заправки',
  'Готовые смеси для горячих и холодных блюд.',
  'Соусы',
  380,
  30
);
createProductIfNotExists(
  'Приправы и специи',
  'Сбалансированные композиции для мяса, рыбы и овощей.',
  'Приправы',
  290,
  100
);

// ===== ФУНКЦИЯ ДЛЯ ЛОГИРОВАНИЯ =====
function addLog(userId, userRole, userTitle, action, details) {
  db.prepare(`
    INSERT INTO logs (user_id, user_role, user_title, action, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, userRole, userTitle, action, details);
}

function createProduct({ name, description, category, price, stock, image_url }) {
  const result = db.prepare(`
    INSERT INTO products (name, description, category, price, stock, image_url, is_active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now', 'localtime'))
  `).run(
    name,
    description || '',
    category || '',
    price,
    stock,
    image_url || '/images/products/no-image.svg'
  );

  return db.prepare(`
    SELECT id, name, description, category, price, stock, image_url, created_at, updated_at
    FROM products
    WHERE id = ?
  `).get(result.lastInsertRowid);
}

function getActiveProducts() {
  return db.prepare(`
    SELECT id, name, description, category, price, stock, image_url, created_at, updated_at
    FROM products
    WHERE is_active = 1
    ORDER BY id DESC
  `).all();
}

module.exports = db;
module.exports.addLog = addLog;
module.exports.createProduct = createProduct;
module.exports.getActiveProducts = getActiveProducts;