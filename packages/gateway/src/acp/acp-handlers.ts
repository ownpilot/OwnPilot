/**
 * ACP Client Handlers
 *
 * Implements the ACP Client interface — the methods the ACP agent calls
 * back to OwnPilot for:
 *   - session/update: receive streaming output
 *   - session/request_permission: ask user before dangerous ops
 *   - fs/read_text_file, fs/write_text_file: controlled file access
 *   - terminal/*: sandboxed command execution
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve, normalize } from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type {
  Client,
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  CreateTerminalRequest,
  CreateTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk';
import { RequestError } from '@agentclientprotocol/sdk';
import type { AcpPermissionRequestEvent, AcpPermissionResponse } from './types.js';
import { mapSessionNotification, type MappedAcpEvent } from './acp-event-mapper.js';
import { getLog } from '../services/log.js';

const log = getLog('AcpHandlers');

// =============================================================================
// TYPES
// =============================================================================

export interface AcpClientHandlerOptions {
  ownerSessionId: string;
  cwd: string;
  allowedDirs?: string[];
  onEvent?: (event: MappedAcpEvent) => void;
  onPermissionRequest?: (request: AcpPermissionRequestEvent) => Promise<AcpPermissionResponse>;
  onTextOutput?: (text: string) => void;
}

// =============================================================================
// TERMINAL MANAGER
// =============================================================================

interface ManagedTerminal {
  id: string;
  process: ChildProcess;
  output: string;
  maxOutput: number;
  exitCode: number | null;
  signal: string | null;
  exited: boolean;
  exitPromise: Promise<{ exitCode: number | null; signal: string | null }>;
}

class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>();
  private nextId = 1;

  create(params: CreateTerminalRequest, cwd: string): ManagedTerminal {
    const id = `acp-term-${this.nextId++}`;
    const maxOutput = params.outputByteLimit ?? 1_048_576;

    const child = spawn(params.command, params.args ?? [], {
      cwd: params.cwd ?? cwd,
      env: {
        ...process.env,
        ...(params.env ? Object.fromEntries(params.env.map((e) => [e.name, e.value])) : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    const terminal: ManagedTerminal = {
      id,
      process: child,
      output: '',
      maxOutput,
      exitCode: null,
      signal: null,
      exited: false,
      exitPromise: new Promise((res) => {
        child.on('exit', (code, signal) => {
          terminal.exitCode = code;
          terminal.signal = signal;
          terminal.exited = true;
          res({ exitCode: code, signal });
        });
        child.on('error', (err) => {
          terminal.exited = true;
          terminal.exitCode = 1;
          terminal.output += `\nError: ${err.message}`;
          res({ exitCode: 1, signal: null });
        });
      }),
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      if (terminal.output.length < maxOutput) {
        terminal.output += chunk.toString('utf8');
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (terminal.output.length < maxOutput) {
        terminal.output += chunk.toString('utf8');
      }
    });

    this.terminals.set(id, terminal);
    return terminal;
  }

  get(id: string): ManagedTerminal | undefined {
    return this.terminals.get(id);
  }

  kill(id: string): boolean {
    const t = this.terminals.get(id);
    if (!t || t.exited) return false;
    t.process.kill('SIGTERM');
    return true;
  }

  release(id: string): void {
    const t = this.terminals.get(id);
    if (t) {
      if (!t.exited) t.process.kill('SIGTERM');
      this.terminals.delete(id);
    }
  }

  dispose(): void {
    for (const [id] of this.terminals) this.release(id);
  }
}

// =============================================================================
// CLIENT HANDLER FACTORY
// =============================================================================

export function createAcpClientHandler(
  options: AcpClientHandlerOptions
): Client & { dispose: () => void } {
  const {
    ownerSessionId,
    cwd,
    allowedDirs = [],
    onEvent,
    onPermissionRequest,
    onTextOutput,
  } = options;
  const terminalManager = new TerminalManager();

  function validatePath(filePath: string): string {
    if (!isAbsolute(filePath)) filePath = resolve(cwd, filePath);
    const normalized = normalize(filePath);
    const allAllowed = [cwd, ...allowedDirs];
    if (!allAllowed.some((dir) => normalized.startsWith(normalize(dir)))) {
      throw RequestError.invalidParams(
        undefined,
        `Path '${filePath}' is outside allowed directories`
      );
    }
    return normalized;
  }

  return {
    // session/update
    async sessionUpdate(params: SessionNotification): Promise<void> {
      const events = mapSessionNotification(params, ownerSessionId);
      for (const event of events) {
        onEvent?.(event);
        if (event.type === 'coding-agent:acp:message') {
          const payload = event.payload as Record<string, unknown>;
          const content = payload.content as Record<string, unknown>;
          if (content?.type === 'text' && typeof content.text === 'string') {
            onTextOutput?.(content.text);
          }
        }
      }
    },

    // session/request_permission
    async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
      const toolCallId = params.toolCall?.toolCallId ?? 'unknown';
      const title = params.toolCall?.title ?? 'Permission requested';

      log.info(`Permission request from agent`, {
        sessionId: ownerSessionId,
        toolCallId,
        title,
        optionCount: params.options?.length,
      });

      if (onPermissionRequest) {
        const request: AcpPermissionRequestEvent = {
          sessionId: ownerSessionId,
          timestamp: new Date().toISOString(),
          toolCallId,
          title,
          options: (params.options ?? []).map((opt) => ({
            optionId: opt.optionId,
            name: opt.name,
            kind: opt.kind,
          })),
        };

        onEvent?.({
          type: 'coding-agent:acp:permission-request',
          payload: request as unknown as Record<string, unknown>,
        });

        const response = await onPermissionRequest(request);
        if (response.outcome === 'cancelled') {
          return { outcome: { outcome: 'cancelled' } };
        }
        return {
          outcome: {
            outcome: 'selected',
            optionId: response.optionId ?? '',
          },
        };
      }

      // Default: auto-approve with first allow option
      const allowOption = params.options?.find(
        (o) => o.kind === 'allow_once' || o.kind === 'allow_always'
      );
      if (allowOption) {
        log.info(`Auto-approving permission: ${allowOption.name}`, {
          optionId: allowOption.optionId,
        });
        return { outcome: { outcome: 'selected', optionId: allowOption.optionId } };
      }

      const rejectOption = params.options?.find((o) => o.kind === 'reject_once');
      return { outcome: { outcome: 'selected', optionId: rejectOption?.optionId ?? '' } };
    },

    // fs/read_text_file
    async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
      const filePath = validatePath(params.path);
      log.debug(`Agent reading file: ${filePath}`, { sessionId: ownerSessionId });
      try {
        const fileContent = await readFile(filePath, 'utf8');
        return { content: fileContent };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw RequestError.resourceNotFound(filePath);
        }
        throw RequestError.internalError(
          undefined,
          `Failed to read file: ${(err as Error).message}`
        );
      }
    },

    // fs/write_text_file
    async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
      const filePath = validatePath(params.path);
      log.info(`Agent writing file: ${filePath}`, { sessionId: ownerSessionId });
      try {
        const dir = dirname(filePath);
        if (!existsSync(dir)) await mkdir(dir, { recursive: true });
        await writeFile(filePath, params.content, 'utf8');
        return {};
      } catch (err) {
        throw RequestError.internalError(
          undefined,
          `Failed to write file: ${(err as Error).message}`
        );
      }
    },

    // terminal/create
    async createTerminal(params: CreateTerminalRequest): Promise<CreateTerminalResponse> {
      log.info(`Agent creating terminal: ${params.command}`, {
        sessionId: ownerSessionId,
        args: params.args,
      });
      const terminal = terminalManager.create(params, cwd);
      return { terminalId: terminal.id };
    },

    // terminal/output
    async terminalOutput(params: TerminalOutputRequest): Promise<TerminalOutputResponse> {
      const terminal = terminalManager.get(params.terminalId);
      if (!terminal) throw RequestError.resourceNotFound(params.terminalId);
      return {
        output: terminal.output,
        truncated: terminal.output.length >= terminal.maxOutput,
        exitStatus: terminal.exited
          ? { exitCode: terminal.exitCode, signal: terminal.signal }
          : undefined,
      };
    },

    // terminal/wait_for_exit
    async waitForTerminalExit(
      params: WaitForTerminalExitRequest
    ): Promise<WaitForTerminalExitResponse> {
      const terminal = terminalManager.get(params.terminalId);
      if (!terminal) throw RequestError.resourceNotFound(params.terminalId);
      const result = await terminal.exitPromise;
      return { exitCode: result.exitCode, signal: result.signal };
    },

    // terminal/kill
    async killTerminal(params: KillTerminalRequest): Promise<KillTerminalResponse> {
      const terminal = terminalManager.get(params.terminalId);
      if (!terminal) throw RequestError.resourceNotFound(params.terminalId);
      terminalManager.kill(params.terminalId);
      return {};
    },

    // terminal/release
    async releaseTerminal(params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> {
      terminalManager.release(params.terminalId);
      return {};
    },

    dispose() {
      terminalManager.dispose();
    },
  };
}
