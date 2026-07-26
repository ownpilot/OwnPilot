import { vi } from 'vitest';

// Production safeFetch uses undici.fetch so its pinned Agent and fetch share
// one dispatcher ABI. Existing tests stub global fetch; bridge only in tests.
vi.mock('undici', async (importOriginal) => {
  const original = await importOriginal<typeof import('undici')>();
  return {
    ...original,
    fetch: (input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init),
  };
});
