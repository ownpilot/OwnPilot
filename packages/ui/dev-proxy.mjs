/**
 * Minimal reverse proxy for dev mode.
 * Vite 7.3.1's built-in http-proxy is broken on Node.js 24.
 * This bridges /api/* and /ws to the gateway on port 8080, adding CORS headers.
 *
 * Usage: node dev-proxy.mjs [proxy-port] [target-port]
 */
import { createServer, request } from 'node:http';

const PROXY_PORT = parseInt(process.env.DEV_PROXY_PORT || process.argv[2] || '5174', 10);
const TARGET_PORT = parseInt(process.env.GATEWAY_PORT || process.argv[3] || '8080', 10);
const TARGET_HOST = process.env.GATEWAY_HOST || '127.0.0.1';
const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function addCorsHeaders(res, origin) {
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-Key,X-Request-ID,X-Session-Token');
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-ID,X-Response-Time');
  }
}

const server = createServer((clientReq, clientRes) => {
  const origin = clientReq.headers.origin;

  // Handle CORS preflight
  if (clientReq.method === 'OPTIONS') {
    addCorsHeaders(clientRes, origin);
    clientRes.writeHead(204);
    clientRes.end();
    return;
  }

  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers: { ...clientReq.headers, host: `${TARGET_HOST}:${TARGET_PORT}` },
  };

  const proxy = request(options, (proxyRes) => {
    // Merge CORS headers with proxy response headers
    const headers = { ...proxyRes.headers };
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      headers['access-control-allow-origin'] = origin;
      headers['access-control-allow-credentials'] = 'true';
    }
    clientRes.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(clientRes);
  });

  proxy.on('error', (err) => {
    console.error(`[dev-proxy] ${clientReq.method} ${clientReq.url} → error: ${err.message}`);
    if (!clientRes.headersSent) {
      addCorsHeaders(clientRes, origin);
      clientRes.writeHead(502, { 'Content-Type': 'application/json' });
    }
    clientRes.end(JSON.stringify({ success: false, error: `Proxy error: ${err.message}` }));
  });

  clientReq.pipe(proxy);
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`[dev-proxy] Proxying http://0.0.0.0:${PROXY_PORT} → http://${TARGET_HOST}:${TARGET_PORT}`);
  console.log(`[dev-proxy] CORS enabled for: ${ALLOWED_ORIGINS.join(', ')}`);
});
