import bcrypt from 'bcryptjs';
import cors from 'cors';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import multer from 'multer';
import path from 'node:path';
import { Server as SocketIOServer } from 'socket.io';
import type Database from 'better-sqlite3';
import {
  requireAuth,
  signAuthToken,
  verifyAuthToken,
  type AuthenticatedRequest,
} from './auth.ts';
import {
  initDatabase,
  type DbAttachmentRow,
  type DbMessageRow,
  type DbUserRow,
} from './db.ts';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
]);

export interface CreateServerOptions {
  dbPath?: string;
  uploadsDir?: string;
}

export interface ServerBundle {
  app: express.Express;
  httpServer: http.Server;
  io: SocketIOServer;
  db: Database.Database;
  uploadsDir: string;
}

export function createChatServer(options: CreateServerOptions = {}): ServerBundle {
  const db = initDatabase(options.dbPath);
  const uploadsDir = options.uploadsDir ?? path.resolve(process.cwd(), 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const maxFileMb = Number(process.env.MAX_FILE_SIZE_MB || '10');
  const maxFileBytes = (Number.isFinite(maxFileMb) && maxFileMb > 0 ? maxFileMb : 10) * 1024 * 1024;

  const corsOriginEnv = process.env.CORS_ORIGIN || '*';
  const corsOrigins =
    corsOriginEnv === '*'
      ? true
      : corsOriginEnv
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean);

  const app = express();
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
    })
  );
  app.use(express.json({ limit: '1mb' }));

  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigins,
      credentials: true,
    },
  });

  // Track active socket IDs per userId for accurate real-time presence
  const onlineUsers = new Map<string, Set<string>>();

  const isUserOnline = (userId: string): boolean => {
    const sockets = onlineUsers.get(userId);
    return Boolean(sockets && sockets.size > 0);
  };

  const toPublicUser = (row: DbUserRow) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    avatarUrl: row.avatar_url,
    lastSeen: row.last_seen,
    online: isUserOnline(row.id),
  });

  const hydrateMessage = (row: DbMessageRow, attachmentRow?: DbAttachmentRow | null) => {
    let attachment = attachmentRow ?? null;
    if (!attachment && row.attachment_id) {
      attachment =
        (db.prepare('SELECT * FROM attachments WHERE id = ?').get(row.attachment_id) as
          | DbAttachmentRow
          | undefined) ?? null;
    }

    return {
      id: row.id,
      senderId: row.sender_id,
      recipientId: row.recipient_id,
      content: row.content,
      attachment: attachment
        ? {
            id: attachment.id,
            originalName: attachment.original_name,
            mimeType: attachment.mime_type,
            sizeBytes: attachment.size_bytes,
            url: `/api/files/${attachment.id}`,
            downloadUrl: `/api/files/${attachment.id}/download`,
          }
        : null,
      createdAt: row.created_at,
      readAt: row.read_at,
    };
  };

  // --- Healthcheck ---
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', onlineCount: onlineUsers.size });
  });

  // --- Auth Routes ---
  app.post('/api/auth/register', async (req, res) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const role =
        typeof req.body?.role === 'string' && req.body.role.trim().length > 0
          ? req.body.role.trim().slice(0, 48)
          : 'Team Member';

      if (name.length < 2) {
        res.status(400).json({ error: 'Name must be at least 2 characters.' });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ error: 'Please enter a valid email address.' });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ error: 'Password must be at least 6 characters.' });
        return;
      }

      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) {
        res.status(409).json({ error: 'An account with this email already exists.' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const now = Date.now();
      const userId = `usr_${crypto.randomUUID()}`;

      db.prepare(
        `INSERT INTO users (id, name, email, password_hash, role, avatar_url, last_seen, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
      ).run(userId, name, email, passwordHash, role, now, now);

      const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as DbUserRow;
      const token = signAuthToken({ sub: userRow.id, email: userRow.email, name: userRow.name });

      // Notify connected clients that a new user joined the directory
      io.emit('user:registered', toPublicUser(userRow));

      res.status(201).json({
        token,
        user: toPublicUser(userRow),
      });
    } catch {
      res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }

      const userRow = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
        | DbUserRow
        | undefined;
      if (!userRow) {
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      const valid = await bcrypt.compare(password, userRow.password_hash);
      if (!valid) {
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      const now = Date.now();
      db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now, userRow.id);
      userRow.last_seen = now;

      const token = signAuthToken({ sub: userRow.id, email: userRow.email, name: userRow.name });
      res.json({
        token,
        user: toPublicUser(userRow),
      });
    } catch {
      res.status(500).json({ error: 'Login failed. Please try again.' });
    }
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.sub) as
      | DbUserRow
      | undefined;
    if (!userRow) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }
    res.json({ user: toPublicUser(userRow) });
  });

  // --- Users & Directory ---
  app.get('/api/users', requireAuth, (req: AuthenticatedRequest, res) => {
    const currentUserId = req.user!.sub;
    const rows = db
      .prepare('SELECT * FROM users WHERE id != ? ORDER BY name COLLATE NOCASE ASC')
      .all(currentUserId) as DbUserRow[];

    const peers = rows.map((row) => {
      const lastMsg = db
        .prepare(
          `SELECT id, sender_id, content, attachment_id, created_at
           FROM messages
           WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .get(currentUserId, row.id, row.id, currentUserId) as
        | {
            id: string;
            sender_id: string;
            content: string;
            attachment_id: string | null;
            created_at: number;
          }
        | undefined;

      const unread = db
        .prepare(
          `SELECT COUNT(*) AS count FROM messages
           WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL`
        )
        .get(row.id, currentUserId) as { count: number };

      return {
        ...toPublicUser(row),
        unreadCount: unread.count,
        lastMessage: lastMsg
          ? {
              id: lastMsg.id,
              content: lastMsg.content,
              senderId: lastMsg.sender_id,
              createdAt: lastMsg.created_at,
              hasAttachment: Boolean(lastMsg.attachment_id),
            }
          : null,
      };
    });

    res.json({ users: peers });
  });

  // --- Conversation History ---
  app.get('/api/messages/:peerId', requireAuth, (req: AuthenticatedRequest, res) => {
    const currentUserId = req.user!.sub;
    const peerId = req.params.peerId;

    const peerExists = db.prepare('SELECT id FROM users WHERE id = ?').get(peerId);
    if (!peerExists) {
      res.status(404).json({ error: 'Conversation user not found.' });
      return;
    }

    const now = Date.now();
    const markResult = db
      .prepare(
        `UPDATE messages SET read_at = ?
         WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL`
      )
      .run(now, peerId, currentUserId);

    if (markResult.changes > 0) {
      io.to(`user:${peerId}`).emit('messages:read_receipt', {
        peerId: currentUserId,
        readAt: now,
      });
    }

    const rows = db
      .prepare(
        `SELECT * FROM messages
         WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
         ORDER BY created_at ASC`
      )
      .all(currentUserId, peerId, peerId, currentUserId) as DbMessageRow[];

    res.json({
      messages: rows.map((row) => hydrateMessage(row)),
    });
  });

  app.post('/api/messages', requireAuth, (req: AuthenticatedRequest, res) => {
    const senderId = req.user!.sub;
    const recipientId = typeof req.body?.recipientId === 'string' ? req.body.recipientId : '';
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    const attachmentId =
      typeof req.body?.attachmentId === 'string' && req.body.attachmentId.length > 0
        ? req.body.attachmentId
        : null;

    if (!recipientId) {
      res.status(400).json({ error: 'Recipient ID is required.' });
      return;
    }

    const recipient = db.prepare('SELECT id FROM users WHERE id = ?').get(recipientId);
    if (!recipient) {
      res.status(404).json({ error: 'Recipient user not found.' });
      return;
    }

    let attachmentRow: DbAttachmentRow | null = null;
    if (attachmentId) {
      attachmentRow =
        (db
          .prepare('SELECT * FROM attachments WHERE id = ? AND uploader_id = ?')
          .get(attachmentId, senderId) as DbAttachmentRow | undefined) ?? null;
      if (!attachmentRow) {
        res.status(400).json({ error: 'Invalid or unauthorized attachment reference.' });
        return;
      }
    }

    if (!content && !attachmentRow) {
      res.status(400).json({ error: 'Message content or attachment is required.' });
      return;
    }

    const messageRow: DbMessageRow = {
      id: crypto.randomUUID(),
      sender_id: senderId,
      recipient_id: recipientId,
      content,
      attachment_id: attachmentRow?.id ?? null,
      created_at: Date.now(),
      read_at: null,
    };

    db.prepare(
      `INSERT INTO messages (id, sender_id, recipient_id, content, attachment_id, created_at, read_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`
    ).run(
      messageRow.id,
      messageRow.sender_id,
      messageRow.recipient_id,
      messageRow.content,
      messageRow.attachment_id,
      messageRow.created_at
    );

    const hydrated = hydrateMessage(messageRow, attachmentRow);
    io.to(`user:${recipientId}`).to(`user:${senderId}`).emit('message:new', hydrated);
    res.status(201).json({ message: hydrated });
  });

  // --- File Upload & Download ---
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12);
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: maxFileBytes },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        cb(
          new Error(
            'Unsupported file type. Allowed: images (PNG, JPG, GIF, WebP), PDF, TXT, CSV, Word, Excel, and ZIP.'
          )
        );
        return;
      }
      cb(null, true);
    },
  });

  app.post('/api/upload', requireAuth, (req: AuthenticatedRequest, res) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({ error: `File exceeds the ${maxFileMb} MB size limit.` });
          return;
        }
        const message = err instanceof Error ? err.message : 'File upload failed.';
        res.status(400).json({ error: message });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'No file provided.' });
        return;
      }

      const attachmentId = `att_${crypto.randomUUID()}`;
      const now = Date.now();

      db.prepare(
        `INSERT INTO attachments (id, uploader_id, original_name, stored_name, mime_type, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        attachmentId,
        req.user!.sub,
        req.file.originalname,
        req.file.filename,
        req.file.mimetype,
        req.file.size,
        now
      );

      res.status(201).json({
        attachment: {
          id: attachmentId,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          url: `/api/files/${attachmentId}`,
          downloadUrl: `/api/files/${attachmentId}/download`,
        },
      });
    });
  });

  app.get('/api/files/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const attachment = db
      .prepare('SELECT * FROM attachments WHERE id = ?')
      .get(req.params.id) as DbAttachmentRow | undefined;

    if (!attachment) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    const filePath = path.resolve(uploadsDir, path.basename(attachment.stored_name));
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Stored file missing on disk.' });
      return;
    }

    res.setHeader('Content-Type', attachment.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.original_name)}"`);
    res.sendFile(filePath);
  });

  app.get('/api/files/:id/download', requireAuth, (req: AuthenticatedRequest, res) => {
    const attachment = db
      .prepare('SELECT * FROM attachments WHERE id = ?')
      .get(req.params.id) as DbAttachmentRow | undefined;

    if (!attachment) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    const filePath = path.resolve(uploadsDir, path.basename(attachment.stored_name));
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Stored file missing on disk.' });
      return;
    }

    res.download(filePath, attachment.original_name);
  });

  // --- Socket.IO Authentication & Real-Time Events ---
  io.use((socket, next) => {
    const token =
      typeof socket.handshake.auth?.token === 'string'
        ? socket.handshake.auth.token
        : typeof socket.handshake.query?.token === 'string'
          ? socket.handshake.query.token
          : '';

    if (!token) {
      next(new Error('Authentication required'));
      return;
    }

    try {
      const payload = verifyAuthToken(token);
      socket.data.user = payload;
      next();
    } catch {
      next(new Error('Invalid or expired authentication token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as { sub: string; email: string; name: string };
    const userId = user.sub;

    socket.join(`user:${userId}`);

    let sockets = onlineUsers.get(userId);
    const wasOffline = !sockets || sockets.size === 0;
    if (!sockets) {
      sockets = new Set<string>();
      onlineUsers.set(userId, sockets);
    }
    sockets.add(socket.id);

    const now = Date.now();
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now, userId);

    if (wasOffline) {
      io.emit('presence:update', {
        userId,
        online: true,
        lastSeen: now,
      });
    }

    socket.on(
      'message:send',
      (
        payload: {
          recipientId?: string;
          content?: string;
          attachmentId?: string | null;
          clientMessageId?: string;
        },
        ack?: (res: { ok: boolean; message?: ReturnType<typeof hydrateMessage>; error?: string }) => void
      ) => {
        try {
          const recipientId = typeof payload?.recipientId === 'string' ? payload.recipientId : '';
          const content = typeof payload?.content === 'string' ? payload.content.trim() : '';
          const attachmentId =
            typeof payload?.attachmentId === 'string' && payload.attachmentId.length > 0
              ? payload.attachmentId
              : null;

          if (!recipientId) {
            ack?.({ ok: false, error: 'Recipient ID is required.' });
            return;
          }

          const recipient = db.prepare('SELECT id FROM users WHERE id = ?').get(recipientId);
          if (!recipient) {
            ack?.({ ok: false, error: 'Recipient not found.' });
            return;
          }

          let attachmentRow: DbAttachmentRow | null = null;
          if (attachmentId) {
            attachmentRow =
              (db
                .prepare('SELECT * FROM attachments WHERE id = ? AND uploader_id = ?')
                .get(attachmentId, userId) as DbAttachmentRow | undefined) ?? null;
            if (!attachmentRow) {
              ack?.({ ok: false, error: 'Invalid attachment reference.' });
              return;
            }
          }

          if (!content && !attachmentRow) {
            ack?.({ ok: false, error: 'Message cannot be empty.' });
            return;
          }

          const messageRow: DbMessageRow = {
            id: crypto.randomUUID(),
            sender_id: userId,
            recipient_id: recipientId,
            content,
            attachment_id: attachmentRow?.id ?? null,
            created_at: Date.now(),
            read_at: null,
          };

          db.prepare(
            `INSERT INTO messages (id, sender_id, recipient_id, content, attachment_id, created_at, read_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL)`
          ).run(
            messageRow.id,
            messageRow.sender_id,
            messageRow.recipient_id,
            messageRow.content,
            messageRow.attachment_id,
            messageRow.created_at
          );

          const hydrated = {
            ...hydrateMessage(messageRow, attachmentRow),
            clientMessageId: payload?.clientMessageId,
          };

          io.to(`user:${recipientId}`).to(`user:${userId}`).emit('message:new', hydrated);
          ack?.({ ok: true, message: hydrated });
        } catch {
          ack?.({ ok: false, error: 'Failed to send message.' });
        }
      }
    );

    socket.on('messages:read', (payload: { peerId?: string }) => {
      const peerId = typeof payload?.peerId === 'string' ? payload.peerId : '';
      if (!peerId) return;

      const readAt = Date.now();
      const result = db
        .prepare(
          `UPDATE messages SET read_at = ?
           WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL`
        )
        .run(readAt, peerId, userId);

      if (result.changes > 0) {
        io.to(`user:${peerId}`).emit('messages:read_receipt', {
          peerId: userId,
          readAt,
        });
      }
    });

    socket.on('typing:start', (payload: { recipientId?: string }) => {
      if (typeof payload?.recipientId === 'string' && payload.recipientId) {
        io.to(`user:${payload.recipientId}`).emit('typing:update', {
          userId,
          isTyping: true,
        });
      }
    });

    socket.on('typing:stop', (payload: { recipientId?: string }) => {
      if (typeof payload?.recipientId === 'string' && payload.recipientId) {
        io.to(`user:${payload.recipientId}`).emit('typing:update', {
          userId,
          isTyping: false,
        });
      }
    });

    socket.on('disconnect', () => {
      const currentSockets = onlineUsers.get(userId);
      if (currentSockets) {
        currentSockets.delete(socket.id);
        if (currentSockets.size === 0) {
          onlineUsers.delete(userId);
          const lastSeen = Date.now();
          db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(lastSeen, userId);
          io.emit('presence:update', {
            userId,
            online: false,
            lastSeen,
          });
        }
      }
    });
  });

  return { app, httpServer, io, db, uploadsDir };
}
