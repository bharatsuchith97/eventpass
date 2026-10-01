import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Connect, type Plugin } from 'vite';

/**
 * Two HTML entries: index.html is the static, indexable landing page served at "/", and app.html is the React
 * app shell served for every other page route. In production the API server does this routing (server/src/app.ts);
 * this plugin mirrors it for `vite` and `vite preview`, and fills in the site URL the way the server does.
 */
function landingAndAppShell(): Plugin {
  const appUrl = new URL(process.env.APP_URL ?? 'http://localhost:5173').origin;
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    const path = (req.url ?? '/').split('?')[0]!;
    const isPage = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html');
    const isInternal = /^\/(@|api\/|src\/|node_modules\/)/.test(path) || /\.[a-z0-9]+$/i.test(path);
    if (isPage && !isInternal && path !== '/') req.url = '/app.html';
    next();
  };
  return {
    name: 'eventpass-landing-and-app-shell',
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
    transformIndexHtml: {
      order: 'pre',
      handler: (html, ctx) => (ctx.server ? html.replaceAll('__APP_URL__', appUrl) : html),
    },
  };
}

export default defineConfig({
  plugins: [react(), landingAndAppShell()],
  resolve: { preserveSymlinks: true },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: false } },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: { landing: resolve(__dirname, 'index.html'), app: resolve(__dirname, 'app.html') },
      output: {
        manualChunks: {
          mui: ['@mui/material', '@mui/icons-material'],
          charts: ['recharts'],
        },
      },
    },
  },
});
