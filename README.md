# RelayChat — Real-Time Messaging Application

A full-stack, responsive real-time messaging platform built with **React**, **TypeScript**, **Tailwind CSS**, **Node.js**, **Express.js**, **Socket.IO**, **SQLite (`better-sqlite3`)**, **JWT**, **bcryptjs**, and **Multer**.

## Key Features

- **JWT Authentication & Protected Routes**:
  - Account registration and sign-in backed by `bcryptjs` password hashing and `jsonwebtoken` authentication.
  - Client-side route guards block unauthenticated access to `/chat` and redirect to `/login`.
  - Per-tab `sessionStorage` session management allows opening two tabs in the same browser as different users for live multi-user testing.
- **Real-Time Messaging (Socket.IO)**:
  - Instant bi-directional message delivery, read receipts, typing indicators, and persistent SQLite message history.
  - Connection/disconnection detection with automatic reconnection and an actionable reconnect banner on error.
- **Live User Presence Management**:
  - Tracks connected sockets per user on the server and broadcasts `presence:update` events in real time.
  - Displays green `Online` indicators and grey `Offline · Last seen ...` timestamps dynamically without refreshing.
- **File Upload & Previews**:
  - Supports images (`PNG`, `JPG`, `GIF`, `WebP`), `PDF`, `TXT`, `CSV`, Word, Excel, and `ZIP` files up to `10 MB`.
  - Drag-and-drop or paperclip attachment with real `XMLHttpRequest` upload progress (`0–100%`), inline image previews with click-to-lightbox zoom, and authenticated file downloads.
- **Responsive Design**:
  - Clean desktop sidebar + chat workspace that adapts into a master-detail view on mobile and tablet screens.

## Workspace Structure

```text
├── server.ts                  # Express + Socket.IO + Vite entry point (port 3000)
├── server/
│   ├── app.ts                 # REST APIs, Multer uploads, Socket.IO event handlers
│   ├── auth.ts                # JWT signing, verification, and requireAuth middleware
│   └── db.ts                  # SQLite schema initialization & seeded test accounts
├── src/
│   ├── App.tsx                # Protected route navigation (/login, /register, /chat)
│   ├── components/
│   │   ├── Avatar.tsx         # User avatar with initials fallback & live presence dot
│   │   ├── ChatDashboard.tsx  # Main chat workspace, header, messages, drag-drop composer
│   │   ├── ChatSidebar.tsx    # Searchable user directory, filters, profile footer
│   │   ├── LoginView.tsx      # Sign-in screen with quick-fill test accounts
│   │   ├── MessageBubble.tsx  # Sent/received bubbles, image previews, file downloads
│   │   └── RegisterView.tsx   # Account registration form
│   ├── services/
│   │   ├── apiClient.ts       # Authenticated fetch interceptor (Bearer token + 401 handling)
│   │   ├── authService.ts     # Session state & auth endpoints
│   │   ├── chatStore.ts       # Reactive store with idempotent message deduplication
│   │   ├── socketService.ts   # Socket.IO client wrapper & typed event streams
│   │   └── uploadService.ts   # File validation & XHR upload progress
│   ├── types/chat.ts          # Shared TypeScript interfaces
│   └── utils/formatters.ts    # Time, last-seen, file-size, and initials helpers
└── tests/
    └── chat.integration.test.ts  # End-to-end API & Socket.IO integration tests
```

## Installation & Running Locally

```bash
npm install
cp .env.example .env
npm run dev
```

The server listens on `http://localhost:3000`.

### Pre-Seeded Test Accounts

To test real-time messaging and presence across two browser tabs:
- **Tab 1**: `maya@relaychat.dev` / `Password123!`
- **Tab 2**: `liam@relaychat.dev` / `Password123!`
- **Optional 3rd**: `elena@relaychat.dev` / `Password123!`

## Environment Variables

See `.env.example`:

- `JWT_SECRET` — Secret key for signing JWT tokens (set a strong random string in production).
- `CORS_ORIGIN` — Allowed CORS origins (`*` or comma-separated origins).
- `MAX_FILE_SIZE_MB` — Maximum upload size in megabytes (default `10`).

## API & WebSocket Reference

### REST Endpoints

- `POST /api/auth/register` — Register user (`{ name, email, password, role? }`) -> `{ token, user }`
- `POST /api/auth/login` — Authenticate user (`{ email, password }`) -> `{ token, user }`
- `GET /api/auth/me` — Verify JWT and fetch current user (`Authorization: Bearer <token>`)
- `GET /api/users` — List workspace peers with online status, `lastSeen`, `unreadCount`, and `lastMessage`
- `GET /api/messages/:peerId` — Fetch conversation history and mark incoming messages read
- `POST /api/messages` — Send a message (`{ recipientId, content, attachmentId? }`)
- `POST /api/upload` — Upload multipart file (`file`) -> `{ attachment }`
- `GET /api/files/:id` — Stream file inline (JWT required)
- `GET /api/files/:id/download` — Download file as attachment (JWT required)

### Socket.IO Events

- **Auth**: Pass `{ auth: { token } }` during handshake.
- **Client -> Server**: `message:send`, `messages:read`, `typing:start`, `typing:stop`
- **Server -> Client**: `message:new`, `presence:update`, `typing:update`, `messages:read_receipt`, `user:registered`

## Testing & Build

```bash
# Run TypeScript type check
npm run lint

# Run automated API & Socket.IO integration tests
npm test

# Build production client bundle
npm run build

# Start production server
npm start
```
