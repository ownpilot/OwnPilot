type ShutdownSignal = 'SIGINT' | 'SIGTERM';

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const satisfies readonly ShutdownSignal[];
const activeHandlers = new Map<string, () => void>();

/**
 * Register one shutdown handler pair for a CLI command. Re-registering the
 * same owner removes the previous pair first, which keeps tests and embedded
 * CLI usage from accumulating process listeners.
 */
export function replaceShutdownSignalHandlers(
  owner: string,
  onSignal: (signal: ShutdownSignal) => void | Promise<void>
): () => void {
  activeHandlers.get(owner)?.();

  let disposed = false;
  const listeners = new Map<ShutdownSignal, () => void>();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const [signal, listener] of listeners) {
      process.off(signal, listener);
    }
    listeners.clear();
    if (activeHandlers.get(owner) === dispose) {
      activeHandlers.delete(owner);
    }
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    const listener = () => {
      dispose();
      void onSignal(signal);
    };
    listeners.set(signal, listener);
    process.on(signal, listener);
  }

  activeHandlers.set(owner, dispose);
  return dispose;
}
