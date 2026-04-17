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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-Key,X-Request-ID,X-Session-Token,X-Runtime,X-Conversation-Id');
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

// WebSocket upgrade handler — forward WS connections to the gateway
server.on('upgrade', (clientReq, clientSocket, head) => {
  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: clientReq.url,
    method: 'GET',
    headers: { ...clientReq.headers, host: `${TARGET_HOST}:${TARGET_PORT}` },
  };

  clientSocket.on('error', (err) => {
    console.error(`[dev-proxy] WS client socket error: ${err.message}`);
  });

  const proxy = request(options);
  proxy.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    proxySocket.on('error', (err) => {
      console.error(`[dev-proxy] WS proxy socket error: ${err.message}`);
      clientSocket.destroy();
    });
    clientSocket.on('error', () => proxySocket.destroy());

    clientSocket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
      Object.entries(proxyRes.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
      '\r\n\r\n'
    );
    if (proxyHead.length) proxySocket.unshift(proxyHead);
    proxySocket.pipe(clientSocket);
    clientSocket.pipe(proxySocket);
  });
  proxy.on('error', (err) => {
    console.error(`[dev-proxy] WS upgrade error: ${err.message}`);
    clientSocket.destroy();
  });
  proxy.end();
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`[dev-proxy] Proxying http://0.0.0.0:${PROXY_PORT} → http://${TARGET_HOST}:${TARGET_PORT}`);
  console.log(`[dev-proxy] CORS enabled for: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`[dev-proxy] WebSocket upgrade enabled`);
});
