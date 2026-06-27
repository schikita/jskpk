const multer = require('multer');
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const db = require('./db');
const addLog = db.addLog;
const getActiveProducts = db.getActiveProducts;
const getProductById = db.getProductById;
const createProduct = db.createProduct;
const updateProduct = db.updateProduct;

const app = express();
const PORT = process.env.PORT || 3000;

const productImageDir = path.join(__dirname, 'public', 'uploads', 'products');
const productImagesDir = path.join(__dirname, 'public', 'images', 'products');

if (!fs.existsSync(productImageDir)) {
  fs.mkdirSync(productImageDir, { recursive: true });
}

if (!fs.existsSync(productImagesDir)) {
  fs.mkdirSync(productImagesDir, { recursive: true });
}

app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 24
  }
}));

app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

function getPage(fileName) {
  return path.join(__dirname, fileName);
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(';').reduce(function (cookies, part) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) {
      return cookies;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = decodeURIComponent(part.slice(separatorIndex + 1).trim());
    cookies[key] = value;
    return cookies;
  }, {});
}

const CONSENT_COOKIE_NAME = 'cookie_consent';
const CONSENT_MAX_AGE = 1000 * 60 * 60 * 24 * 365;

function requireAuth(req, res, next) {
  if (!req.session.account) {
    return res.redirect('/auth.html');
  }
  next();
}

function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.session.account) {
      return res.redirect('/auth.html');
    }
    if (!roles.includes(req.session.account.role)) {
      return res.status(403).send('Недостаточно прав для просмотра страницы');
    }
    next();
  };
}

function requireRoleApi(...roles) {
  return function (req, res, next) {
    if (!req.session.account) {
      return res.status(401).json({
        ok: false,
        message: 'Пользователь не авторизован'
      });
    }
    if (!roles.includes(req.session.account.role)) {
      return res.status(403).json({
        ok: false,
        message: 'Недостаточно прав'
      });
    }
    next();
  };
}

// --- Статические страницы ---
app.get('/', (req, res) => res.sendFile(getPage('index.html')));
app.get('/index.html', (req, res) => res.sendFile(getPage('index.html')));
app.get('/auth.html', (req, res) => res.sendFile(getPage('auth.html')));
app.get('/user-page.html', requireRole('user', 'manager', 'cladman', 'driver'), (req, res) => res.sendFile(getPage('user-page.html')));
app.get('/manager-page.html', requireRole('manager'), (req, res) => res.sendFile(getPage('manager-page.html')));
app.get('/manager/products/new', requireRole('manager'), (req, res) => res.sendFile(getPage('manager-add-product.html')));
app.get('/manager/products/:id/edit', requireRole('manager'), (req, res) => res.sendFile(getPage('manager-edit-product.html')));
app.get('/cladman-page.html', requireRole('cladman'), (req, res) => res.sendFile(getPage('cladman-page.html')));
app.get('/cladman/catalog', requireRole('cladman', 'manager'), (req, res) => res.sendFile(getPage('cladman-catalog.html')));

app.get('/driver-page.html', requireRole('driver'), (req, res) => res.sendFile(getPage('driver-page.html')));
app.get('/manager-edit-product.html', requireRole('manager'), (req, res) => res.sendFile(getPage('manager-edit-product.html')));

// --- Cookie consent ---
app.get('/api/cookie-consent', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const consent = cookies[CONSENT_COOKIE_NAME] || null;
  res.json({ ok: true, consent });
});

app.post('/api/cookie-consent', (req, res) => {
  const consent = String(req.body.consent || '').trim();
  if (!['accepted', 'rejected'].includes(consent)) {
    return res.status(400).json({ ok: false, message: 'Некорректное значение согласия' });
  }
  res.cookie(CONSENT_COOKIE_NAME, consent, {
    maxAge: CONSENT_MAX_AGE,
    httpOnly: false,
    sameSite: 'lax',
    secure: false,
    path: '/'
  });
  res.json({ ok: true, consent });
});


app.get('/debug/session', (req, res) => {
  res.json({
    session: req.session,
    account: req.session.account || null
  });
});

// --- Auth ---
app.post('/api/login', (req, res) => {
  const role = String(req.body.role || '').trim();
  if (!role) {
    return res.status(400).json({ ok: false, message: 'Выберите роль' });
  }

  const account = db.prepare(`
    SELECT id, role, title
    FROM role_accounts
    WHERE role = ?
  `).get(role);

  if (!account) {
    return res.status(401).json({ ok: false, message: 'Некорректная роль' });
  }

  req.session.account = {
    id: account.id,
    role: account.role,
    title: account.title
  };

  addLog(account.id, account.role, account.title, 'login', 'Вход в систему');

  res.json({ ok: true, account: req.session.account });
});

app.post('/api/logout', requireAuth, (req, res) => {
  const acc = req.session.account;
  addLog(acc.id, acc.role, acc.title, 'logout', 'Выход из системы');
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({ ok: false, message: 'Не удалось выйти из системы' });
    }
    res.clearCookie('sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.account) {
    return res.status(401).json({ ok: false, message: 'Пользователь не авторизован' });
  }
  res.json({ ok: true, account: req.session.account });
});

// --- Products ---
app.get('/api/products', (req, res) => {
  const products = getActiveProducts();
  res.json({ ok: true, success: true, products });
});

app.get('/api/products/:id', (req, res) => {
  const productId = Number(req.params.id);

  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({
      ok: false,
      success: false,
      message: 'Некорректный идентификатор товара'
    });
  }

  const product = getProductById(productId);

  if (!product || product.is_active !== 1) {
    return res.status(404).json({
      ok: false,
      success: false,
      message: 'Товар не найден'
    });
  }

  res.json({ ok: true, success: true, product });
});

app.post('/api/products', requireRoleApi('manager'), (req, res) => {
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  const category = String(req.body.category || '').trim();
  const priceValue = req.body.price;
  const price = priceValue === '' || priceValue === null || priceValue === undefined
    ? null
    : Number(priceValue);

  if (!name) {
    return res.status(400).json({ ok: false, message: 'Название товара обязательно' });
  }
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    return res.status(400).json({ ok: false, message: 'Некорректная цена' });
  }

  const result = db.prepare(`
    INSERT INTO products (name, description, category, price, stock)
    VALUES (?, ?, ?, ?, 0)
  `).run(name, description, category, price);

  const product = db.prepare(`
    SELECT id, name, description, category, price, stock, created_at
    FROM products
    WHERE id = ?
  `).get(result.lastInsertRowid);

  const acc = req.session.account;
  addLog(acc.id, acc.role, acc.title, 'product_add', `Добавлен товар: ${name}`);

  res.status(201).json({ ok: true, product });
});

// ===== РЕДАКТИРОВАНИЕ ТОВАРА =====
app.patch('/api/products/:id', requireRoleApi('manager'), (req, res) => {
  const productId = Number(req.params.id);
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  const category = String(req.body.category || '').trim();
  const priceValue = req.body.price;
  const stockValue = req.body.stock;
  
  const price = priceValue === '' || priceValue === null || priceValue === undefined
    ? null
    : Number(priceValue);
  const stock = stockValue === '' || stockValue === null || stockValue === undefined
    ? 0
    : Number(stockValue);

  const existingProduct = db.prepare(`
    SELECT * FROM products WHERE id = ?
  `).get(productId);
  
  if (!existingProduct) {
    return res.status(404).json({ ok: false, message: 'Товар не найден' });
  }

  if (!name) {
    return res.status(400).json({ ok: false, message: 'Название товара обязательно' });
  }
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    return res.status(400).json({ ok: false, message: 'Некорректная цена' });
  }
  if (!Number.isInteger(stock) || stock < 0) {
    return res.status(400).json({ ok: false, message: 'Некорректный остаток' });
  }

  db.prepare(`
    UPDATE products
    SET name = ?, description = ?, category = ?, price = ?, stock = ?
    WHERE id = ?
  `).run(name, description, category, price, stock, productId);

  const updatedProduct = db.prepare(`
    SELECT id, name, description, category, price, stock, created_at
    FROM products
    WHERE id = ?
  `).get(productId);

  const acc = req.session.account;
  addLog(
    acc.id, 
    acc.role, 
    acc.title, 
    'product_edit', 
    `Отредактирован товар: ${name} (ID: ${productId})`
  );

  res.json({ ok: true, product: updatedProduct });
});

// ===== УДАЛЕНИЕ ТОВАРА =====
app.delete('/api/products/:id', requireRoleApi('manager'), (req, res) => {
  const productId = Number(req.params.id);
  
  const existingProduct = db.prepare(`
    SELECT * FROM products WHERE id = ?
  `).get(productId);
  
  if (!existingProduct) {
    return res.status(404).json({ ok: false, message: 'Товар не найден' });
  }

  const ordersWithProduct = db.prepare(`
    SELECT COUNT(*) as count FROM orders WHERE items LIKE ?
  `).get(`%"productId":${productId}%`);
  
  if (ordersWithProduct.count > 0) {
    return res.status(400).json({ 
      ok: false, 
      message: 'Нельзя удалить товар, так как он используется в заявках' 
    });
  }

  db.prepare(`DELETE FROM products WHERE id = ?`).run(productId);
  
  const acc = req.session.account;
  addLog(acc.id, acc.role, acc.title, 'product_delete', `Удалён товар: ${existingProduct.name} (ID: ${productId})`);
  
  res.json({ ok: true, message: 'Товар удалён' });
});

// --- Orders ---
app.get('/api/orders', requireAuth, (req, res) => {
  const account = req.session.account;
  let orders;

  if (account.role === 'manager' || account.role === 'cladman' || account.role === 'driver') {
    orders = db.prepare(`
      SELECT o.*, ra.title as user_title
      FROM orders o
      JOIN role_accounts ra ON o.user_id = ra.id
      ORDER BY o.id DESC
    `).all();
  } else {
    orders = db.prepare(`
      SELECT o.*, ra.title as user_title
      FROM orders o
      JOIN role_accounts ra ON o.user_id = ra.id
      WHERE o.user_id = ?
      ORDER BY o.id DESC
    `).all(account.id);
  }

  orders = orders.map(order => ({
    ...order,
    items: JSON.parse(order.items)
  }));

  res.json({ ok: true, orders });
});

app.post('/api/orders', requireRoleApi('user'), (req, res) => {
  const account = req.session.account;
  const items = req.body.items;
  const totalPrice = req.body.totalPrice || 0;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, message: 'Корзина пуста' });
  }

  for (const item of items) {
    const product = db.prepare(`
      SELECT id, name, price FROM products WHERE id = ?
    `).get(item.productId);
    if (!product) {
      return res.status(400).json({ ok: false, message: `Товар не найден: ${item.name}` });
    }
    item.price = product.price;
  }

  const itemsJson = JSON.stringify(items);

  const result = db.prepare(`
    INSERT INTO orders (user_id, user_role, user_title, items, total_price, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(account.id, account.role, account.title, itemsJson, totalPrice);

  const order = db.prepare(`
    SELECT * FROM orders WHERE id = ?
  `).get(result.lastInsertRowid);
  order.items = JSON.parse(order.items);

  addLog(account.id, account.role, account.title, 'order_create', `Создана заявка #${order.id}`);

  res.status(201).json({ ok: true, order });
});

app.patch('/api/orders/:id/status', requireAuth, (req, res) => {
  const orderId = Number(req.params.id);
  const status = String(req.body.status || '').trim();
  const account = req.session.account;

  const allowedStatuses = ['pending', 'approved', 'rejected', 'shipped', 'delivered'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ ok: false, message: 'Некорректный статус' });
  }

  const order = db.prepare(`
    SELECT * FROM orders WHERE id = ?
  `).get(orderId);
  if (!order) {
    return res.status(404).json({ ok: false, message: 'Заявка не найдена' });
  }
  order.items = JSON.parse(order.items);

  if (account.role === 'user') {
    if (order.user_id !== account.id) {
      return res.status(403).json({ ok: false, message: 'Недостаточно прав' });
    }
    if (status !== 'cancelled' && status !== 'pending') {
      return res.status(403).json({ ok: false, message: 'Вы можете только отменить заявку' });
    }
    if (order.status !== 'pending') {
      return res.status(400).json({ ok: false, message: 'Заявка уже обработана' });
    }
  }

  if (account.role === 'manager') {
    if (order.status !== 'pending') {
      return res.status(400).json({ ok: false, message: 'Заявка уже обработана' });
    }
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ ok: false, message: 'Менеджер может только одобрить или отклонить заявку' });
    }
  }

  if (account.role === 'cladman') {
    if (order.status !== 'approved') {
      return res.status(400).json({ ok: false, message: 'Заявка должна быть одобрена менеджером' });
    }
    if (status !== 'shipped') {
      return res.status(400).json({ ok: false, message: 'Кладовщик может только подтвердить отгрузку' });
    }

    for (const item of order.items) {
      const product = db.prepare(`
        SELECT id, name, stock FROM products WHERE id = ?
      `).get(item.productId);
      
      if (!product) {
        return res.status(400).json({ 
          ok: false, 
          message: `Товар "${item.name}" не найден в каталоге` 
        });
      }
      
      if (product.stock < item.quantity) {
        return res.status(400).json({ 
          ok: false, 
          message: `Недостаточно товара "${item.name}" на складе. В наличии: ${product.stock}, запрошено: ${item.quantity}` 
        });
      }
    }

    const shipmentDetails = [];
    for (const item of order.items) {
      db.prepare(`
        UPDATE products 
        SET stock = stock - ? 
        WHERE id = ?
      `).run(item.quantity, item.productId);
      
      const updatedProduct = db.prepare(`
        SELECT name, stock FROM products WHERE id = ?
      `).get(item.productId);
      
      shipmentDetails.push(`${item.name} × ${item.quantity} (остаток: ${updatedProduct.stock})`);
    }
    
    addLog(
      account.id, 
      account.role, 
      account.title, 
      'shipment', 
      `Выданы товары по заявке #${orderId}: ${shipmentDetails.join('; ')}`
    );
  }

  if (account.role === 'driver') {
    if (order.status !== 'shipped') {
      return res.status(400).json({ ok: false, message: 'Заявка должна быть отгружена' });
    }
    if (status !== 'delivered') {
      return res.status(400).json({ ok: false, message: 'Водитель может только подтвердить доставку' });
    }
  }

  db.prepare(`
    UPDATE orders
    SET status = ?, updated_at = (datetime('now', 'localtime'))
    WHERE id = ?
  `).run(status, orderId);

  const updatedOrder = db.prepare(`
    SELECT * FROM orders WHERE id = ?
  `).get(orderId);
  updatedOrder.items = JSON.parse(updatedOrder.items);

  if (account.role !== 'cladman') {
    addLog(
      account.id, 
      account.role, 
      account.title, 
      'order_status_change',
      `Статус заявки #${orderId} изменён на "${status}"`
    );
  }

  res.json({ ok: true, order: updatedOrder });
});

// --- Logs ---
app.get('/api/logs', requireRoleApi('manager'), (req, res) => {
  const logs = db.prepare(`
    SELECT * FROM logs
    ORDER BY id DESC
    LIMIT 100
  `).all();
  res.json({ ok: true, logs });
});

const productImageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, productImageDir);
  },
  filename: function (req, file, cb) {
    const extension = path.extname(file.originalname).toLowerCase();
    const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;
    cb(null, fileName);
  }
});

const productImageUpload = multer({
  storage: productImageStorage,
  limits: {
    fileSize: 3 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    if (!allowedTypes.includes(file.mimetype)) {
      cb(new Error('Можно загружать только JPEG, PNG, WEBP'));
      return;
    }

    cb(null, true);
  }
});

function normalizeText(value, maxLength) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function normalizePrice(value) {
  const price = Number(String(value || '0').replace(',', '.'));

  if (!Number.isFinite(price) || price < 0) {
    return 0;
  }

  return Math.round(price * 100) / 100;
}

function normalizeStock(value) {
  const stock = Number.parseInt(value, 10);

  if (!Number.isFinite(stock) || stock < 0) {
    return 0;
  }

  return Math.min(stock, 100000);
}

app.post(
  '/api/manager/products',
  requireRoleApi('manager'),
  productImageUpload.single('image'),
  function (req, res) {
    const name = normalizeText(req.body.name, 120);
    const description = normalizeText(req.body.description, 500);
    const category = normalizeText(req.body.category, 80);
    const price = normalizePrice(req.body.price);
    const stock = normalizeStock(req.body.stock);

    if (!name) {
      return res.status(400).json({
        ok: false,
        success: false,
        message: 'Введите название товара'
      });
    }

    const imageUrl = req.file
      ? `/uploads/products/${req.file.filename}`
      : '/images/products/no-image.svg';

    const product = createProduct({
      name,
      description,
      category,
      price,
      stock,
      image_url: imageUrl
    });

    if (req.session && req.session.account) {
      addLog(
        req.session.account.id,
        req.session.account.role,
        req.session.account.title,
        'product_created',
        `Добавлен товар: ${product.name}`
      );
    }

    res.json({
      ok: true,
      success: true,
      product
    });
  }
);

app.patch(
  '/api/manager/products/:id',
  requireRoleApi('manager'),
  productImageUpload.single('image'),
  function (req, res) {
    const productId = Number(req.params.id);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({
        ok: false,
        success: false,
        message: 'Некорректный идентификатор товара'
      });
    }

    const name = normalizeText(req.body.name, 120);
    const description = normalizeText(req.body.description, 500);
    const category = normalizeText(req.body.category, 80);
    const price = normalizePrice(req.body.price);
    const stock = normalizeStock(req.body.stock);

    if (!name) {
      return res.status(400).json({
        ok: false,
        success: false,
        message: 'Введите название товара'
      });
    }

    const existingProduct = getProductById(productId);

    if (!existingProduct || existingProduct.is_active !== 1) {
      return res.status(404).json({
        ok: false,
        success: false,
        message: 'Товар не найден'
      });
    }

    const imageUrl = req.file
      ? `/uploads/products/${req.file.filename}`
      : existingProduct.image_url;

    const product = updateProduct(productId, {
      name,
      description,
      category,
      price,
      stock,
      image_url: imageUrl
    });

    if (req.session && req.session.account) {
      addLog(
        req.session.account.id,
        req.session.account.role,
        req.session.account.title,
        'product_updated',
        `Обновлён товар: ${product.name}`
      );
    }

    res.json({
      ok: true,
      success: true,
      product
    });
  }
);

app.use(express.static(__dirname));

// --- 404 ---
app.use((req, res) => {
  res.status(404).send('Страница не найдена');
});

app.use(function (error, req, res, next) {
  console.error(error);

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      ok: false,
      success: false,
      message: 'Файл слишком большой или формат не поддерживается'
    });
  }

  res.status(500).json({
    ok: false,
    success: false,
    message: error.message || 'Внутренняя ошибка сервера'
  });
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});