const fs = require('fs'),
  p = require('path'),
  d = 'D:/Codebox/PROJECTS/OwnPilot/packages/gateway/src/routes/workspaces';
function w(n, c) {
  fs.writeFileSync(p.join(d, n), c);
  console.log('Written ' + n + ': ' + c.length + ' bytes');
}
const S = String.fromCharCode;
const Q = S(39),
  N = S(10);
function q(s) {
  return Q + s + Q;
}

// Build container.test.ts
const c = [];
c.push('/**');
c.push(' * Workspace Container Routes Tests');
c.push(' */');
c.push('');
c.push('import { describe, it, expect, beforeEach, vi } from ' + q('vitest') + ';');
c.push('import { Hono } from ' + q('hono') + ';');
c.push('');
c.push('vi.mock(' + q('@ownpilot/core') + ', () => ({');
c.push('  getOrchestrator: vi.fn(),');
c.push('  isDockerAvailable: vi.fn(),');
c.push('}));');
c.push('');
c.push('vi.mock(' + q('../../db/repositories/workspaces.js') + ', () => ({');
c.push('  WorkspacesRepository: vi.fn(),');
c.push('}));');
