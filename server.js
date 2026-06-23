const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const helmet = require('helmet');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
    contentSecurityPolicy: false
}));

app.use(
    session({
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
    })
);

function getPage(fileName) {
    return path.join(__dirname, fileName);
}

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
            return res.status(403).send('Недостаточно прав для простомтра страницы');
        }

        next();
    }
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
