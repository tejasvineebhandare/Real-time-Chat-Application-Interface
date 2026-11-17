import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface DbUserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  avatar_url: string | null;
  last_seen: number;
  created_at: number;
}

export interface DbAttachmentRow {
  id: string;
  uploader_id: string;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: number;
}

export interface DbMessageRow {
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  attachment_id: string | null;
  created_at: number;
  read_at: number | null;
}

export function initDatabase(dbPath?: string): Database.Database {
  const targetPath = dbPath ?? path.resolve(process.cwd(), 'data', 'relaychat.db');
  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  const db = new Database(targetPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Team Member',
      avatar_url TEXT,
      last_seen INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      uploader_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      content TEXT NOT NULL,
      attachment_id TEXT,
      created_at INTEGER NOT NULL,
      read_at INTEGER,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_pair_time
      ON messages(sender_id, recipient_id, created_at);
  `);

  seedInitialData(db);
  return db;
}

function seedInitialData(db: Database.Database): void {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  if (userCount.count > 0) {
    return;
  }

  const now = Date.now();
  const passwordHash = bcrypt.hashSync('Password123!', 10);

  const mayaId = 'usr_maya_lin';
  const liamId = 'usr_liam_patel';
  const elenaId = 'usr_elena_rostova';

  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, avatar_url, last_seen, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run(
    mayaId,
    'Maya Lin',
    'maya@relaychat.dev',
    passwordHash,
    'Product Designer',
    '/src/assets/images/avatar_maya_lin_1794929630589.jpg',
    now - 1000 * 60 * 12,
    now - 1000 * 60 * 60 * 24 * 7
  );

  insertUser.run(
    liamId,
    'Liam Patel',
    'liam@relaychat.dev',
    passwordHash,
    'Staff Engineer',
    '/src/assets/images/avatar_liam_patel_1794929630023.jpg',
    now - 1000 * 60 * 4,
    now - 1000 * 60 * 60 * 24 * 6
  );

  insertUser.run(
    elenaId,
    'Elena Rostova',
    'elena@relaychat.dev',
    passwordHash,
    'Engineering Lead',
    '/src/assets/images/avatar_elena_rostova_1794929630475.jpg',
    now - 1000 * 60 * 45,
    now - 1000 * 60 * 60 * 24 * 5
  );

  const insertMessage = db.prepare(`
    INSERT INTO messages (id, sender_id, recipient_id, content, attachment_id, created_at, read_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?)
  `);

  insertMessage.run(
    crypto.randomUUID(),
    liamId,
    mayaId,
    'Morning Maya! I pushed the WebSocket presence handler and JWT socket middleware.',
    now - 1000 * 60 * 35,
    now - 1000 * 60 * 30
  );

  insertMessage.run(
    crypto.randomUUID(),
    mayaId,
    liamId,
    'Awesome—just verified the layout on tablet and desktop. Let us test live file uploads across two tabs next.',
    now - 1000 * 60 * 28,
    now - 1000 * 60 * 25
  );

  insertMessage.run(
    crypto.randomUUID(),
    elenaId,
    mayaId,
    'Can you share the updated release checklist PDF before the 2 PM review?',
    now - 1000 * 60 * 50,
    null
  );
}
