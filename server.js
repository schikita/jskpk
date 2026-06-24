const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.get('/', (req, res) => {
  res.sendFile(getPage('index.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(getPage('index.html'));
});

app.get('/auth.html', (req, res) => {
  res.sendFile(getPage('auth.html'));
});

app.get('/user-page.html', requireRole('user', 'manager', 'cladman', 'driver'), (req, res) => {
  res.sendFile(getPage('user-page.html'));
});

app.get('/manager-page.html', requireRole('manager'), (req, res) => {
  res.sendFile(getPage('manager-page.html'));
});

app.get('/cladman-page.html', requireRole('cladman'), (req, res) => {
  res.sendFile(getPage('cladman-page.html'));
});

app.get('/driver-page.html', requireRole('driver'), (req, res) => {
  res.sendFile(getPage('driver-page.html'));
});

app.use(express.static(__dirname));

app.get('/api/cookie-consent', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const consent = cookies[CONSENT_COOKIE_NAME] || null;

  res.json({
    ok: true,
    consent
  });
});

app.post('/api/cookie-consent', (req, res) => {
  const consent = String(req.body.consent || '').trim();

  if (!['accepted', 'rejected'].includes(consent)) {
    return res.status(400).json({
      ok: false,
      message: 'Некорректное значение согласия'
    });
  }

  res.cookie(CONSENT_COOKIE_NAME, consent, {
    maxAge: CONSENT_MAX_AGE,
    httpOnly: false,
    sameSite: 'lax',
    secure: false,
    path: '/'
  });

  res.json({
    ok: true,
    consent
  });
});

app.post('/api/login', (req, res) => {
  const role = String(req.body.role || '').trim();

  if (!role) {
    return res.status(400).json({
      ok: false,
      message: 'Выберите роль'
    });
  }

  const account = db.prepare(`
    SELECT id, role, title
    FROM role_accounts
    WHERE role = ?
  `).get(role);

  if (!account) {
    return res.status(401).json({
      ok: false,
      message: 'Некорректная роль'
    });
  }

  req.session.account = {
    id: account.id,
    role: account.role,
    title: account.title
  };

  res.json({
    ok: true,
    account: req.session.account
  });
});

app.post('/api/logout', requireAuth, (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({
        ok: false,
        message: 'Не удалось выйти из системы'
      });
    }

    res.clearCookie('sid');

    res.json({
      ok: true
    });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.account) {
    return res.status(401).json({
      ok: false,
      message: 'Пользователь не авторизован'
    });
  }

  res.json({
    ok: true,
    account: req.session.account
  });
});

app.post('/api/orders', requireAuth, (req, res) => {
  const title = String(req.body.title || '').trim();

  if (!title) {
    return res.status(400).json({
      ok: false,
      message: 'Название заявки обязательно'
    });
  }

  const result = db.prepare(`
    INSERT INTO orders (role, title)
    VALUES (?, ?)
  `).run(req.session.account.role, title);

  const order = db.prepare(`
    SELECT id, role, title, status, created_at
    FROM orders
    WHERE id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({
    ok: true,
    order
  });
});

app.get('/api/orders', requireAuth, (req, res) => {
  let orders;

  if (req.session.account.role === 'manager') {
    orders = db.prepare(`
      SELECT id, role, title, status, created_at
      FROM orders
      ORDER BY id DESC
    `).all();
  } else {
    orders = db.prepare(`
      SELECT id, role, title, status, created_at
      FROM orders
      WHERE role = ?
      ORDER BY id DESC
    `).all(req.session.account.role);
  }

  res.json({
    ok: true,
    orders
  });
});

app.patch('/api/orders/:id/status', requireRole('manager'), (req, res) => {
  const orderId = Number(req.params.id);
  const status = String(req.body.status || '').trim();

  const allowedStatuses = ['new', 'in_work', 'done', 'cancelled'];

  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({
      ok: false,
      message: 'Некорректный ID заявки'
    });
  }

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      ok: false,
      message: 'Некорректный статус'
    });
  }

  const result = db.prepare(`
    UPDATE orders
    SET status = ?
    WHERE id = ?
  `).run(status, orderId);

  if (result.changes === 0) {
    return res.status(404).json({
      ok: false,
      message: 'Заявка не найдена'
    });
  }

  const order = db.prepare(`
    SELECT id, role, title, status, created_at
    FROM orders
    WHERE id = ?
  `).get(orderId);

  res.json({
    ok: true,
    order
  });
});

app.get('/api/products', (req, res) => {
  const products = db.prepare(`
    SELECT id, name, description, category, price, created_at
    FROM products
    ORDER BY id DESC
  `).all();

  res.json({
    ok: true,
    products
  });
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
    return res.status(400).json({
      ok: false,
      message: 'Название товара обязательно'
    });
  }

  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    return res.status(400).json({
      ok: false,
      message: 'Некорректная цена'
    });
  }

  const result = db.prepare(`
    INSERT INTO products (name, description, category, price)
    VALUES (?, ?, ?, ?)
  `).run(name, description, category, price);

  const product = db.prepare(`
    SELECT id, name, description, category, price, created_at
    FROM products
    WHERE id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({
    ok: true,
    product
  });
});

app.use((req, res) => {
  res.status(404).send('Страница не найдена');
});

app.use((error, req, res, next) => {
  console.error(error);

  res.status(500).json({
    ok: false,
    message: 'Внутренняя ошибка сервера'
  });
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});