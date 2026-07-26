import type { Window as HappyDOMWindow } from 'happy-dom';

// React 18+/19 uses this flag to decide whether the current test runner
// supports act(...). Vitest + happy-dom does, but React cannot infer it unless
// the environment declares it before components render.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Unit tests assert iframe/media attributes and sandbox policy; they must not
// perform real network requests. Return an empty in-memory response for any
// request that reaches Happy DOM's own fetch layer. Tests that exercise API
// calls replace global fetch directly and are unaffected by this interceptor.
if (typeof window !== 'undefined' && 'happyDOM' in window) {
  const testWindow = window as unknown as HappyDOMWindow;
  testWindow.happyDOM.settings.fetch.interceptor = {
    beforeAsyncRequest: async ({ window: requestWindow }) =>
      new requestWindow.Response('', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
  };
}
