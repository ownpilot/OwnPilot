import { defineConfig, loadEnv, createLogger } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Plugin } from 'vite';

/**
 * Fail the build if the emitted CSS is suspiciously small.
 *
 * Tailwind v4 scans source files with the native `@tailwindcss/oxide` addon.
 * If that native binary fails to load (e.g. a corrupt platform package on
 * Windows), oxide silently falls back to its WASM build, which scans nothing
 * and emits a utility-less stylesheet (~13 KB instead of ~250 KB) — with no
 * error. That ships an entirely unstyled UI, including in Docker images.
 * A healthy build is hundreds of KB; 80 KB is far above the broken case and
 * far below any legitimate output, so it cleanly distinguishes the two.
 */
function cssSizeGuard(minBytes = 80_000): Plugin {
  return {
    name: 'css-size-guard',
    apply: 'build',
    writeBundle(_options, bundle) {
      let total = 0;
      for (const [name, asset] of Object.entries(bundle)) {
        if (name.endsWith('.css') && asset.type === 'asset') {
          const src = asset.source;
          total += typeof src === 'string' ? Buffer.byteLength(src) : src.byteLength;
        }
      }
      if (total < minBytes) {
        throw new Error(
          `[css-size-guard] Emitted CSS is only ${total} bytes (< ${minBytes}). ` +
            `Tailwind likely generated no utilities — the native @tailwindcss/oxide ` +
            `scanner probably failed and fell back to WASM. Repair the install ` +
            `(pnpm install --force) before shipping.`
        );
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load env from monorepo root (two levels up from packages/ui)
  const env = loadEnv(mode, resolve(__dirname, '../..'), '');

  // Read version from core package.json (single source of truth)
  const corePkg = JSON.parse(readFileSync(resolve(__dirname, '../core/package.json'), 'utf-8'));

  const uiPort = parseInt(env.UI_PORT || '8199', 10);
  const apiPort = env.PORT || '8080';
  const apiTarget = `http://127.0.0.1:${apiPort}`;
  const wsTarget = `ws://127.0.0.1:${apiPort}`;

  // Filter out "ws proxy error" noise from Claude Desktop Preview Panel.
  // The embedded browser has no auth token, so gateway rejects WS upgrades
  // with 401. This is expected and harmless — UI works fine without realtime.
  const logger = createLogger();
  const originalError = logger.error.bind(logger);
  logger.error = (msg, options) => {
    if (typeof msg === 'string' && msg.includes('ws proxy error')) return;
    originalError(msg, options);
  };

  // Bundle visualizer: emits `dist/bundle-stats.html` (treemap) when
  // `ANALYZE=true` is set. Use locally to spot vendor-chunk bloat; CI can
  // upload the artifact for size-diff review.
  const enableVisualizer = env.ANALYZE === 'true';

  return {
    customLogger: logger,
    plugins: [
      react(),
      tailwindcss(),
      cssSizeGuard(),
      ...(enableVisualizer
        ? [
            visualizer({
              filename: 'dist/bundle-stats.html',
              template: 'treemap',
              gzipSize: true,
              brotliSize: true,
              open: false,
            }),
          ]
        : []),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(corePkg.version),
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    server: {
      port: uiPort,
      // NOTE: Vite 7.3.1 built-in proxy is broken on Node.js 24.
      // In dev mode with VITE_API_BASE set, the UI fetches directly from gateway.
      // Without VITE_API_BASE, proxy is used (works on Node 22).
      ...(env.VITE_API_BASE
        ? {}
        : {
            proxy: {
              '/api': {
                target: apiTarget,
                changeOrigin: true,
              },
              '/ws': {
                target: wsTarget,
                ws: true,
                changeOrigin: true,
              },
            },
          }),
    },
    build: {
      outDir: 'dist',
      // Production builds should not ship source maps — they leak the entire
      // TypeScript source tree, including auth flows and tool implementations,
      // through `gateway` `serveStatic('/assets/*')`. Set `VITE_SOURCEMAP=true`
      // to opt back in for staging/debug builds.
      sourcemap: env.VITE_SOURCEMAP === 'true' ? true : mode !== 'production',
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Vendor chunks (node_modules only)
            if (id.includes('node_modules')) {
              if (
                id.includes('/react-dom/') ||
                id.includes('/react/') ||
                id.includes('/react-router') ||
                id.includes('/scheduler/')
              ) {
                return 'vendor-react';
              }
              if (id.includes('/prism-react-renderer/')) {
                return 'vendor-prism';
              }
              return; // let Rollup decide for other deps
            }
            // App chunks (source code only)
            if (id.includes('/components/icons')) return 'icons';
            if (id.includes('/src/api/')) return 'api';
            if (id.includes('/src/hooks/')) return 'stores';
          },
        },
      },
    },
  };
});
