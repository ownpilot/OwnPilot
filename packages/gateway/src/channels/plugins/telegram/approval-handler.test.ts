/**
 * Comprehensive tests for Telegram Approval Handler.
 *
 * Covers: escapeHtml, truncate, registerApprovalHandler,
 * requestTelegramApproval, clearPendingApprovals, and integration flows.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Hoisted mocks
// ============================================================================

const mockLogInfo = vi.hoisted(() => vi.fn());
const mockLogDebug = vi.hoisted(() => vi.fn());
const mockLogWarn = vi.hoisted(() => vi.fn());

vi.mock('../../../services/log.js', () => ({
  getLog: () => ({ info: mockLogInfo, debug: mockLogDebug, warn: mockLogWarn, error: vi.fn() }),
}));

interface MockButton { text: string; data: string }
interface MockKeyboard { _buttons: MockButton[] }

const allKeyboards: MockKeyboard[] = [];
let lastKeyboard: MockKeyboard;

vi.mock('grammy', () => {
  class InlineKeyboard {
    _buttons: MockButton[] = [];
    text(label: string, data: string) {
      this._buttons.push({ text: label, data });
      return this;
    }
    constructor() {
      const instance = this; // eslint-disable-line @typescript-eslint/no-this-alias
      lastKeyboard = instance;
      allKeyboards.push(instance);
    }
  }
  return { InlineKeyboard };
});

// Stable mock for randomUUID — counter increments per call
let uuidCounter = 0;
vi.mock('node:crypto', () => ({
  randomUUID: () => {
    uuidCounter++;
    return `${String(uuidCounter).padStart(8, '0')}-0000-0000-0000-000000000000`;
  },
}));

// ============================================================================
// Helpers
// ============================================================================

function createMockBot() {
  return {
    on: vi.fn(),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
      editMessageText: vi.fn().mockResolvedValue({}),
    },
    token: 'test-token',
  };
}

type CallbackQueryHandler = (
  ctx: {
    callbackQuery: { data: string };
    answerCallbackQuery: ReturnType<typeof vi.fn>;
    editMessageText: ReturnType<typeof vi.fn>;
  },
  next: ReturnType<typeof vi.fn>,
) => Promise<void>;

function getRegisteredHandler(mockBot: ReturnType<typeof createMockBot>): CallbackQueryHandler {
  expect(mockBot.on).toHaveBeenCalledWith('callback_query:data', expect.any(Function));
  return mockBot.on.mock.calls[0]![1] as CallbackQueryHandler;
}

function createMockCtx(data: string) {
  return {
    callbackQuery: { data },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Flush microtask queue so that `await sendMessage()` inside
 * requestTelegramApproval resolves and `pending.set()` runs.
 */
async function flushMicrotasks() {
  await vi.advanceTimersByTimeAsync(0);
}

/**
 * Helper: call requestTelegramApproval and flush so the pending entry is ready.
 * Returns the promise and the keyboard that was created.
 */
async function requestAndFlush(
  bot: ReturnType<typeof createMockBot>,
  chatId: string,
  params: { toolName: string; description: string; riskLevel?: string },
) {
  const promise = requestTelegramApproval(bot as never, chatId, params);
  const keyboard = lastKeyboard;
  await flushMicrotasks();
  return { promise, keyboard };
}

// ============================================================================
// Module under test (dynamic import for module-level state isolation)
// ============================================================================

let registerApprovalHandler: typeof import('./approval-handler.js').registerApprovalHandler;
let requestTelegramApproval: typeof import('./approval-handler.js').requestTelegramApproval;
let clearPendingApprovals: typeof import('./approval-handler.js').clearPendingApprovals;

beforeEach(async () => {
  const mod = await import('./approval-handler.js');
  registerApprovalHandler = mod.registerApprovalHandler;
  requestTelegramApproval = mod.requestTelegramApproval;
  clearPendingApprovals = mod.clearPendingApprovals;

  // Reset module-level pending map
  clearPendingApprovals();
  uuidCounter = 0;
  allKeyboards.length = 0;

  mockLogInfo.mockClear();
  mockLogDebug.mockClear();
  mockLogWarn.mockClear();
});

// ============================================================================
// escapeHtml (internal — tested indirectly via requestTelegramApproval)
// ============================================================================

describe('escapeHtml (via message content)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearPendingApprovals();
    vi.useRealTimers();
  });

  it('should escape ampersands in tool name', async () => {
    const bot = createMockBot();
    requestTelegramApproval(bot as never, '123', {
      toolName: 'foo&bar',
      description: 'test',
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).toContain('foo&amp;bar');
    expect(sentText).not.toContain('foo&bar');
  });

  it('should escape less-than brackets in tool name', async () => {
    const bot = createMockBot();
    requestTelegramApproval(bot as never, '123', {
      toolName: '<script>',
      description: 'test',
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).toContain('&lt;script&gt;');
    expect(sentText).not.toMatch(/<script>/);
  });

  it('should escape greater-than brackets in tool name', async () => {
    const bot = createMockBot();
    requestTelegramApproval(bot as never, '123', {
      toolName: 'a>b',
      description: 'test',
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).toContain('a&gt;b');
  });

  it('should escape combined special chars', async () => {
    const bot = createMockBot();
    requestTelegramApproval(bot as never, '123', {
      toolName: 'a&b<c>d',
      description: '',
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).toContain('a&amp;b&lt;c&gt;d');
  });

  it('should escape description text', async () => {
    const bot = createMockBot();
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: 'do <this> & <that>',
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).toContain('do &lt;this&gt; &amp; &lt;that&gt;');
  });

  it('should handle tool name with no special chars', async () => {
    const bot = createMockBot();
    requestTelegramApproval(bot as never, '123', {
      toolName: 'normalTool',
      description: 'desc',
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).toContain('normalTool');
  });
});

// ============================================================================
// truncate (internal — tested indirectly via description in message)
// ============================================================================

describe('truncate (via description content)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearPendingApprovals();
    vi.useRealTimers();
  });

  it('should not truncate description under maxLength (500)', async () => {
    const bot = createMockBot();
    const desc = 'a'.repeat(499);
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: desc,
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).toContain(desc);
    expect(sentText).not.toContain('\u2026');
  });

  it('should not truncate description at exact maxLength (500)', async () => {
    const bot = createMockBot();
    const desc = 'b'.repeat(500);
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: desc,
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).toContain(desc);
    expect(sentText).not.toContain('\u2026');
  });

  it('should truncate description over maxLength with ellipsis', async () => {
    const bot = createMockBot();
    const desc = 'c'.repeat(501);
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: desc,
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    // truncate(text, 500) -> text.slice(0, 499) + ellipsis
    expect(sentText).toContain('c'.repeat(499) + '\u2026');
    expect(sentText).not.toContain('c'.repeat(501));
  });

  it('should handle very long description', async () => {
    const bot = createMockBot();
    const desc = 'x'.repeat(2000);
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: desc,
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).toContain('x'.repeat(499) + '\u2026');
  });

  it('should handle empty description (no Action line)', async () => {
    const bot = createMockBot();
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: '',
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    // Empty string is falsy so filter(Boolean) removes the Action line
    expect(sentText).not.toContain('<b>Action:</b>');
  });
});

// ============================================================================
// registerApprovalHandler
// ============================================================================

describe('registerApprovalHandler', () => {
  let bot: ReturnType<typeof createMockBot>;

  beforeEach(() => {
    vi.useFakeTimers();
    bot = createMockBot();
  });

  afterEach(() => {
    clearPendingApprovals();
    vi.useRealTimers();
  });

  it('should register callback_query:data handler on bot', () => {
    registerApprovalHandler(bot as never);
    expect(bot.on).toHaveBeenCalledTimes(1);
    expect(bot.on).toHaveBeenCalledWith('callback_query:data', expect.any(Function));
  });

  it('should call next() for non-approve/deny callback data', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);
    const ctx = createMockCtx('other:data');
    const next = vi.fn().mockResolvedValue(undefined);

    await handler(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
  });

  it('should call next() for callback data without colon', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);
    const ctx = createMockCtx('randomdata');
    const next = vi.fn().mockResolvedValue(undefined);

    await handler(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should call next() for empty callback data', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);
    const ctx = createMockCtx('');
    const next = vi.fn().mockResolvedValue(undefined);

    await handler(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should not call next() for approve: prefix', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const { promise, keyboard } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });
    const approveId = keyboard._buttons[0]!.data.split(':')[1]!;

    const ctx = createMockCtx(`approve:${approveId}`);
    const next = vi.fn().mockResolvedValue(undefined);

    await handler(ctx, next);

    expect(next).not.toHaveBeenCalled();
    await promise;
  });

  it('should not call next() for deny: prefix', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const { promise, keyboard } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });
    const denyId = keyboard._buttons[1]!.data.split(':')[1]!;

    const ctx = createMockCtx(`deny:${denyId}`);
    const next = vi.fn().mockResolvedValue(undefined);

    await handler(ctx, next);

    expect(next).not.toHaveBeenCalled();
    await promise;
  });

  it('should answer "expired" for unknown approval ID', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const ctx = createMockCtx('approve:unknown1');
    const next = vi.fn().mockResolvedValue(undefined);

    await handler(ctx, next);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'This approval has expired.' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should answer "expired" for unknown deny ID', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const ctx = createMockCtx('deny:unknown2');
    const next = vi.fn().mockResolvedValue(undefined);

    await handler(ctx, next);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'This approval has expired.' });
  });

  it('should resolve promise with true on approve', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const { promise, keyboard } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });
    const approveId = keyboard._buttons[0]!.data.split(':')[1]!;

    const ctx = createMockCtx(`approve:${approveId}`);
    await handler(ctx, vi.fn());

    const result = await promise;
    expect(result).toBe(true);
  });

  it('should resolve promise with false on deny', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const { promise, keyboard } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });
    const denyId = keyboard._buttons[1]!.data.split(':')[1]!;

    const ctx = createMockCtx(`deny:${denyId}`);
    await handler(ctx, vi.fn());

    const result = await promise;
    expect(result).toBe(false);
  });

  it('should edit message to "Approved" on approve', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const { promise, keyboard } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });
    const approveId = keyboard._buttons[0]!.data.split(':')[1]!;

    const ctx = createMockCtx(`approve:${approveId}`);
    await handler(ctx, vi.fn());
    await promise;

    expect(ctx.editMessageText).toHaveBeenCalledWith('\u2705 Approved');
  });

  it('should edit message to "Denied" on deny', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const { promise, keyboard } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });
    const denyId = keyboard._buttons[1]!.data.split(':')[1]!;

    const ctx = createMockCtx(`deny:${denyId}`);
    await handler(ctx, vi.fn());
    await promise;

    expect(ctx.editMessageText).toHaveBeenCalledWith('\u274c Denied');
  });

  it('should answer callback query with "Approved"', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const { promise, keyboard } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });
    const approveId = keyboard._buttons[0]!.data.split(':')[1]!;

    const ctx = createMockCtx(`approve:${approveId}`);
    await handler(ctx, vi.fn());
    await promise;

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Approved' });
  });

  it('should answer callback query with "Denied"', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const { promise, keyboard } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });
    const denyId = keyboard._buttons[1]!.data.split(':')[1]!;

    const ctx = createMockCtx(`deny:${denyId}`);
    await handler(ctx, vi.fn());
    await promise;

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Denied' });
  });

  it('should clear timeout on approval', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const { promise, keyboard } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });
    const approveId = keyboard._buttons[0]!.data.split(':')[1]!;

    clearTimeoutSpy.mockClear();
    const ctx = createMockCtx(`approve:${approveId}`);
    await handler(ctx, vi.fn());
    await promise;

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('should delete entry from pending after approval', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const { promise, keyboard } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });
    const approveId = keyboard._buttons[0]!.data.split(':')[1]!;

    const ctx = createMockCtx(`approve:${approveId}`);
    await handler(ctx, vi.fn());
    await promise;

    // Attempting the same ID again should give "expired"
    const ctx2 = createMockCtx(`approve:${approveId}`);
    await handler(ctx2, vi.fn());
    expect(ctx2.answerCallbackQuery).toHaveBeenCalledWith({ text: 'This approval has expired.' });
  });

  it('should handle editMessageText failure gracefully', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const { promise, keyboard } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });
    const approveId = keyboard._buttons[0]!.data.split(':')[1]!;

    const ctx = createMockCtx(`approve:${approveId}`);
    ctx.editMessageText.mockRejectedValue(new Error('Telegram API error'));

    await handler(ctx, vi.fn());

    const result = await promise;
    // Resolve happens BEFORE edit, so it still works
    expect(result).toBe(true);
    expect(mockLogDebug).toHaveBeenCalledWith('Failed to edit approval message', expect.any(Object));
  });

  it('should handle answerCallbackQuery failure gracefully', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const { promise, keyboard } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });
    const denyId = keyboard._buttons[1]!.data.split(':')[1]!;

    const ctx = createMockCtx(`deny:${denyId}`);
    ctx.answerCallbackQuery.mockRejectedValue(new Error('query too old'));

    await handler(ctx, vi.fn());

    const result = await promise;
    expect(result).toBe(false);
    expect(mockLogDebug).toHaveBeenCalledWith('Failed to answer callback query', expect.any(Object));
  });

  it('should resolve even when editMessageText fails', async () => {
    // This tests the design guarantee: resolve is called before edit,
    // so the approval decision is delivered even if Telegram API fails.
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const { promise, keyboard } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });
    const approveId = keyboard._buttons[0]!.data.split(':')[1]!;

    const ctx = createMockCtx(`approve:${approveId}`);
    // editMessageText throws, but resolve already happened
    ctx.editMessageText.mockRejectedValue(new Error('network error'));
    ctx.answerCallbackQuery.mockRejectedValue(new Error('network error'));

    await handler(ctx, vi.fn());

    // Despite both Telegram API calls failing, the promise resolves true
    const result = await promise;
    expect(result).toBe(true);
  });

  it('should handle answerCallbackQuery failure for expired entries gracefully', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const ctx = createMockCtx('approve:nonexistent');
    ctx.answerCallbackQuery.mockRejectedValue(new Error('fail'));

    // Should not throw -- .catch(() => {}) handles it
    await handler(ctx, vi.fn());
  });
});

// ============================================================================
// requestTelegramApproval
// ============================================================================

describe('requestTelegramApproval', () => {
  let bot: ReturnType<typeof createMockBot>;

  beforeEach(() => {
    vi.useFakeTimers();
    bot = createMockBot();
  });

  afterEach(() => {
    clearPendingApprovals();
    vi.useRealTimers();
  });

  it('should send message with HTML parse_mode', async () => {
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: 'desc',
    });

    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      '123',
      expect.any(String),
      expect.objectContaining({ parse_mode: 'HTML' }),
    );
  });

  it('should send message with reply_markup (inline keyboard)', async () => {
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: 'desc',
    });

    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      '123',
      expect.any(String),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );
  });

  it('should send to the correct chatId', async () => {
    requestTelegramApproval(bot as never, '99887766', {
      toolName: 'tool',
      description: 'desc',
    });

    expect(bot.api.sendMessage.mock.calls[0]![0]).toBe('99887766');
  });

  it('should include tool name in message body', async () => {
    requestTelegramApproval(bot as never, '123', {
      toolName: 'mySpecialTool',
      description: 'desc',
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).toContain('mySpecialTool');
    expect(sentText).toContain('<b>Tool:</b>');
    expect(sentText).toContain('<code>mySpecialTool</code>');
  });

  it('should include "Tool Approval Required" heading', async () => {
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: 'desc',
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).toContain('<b>Tool Approval Required</b>');
  });

  it('should include description as Action line', async () => {
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: 'Run the dangerous command',
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).toContain('<b>Action:</b> Run the dangerous command');
  });

  it('should omit Action line when description is empty', async () => {
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: '',
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).not.toContain('<b>Action:</b>');
  });

  it('should show high risk badge when riskLevel is "high"', async () => {
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: 'desc',
      riskLevel: 'high',
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).toContain('\u26a0\ufe0f HIGH RISK');
  });

  it('should not show risk badge when riskLevel is undefined', async () => {
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: 'desc',
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).not.toContain('HIGH RISK');
  });

  it('should not show risk badge when riskLevel is "low"', async () => {
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: 'desc',
      riskLevel: 'low',
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).not.toContain('HIGH RISK');
  });

  it('should not show risk badge when riskLevel is "medium"', async () => {
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: 'desc',
      riskLevel: 'medium',
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).not.toContain('HIGH RISK');
  });

  it('should create keyboard with approve and deny buttons', async () => {
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: 'desc',
    });

    expect(lastKeyboard._buttons).toHaveLength(2);
    expect(lastKeyboard._buttons[0]!.text).toBe('\u2705 Approve');
    expect(lastKeyboard._buttons[1]!.text).toBe('\u274c Deny');
  });

  it('should use consistent ID for approve and deny buttons', async () => {
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: 'desc',
    });

    const approveId = lastKeyboard._buttons[0]!.data.split(':')[1];
    const denyId = lastKeyboard._buttons[1]!.data.split(':')[1];
    expect(approveId).toBe(denyId);
  });

  it('should generate 8-character IDs from UUID', async () => {
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: 'desc',
    });

    const id = lastKeyboard._buttons[0]!.data.split(':')[1]!;
    expect(id).toHaveLength(8);
  });

  it('should generate unique IDs for different requests', async () => {
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool1',
      description: 'desc',
    });
    // Capture first keyboard before it gets overwritten
    const kb1 = allKeyboards[allKeyboards.length - 1]!;
    const id1 = kb1._buttons[0]!.data.split(':')[1];

    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool2',
      description: 'desc',
    });
    const kb2 = allKeyboards[allKeyboards.length - 1]!;
    const id2 = kb2._buttons[0]!.data.split(':')[1];

    expect(id1).not.toBe(id2);
  });

  it('should resolve false on timeout (120 seconds)', async () => {
    const { promise } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });

    await vi.advanceTimersByTimeAsync(120_000);

    const result = await promise;
    expect(result).toBe(false);
  });

  it('should edit message to "timed out" on timeout', async () => {
    const { promise } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });

    await vi.advanceTimersByTimeAsync(120_000);
    await promise;

    expect(bot.api.editMessageText).toHaveBeenCalledWith(
      '123',
      42, // message_id from mock
      '\u23f0 Approval timed out \u2014 denied automatically.',
    );
  });

  it('should not throw when edit on timeout fails', async () => {
    bot.api.editMessageText.mockRejectedValue(new Error('fail'));

    const { promise } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });

    await vi.advanceTimersByTimeAsync(120_000);

    // Should not throw
    const result = await promise;
    expect(result).toBe(false);
  });

  it('should evict oldest entry when at MAX_PENDING capacity (50)', async () => {
    const resolvers: Array<Promise<boolean>> = [];

    // Fill up to capacity
    for (let i = 0; i < 50; i++) {
      const { promise } = await requestAndFlush(bot, '123', {
        toolName: `tool${i}`,
        description: 'desc',
      });
      resolvers.push(promise);
    }

    // The 51st request should evict the oldest (index 0)
    await requestAndFlush(bot, '123', {
      toolName: 'tool50',
      description: 'desc',
    });

    // First entry should have been resolved with false (evicted)
    const firstResult = await resolvers[0]!;
    expect(firstResult).toBe(false);
  });

  it('should clear evicted entry timer', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    // Fill to capacity
    for (let i = 0; i < 50; i++) {
      await requestAndFlush(bot, '123', {
        toolName: `tool${i}`,
        description: 'desc',
      });
    }

    clearTimeoutSpy.mockClear();

    // 51st triggers eviction
    await requestAndFlush(bot, '123', {
      toolName: 'tool50',
      description: 'desc',
    });

    // clearTimeout should be called for the evicted entry
    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  it('should return a Promise', () => {
    const result = requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: 'desc',
    });

    expect(result).toBeInstanceOf(Promise);
  });

  it('should use message_id from sent message', async () => {
    bot.api.sendMessage.mockResolvedValue({ message_id: 999 });

    const { promise } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });

    await vi.advanceTimersByTimeAsync(120_000);
    await promise;

    // Timeout edit uses the returned message_id
    expect(bot.api.editMessageText).toHaveBeenCalledWith(
      '123',
      999,
      expect.any(String),
    );
  });

  it('should include lock emoji in heading', async () => {
    requestTelegramApproval(bot as never, '123', {
      toolName: 'tool',
      description: 'desc',
    });

    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).toContain('\ud83d\udd10');
  });

  it('should not resolve before timeout when no action taken', async () => {
    const { promise } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });

    // Advance to just under 120s
    await vi.advanceTimersByTimeAsync(119_999);

    // Promise should still be pending -- test by racing with a sentinel
    const sentinel = Symbol('pending');
    const raceResult = await Promise.race([
      promise,
      Promise.resolve(sentinel),
    ]);
    expect(raceResult).toBe(sentinel);

    // Now cross the 120s boundary
    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;
    expect(result).toBe(false);
  });
});

// ============================================================================
// clearPendingApprovals
// ============================================================================

describe('clearPendingApprovals', () => {
  let bot: ReturnType<typeof createMockBot>;

  beforeEach(() => {
    vi.useFakeTimers();
    bot = createMockBot();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should resolve all pending approvals as false', async () => {
    const { promise: p1 } = await requestAndFlush(bot, '123', {
      toolName: 'tool1',
      description: 'desc',
    });
    const { promise: p2 } = await requestAndFlush(bot, '456', {
      toolName: 'tool2',
      description: 'desc',
    });
    const { promise: p3 } = await requestAndFlush(bot, '789', {
      toolName: 'tool3',
      description: 'desc',
    });

    clearPendingApprovals();

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBe(false);
    expect(r2).toBe(false);
    expect(r3).toBe(false);
  });

  it('should clear all timers', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    await requestAndFlush(bot, '123', {
      toolName: 'tool1',
      description: 'desc',
    });
    await requestAndFlush(bot, '456', {
      toolName: 'tool2',
      description: 'desc',
    });

    clearTimeoutSpy.mockClear();
    clearPendingApprovals();

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);
    clearTimeoutSpy.mockRestore();
  });

  it('should empty the pending map (subsequent approve gives expired)', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const { keyboard } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });
    const approveId = keyboard._buttons[0]!.data.split(':')[1]!;

    clearPendingApprovals();

    // Now the ID should be expired
    const ctx = createMockCtx(`approve:${approveId}`);
    await handler(ctx, vi.fn());
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'This approval has expired.' });
  });

  it('should be safe to call when no pending approvals exist', () => {
    expect(() => clearPendingApprovals()).not.toThrow();
  });

  it('should be safe to call multiple times consecutively', async () => {
    await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });

    expect(() => {
      clearPendingApprovals();
      clearPendingApprovals();
      clearPendingApprovals();
    }).not.toThrow();
  });

  it('should not affect new approvals created after clear', async () => {
    await requestAndFlush(bot, '123', {
      toolName: 'tool1',
      description: 'desc',
    });

    clearPendingApprovals();

    // New approval after clear should work independently
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const { promise, keyboard } = await requestAndFlush(bot, '123', {
      toolName: 'tool2',
      description: 'desc',
    });
    const approveId = keyboard._buttons[0]!.data.split(':')[1]!;

    const ctx = createMockCtx(`approve:${approveId}`);
    await handler(ctx, vi.fn());

    const result = await promise;
    expect(result).toBe(true);
  });

  it('should handle single pending approval', async () => {
    const { promise } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });

    clearPendingApprovals();

    const result = await promise;
    expect(result).toBe(false);
  });

  it('should prevent timeouts from firing after clear', async () => {
    const { promise } = await requestAndFlush(bot, '123', {
      toolName: 'tool',
      description: 'desc',
    });

    clearPendingApprovals();
    await promise;

    // Advance past timeout -- should not cause editMessageText call for timeout
    bot.api.editMessageText.mockClear();
    await vi.advanceTimersByTimeAsync(120_000);

    // editMessageText should NOT be called (timer was cleared)
    expect(bot.api.editMessageText).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Integration tests
// ============================================================================

describe('integration', () => {
  let bot: ReturnType<typeof createMockBot>;

  beforeEach(() => {
    vi.useFakeTimers();
    bot = createMockBot();
  });

  afterEach(() => {
    clearPendingApprovals();
    vi.useRealTimers();
  });

  it('should complete full approve flow: request -> handler callback -> resolves true', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    // 1. Request approval
    const { promise, keyboard } = await requestAndFlush(bot, '123', {
      toolName: 'deleteFiles',
      description: 'Delete all temporary files',
      riskLevel: 'high',
    });

    // Verify message was sent
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    const sentText = bot.api.sendMessage.mock.calls[0]![1] as string;
    expect(sentText).toContain('deleteFiles');
    expect(sentText).toContain('Delete all temporary files');
    expect(sentText).toContain('\u26a0\ufe0f HIGH RISK');

    // 2. User clicks approve
    const approveId = keyboard._buttons[0]!.data.split(':')[1]!;
    const ctx = createMockCtx(`approve:${approveId}`);
    await handler(ctx, vi.fn());

    // 3. Promise resolves true
    const result = await promise;
    expect(result).toBe(true);

    // 4. Message edited and callback answered
    expect(ctx.editMessageText).toHaveBeenCalledWith('\u2705 Approved');
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Approved' });
  });

  it('should complete full deny flow: request -> handler callback -> resolves false', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const { promise, keyboard } = await requestAndFlush(bot, '123', {
      toolName: 'sendEmail',
      description: 'Send email to all contacts',
    });

    const denyId = keyboard._buttons[1]!.data.split(':')[1]!;
    const ctx = createMockCtx(`deny:${denyId}`);
    await handler(ctx, vi.fn());

    const result = await promise;
    expect(result).toBe(false);

    expect(ctx.editMessageText).toHaveBeenCalledWith('\u274c Denied');
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Denied' });
  });

  it('should complete full timeout flow: request -> 120s -> resolves false', async () => {
    const { promise } = await requestAndFlush(bot, '123', {
      toolName: 'slowTool',
      description: 'Takes time',
    });

    await vi.advanceTimersByTimeAsync(120_000);

    const result = await promise;
    expect(result).toBe(false);

    expect(bot.api.editMessageText).toHaveBeenCalledWith(
      '123',
      42,
      '\u23f0 Approval timed out \u2014 denied automatically.',
    );
  });

  it('should track concurrent approvals separately', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    // Request two approvals, capturing each keyboard
    const { promise: promise1, keyboard: kb1 } = await requestAndFlush(bot, '111', {
      toolName: 'tool1',
      description: 'first',
    });
    const id1 = kb1._buttons[0]!.data.split(':')[1]!;

    const { promise: promise2, keyboard: kb2 } = await requestAndFlush(bot, '222', {
      toolName: 'tool2',
      description: 'second',
    });
    const id2 = kb2._buttons[0]!.data.split(':')[1]!;

    expect(id1).not.toBe(id2);

    // Approve first, deny second
    const ctx1 = createMockCtx(`approve:${id1}`);
    await handler(ctx1, vi.fn());

    const ctx2 = createMockCtx(`deny:${id2}`);
    await handler(ctx2, vi.fn());

    const [r1, r2] = await Promise.all([promise1, promise2]);
    expect(r1).toBe(true);
    expect(r2).toBe(false);
  });

  it('should handle mixed flow: one approved, one timed out', async () => {
    registerApprovalHandler(bot as never);
    const handler = getRegisteredHandler(bot);

    const { promise: promise1, keyboard: kb1 } = await requestAndFlush(bot, '111', {
      toolName: 'tool1',
      description: 'first',
    });
    const id1 = kb1._buttons[0]!.data.split(':')[1]!;

    const { promise: promise2 } = await requestAndFlush(bot, '222', {
      toolName: 'tool2',
      description: 'second',
    });

    // Approve first
    const ctx1 = createMockCtx(`approve:${id1}`);
    await handler(ctx1, vi.fn());
    const r1 = await promise1;
    expect(r1).toBe(true);

    // Let second time out
    await vi.advanceTimersByTimeAsync(120_000);
    const r2 = await promise2;
    expect(r2).toBe(false);
  });
});
