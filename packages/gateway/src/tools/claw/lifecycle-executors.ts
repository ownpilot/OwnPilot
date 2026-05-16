/**
 * Claw Lifecycle Executors
 *
 * Three executors covering claw runtime mechanics:
 *  - claw_install_package — npm/pnpm/pip install into the claw workspace
 *  - claw_run_script      — execute a script in Docker (preferred) or local sandbox
 *  - claw_create_tool     — compile & run an ephemeral tool from generated code
 *
 * Each is a pure handler that returns a uniform { success, result?, error? }.
 */

import { getErrorMessage, validateToolCode } from '@ownpilot/core';
import { getClawContext } from '../../services/claw-context.js';
import { validatePackageName, validateToolName, truncateScriptOutput } from './validation.js';
import { buildSandboxEnv } from './sandbox-env.js';

type ExecResult = { success: boolean; result?: unknown; error?: string };

export async function executeInstallPackage(
  args: Record<string, unknown>,
  _userId: string
): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };
  if (!ctx.workspaceId) return { success: false, error: 'No workspace configured for this Claw' };

  const packageName = args.package_name as string;
  const manager = (args.manager as string) ?? 'npm';

  if (!validatePackageName(packageName)) {
    return { success: false, error: `Invalid package name: ${packageName}` };
  }

  if (!['npm', 'pip', 'pnpm'].includes(manager)) {
    return { success: false, error: `Invalid package manager: ${manager}` };
  }

  const { getSessionWorkspacePath } = await import('../../workspace/file-workspace.js');
  const wsPath = getSessionWorkspacePath(ctx.workspaceId);
  if (!wsPath) return { success: false, error: 'Workspace not found' };

  // Async execFile (no shell, no event-loop block).
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  const commands: Record<string, { cmd: string; args: string[] }> = {
    npm: { cmd: 'npm', args: ['install', '--prefix', wsPath, packageName] },
    pnpm: { cmd: 'pnpm', args: ['add', '--dir', wsPath, packageName] },
    pip: { cmd: 'pip', args: ['install', '--target', `${wsPath}/pip_packages`, packageName] },
  };

  const entry = commands[manager];
  if (!entry) return { success: false, error: `Unsupported package manager: ${manager}` };

  try {
    const { stdout, stderr } = await execFileAsync(entry.cmd, entry.args, {
      timeout: 60_000,
      cwd: wsPath,
      encoding: 'utf-8',
      env: buildSandboxEnv({ HOME: wsPath }),
      maxBuffer: 4 * 1024 * 1024,
    });

    const output = (stdout || stderr || '').slice(0, 2000);
    return {
      success: true,
      result: { package: packageName, manager, output },
    };
  } catch (err) {
    return { success: false, error: `Install failed: ${getErrorMessage(err)}` };
  }
}

export async function executeRunScript(
  args: Record<string, unknown>,
  _userId: string
): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };
  if (!ctx.workspaceId) return { success: false, error: 'No workspace configured for this Claw' };

  const script = args.script as string;
  const language = (args.language as string) ?? 'javascript';
  const timeoutMs = Math.min((args.timeout_ms as number) ?? 30_000, 120_000);

  if (!script || script.length > 100_000) {
    return { success: false, error: 'Script is empty or exceeds 100KB limit' };
  }

  // RCE-004: scan script content for dangerous patterns before writing/executing
  const scriptValidation = validateToolCode(script);
  if (!scriptValidation.valid) {
    return { success: false, error: `Script blocked: ${scriptValidation.errors.join('; ')}` };
  }

  const { getSessionWorkspacePath, writeSessionWorkspaceFile } =
    await import('../../workspace/file-workspace.js');
  const wsPath = getSessionWorkspacePath(ctx.workspaceId);
  if (!wsPath) return { success: false, error: 'Workspace not found' };

  // Write script to workspace for Docker sandbox path mapping; will be cleaned up after execution.
  // Add a random suffix so two scripts written in the same millisecond (rare
  // but possible under concurrent claw cycles) don't collide.
  const ext: Record<string, string> = { python: 'py', javascript: 'js', shell: 'sh' };
  const rand = Math.random().toString(36).slice(2, 8);
  const scriptName = `script_${Date.now()}_${rand}.${ext[language] ?? 'js'}`;
  const scriptRelPath = `scripts/${scriptName}`;
  writeSessionWorkspaceFile(ctx.workspaceId, scriptRelPath, Buffer.from(script, 'utf-8'));

  const scriptFullPath = `${wsPath}/scripts/${scriptName}`;

  const { rmSync } = await import('node:fs');
  const cleanup = () => {
    try {
      rmSync(scriptFullPath, { force: true });
    } catch {
      // Best-effort cleanup
    }
  };

  // Async execFile so the cycle's event loop is not blocked while a script
  // runs. Multiple claws can execute concurrently without serializing on the
  // single-threaded sync call.
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  // Decide between local and Docker execution. The claw's sandbox preference
  // (auto | docker | local) flows in via the execution context. For Docker we
  // probe `docker version` once; if it isn't available we fall back to local
  // and surface the fallback in the result so the LLM knows what happened.
  const sandboxPref = ctx.sandbox ?? 'auto';
  let useDocker = false;
  let dockerFallbackReason: string | undefined;
  if (sandboxPref === 'docker' || sandboxPref === 'auto') {
    try {
      await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}'], {
        timeout: 3000,
        encoding: 'utf-8',
      });
      useDocker = sandboxPref === 'docker' || (sandboxPref === 'auto' && language === 'python');
    } catch {
      if (sandboxPref === 'docker') {
        dockerFallbackReason = 'docker daemon not reachable; falling back to local execution';
      }
    }
  }

  const dockerImages: Record<string, string> = {
    python: 'python:3.11-slim',
    javascript: 'node:20-alpine',
    shell: 'alpine:3.19',
  };

  const localInterpreters: Record<string, { cmd: string; args: string[] }> = {
    python: { cmd: 'python3', args: [scriptFullPath] },
    javascript: { cmd: 'node', args: [scriptFullPath] },
    shell: { cmd: 'sh', args: [scriptFullPath] },
  };

  const containerCmd: Record<string, string[]> = {
    python: ['python3', `/workspace/scripts/${scriptName}`],
    javascript: ['node', `/workspace/scripts/${scriptName}`],
    shell: ['sh', `/workspace/scripts/${scriptName}`],
  };

  let cmd: string;
  let cmdArgs: string[];
  let sandboxLabel: 'docker' | 'local';

  if (useDocker) {
    sandboxLabel = 'docker';
    const image = dockerImages[language] ?? dockerImages.javascript!;
    const inner = containerCmd[language] ?? containerCmd.javascript!;

    // Normalize the host path for Docker mounts. Docker Desktop on Windows
    // accepts `D:\path` for some shells but the safer cross-shell form is
    // `/d/path` (Git Bash / MSYS style) which works under WSL2 + classic
    // Hyper-V backends. Forward slashes are also required when the gateway
    // runs inside MSYS bash on Windows (our dev shell).
    const mountSource =
      process.platform === 'win32'
        ? `/${wsPath.charAt(0).toLowerCase()}${wsPath.slice(2).replace(/\\/g, '/')}`
        : wsPath;

    // --rm: clean up after run; --network none: deny network by default;
    // --memory / --cpus: prevent runaway resource use; -v: workspace mount.
    cmd = 'docker';
    cmdArgs = [
      'run',
      '--rm',
      '--network',
      'none',
      '--memory',
      '512m',
      '--cpus',
      '1',
      '--workdir',
      '/workspace',
      '-v',
      `${mountSource}:/workspace`,
      image,
      ...inner,
    ];
  } else {
    sandboxLabel = 'local';
    const interp = localInterpreters[language] ?? localInterpreters.javascript!;
    cmd = interp.cmd;
    cmdArgs = interp.args;
  }

  // Build env for local execution. Docker passes its own minimal env via -e
  // flags, so it's safe to leave runtimeEnv empty there. For local runs we
  // must NOT spread process.env directly — that would hand the gateway's
  // API keys, DB URLs, and cloud credentials to the user-controlled script.
  // Use the sanitized allowlist and add only what interpreters need.
  const sep = process.platform === 'win32' ? ';' : ':';
  const runtimeEnv: Record<string, string> = useDocker
    ? {}
    : buildSandboxEnv({
        HOME: wsPath,
        NODE_PATH: `${wsPath}/node_modules`,
        PYTHONPATH: `${wsPath}/pip_packages${process.env.PYTHONPATH ? `${sep}${process.env.PYTHONPATH}` : ''}`,
      });

  if (useDocker) {
    // Insert -e flags right after `run`. cmdArgs starts with 'run' so we
    // splice into index 1.
    cmdArgs.splice(
      1,
      0,
      '-e',
      `NODE_PATH=/workspace/node_modules`,
      '-e',
      `PYTHONPATH=/workspace/pip_packages`
    );
  }

  try {
    const { stdout, stderr } = await execFileAsync(cmd, cmdArgs, {
      timeout: timeoutMs,
      cwd: wsPath,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
      ...(useDocker ? {} : { env: runtimeEnv }),
    });

    cleanup();

    return {
      success: true,
      result: {
        stdout: truncateScriptOutput(stdout),
        stderr: truncateScriptOutput(stderr ?? ''),
        exitCode: 0,
        sandbox: sandboxLabel,
        ...(dockerFallbackReason ? { fallback: dockerFallbackReason } : {}),
      },
    };
  } catch (err: unknown) {
    cleanup();
    const execErr = err as { stdout?: string; stderr?: string; code?: number; signal?: string };
    return {
      success: false,
      result: {
        stdout: truncateScriptOutput(execErr.stdout ?? ''),
        stderr: truncateScriptOutput(execErr.stderr ?? ''),
        exitCode: execErr.code ?? 1,
        signal: execErr.signal,
        sandbox: sandboxLabel,
        ...(dockerFallbackReason ? { fallback: dockerFallbackReason } : {}),
      },
      error: getErrorMessage(err),
    };
  }
}

export async function executeCreateTool(args: Record<string, unknown>): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const name = args.name as string;
  const description = args.description as string;
  const code = args.code as string;
  const toolArgs = (args.parameters as Record<string, unknown>) ?? undefined;
  const invokeArgs = (args.args as Record<string, unknown>) ?? {};

  if (!validateToolName(name)) {
    return {
      success: false,
      error: `Invalid tool name "${name}". Must be lowercase, start with a letter, and contain only letters, numbers, underscores.`,
    };
  }

  if (!code || code.length > 50_000) {
    return { success: false, error: 'Code is empty or exceeds 50KB limit' };
  }

  if (!description?.trim()) {
    return { success: false, error: 'Tool description is required' };
  }

  // Security: validate code against dangerous pattern blocklist before sandbox execution
  const validation = validateToolCode(code);
  if (!validation.valid) {
    return { success: false, error: `Code blocked: ${validation.errors.join('; ')}` };
  }

  // Execute the user code in a Node.js vm sandbox.
  // The code should define a function with the tool name (or assign to `exports.default`).
  // We inject 'args' into the sandbox context and call the function.
  try {
    const vm = await import('node:vm');

    const logs: string[] = [];
    const sandbox: Record<string, unknown> = {
      args: invokeArgs,
      module: { exports: {} as Record<string, unknown> },
      exports: {} as Record<string, unknown>,
      __result: undefined,
      console: {
        log: (...a: unknown[]) => logs.push(a.map(String).join(' ')),
        error: (...a: unknown[]) => logs.push('[err] ' + a.map(String).join(' ')),
      },
      // Block sandbox escape vectors
      require: undefined,
      process: undefined,
      global: undefined,
      globalThis: undefined,
      Function: undefined,
      eval: undefined,
      import: undefined,
    };

    const wrappedCode = `
${code}
// Auto-detect callable: named function or module.exports
const __fn = typeof ${name} === 'function'
  ? ${name}
  : (module.exports && typeof module.exports.default === 'function' ? module.exports.default
  : (typeof module.exports === 'function' ? module.exports : null));
__result = typeof __fn === 'function' ? __fn(args) : { error: "No function named '${name}' found. Define: function ${name}(args) { ... }" };
`;

    const vmCtx = vm.createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
    });
    vm.runInContext(wrappedCode, vmCtx, { timeout: 10_000 });

    // Resolve promises (sync vm can't await, but we can resolve simple thenables)
    let output = vmCtx.__result;
    if (
      output &&
      typeof output === 'object' &&
      typeof (output as Promise<unknown>).then === 'function'
    ) {
      output = await (output as Promise<unknown>);
    }

    return {
      success: true,
      result: {
        executed: true,
        name,
        description,
        schema: toolArgs,
        output,
        executedWith: invokeArgs,
        logs: logs.length > 0 ? logs : undefined,
        note: 'Code executed in an ephemeral vm sandbox. Nothing is persisted — call claw_create_tool again with the full code to re-run.',
      },
    };
  } catch (err) {
    return { success: false, error: `Tool execution failed: ${getErrorMessage(err)}` };
  }
}
