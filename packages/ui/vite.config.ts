import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  // Load env from monorepo root (two levels up from packages/ui)
  const env = loadEnv(mode, resolve(__dirname, '../..'), '');

  const uiPort = parseInt(env.UI_PORT || '5173', 10);
  const apiPort = env.PORT || '8080';
  const apiTarget = `http://localhost:${apiPort}`;
  const wsTarget = `ws://localhost:${apiPort}`;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    server: {
      port: uiPort,
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
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
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
