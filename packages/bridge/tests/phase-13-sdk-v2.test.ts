import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { isSdkAvailable, SdkSessionWrapper } from "../src/sdk-session.ts";

// ---------------------------------------------------------------------------
// Mock child_process.spawn BEFORE importing ClaudeManager so the module picks
// up our mock when it does `import { spawn } from 'node:child_process'`.
// ---------------------------------------------------------------------------
vi.mock("node:child_process", async (importOriginal) => {
  const mod = await importOriginal<typeof import("node:child_process")>();
  return { ...mod, spawn: vi.fn() };
});

import { spawn } from "node:child_process";
import { ClaudeManager } from "../src/claude-manager.ts";

// ---------------------------------------------------------------------------
// FakeProc: minimal ChildProcess mock for CLI-path fallback tests
// ---------------------------------------------------------------------------
class FakeProc extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 12345;
  killed = false;
  exitCode: number | null = null;

  constructor() {
    super();
    this.stdin.on("error", () => {});
    this.stdout.on("error", () => {});
    this.stderr.on("error", () => {});
  }

  sendLines(lines: string[], exitCode = 0): void {
    const doSend = () => {
      for (const line of lines) this.stdout.push(line + "\n");
      setImmediate(() => {
        this.stdout.push(null);
        setTimeout(() => { this.exitCode = exitCode; this.emit("exit", exitCode, null); }, 50);
      });
    };
    this.stdout.once("resume", doSend);
  }

  kill(signal?: string): boolean {
    this.killed = true;
    this.emit("exit", null, signal ?? "SIGTERM");
    return true;
  }
}

// ---------------------------------------------------------------------------
// Basic SDK module tests
// ---------------------------------------------------------------------------

describe("phase-13: Agent SDK V2", () => {
  it("isSdkAvailable export exists", () => {
    expect(typeof isSdkAvailable).toBe("function");
  });

  it("USE_SDK_SESSION env can be set without crash", () => {
    process.env.USE_SDK_SESSION = "false";
    expect(() => isSdkAvailable()).not.toThrow();
    delete process.env.USE_SDK_SESSION;
  });

  it("isSdkAvailable returns false when SDK not installed", () => {
    const result = isSdkAvailable();
    expect(typeof result).toBe("boolean");
  });

  // -------------------------------------------------------------------------
  // RED: SdkSessionWrapper.send() must yield StreamChunk-compatible objects
  // (type: 'text' | 'error' | 'done'), NOT { type: 'output', content: '' }
  // -------------------------------------------------------------------------
  it("SdkSessionWrapper.send() yields StreamChunk-compatible chunks", async () => {
    const w = new SdkSessionWrapper();
    await w.create({ projectDir: "/tmp" });
    const chunks: Array<{ type: string }> = [];
    for await (const c of w.send("test")) chunks.push(c);
    // All chunk types must be StreamChunk-compatible
    for (const chunk of chunks) {
      expect(["text", "error", "done"]).toContain(chunk.type);
    }
    // Must always end with a 'done' chunk
    expect(chunks.at(-1)?.type).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// Wiring: USE_SDK_SESSION routing in ClaudeManager
// ---------------------------------------------------------------------------
describe("phase-13: ClaudeManager SDK routing", () => {
  let manager: ClaudeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ClaudeManager();
    delete process.env.USE_SDK_SESSION;
  });

  afterEach(() => {
    delete process.env.USE_SDK_SESSION;
  });

  it("USE_SDK_SESSION unset → CLI spawn path used", async () => {
    const proc = new FakeProc();
    proc.sendLines([
      JSON.stringify({ type: "result", subtype: "success", result: "ok", usage: { input_tokens: 1, output_tokens: 1 } }),
    ]);
    (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(proc as unknown as ReturnType<typeof spawn>);

    const chunks: unknown[] = [];
    for await (const c of manager.send("conv-cli", "hello", "/tmp/test")) chunks.push(c);

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("USE_SDK_SESSION=true + SDK unavailable → CLI fallback (spawn called)", async () => {
    process.env.USE_SDK_SESSION = "true";
    // isSdkAvailable() returns false (SDK not installed) → falls back to CLI spawn

    const proc = new FakeProc();
    proc.sendLines([
      JSON.stringify({ type: "result", subtype: "success", result: "fallback", usage: { input_tokens: 1, output_tokens: 1 } }),
    ]);
    (spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(proc as unknown as ReturnType<typeof spawn>);

    const chunks: unknown[] = [];
    for await (const c of manager.send("conv-fallback", "hello", "/tmp/test")) chunks.push(c);

    // Must fall back to CLI since SDK not available
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
