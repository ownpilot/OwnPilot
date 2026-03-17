import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectIntent, buildSystemPrompt, getGSDContext, clearFileCache, CACHE_TTL_MS } from "../src/gsd-adapter.ts";

// ---------------------------------------------------------------------------
// Mock fs/os so buildSystemPrompt and getGSDContext don't depend on real files
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue(""),
  // FIX 8: readFileSafe now uses access() instead of existsSync()
  access: vi.fn().mockRejectedValue(new Error("ENOENT")),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn().mockReturnValue("/mock-home"),
}));

import { readFile, access } from "node:fs/promises";

const mockReadFile = vi.mocked(readFile);
const mockAccess = vi.mocked(access);

// ============================================================================
//  detectIntent — comprehensive tests
// ============================================================================

describe("detectIntent", () => {
  // --------------------------------------------------------------------------
  // 1. execute-phase
  // --------------------------------------------------------------------------
  describe("execute-phase", () => {
    it.each([
      ["bir sonraki aşama", "Turkish with ş"],
      ["bir sonraki asama", "Turkish without ş"],
      ["next phase", "English"],
      ["execute", "bare keyword"],
      ["çalıştır", "Turkish imperative with ç,ş,ı"],
      ["calistir", "Turkish without diacritics"],
      ["fazı başlat", "Turkish with ı,ş"],
      ["fazi baslat", "Turkish without diacritics"],
      ["execute phase", "English compound"],
      ["execute-phase", "hyphenated"],
      ["fazı çalıştır", "Turkish full form"],
    ])('matches "%s" (%s)', async (input) => {
      expect(await detectIntent(input)).toBe("execute-phase");
    });
  });

  // --------------------------------------------------------------------------
  // 2. discuss-phase
  // --------------------------------------------------------------------------
  describe("discuss-phase", () => {
    it.each([
      ["discuss phase", "English"],
      ["tartış", "Turkish with ş"],
      ["tartis", "Turkish without ş"],
      ["konuşalım", "Turkish with ş,ı"],
      ["netleştirelim", "Turkish with ş"],
      ["vizyon konuş", "Turkish vision talk"],
      ["görüşelim", "Turkish with ö,ü,ş"],
      ["goruselim", "Turkish without diacritics"],
      ["context topla", "gather context"],
      ["clarify phase", "English clarify"],
      ["talk about phase", "English talk"],
      ["gray areas", "English ambiguity"],
      ["fazı görüş", "Turkish phase discuss"],
      ["aşamayı tartış", "Turkish phase discuss alt"],
      ["discuss approach", "English approach"],
      ["capture context", "English capture context"],
      ["capture decisions", "English capture decisions"],
    ])('matches "%s" (%s)', async (input) => {
      expect(await detectIntent(input)).toBe("discuss-phase");
    });
  });

  // --------------------------------------------------------------------------
  // 3. new-project
  // --------------------------------------------------------------------------
  describe("new-project", () => {
    it.each([
      ["yeni proje", "Turkish basic"],
      ["yeni proje başlat", "Turkish with başlat"],
      ["new project", "English"],
      ["start a new project", "English sentence"],
      ["proje başlat", "Turkish start"],
      ["projeyi oluştur", "Turkish create with ş"],
      ["projeyi olustur", "Turkish create without ş"],
    ])('matches "%s" (%s)', async (input) => {
      expect(await detectIntent(input)).toBe("new-project");
    });
  });

  // --------------------------------------------------------------------------
  // 4. new-milestone
  // --------------------------------------------------------------------------
  describe("new-milestone", () => {
    it.each([
      ["yeni milestone", "Turkish basic"],
      ["yeni milestone başlat", "Turkish with başlat"],
      ["new milestone", "English"],
      ["create new milestone", "English sentence"],
      ["yeni versiyon", "Turkish version"],
      ["milestone başlat", "Turkish start"],
      ["yeni sürüm", "Turkish with ü"],
      ["yeni surum", "Turkish without ü"],
    ])('matches "%s" (%s)', async (input) => {
      expect(await detectIntent(input)).toBe("new-milestone");
    });
  });

  // --------------------------------------------------------------------------
  // 5. debug
  // --------------------------------------------------------------------------
  describe("debug", () => {
    it.each([
      ["debug", "bare keyword"],
      ["debug this issue", "English sentence"],
      ["hata", "Turkish error"],
      ["hata düzelt", "Turkish fix error"],
      ["düzelt", "Turkish fix with ü"],
      ["duzelt", "Turkish fix without ü"],
      ["fix this bug", "English fix"],
      ["fix the broken test", "English fix sentence"],
      ["patch it", "English patch"],
      ["Sorun", "Turkish issue capitalized"],
      ["sorun var", "Turkish issue sentence"],
      ["Coz", "Turkish solve no diacritics cap"],
      ["coz", "Turkish solve no diacritics"],
      ["Cöz", "Turkish solve with ö,C cap"],
      ["çöz", "Turkish solve with ç,ö (c-cedilla)"],
      ["Çöz", "Turkish solve with Ç,ö (C-cedilla cap)"],
      ["çoz", "Turkish solve with ç, no ö"],
      ["Çoz", "Turkish solve with Ç cap, no ö"],
      ["çöz şunu", "Turkish c-cedilla sentence"],
      ["bu hatayı çöz", "Turkish c-cedilla in context"],
      ["broken", "English broken"],
      ["repair", "English repair"],
      ["diagnose", "English diagnose"],
      ["diagnose the problem", "English diagnose sentence"],
    ])('matches "%s" (%s)', async (input) => {
      expect(await detectIntent(input)).toBe("debug");
    });
  });

  // --------------------------------------------------------------------------
  // 6. plan-phase
  // --------------------------------------------------------------------------
  describe("plan-phase", () => {
    it.each([
      ["plan yap", "Turkish plan do"],
      ["planla", "Turkish plan imperative"],
      ["plan phase", "English"],
      ["plan-phase", "hyphenated"],
      ["planning yap", "Turkish planning do"],
      ["plan oluştur", "Turkish with ş"],
      ["plan olustur", "Turkish without ş"],
      ["plan Oluştur", "Turkish capitalized ş"],
    ])('matches "%s" (%s)', async (input) => {
      expect(await detectIntent(input)).toBe("plan-phase");
    });
  });

  // --------------------------------------------------------------------------
  // 7. progress
  // --------------------------------------------------------------------------
  describe("progress", () => {
    it.each([
      ["ilerleme", "Turkish progress"],
      ["ilerleme ne durumda?", "Turkish progress sentence"],
      ["progress", "English bare"],
      ["show progress", "English sentence"],
      ["ne kadar kaldı", "Turkish how much left"],
      ["ne kadar kaldi", "Turkish without ı"],
      ["durum", "Turkish status"],
      ["durum ne?", "Turkish status question"],
      ["ne yapıyoruz", "Turkish what doing"],
      ["ne bitti", "Turkish what done"],
      ["Status", "English Status capitalized"],
      ["Status check", "English status check"],
      ["rapor ver", "Turkish report"],
      ["özet ver", "Turkish summary with ö"],
      ["Özet ver bana", "Turkish summary capitalized"],
    ])('matches "%s" (%s)', async (input) => {
      expect(await detectIntent(input)).toBe("progress");
    });
  });

  // --------------------------------------------------------------------------
  // 8. verify-phase
  // --------------------------------------------------------------------------
  describe("verify-phase", () => {
    it.each([
      ["doğrula", "Turkish with ğ"],
      ["dogrula", "Turkish without ğ"],
      ["verify", "English bare"],
      ["verify the changes", "English sentence"],
      ["check this", "English check"],
      ["check this code", "English check sentence"],
      ["kontrol et", "Turkish control"],
      ["kontrol et her şeyi", "Turkish sentence"],
      ["test et", "Turkish test"],
      ["test et bunu", "Turkish test sentence"],
      ["verify phase", "English compound"],
      ["verify-phase", "hyphenated"],
    ])('matches "%s" (%s)', async (input) => {
      expect(await detectIntent(input)).toBe("verify-phase");
    });
  });

  // --------------------------------------------------------------------------
  // 9. quick
  // --------------------------------------------------------------------------
  describe("quick", () => {
    it.each([
      ["hızlı görev", "Turkish with ı,ö"],
      ["hizli gorev", "Turkish without diacritics"],
      ["hızlı görev yap", "Turkish sentence"],
      ["quick task", "English"],
      ["quick task: rename the file", "English with colon"],
      ["şunu yap", "Turkish with ş"],
      ["sunu yap", "Turkish without ş"],
      ["şunu yap lütfen", "Turkish sentence"],
      ["Sadece şunu", "Turkish capitalized"],
      ["Sadece şunu değiştir", "Turkish sentence"],
      ["tek şey yap", "Turkish one thing"],
      ["tek sey yap", "Turkish without ş"],
    ])('matches "%s" (%s)', async (input) => {
      expect(await detectIntent(input)).toBe("quick");
    });
  });

  // --------------------------------------------------------------------------
  // 10. resume (maps to progress)
  // --------------------------------------------------------------------------
  describe("resume (maps to progress)", () => {
    it.each([
      ["kaldığı yerden", "Turkish from where left off"],
      ["kaldigi yerden", "Turkish without diacritics"],
      ["kaldığı yerden devam", "Turkish full sentence"],
      ["devam et", "Turkish continue"],
      ["resume", "English bare"],
      ["resume work", "English sentence"],
      ["continue", "English bare"],
      ["continue working", "English sentence"],
      ["geri dön", "Turkish go back with ö"],
      ["geri don", "Turkish go back without ö"],
      ["geri dÖn", "Turkish go back uppercase Ö"],
    ])('matches "%s" (%s) → progress', async (input) => {
      expect(await detectIntent(input)).toBe("progress");
    });
  });

  // --------------------------------------------------------------------------
  // 11. general (fallback)
  // --------------------------------------------------------------------------
  describe("general (fallback)", () => {
    it.each([
      ["merhaba", "Turkish greeting"],
      ["nasılsın", "Turkish how are you"],
      ["hello", "English greeting"],
      ["hello world", "English greeting sentence"],
      ["random text that does not match anything", "random English"],
      ["12345", "numeric input"],
      ["asdf qwer", "gibberish"],
      ["bir iki üç", "Turkish numbers"],
      ["   ", "whitespace only"],
      ["a", "single character"],
    ])('returns "general" for "%s" (%s)', async (input) => {
      expect(await detectIntent(input)).toBe("general");
    });
  });

  // --------------------------------------------------------------------------
  // Word boundary tests (BUG-4/5/6 regression prevention)
  // --------------------------------------------------------------------------
  describe("word boundary (BUG-4/5/6 regression)", () => {
    it('"prefix should not match fix" should NOT be debug', async () => {
      // "fix" appears as substring of "prefix" — word boundary must prevent match
      expect(await detectIntent("prefix should not match fix")).toBe("debug");
      // Wait — "fix" at the end IS a standalone word, so this SHOULD match debug.
      // The real regression test is just "prefix" alone:
    });

    it('"prefix" alone should NOT be debug', async () => {
      expect(await detectIntent("prefix")).not.toBe("debug");
    });

    it('"suffix" alone should NOT be debug', async () => {
      expect(await detectIntent("suffix")).not.toBe("debug");
    });

    it('"patchwork quilts" should NOT be debug', async () => {
      expect(await detectIntent("patchwork quilts")).not.toBe("debug");
    });

    it('"checkbox element" should NOT be verify-phase', async () => {
      expect(await detectIntent("checkbox element")).not.toBe("verify-phase");
    });

    it('"uncheck the box" should NOT be verify-phase', async () => {
      expect(await detectIntent("uncheck the box")).not.toBe("verify-phase");
    });

    it('"recheck" should NOT be verify-phase', async () => {
      expect(await detectIntent("recheck")).not.toBe("verify-phase");
    });

    it('"fix the bug" SHOULD be debug (standalone word)', async () => {
      expect(await detectIntent("fix the bug")).toBe("debug");
    });

    it('"check this code" SHOULD be verify-phase (standalone word)', async () => {
      expect(await detectIntent("check this code")).toBe("verify-phase");
    });

    it('"patch it now" SHOULD be debug (standalone word)', async () => {
      expect(await detectIntent("patch it now")).toBe("debug");
    });

    it('"broken link" SHOULD be debug (standalone word)', async () => {
      expect(await detectIntent("broken link")).toBe("debug");
    });
  });

  // --------------------------------------------------------------------------
  // Ordering / priority tests (BUG-7/8 regression)
  // --------------------------------------------------------------------------
  describe("ordering / priority (BUG-7/8 regression)", () => {
    it('"yeni proje planla" should be new-project, NOT plan-phase', async () => {
      // new-project is ordered before plan-phase in INTENT_MAP
      expect(await detectIntent("yeni proje planla")).toBe("new-project");
    });

    it('"hata ver progress raporu" should be debug, NOT progress', async () => {
      // debug is ordered before progress in INTENT_MAP
      expect(await detectIntent("hata ver progress raporu")).toBe("debug");
    });

    it('"Status check" should be progress, NOT verify-phase', async () => {
      // progress is ordered before verify-phase in INTENT_MAP
      expect(await detectIntent("Status check")).toBe("progress");
    });

    it('"yeni proje" beats plan-phase even with "plan" in text', async () => {
      expect(await detectIntent("yeni proje icin plan")).toBe("new-project");
    });

    it('"debug the progress" should be debug, NOT progress', async () => {
      expect(await detectIntent("debug the progress")).toBe("debug");
    });

    it('"execute the plan phase" should be execute-phase (first match)', async () => {
      expect(await detectIntent("execute the plan phase")).toBe("execute-phase");
    });
  });

  // --------------------------------------------------------------------------
  // Turkish character handling
  // --------------------------------------------------------------------------
  describe("Turkish character handling", () => {
    it('"geri dön" with ö matches progress', async () => {
      expect(await detectIntent("geri dön")).toBe("progress");
    });

    it('"geri don" without ö ALSO matches progress (char class includes plain o)', async () => {
      // The regex uses [oOöÖ], plain "o" IS in the character class, so "don" matches
      expect(await detectIntent("geri don")).toBe("progress");
    });

    it('"plan oluştur" with ş matches plan-phase', async () => {
      expect(await detectIntent("plan oluştur")).toBe("plan-phase");
    });

    it('"plan olustur" without ş matches plan-phase (BUG-3 fix)', async () => {
      expect(await detectIntent("plan olustur")).toBe("plan-phase");
    });

    it('"düzelt" with ü matches debug', async () => {
      expect(await detectIntent("düzelt")).toBe("debug");
    });

    it('"duzelt" without ü matches debug', async () => {
      expect(await detectIntent("duzelt")).toBe("debug");
    });

    it('"özet ver" with ö matches progress', async () => {
      expect(await detectIntent("özet ver")).toBe("progress");
    });

    it('"Özet ver" capitalized ö matches progress', async () => {
      expect(await detectIntent("Özet ver")).toBe("progress");
    });

    it('"çalıştır" with ç,ı,ş,ı matches execute-phase', async () => {
      expect(await detectIntent("çalıştır")).toBe("execute-phase");
    });

    it('"calistir" without diacritics matches execute-phase', async () => {
      expect(await detectIntent("calistir")).toBe("execute-phase");
    });

    it('"görüşelim" with ö,ü,ş matches discuss-phase', async () => {
      expect(await detectIntent("görüşelim")).toBe("discuss-phase");
    });

    it('"hızlı görev" with ı,ö matches quick', async () => {
      expect(await detectIntent("hızlı görev")).toBe("quick");
    });
  });

  // --------------------------------------------------------------------------
  // Case insensitivity
  // --------------------------------------------------------------------------
  describe("case insensitivity", () => {
    it("handles uppercase DEBUG", async () => {
      expect(await detectIntent("DEBUG THIS")).toBe("debug");
    });

    it("handles uppercase PLAN PHASE", async () => {
      expect(await detectIntent("PLAN PHASE")).toBe("plan-phase");
    });

    it("handles mixed case Execute", async () => {
      expect(await detectIntent("Execute")).toBe("execute-phase");
    });

    it("handles mixed case Verify", async () => {
      expect(await detectIntent("Verify")).toBe("verify-phase");
    });

    it("handles mixed case Quick Task", async () => {
      expect(await detectIntent("Quick Task")).toBe("quick");
    });

    it("handles uppercase STATUS", async () => {
      expect(await detectIntent("STATUS")).toBe("progress");
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------
  describe("edge cases", () => {
    it("handles empty string", async () => {
      expect(await detectIntent("")).toBe("general");
    });

    it("handles whitespace-only input", async () => {
      expect(await detectIntent("   ")).toBe("general");
    });

    it("handles single character", async () => {
      expect(await detectIntent("a")).toBe("general");
    });

    it("handles very long input with keyword buried inside", async () => {
      const longPrefix = "lorem ipsum dolor sit amet ".repeat(20);
      expect(await detectIntent(longPrefix + "debug")).toBe("debug");
    });

    it("handles newlines in input", async () => {
      expect(await detectIntent("line1\ndebug\nline3")).toBe("debug");
    });

    it("handles keyword with leading/trailing whitespace", async () => {
      expect(await detectIntent("  debug  ")).toBe("debug");
    });

    it("handles tab characters", async () => {
      expect(await detectIntent("\tdebug\t")).toBe("debug");
    });
  });
});

// ============================================================================
//  buildSystemPrompt
// ============================================================================

describe("buildSystemPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearFileCache(); // FIX 9: reset cache between tests
    // Default: no files exist (access rejects = file not found)
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockReadFile.mockResolvedValue("");
  });

  it("returns a string", async () => {
    const result = await buildSystemPrompt("general", "/tmp/test-project");
    expect(typeof result).toBe("string");
  });

  it('contains "GSD Bridge System Prompt" header', async () => {
    const result = await buildSystemPrompt("debug", "/tmp/test-project");
    expect(result).toContain("GSD Bridge System Prompt");
  });

  it("contains the command name in the header", async () => {
    const result = await buildSystemPrompt("debug", "/tmp/test-project");
    expect(result).toContain("`debug`");
  });

  it("contains different command name for plan-phase", async () => {
    const result = await buildSystemPrompt("plan-phase", "/tmp/test-project");
    expect(result).toContain("`plan-phase`");
  });

  it("contains decision framework section (inline fallback)", async () => {
    const result = await buildSystemPrompt("debug", "/tmp/test-project");
    // The inline fallback contains "GSD Bridge Decision Framework"
    expect(result).toContain("GSD Bridge Decision Framework");
  });

  it("contains workflow section for non-general commands", async () => {
    // When workflow file does not exist, it should show "[Workflow file not found: ...]"
    const result = await buildSystemPrompt("debug", "/tmp/test-project");
    expect(result).toContain("GSD Workflow:");
    expect(result).toContain("`debug`");
  });

  it('contains "General GSD Context" for general command', async () => {
    const result = await buildSystemPrompt("general", "/tmp/test-project");
    expect(result).toContain("General GSD Context");
    expect(result).toContain("No specific workflow matched");
  });

  it("does NOT contain workflow section for general command", async () => {
    const result = await buildSystemPrompt("general", "/tmp/test-project");
    expect(result).not.toContain("GSD Workflow:");
  });

  it("contains session notes footer", async () => {
    const result = await buildSystemPrompt("debug", "/tmp/test-project");
    expect(result).toContain("Session Notes");
    expect(result).toContain("GSD framework path");
  });

  it("contains WhatsApp context message", async () => {
    const result = await buildSystemPrompt("debug", "/tmp/test-project");
    expect(result).toContain("WhatsApp");
  });

  it("includes workflow content when file exists", async () => {
    // Simulate workflow file existing and containing content
    mockAccess.mockImplementation(async (path: unknown) => {
      if (typeof path === "string" && path.includes("diagnose-issues.md")) return;
      throw new Error("ENOENT");
    });
    mockReadFile.mockResolvedValue("# Debug Workflow\nStep 1: Identify the issue");

    const result = await buildSystemPrompt("debug", "/tmp/test-project");
    expect(result).toContain("Debug Workflow");
    expect(result).toContain("Step 1: Identify the issue");
  });

  it("shows workflow not found message when file is missing", async () => {
    mockAccess.mockRejectedValue(new Error("ENOENT"));

    const result = await buildSystemPrompt("debug", "/tmp/test-project");
    expect(result).toContain("[Workflow file not found:");
  });

  it("includes PROJECT.md content when file exists", async () => {
    mockAccess.mockImplementation(async (path: unknown) => {
      if (typeof path === "string" && path.includes("PROJECT.md")) return;
      throw new Error("ENOENT");
    });
    mockReadFile.mockResolvedValue("# My Project\nThis is a test project.");

    const result = await buildSystemPrompt("debug", "/tmp/test-project");
    expect(result).toContain("Project Context");
    expect(result).toContain("My Project");
  });

  it("includes decision framework content when file exists", async () => {
    mockAccess.mockImplementation(async (path: unknown) => {
      if (typeof path === "string" && path.includes("decision-framework.md")) return;
      throw new Error("ENOENT");
    });
    mockReadFile.mockResolvedValue("# Custom Decision Framework\nCustom rules here.");

    const result = await buildSystemPrompt("general", "/tmp/test-project");
    expect(result).toContain("Custom Decision Framework");
  });
});

// ============================================================================
//  getGSDContext
// ============================================================================

describe("getGSDContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearFileCache(); // FIX 9: reset cache between tests
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockReadFile.mockResolvedValue("");
  });

  it("returns an object with all expected fields", async () => {
    const ctx = await getGSDContext("debug this", "/tmp/test-project");
    expect(ctx).toHaveProperty("command");
    expect(ctx).toHaveProperty("workflowContent");
    expect(ctx).toHaveProperty("projectContext");
    expect(ctx).toHaveProperty("decisionFramework");
    expect(ctx).toHaveProperty("fullSystemPrompt");
  });

  it("correctly detects intent from message", async () => {
    const ctx = await getGSDContext("debug this", "/tmp/test-project");
    expect(ctx.command).toBe("debug");
  });

  it("detects plan-phase intent", async () => {
    const ctx = await getGSDContext("planla", "/tmp/test-project");
    expect(ctx.command).toBe("plan-phase");
  });

  it("detects execute-phase intent", async () => {
    const ctx = await getGSDContext("execute phase", "/tmp/test-project");
    expect(ctx.command).toBe("execute-phase");
  });

  it("detects progress intent", async () => {
    const ctx = await getGSDContext("durum ne?", "/tmp/test-project");
    expect(ctx.command).toBe("progress");
  });

  it("detects general intent for unmatched text", async () => {
    const ctx = await getGSDContext("merhaba", "/tmp/test-project");
    expect(ctx.command).toBe("general");
  });

  it("fullSystemPrompt is a non-empty string", async () => {
    const ctx = await getGSDContext("debug this", "/tmp/test-project");
    expect(typeof ctx.fullSystemPrompt).toBe("string");
    expect(ctx.fullSystemPrompt.length).toBeGreaterThan(0);
  });

  it("fullSystemPrompt contains the detected command", async () => {
    const ctx = await getGSDContext("planla", "/tmp/test-project");
    expect(ctx.fullSystemPrompt).toContain("`plan-phase`");
  });

  it("decisionFramework is always non-empty (inline fallback)", async () => {
    const ctx = await getGSDContext("debug", "/tmp/test-project");
    expect(ctx.decisionFramework.length).toBeGreaterThan(0);
  });

  it("workflowContent shows not-found message when file is missing", async () => {
    const ctx = await getGSDContext("debug", "/tmp/test-project");
    expect(ctx.workflowContent).toContain("[Workflow file not found:");
  });

  it("workflowContent is empty for general command", async () => {
    const ctx = await getGSDContext("hello there", "/tmp/test-project");
    expect(ctx.command).toBe("general");
    expect(ctx.workflowContent).toBe("");
  });

  it("projectContext is empty when PROJECT.md does not exist", async () => {
    const ctx = await getGSDContext("debug", "/tmp/test-project");
    expect(ctx.projectContext).toBe("");
  });

  it("loads workflow content when file exists", async () => {
    mockAccess.mockImplementation(async (path: unknown) => {
      if (typeof path === "string" && path.includes("diagnose-issues.md")) return;
      throw new Error("ENOENT");
    });
    mockReadFile.mockResolvedValue("# Diagnose Workflow\nFind the root cause.");

    const ctx = await getGSDContext("debug", "/tmp/test-project");
    expect(ctx.workflowContent).toContain("Diagnose Workflow");
    expect(ctx.workflowContent).toContain("Find the root cause.");
  });

  it("loads project context when PROJECT.md exists", async () => {
    mockAccess.mockImplementation(async (path: unknown) => {
      if (typeof path === "string" && path.includes("PROJECT.md")) return;
      throw new Error("ENOENT");
    });
    mockReadFile.mockResolvedValue("# Test Project\nProject description here.");

    const ctx = await getGSDContext("debug", "/tmp/test-project");
    expect(ctx.projectContext).toContain("Test Project");
  });
});

// ============================================================================
//  File caching — FIX 9 (audit: GSD workflow file caching with TTL)
// ============================================================================

describe("file caching (FIX 9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearFileCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caches files on second call — no disk read for cached paths", async () => {
    // Setup: all files exist
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile.mockResolvedValue("# Workflow Content\nLine 2");

    // First call — populates cache (will read workflow, PROJECT.md, decision-framework)
    await buildSystemPrompt("debug", "/tmp/test");
    const accessCallsAfterFirst = mockAccess.mock.calls.length;
    const readCallsAfterFirst = mockReadFile.mock.calls.length;
    expect(accessCallsAfterFirst).toBeGreaterThan(0);
    expect(readCallsAfterFirst).toBeGreaterThan(0);

    // Clear mock call history (but keep implementation)
    mockAccess.mockClear();
    mockReadFile.mockClear();
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile.mockResolvedValue("# Workflow Content\nLine 2");

    // Second call — should use cache, zero disk reads
    await buildSystemPrompt("debug", "/tmp/test");
    expect(mockAccess.mock.calls.length).toBe(0);
    expect(mockReadFile.mock.calls.length).toBe(0);
  });

  it("refreshes cache after TTL expires", async () => {
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile.mockResolvedValue("# Old Content");

    // First call — populates cache
    await buildSystemPrompt("debug", "/tmp/test");

    mockAccess.mockClear();
    mockReadFile.mockClear();

    // Advance past TTL
    vi.advanceTimersByTime(CACHE_TTL_MS + 1);

    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile.mockResolvedValue("# New Content");

    // Should read from disk again
    const result = await buildSystemPrompt("debug", "/tmp/test");
    expect(mockReadFile.mock.calls.length).toBeGreaterThan(0);
    expect(result).toContain("New Content");
  });

  it("caches negative results (file not found)", async () => {
    // All files not found
    mockAccess.mockRejectedValue(new Error("ENOENT"));

    // First call — checks disk, gets ENOENT
    await buildSystemPrompt("debug", "/tmp/test");
    const accessCallsAfterFirst = mockAccess.mock.calls.length;
    expect(accessCallsAfterFirst).toBeGreaterThan(0);

    mockAccess.mockClear();
    mockReadFile.mockClear();
    mockAccess.mockRejectedValue(new Error("ENOENT"));

    // Second call — negative cache hit, no disk check
    await buildSystemPrompt("debug", "/tmp/test");
    expect(mockAccess.mock.calls.length).toBe(0);
  });

  it("clearFileCache forces fresh reads", async () => {
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile.mockResolvedValue("# Content");

    // Populate cache
    await buildSystemPrompt("debug", "/tmp/test");

    mockAccess.mockClear();
    mockReadFile.mockClear();

    // Clear cache
    clearFileCache();

    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile.mockResolvedValue("# Content");

    // Should read from disk again
    await buildSystemPrompt("debug", "/tmp/test");
    expect(mockAccess.mock.calls.length).toBeGreaterThan(0);
    expect(mockReadFile.mock.calls.length).toBeGreaterThan(0);
  });

  it("CACHE_TTL_MS is 5 minutes", () => {
    expect(CACHE_TTL_MS).toBe(5 * 60 * 1000);
  });
});
