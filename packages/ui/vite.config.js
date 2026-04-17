import { defineConfig, loadEnv, createLogger } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'fs';
import { resolve } from 'path';
export default defineConfig(({ mode }) => {
    // Load env from monorepo root (two levels up from packages/ui)
    const env = loadEnv(mode, resolve(__dirname, '../..'), '');
    // Read version from core package.json (single source of truth)
    const corePkg = JSON.parse(readFileSync(resolve(__dirname, '../core/package.json'), 'utf-8'));
    const uiPort = parseInt(env.UI_PORT || '5173', 10);
    const apiPort = env.PORT || '8080';
    const apiTarget = `http://127.0.0.1:${apiPort}`;
    const wsTarget = `ws://127.0.0.1:${apiPort}`;
    // Filter out "ws proxy error" noise from Claude Desktop Preview Panel.
    // The embedded browser has no auth token, so gateway rejects WS upgrades
    // with 401. This is expected and harmless — UI works fine without realtime.
    const logger = createLogger();
    const originalError = logger.error.bind(logger);
    logger.error = (msg, options) => {
        if (typeof msg === 'string' && msg.includes('ws proxy error'))
            return;
        originalError(msg, options);
    };
    return {
        customLogger: logger,
        plugins: [react(), tailwindcss()],
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
            ...(env.VITE_API_BASE ? {} : {
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
            sourcemap: true,
            rollupOptions: {
                output: {
                    manualChunks(id) {
                        // Vendor chunks (node_modules only)
                        if (id.includes('node_modules')) {
                            if (id.includes('/react-dom/') ||
                                id.includes('/react/') ||
                                id.includes('/react-router') ||
                                id.includes('/scheduler/')) {
                                return 'vendor-react';
                            }
                            if (id.includes('/prism-react-renderer/')) {
                                return 'vendor-prism';
                            }
                            return; // let Rollup decide for other deps
                        }
                        // App chunks (source code only)
                        if (id.includes('/components/icons'))
                            return 'icons';
                        if (id.includes('/src/api/'))
                            return 'api';
                        if (id.includes('/src/hooks/'))
                            return 'stores';
                    },
                },
            },
        },
    };
});
