import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createChatServer } from './server/app.ts';

async function start(): Promise<void> {
  const { app, httpServer } = createChatServer();
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT || '3000');
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`RelayChat server listening on http://0.0.0.0:${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start RelayChat server:', error);
  process.exit(1);
});
