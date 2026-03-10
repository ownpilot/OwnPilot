/**
 * Command Interceptor — Command Registry
 *
 * Central registry for all bridge-handled slash commands.
 * Provides command lookup, synthetic stream generation, and the
 * tryInterceptCommand() entry point used by router.ts.
 */

import type { StreamChunk } from '../types.ts';
import type { CommandDefinition, CommandContext, CommandResult } from './types.ts';
import { parseCommand } from './parser.ts';

/**
 * Registry of all available bridge commands.
 */
class CommandRegistry {
  private commands = new Map<string, CommandDefinition>();

  /**
   * Register a command definition. Overwrites if name already exists.
   */
  register(def: CommandDefinition): void {
    this.commands.set(def.name.toLowerCase(), def);
  }

  /**
   * Look up a command by name (case-insensitive).
   */
  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name.toLowerCase());
  }

  /**
   * Check if a command is registered.
   */
  has(name: string): boolean {
    return this.commands.has(name.toLowerCase());
  }

  /**
   * Get all registered commands, sorted alphabetically by name.
   */
  getAll(): CommandDefinition[] {
    return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** Singleton registry instance — handlers register into this at module load time. */
export const commandRegistry = new CommandRegistry();

/**
 * Create an AsyncGenerator<StreamChunk> from a plain text response.
 * Matches the same StreamChunk format that CC produces, so routes.ts
 * needs zero changes to handle command responses.
 */
export async function* syntheticStream(text: string): AsyncGenerator<StreamChunk> {
  yield { type: 'text', text };
  yield { type: 'done' };
}

/**
 * Try to intercept a slash command before it reaches CC.
 *
 * Flow:
 * 1. Parse message for slash command
 * 2. If not a command → return null (pass through)
 * 3. Look up handler in registry
 * 4. If no handler → return null (pass through to CC for Skills etc.)
 * 5. Execute handler
 * 6. If handled → return synthetic stream
 * 7. If not handled → return null (pass through)
 *
 * @returns AsyncGenerator stream if intercepted, null if message should pass through
 */
export async function tryInterceptCommand(
  message: string,
  ctx: CommandContext,
): Promise<AsyncGenerator<StreamChunk> | null> {
  const parsed = parseCommand(message);
  if (!parsed) return null;

  const def = commandRegistry.get(parsed.name);
  if (!def) return null; // Unknown command → fallthrough to CC (Skills, etc.)

  try {
    const result: CommandResult = await def.handler(parsed.args, ctx);

    if (!result.handled) {
      // Handler declined — pass through to CC
      return null;
    }

    return syntheticStream(result.response ?? '');
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return syntheticStream(`Error executing /${parsed.name}: ${errMsg}`);
  }
}
