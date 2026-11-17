import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { io as createSocketClient, type Socket } from 'socket.io-client';
import { createChatServer, type ServerBundle } from '../server/app.ts';

let bundle: ServerBundle;
let baseUrl: string;
let tempDir: string;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relaychat-test-'));
  bundle = createChatServer({
    dbPath: path.join(tempDir, 'test.db'),
    uploadsDir: path.join(tempDir, 'uploads'),
  });

  await new Promise<void>((resolve) => {
    bundle.httpServer.listen(0, '127.0.0.1', () => {
      const address = bundle.httpServer.address();
      if (address && typeof address === 'object') {
        baseUrl = `http://127.0.0.1:${address.port}`;
      }
      resolve();
    });
  });
});

after(async () => {
  bundle.io.close();
  await new Promise<void>((resolve) => bundle.httpServer.close(() => resolve()));
  bundle.db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function connectClient(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createSocketClient(baseUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
  });
}

test('rejects unauthenticated access to protected API routes and WebSocket', async () => {
  const usersRes = await fetch(`${baseUrl}/api/users`);
  assert.equal(usersRes.status, 401);

  const msgsRes = await fetch(`${baseUrl}/api/messages/usr_maya_lin`);
  assert.equal(msgsRes.status, 401);

  const uploadRes = await fetch(`${baseUrl}/api/upload`, { method: 'POST' });
  assert.equal(uploadRes.status, 401);

  await assert.rejects(
    () => connectClient('invalid.jwt.token'),
    (err: Error) => err.message.includes('Invalid') || err.message.includes('Authentication')
  );
});

test('registers a new user, rejects duplicates, and logs in with JWT', async () => {
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Jordan Brooks',
      email: 'jordan@relaychat.dev',
      password: 'Password123!',
      role: 'QA Engineer',
    }),
  });
  assert.equal(regRes.status, 201);
  const regData = await regRes.json();
  assert.ok(regData.token);
  assert.equal(regData.user.email, 'jordan@relaychat.dev');

  // Duplicate email check
  const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Jordan Duplicate',
      email: 'jordan@relaychat.dev',
      password: 'Password123!',
    }),
  });
  assert.equal(dupRes.status, 409);

  // Login check
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'jordan@relaychat.dev',
      password: 'Password123!',
    }),
  });
  assert.equal(loginRes.status, 200);
  const loginData = await loginRes.json();
  assert.ok(loginData.token);

  const meRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${loginData.token}` },
  });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData.user.id, regData.user.id);
});

test('delivers real-time messages and updates online/offline user presence over Socket.IO', async () => {
  const mayaLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'maya@relaychat.dev', password: 'Password123!' }),
  }).then((r) => r.json());

  const liamLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'liam@relaychat.dev', password: 'Password123!' }),
  }).then((r) => r.json());

  const mayaSocket = await connectClient(mayaLogin.token);

  const liamOnlinePromise = new Promise<{ userId: string; online: boolean }>((resolve) => {
    mayaSocket.on('presence:update', (evt) => {
      if (evt.userId === liamLogin.user.id && evt.online === true) {
        resolve(evt);
      }
    });
  });

  const liamSocket = await connectClient(liamLogin.token);
  const onlineEvt = await liamOnlinePromise;
  assert.equal(onlineEvt.online, true);

  // Send a real-time message from Liam to Maya
  const incomingMessagePromise = new Promise<{ content: string; senderId: string }>((resolve) => {
    mayaSocket.once('message:new', (msg) => resolve(msg));
  });

  const ack = await new Promise<{ ok: boolean; message?: { id: string } }>((resolve) => {
    liamSocket.emit(
      'message:send',
      {
        recipientId: mayaLogin.user.id,
        content: 'Integration test ping from Liam',
      },
      resolve
    );
  });

  assert.equal(ack.ok, true);
  const received = await incomingMessagePromise;
  assert.equal(received.content, 'Integration test ping from Liam');
  assert.equal(received.senderId, liamLogin.user.id);

  // Verify disconnection broadcasts offline presence with lastSeen
  const liamOfflinePromise = new Promise<{ userId: string; online: boolean; lastSeen: number }>(
    (resolve) => {
      mayaSocket.on('presence:update', (evt) => {
        if (evt.userId === liamLogin.user.id && evt.online === false) {
          resolve(evt);
        }
      });
    }
  );

  liamSocket.disconnect();
  const offlineEvt = await liamOfflinePromise;
  assert.equal(offlineEvt.online, false);
  assert.ok(offlineEvt.lastSeen > 0);

  mayaSocket.disconnect();
});

test('uploads valid attachments, rejects unsupported types, and downloads files securely', async () => {
  const mayaLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'maya@relaychat.dev', password: 'Password123!' }),
  }).then((r) => r.json());

  const validForm = new FormData();
  validForm.append('file', new Blob(['RelayChat release notes v1'], { type: 'text/plain' }), 'notes.txt');

  const uploadRes = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mayaLogin.token}` },
    body: validForm,
  });
  assert.equal(uploadRes.status, 201);
  const uploadData = await uploadRes.json();
  assert.equal(uploadData.attachment.originalName, 'notes.txt');

  const downloadRes = await fetch(`${baseUrl}${uploadData.attachment.downloadUrl}`, {
    headers: { Authorization: `Bearer ${mayaLogin.token}` },
  });
  assert.equal(downloadRes.status, 200);
  const downloadedText = await downloadRes.text();
  assert.equal(downloadedText, 'RelayChat release notes v1');

  // Disallowed file type
  const invalidForm = new FormData();
  invalidForm.append(
    'file',
    new Blob(['#!/bin/sh'], { type: 'application/x-sh' }),
    'script.sh'
  );
  const invalidRes = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mayaLogin.token}` },
    body: invalidForm,
  });
  assert.equal(invalidRes.status, 400);
});
