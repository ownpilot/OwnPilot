/**
 * E2E Test: Interactive Session Mode (Phase 4b)
 *
 * Standalone test script — NOT vitest. Runs against a LIVE bridge (localhost:9090)
 * with real CC spawn. Validates the full interactive lifecycle:
 *   start → write → output → multi-turn → close → post-close
 *
 * Usage:
 *   npm run test:e2e
 *   # or directly:
 *   node --experimental-strip-types tests/e2e/interactive-e2e.ts
 *
 * Requires:
 *   - Bridge running on localhost:9090 (or BRIDGE_URL env)
 *   - Claude Code CLI installed and authenticated
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BRIDGE_URL = process.env.BRIDGE_URL ?? 'http://localhost:9090';
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY ?? 'YOUR_BRIDGE_API_KEY_HERE';
const E2E_TIMEOUT = parseInt(process.env.E2E_TIMEOUT ?? '60000', 10);
const CONV_ID = `e2e-interactive-${Date.now()}`;

// ---------------------------------------------------------------------------
// State shared across tests
// ---------------------------------------------------------------------------

let sessionId = '';
let pid = 0;
let sseAbortController: AbortController | null = null;
// Collected SSE events (shared buffer for the SSE listener)
const sseEvents: Array<{ event: string; data: Record<string, unknown> }> = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function bridgeFetch(
  path: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  } = {},
): Promise<Response> {
  const url = `${BRIDGE_URL}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${BRIDGE_API_KEY}`,
    ...options.headers,
  };
  const hasBody = !!options.body;
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: hasBody ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
}

/**
 * Start SSE listener in background. Pushes parsed events into sseEvents[].
 * Returns the AbortController used to disconnect.
 */
function startSSEListener(): AbortController {
  const controller = new AbortController();
  const url = `${BRIDGE_URL}/v1/notifications/stream`;

  // Start consuming in background (fire and forget — errors handled internally)
  (async () => {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${BRIDGE_API_KEY}`,
          Accept: 'text/event-stream',
        },
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        console.error(`  SSE connection failed: ${res.status} ${res.statusText}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = '';
        let currentData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6);
          } else if (line === '' && currentEvent && currentData) {
            try {
              const parsed = JSON.parse(currentData) as Record<string, unknown>;
              sseEvents.push({ event: currentEvent, data: parsed });
            } catch {
              // Non-JSON data (heartbeat text, etc.)
              sseEvents.push({ event: currentEvent, data: { raw: currentData } });
            }
            currentEvent = '';
            currentData = '';
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return; // Expected on cleanup
      console.error(`  SSE error: ${err}`);
    }
  })();

  return controller;
}

/**
 * Wait for an SSE event matching the predicate. Polls the sseEvents buffer.
 */
async function waitForSSE(
  predicate: (ev: { event: string; data: Record<string, unknown> }) => boolean,
  description: string,
  timeoutMs: number = E2E_TIMEOUT,
): Promise<{ event: string; data: Record<string, unknown> }> {
  const start = Date.now();
  const pollInterval = 250;

  while (Date.now() - start < timeoutMs) {
    const found = sseEvents.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  throw new Error(`Timeout waiting for SSE event: ${description} (${timeoutMs}ms)`);
}

/**
 * Collect all matching SSE events within a time window.
 * Useful for gathering session.output chunks that arrive in multiple events.
 */
async function collectSSEOutputs(
  conversationId: string,
  timeoutMs: number = E2E_TIMEOUT,
): Promise<string> {
  const start = Date.now();
  const pollInterval = 500;
  let lastOutputIndex = -1;
  let stableCount = 0;

  // Wait for at least one session.done event for this conversation (signals turn complete)
  while (Date.now() - start < timeoutMs) {
    const doneEvent = sseEvents.find(
      (ev) =>
        ev.event === 'session.done' &&
        ev.data['conversationId'] === conversationId,
    );

    if (doneEvent) {
      // Done event found — collect all output text
      const outputs = sseEvents.filter(
        (ev) =>
          ev.event === 'session.output' &&
          ev.data['conversationId'] === conversationId,
      );
      return outputs.map((ev) => ev.data['text'] as string).join('');
    }

    // Check if we have output but no done yet (stale detection)
    const currentOutputCount = sseEvents.filter(
      (ev) =>
        ev.event === 'session.output' &&
        ev.data['conversationId'] === conversationId,
    ).length;

    if (currentOutputCount === lastOutputIndex) {
      stableCount++;
    } else {
      stableCount = 0;
      lastOutputIndex = currentOutputCount;
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  // Timeout — return whatever we have
  const outputs = sseEvents.filter(
    (ev) =>
      ev.event === 'session.output' &&
      ev.data['conversationId'] === conversationId,
  );
  if (outputs.length > 0) {
    return outputs.map((ev) => ev.data['text'] as string).join('');
  }
  throw new Error(`Timeout collecting SSE outputs for ${conversationId} (${timeoutMs}ms)`);
}

function clearSSEEventsForConversation(conversationId: string): void {
  // Remove events for this conversation to isolate subsequent turns
  for (let i = sseEvents.length - 1; i >= 0; i--) {
    if (sseEvents[i].data['conversationId'] === conversationId) {
      sseEvents.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

async function test1_startInteractive(): Promise<void> {
  console.log('\n--- Test 1: Start interactive session ---');

  const res = await bridgeFetch('/v1/sessions/start-interactive', {
    method: 'POST',
    headers: { 'X-Conversation-Id': CONV_ID },
    body: {
      project_dir: '/tmp',
      system_prompt: 'You are a math assistant. Always reply with ONLY the numeric answer, no words, no explanation, no punctuation. Just the number.',
      max_turns: 10,
    },
  });

  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`Expected 200, got ${res.status}: ${body}`);
  }

  const body = (await res.json()) as Record<string, unknown>;

  // Validate response shape
  if (body['status'] !== 'interactive') {
    throw new Error(`Expected status "interactive", got "${body['status']}"`);
  }
  if (body['conversationId'] !== CONV_ID) {
    throw new Error(`Expected conversationId "${CONV_ID}", got "${body['conversationId']}"`);
  }
  if (typeof body['sessionId'] !== 'string' || (body['sessionId'] as string).length < 10) {
    throw new Error(`Invalid sessionId: ${body['sessionId']}`);
  }
  if (typeof body['pid'] !== 'number' || (body['pid'] as number) <= 0) {
    throw new Error(`Invalid PID: ${body['pid']}`);
  }

  // Validate UUID format for sessionId
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(body['sessionId'] as string)) {
    throw new Error(`sessionId is not a valid UUID: ${body['sessionId']}`);
  }

  sessionId = body['sessionId'] as string;
  pid = body['pid'] as number;

  console.log(`  ✓ Test 1 PASS: conversationId=${CONV_ID}, sessionId=${sessionId}, pid=${pid}`);
}

async function test2_firstMessage(): Promise<void> {
  console.log('\n--- Test 2: First message + receive output via SSE ---');

  // Clear any events from session startup
  clearSSEEventsForConversation(CONV_ID);

  // Send first message
  const res = await bridgeFetch(`/v1/sessions/${CONV_ID}/input`, {
    method: 'POST',
    body: { message: 'What is 2+2? Reply with just the number.' },
  });

  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`Expected 200, got ${res.status}: ${body}`);
  }

  const body = (await res.json()) as Record<string, unknown>;
  if (body['status'] !== 'sent') {
    throw new Error(`Expected status "sent", got "${body['status']}"`);
  }

  // Wait for output via SSE
  console.log('  Waiting for CC output via SSE...');
  const output = await collectSSEOutputs(CONV_ID);

  console.log(`  Received output: "${output.trim()}"`);

  if (!output.includes('4')) {
    throw new Error(`Expected output to contain "4", got: "${output}"`);
  }

  console.log(`  ✓ Test 2 PASS: received output containing "4"`);
}

async function test3_multiTurn(): Promise<void> {
  console.log('\n--- Test 3: Multi-turn (context preserved) ---');

  // Wait for CC to fully settle after first turn before sending second message
  // CC needs a brief pause between turns in stream-json mode
  await new Promise((r) => setTimeout(r, 3000));

  // Clear previous turn's events
  clearSSEEventsForConversation(CONV_ID);

  // Send second message referencing previous context
  const res = await bridgeFetch(`/v1/sessions/${CONV_ID}/input`, {
    method: 'POST',
    body: { message: 'Now multiply that by 3. Reply with just the number.' },
  });

  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`Expected 200, got ${res.status}: ${body}`);
  }

  // Wait for output via SSE
  console.log('  Waiting for CC output via SSE...');
  const output = await collectSSEOutputs(CONV_ID);

  console.log(`  Received output: "${output.trim()}"`);

  if (!output.includes('12')) {
    throw new Error(`Expected output to contain "12", got: "${output}"`);
  }

  console.log(`  ✓ Test 3 PASS: received output containing "12" (context preserved)`);
}

async function test4_closeInteractive(): Promise<void> {
  console.log('\n--- Test 4: Close interactive session ---');

  // Clear previous events
  clearSSEEventsForConversation(CONV_ID);

  const res = await bridgeFetch(`/v1/sessions/${CONV_ID}/close-interactive`, {
    method: 'POST',
  });

  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`Expected 200, got ${res.status}: ${body}`);
  }

  const body = (await res.json()) as Record<string, unknown>;
  if (body['status'] !== 'closed') {
    throw new Error(`Expected status "closed", got "${body['status']}"`);
  }

  // Wait for session.done event (emitted on process exit)
  console.log('  Waiting for session.done event...');
  try {
    await waitForSSE(
      (ev) => ev.event === 'session.done' && ev.data['conversationId'] === CONV_ID,
      'session.done after close',
      10_000,
    );
    console.log('  session.done event received');
  } catch {
    // session.done may have already been emitted during close — check all events
    const hasDone = sseEvents.some(
      (ev) => ev.event === 'session.done' && ev.data['conversationId'] === CONV_ID,
    );
    if (hasDone) {
      console.log('  session.done event was already received');
    } else {
      console.log('  Warning: session.done event not received (process may have exited before SSE delivery)');
    }
  }

  console.log(`  ✓ Test 4 PASS: session closed`);
}

async function test5_postCloseVerify(): Promise<void> {
  console.log('\n--- Test 5: Post-close verification ---');

  // Try to send input to closed session — should get 409
  const res = await bridgeFetch(`/v1/sessions/${CONV_ID}/input`, {
    method: 'POST',
    body: { message: 'This should fail' },
  });

  if (res.status !== 409) {
    const body = await res.text();
    throw new Error(`Expected 409, got ${res.status}: ${body}`);
  }

  const body = (await res.json()) as Record<string, unknown>;
  const error = body['error'] as Record<string, unknown> | undefined;
  if (error?.['type'] !== 'conflict') {
    throw new Error(`Expected error type "conflict", got "${error?.['type']}"`);
  }

  console.log(`  ✓ Test 5 PASS: post-close input correctly rejected with 409`);
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function cleanup(): Promise<void> {
  // Disconnect SSE
  if (sseAbortController) {
    sseAbortController.abort();
    sseAbortController = null;
  }

  // Try to close interactive session if still open
  try {
    await bridgeFetch(`/v1/sessions/${CONV_ID}/close-interactive`, { method: 'POST' });
  } catch {
    // Ignore — session might already be closed
  }

  // Terminate session to clean up bridge state
  try {
    await bridgeFetch(`/v1/sessions/${CONV_ID}`, { method: 'DELETE' });
  } catch {
    // Ignore
  }
}

async function main(): Promise<void> {
  console.log('=== Interactive Session E2E Test ===');
  console.log(`Bridge: ${BRIDGE_URL}`);
  console.log(`ConversationId: ${CONV_ID}`);
  console.log(`Timeout per test: ${E2E_TIMEOUT}ms`);

  // Pre-flight: check bridge is reachable
  try {
    const pingRes = await bridgeFetch('/ping');
    if (pingRes.status !== 200) throw new Error(`Ping failed: ${pingRes.status}`);
    console.log('Bridge reachable ✓');
  } catch (err) {
    console.error(`\n✗ Bridge not reachable at ${BRIDGE_URL}`);
    console.error(`  Start it: cd /home/ayaz/openclaw-bridge && npm start`);
    process.exit(1);
  }

  // Start SSE listener before tests
  console.log('Starting SSE listener...');
  sseAbortController = startSSEListener();

  // Give SSE connection a moment to establish
  await new Promise((r) => setTimeout(r, 1000));

  const tests = [
    { name: 'Start interactive session', fn: test1_startInteractive },
    { name: 'First message + SSE output', fn: test2_firstMessage },
    { name: 'Multi-turn (context preserved)', fn: test3_multiTurn },
    { name: 'Close interactive session', fn: test4_closeInteractive },
    { name: 'Post-close 409 verification', fn: test5_postCloseVerify },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test.fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`  ✗ ${test.name} FAILED: ${err instanceof Error ? err.message : err}`);
      // Stop on first failure — later tests depend on earlier state
      break;
    }
  }

  // Cleanup
  await cleanup();

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`${passed}/${tests.length} PASS${failed > 0 ? ` | ${failed} FAILED` : ''} — Interactive E2E ${failed === 0 ? 'complete ✓' : 'FAILED ✗'}`);
  console.log(`${'='.repeat(50)}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  cleanup().finally(() => process.exit(1));
});
