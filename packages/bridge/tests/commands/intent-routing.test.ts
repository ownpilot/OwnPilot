import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, TEST_AUTH_HEADER } from '../helpers/build-app.ts';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

async function postMessage(content: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: {
      authorization: TEST_AUTH_HEADER,
      'content-type': 'application/json',
      'x-project-dir': '/home/ayaz/openclaw-bridge',
    },
    payload: {
      model: 'bridge-model',
      stream: false,
      messages: [{ role: 'user', content }],
    },
  });
}

function getContent(res: { json(): Record<string, unknown> }): string {
  const body = res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content ?? '';
}

// Smoke test: proves resolveIntent is wired into routeMessage
describe('intent routing smoke test', () => {
  it('TR: "ne kadar harcadım" routes to /cost', async () => {
    const res = await postMessage('ne kadar harcadım');
    expect(res.statusCode).toBe(200);
    expect(getContent(res)).toContain('no cost data');
  });
});
