require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

// Environment
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const NODE_ENV = process.env.NODE_ENV || 'development';
const DB_FILE = process.env.DATABASE_FILE || path.join(__dirname, 'data.sqlite');

// Database init
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_type TEXT NOT NULL,
  days_json TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  activities_json TEXT,
  comments TEXT,
  total_price INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL,
  user_id INTEGER,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
`);

// App
const app = express();
app.use(helmet({
  contentSecurityPolicy: NODE_ENV === 'production' ? undefined : false,
}));
app.use(cors()); // Static served from same origin; kept permissive for simplicity
app.use(express.json());
app.use(morgan('dev'));

// Helpers
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Jeton invalide' });
  }
}

// API Routes
const api = express.Router();

// Health
api.get('/health', (req, res) => {
  res.json({ ok: true, env: NODE_ENV });
});

// Auth: Register
api.post('/auth/register', (req, res) => {
  const { firstName, lastName, email, password } = req.body || {};
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Mot de passe trop court (min 8)' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  try {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: 'Email déjà utilisé' });
    }
    const passwordHash = bcrypt.hashSync(password, 10);
    const info = db
      .prepare('INSERT INTO users (first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?)')
      .run(firstName, lastName, normalizedEmail, passwordHash);
    const userId = info.lastInsertRowid;
    const token = signToken({ userId, email: normalizedEmail });
    return res.status(201).json({
      token,
      user: { id: userId, firstName, lastName, email: normalizedEmail },
    });
  } catch (err) {
    console.error('Register error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Auth: Login
api.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
    if (!user) return res.status(401).json({ error: 'Identifiants invalides' });
    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Identifiants invalides' });
    const token = signToken({ userId: user.id, email: normalizedEmail });
    return res.json({
      token,
      user: { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email },
    });
  } catch (err) {
    console.error('Login error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Contact
api.post('/contact', (req, res) => {
  const { name, email, subject, message } = req.body || {};
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'Tous les champs sont requis' });
  }
  try {
    db.prepare('INSERT INTO contacts (name, email, subject, message) VALUES (?, ?, ?, ?)')
      .run(name, email, subject, message);
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Contact error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Reservations
const TICKET_PRICES = { student: 5000, pro: 10000, vip: 20000 };
api.post('/reservations', (req, res) => {
  const {
    ticketType,
    days,
    quantity,
    firstName,
    lastName,
    email,
    phone,
    activities,
    comments,
  } = req.body || {};

  if (!ticketType || !Array.isArray(days) || days.length === 0 || !quantity || !firstName || !lastName || !email) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }
  if (!Object.prototype.hasOwnProperty.call(TICKET_PRICES, ticketType)) {
    return res.status(400).json({ error: 'Type de billet invalide' });
  }
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 100) {
    return res.status(400).json({ error: 'Quantité invalide' });
  }
  const daysCount = days.length;
  const base = TICKET_PRICES[ticketType];
  const total = base * daysCount * qty;

  try {
    const info = db.prepare(
      `INSERT INTO reservations (
        ticket_type, days_json, quantity, first_name, last_name, email, phone, activities_json, comments, total_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      ticketType,
      JSON.stringify(days),
      qty,
      firstName,
      lastName,
      email,
      phone || null,
      activities ? JSON.stringify(activities) : null,
      comments || null,
      total
    );
    return res.status(201).json({ ok: true, reservationId: info.lastInsertRowid, total });
  } catch (err) {
    console.error('Reservation error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Forum minimal
api.get('/forum/topics', (req, res) => {
  const { category } = req.query;
  try {
    const rows = category
      ? db.prepare('SELECT * FROM topics WHERE category = ? ORDER BY created_at DESC').all(category)
      : db.prepare('SELECT * FROM topics ORDER BY created_at DESC').all();
    return res.json({ topics: rows });
  } catch (err) {
    console.error('Get topics error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

api.post('/forum/topics', authMiddleware, (req, res) => {
  const { title, category } = req.body || {};
  if (!title || !category) return res.status(400).json({ error: 'Titre et catégorie requis' });
  try {
    const info = db.prepare('INSERT INTO topics (title, category, created_by) VALUES (?, ?, ?)')
      .run(title, category, req.user.userId || null);
    return res.status(201).json({ ok: true, topicId: info.lastInsertRowid });
  } catch (err) {
    console.error('Create topic error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

api.get('/forum/topics/:id/posts', (req, res) => {
  const topicId = Number(req.params.id);
  if (!Number.isInteger(topicId)) return res.status(400).json({ error: 'ID invalide' });
  try {
    const posts = db.prepare('SELECT * FROM posts WHERE topic_id = ? ORDER BY created_at ASC').all(topicId);
    return res.json({ posts });
  } catch (err) {
    console.error('Get posts error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

api.post('/forum/topics/:id/posts', authMiddleware, (req, res) => {
  const topicId = Number(req.params.id);
  const { content } = req.body || {};
  if (!Number.isInteger(topicId)) return res.status(400).json({ error: 'ID invalide' });
  if (!content) return res.status(400).json({ error: 'Contenu requis' });
  try {
    const info = db.prepare('INSERT INTO posts (topic_id, user_id, content) VALUES (?, ?, ?)')
      .run(topicId, req.user.userId || null, content);
    return res.status(201).json({ ok: true, postId: info.lastInsertRowid });
  } catch (err) {
    console.error('Create post error', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.use('/api', api);

// Serve static site from project root
app.use(express.static(__dirname));

// Fallback: serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 404 for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Route API introuvable' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
