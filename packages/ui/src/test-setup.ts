// React 18+/19 uses this flag to decide whether the current test runner
// supports act(...). Vitest + happy-dom does, but React cannot infer it unless
// the environment declares it before components render.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
