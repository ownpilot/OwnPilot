/**
 * `ownpilot acp-serve` — run OwnPilot as an ACP (Agent Client Protocol)
 * agent over stdio.
 *
 * External tools that speak ACP (Zed IDE, custom integrations, etc.)
 * spawn this command as a subprocess and talk to it via newline-
 * delimited JSON-RPC on stdin/stdout. The CLI:
 *
 *   1. Initializes the gateway repositories so the chat-agent path
 *      (provider config, settings, plugins) is ready.
 *   2. Builds an ACP {@link Stream} from stdio via
 *      {@link ndJsonStream}.
 *   3. Hands the stream to {@link runAcpServer}, which constructs an
 *      {@link AcpServerAgent} bound to the connection.
 *   4. Waits for the connection to close (stdin EOF) before exiting.
 *
 * NEVER write debug / status output to stdout — that channel carries the
 * JSON-RPC frames. Everything diagnostic goes to stderr.
 */

import { Readable, Writable } from 'node:stream';
import { ndJsonStream } from '@agentclientprotocol/sdk';
import { runAcpServer, loadApiKeysToEnvironment } from '@ownpilot/gateway';

interface AcpServeOptions {
  /**
   * Optional log line written to stderr just before the server starts
   * listening. Useful for spawning processes that want a "ready" marker
   * before they start writing the initialize frame.
   */
  readyMessage?: string;
}

/**
 * Initializer callback contract. The CLI entry point passes its
 * shared `initializeAll()` here so we don't duplicate the repo bring-up
 * dance — and so tests can substitute a no-op.
 */
type AcpInitializer = () => Promise<void>;

/**
 * Start the ACP server bound to the current process's stdio.
 *
 * Resolves when the input stream closes (peer disconnect). The caller
 * should `process.exit(0)` after `await`, since the SDK keeps no other
 * handles open.
 */
export async function startAcpServe(
  initializeAll: AcpInitializer,
  options: AcpServeOptions = {}
): Promise<void> {
  await initializeAll();
  await loadApiKeysToEnvironment();

  // Web-stream wrappers around stdio. `as` casts are needed because the
  // Node typings still mark Readable.toWeb's return as `ReadableStream<any>`
  // but the ACP SDK wants `ReadableStream<Uint8Array>`.
  const input = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const output = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;

  const stream = ndJsonStream(output, input);
  const connection = runAcpServer(stream);

  if (options.readyMessage) {
    process.stderr.write(`${options.readyMessage}\n`);
  }

  // Park until the peer disconnects. ndJsonStream surfaces EOF as a
  // closed readable, which makes the AgentSideConnection finish; we
  // expose that through the connection's done() promise (when present)
  // and additionally watch stdin for completeness.
  await new Promise<void>((resolve) => {
    const done = (connection as unknown as { done?: () => Promise<void> }).done;
    if (typeof done === 'function') {
      void done().finally(resolve);
    }
    process.stdin.once('end', resolve);
    process.stdin.once('close', resolve);
  });
}
