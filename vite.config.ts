import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

// The dev server must be reachable from the preview proxy, and the proxy
// hostname is supplied per process through __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS.
// Vite 5 does not read that variable itself, so parse it here instead of
// hardcoding a hostname in this file.
const allowedHosts = (process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [
    react(),
    {
      // Never let the SPA fallback answer a missing glyph range with HTML: the
      // PBF parser would throw and block map loading.
      name: 'night-map-font-404',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/fonts/') && req.url.endsWith('.pbf')) {
            const file = path.join(process.cwd(), 'public', decodeURIComponent(req.url.split('?')[0]));
            if (!fs.existsSync(file)) {
              res.statusCode = 404;
              res.end('glyph range not shipped');
              return;
            }
          }
          next();
        });
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    ...(allowedHosts.length ? { allowedHosts } : {}),
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    ...(allowedHosts.length ? { allowedHosts } : {}),
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 3000,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
