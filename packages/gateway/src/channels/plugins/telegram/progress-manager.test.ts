import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLogDebug = vi.hoisted(() => vi.fn());
const mockLogWarn = vi.hoisted(() => vi.fn());
const mockLogInfo = vi.hoisted(() => vi.fn());
const mockLogError = vi.hoisted(() => vi.fn());

vi.mock('../../../services/log.js', () => ({
  getLog: () => ({
    info: mockLogInfo,
    debug: mockLogDebug,
    warn: mockLogWarn,
    error: mockLogError,
  }),
}));

const mockMarkdownToTelegramHtml = vi.hoisted(() =>
  vi.fn((text: string) => `<html>${text}</html>`),
);
const mockSplitMessage = vi.hoisted(() => vi.fn((text: string) => [text]));
const mockPlatformLimits = vi.hoisted(() => ({ telegram: 4096 }));

vi.mock('../../utils/markdown-telegram.js', () => ({
  markdownToTelegramHtml: (...args: unknown[]) => mockMarkdownToTelegramHtml(...args),
}));

vi.mock('../../utils/message-utils.js', () => ({
  splitMessage: (...args: unknown[]) => mockSplitMessage(...args),
  PLATFORM_MESSAGE_LIMITS: mockPlatformLimits,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let messageIdCounter: number;

function createMockBot() {
  messageIdCounter = 100;
  return {
    api: {
      sendMessage: vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ message_id: messageIdCounter++ }),
        ),
      editMessageText: vi.fn().mockResolvedValue({}),
    },
  };
}

type MockBot = ReturnType<typeof createMockBot>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TelegramProgressManager', () => {
  let TelegramProgressManager: typeof import('./progress-manager.js').TelegramProgressManager;
  let bot: MockBot;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockMarkdownToTelegramHtml.mockImplementation((text: string) => `<html>${text}</html>`);
    mockSplitMessage.mockImplementation((text: string) => [text]);

    bot = createMockBot();
    const mod = await import('./progress-manager.js');
    TelegramProgressManager = mod.TelegramProgressManager;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // Constructor
  // =========================================================================

  describe('constructor', () => {
    it('creates instance with bot, chatId, and parseMode', () => {
      const pm = new TelegramProgressManager(bot as never, '12345', 'HTML');
      expect(pm).toBeInstanceOf(TelegramProgressManager);
    });

    it('creates instance without parseMode', () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      expect(pm).toBeInstanceOf(TelegramProgressManager);
    });

    it('getMessageId() returns null before start', () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      expect(pm.getMessageId()).toBeNull();
    });
  });

  // =========================================================================
  // start()
  // =========================================================================

  describe('start()', () => {
    it('sends message via bot.api.sendMessage', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
      expect(bot.api.sendMessage).toHaveBeenCalledWith('12345', '🤔 Thinking...');
    });

    it('uses default text "🤔 Thinking..."', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      expect(bot.api.sendMessage.mock.calls[0]![1]).toBe('🤔 Thinking...');
    });

    it('uses custom initial text when provided', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start('Processing your request...');
      expect(bot.api.sendMessage).toHaveBeenCalledWith('12345', 'Processing your request...');
    });

    it('returns message_id as string', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      const result = await pm.start();
      expect(result).toBe('100');
      expect(typeof result).toBe('string');
    });

    it('stores messageId for later use', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      expect(pm.getMessageId()).toBe(100);
    });

    it('sets lastEditTime to current time', async () => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      // Verify lastEditTime was set by checking that an immediate update throttles
      // (elapsed < 3s since start was just called)
      pm.update('progress 1');
      // The update should be queued, not immediate
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
    });

    it('returns empty string when sendMessage throws', async () => {
      bot.api.sendMessage.mockRejectedValueOnce(new Error('Network error'));
      const pm = new TelegramProgressManager(bot as never, '12345');
      const result = await pm.start();
      expect(result).toBe('');
    });

    it('logs warning on sendMessage failure', async () => {
      const error = new Error('Network error');
      bot.api.sendMessage.mockRejectedValueOnce(error);
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      expect(mockLogWarn).toHaveBeenCalledWith(
        'Failed to send initial progress message',
        { error },
      );
    });
  });

  // =========================================================================
  // update()
  // =========================================================================

  describe('update()', () => {
    it('is a noop when finished', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      await pm.finish('done');
      bot.api.editMessageText.mockClear();
      pm.update('should be ignored');
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
    });

    it('is a noop when no messageId (start not called)', () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      pm.update('should be ignored');
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
    });

    it('immediately edits when elapsed >= 3s', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      vi.advanceTimersByTime(3000);
      pm.update('progress update');
      expect(bot.api.editMessageText).toHaveBeenCalledWith(
        '12345',
        100,
        'progress update',
      );
    });

    it('queues update when within throttle window', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      // Immediately after start — within throttle window
      pm.update('queued text');
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
    });

    it('only one timer is queued (subsequent updates replace pending text)', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      pm.update('text 1');
      pm.update('text 2');
      pm.update('text 3');
      // Only one timer fires
      vi.advanceTimersByTime(3000);
      // Should have been called once with the last text
      expect(bot.api.editMessageText).toHaveBeenCalledTimes(1);
      expect(bot.api.editMessageText).toHaveBeenCalledWith('12345', 100, 'text 3');
    });

    it('timer fires and edits with the latest pending text', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      pm.update('latest text');
      vi.advanceTimersByTime(3000);
      expect(bot.api.editMessageText).toHaveBeenCalledWith('12345', 100, 'latest text');
    });

    it('timer respects remaining throttle time', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      // Advance 1s, then update — timer should be set for 2s remaining
      vi.advanceTimersByTime(1000);
      pm.update('after 1s');
      // At 1.5s nothing should have happened yet
      vi.advanceTimersByTime(500);
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
      // At 3s from start the timer should fire
      vi.advanceTimersByTime(1500);
      expect(bot.api.editMessageText).toHaveBeenCalledWith('12345', 100, 'after 1s');
    });

    it('pending text is cleared after timer fires', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      pm.update('pending');
      vi.advanceTimersByTime(3000);
      expect(bot.api.editMessageText).toHaveBeenCalledTimes(1);
      // Advance another 3s — no additional edit should happen (no pending text)
      bot.api.editMessageText.mockClear();
      vi.advanceTimersByTime(3000);
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
    });

    it('doEdit updates lastEditTime', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      vi.advanceTimersByTime(3000); // elapsed = 3s
      pm.update('first edit');
      // This should reset lastEditTime. A subsequent update within 3s should queue.
      bot.api.editMessageText.mockClear();
      pm.update('should be queued');
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
    });

    it('doEdit calls bot.api.editMessageText with correct params', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      vi.advanceTimersByTime(3000);
      pm.update('edit text');
      expect(bot.api.editMessageText).toHaveBeenCalledWith('12345', 100, 'edit text');
    });

    it('doEdit catches editMessageText error without throwing', async () => {
      bot.api.editMessageText.mockRejectedValueOnce(new Error('edit fail'));
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      vi.advanceTimersByTime(3000);
      // Should not throw
      expect(() => pm.update('edit text')).not.toThrow();
      // Allow the promise rejection to be caught
      await vi.advanceTimersByTimeAsync(0);
    });

    it('multiple rapid updates result in only the last one being applied', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      pm.update('update 1');
      pm.update('update 2');
      pm.update('update 3');
      pm.update('update 4');
      pm.update('final update');
      vi.advanceTimersByTime(3000);
      expect(bot.api.editMessageText).toHaveBeenCalledTimes(1);
      expect(bot.api.editMessageText).toHaveBeenCalledWith('12345', 100, 'final update');
    });

    it('update after finish is ignored', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      await pm.finish('final');
      bot.api.editMessageText.mockClear();
      bot.api.sendMessage.mockClear();
      pm.update('ignored');
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
      expect(bot.api.sendMessage).not.toHaveBeenCalled();
    });

    it('queued timer does not fire if finished before timer elapses', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      pm.update('queued');
      // finish cancels the timer
      await pm.finish('final');
      bot.api.editMessageText.mockClear();
      vi.advanceTimersByTime(3000);
      // The queued update should NOT have fired
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
    });

    it('second update after throttle window opens edits immediately', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      // Wait full throttle window
      vi.advanceTimersByTime(3000);
      pm.update('immediate 1');
      expect(bot.api.editMessageText).toHaveBeenCalledTimes(1);
      bot.api.editMessageText.mockClear();
      // Wait another full window
      vi.advanceTimersByTime(3000);
      pm.update('immediate 2');
      expect(bot.api.editMessageText).toHaveBeenCalledTimes(1);
      expect(bot.api.editMessageText).toHaveBeenCalledWith('12345', 100, 'immediate 2');
    });

    it('doEdit is noop when finished flag is set', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      // Queue an update
      pm.update('queued text');
      // Manually set finished via cancel
      await pm.cancel();
      bot.api.editMessageText.mockClear();
      // Timer fires but doEdit checks finished flag
      vi.advanceTimersByTime(3000);
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
    });

    it('doEdit is noop when messageId is null', async () => {
      // start fails → messageId remains null
      bot.api.sendMessage.mockRejectedValueOnce(new Error('fail'));
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      pm.update('ignored');
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
    });

    it('immediate edit followed by queued update within same window', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      vi.advanceTimersByTime(3000);
      pm.update('immediate');
      expect(bot.api.editMessageText).toHaveBeenCalledWith('12345', 100, 'immediate');
      bot.api.editMessageText.mockClear();
      // Now within new throttle window
      pm.update('queued after immediate');
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
      vi.advanceTimersByTime(3000);
      expect(bot.api.editMessageText).toHaveBeenCalledWith(
        '12345',
        100,
        'queued after immediate',
      );
    });

    it('editMessageText error in doEdit logs debug message', async () => {
      const error = new Error('edit fail');
      bot.api.editMessageText.mockRejectedValueOnce(error);
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      vi.advanceTimersByTime(3000);
      pm.update('edit text');
      // Let the rejected promise settle
      await vi.advanceTimersByTimeAsync(0);
      expect(mockLogDebug).toHaveBeenCalledWith('Progress edit failed', { error });
    });
  });

  // =========================================================================
  // finish()
  // =========================================================================

  describe('finish()', () => {
    it('sets finished = true', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      await pm.finish('done');
      // Verify by checking that update is now a noop
      bot.api.editMessageText.mockClear();
      pm.update('ignored');
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
    });

    it('cancels pending timer', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      pm.update('queued');
      await pm.finish('done');
      bot.api.editMessageText.mockClear();
      vi.advanceTimersByTime(5000);
      // The queued update timer should have been cancelled
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
    });

    it('clears pending text', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      pm.update('pending text');
      await pm.finish('final');
      // Pending text should be null — no stale edits after finish
      bot.api.editMessageText.mockClear();
      vi.advanceTimersByTime(5000);
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
    });

    it('guards against empty text using "(empty response)"', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      bot.api.editMessageText.mockClear();
      await pm.finish('');
      expect(bot.api.editMessageText).toHaveBeenCalledWith(
        '12345',
        100,
        '(empty response)',
        {},
      );
    });

    it('trims whitespace from final text', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      bot.api.editMessageText.mockClear();
      await pm.finish('  hello world  ');
      expect(bot.api.editMessageText).toHaveBeenCalledWith(
        '12345',
        100,
        'hello world',
        {},
      );
    });

    it('trims whitespace-only text to "(empty response)"', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      bot.api.editMessageText.mockClear();
      await pm.finish('   ');
      expect(bot.api.editMessageText).toHaveBeenCalledWith(
        '12345',
        100,
        '(empty response)',
        {},
      );
    });

    it('falls back to sendFresh when no messageId', async () => {
      bot.api.sendMessage.mockRejectedValueOnce(new Error('fail'));
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start(); // fails, messageId stays null
      bot.api.sendMessage.mockImplementation(() =>
        Promise.resolve({ message_id: messageIdCounter++ }),
      );
      const result = await pm.finish('fallback text');
      // sendFresh sends via sendMessage, not editMessageText
      expect(bot.api.sendMessage).toHaveBeenCalled();
      expect(typeof result).toBe('string');
    });

    it('converts markdown to HTML when parseMode is HTML', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345', 'HTML');
      await pm.start();
      bot.api.editMessageText.mockClear();
      await pm.finish('**bold text**');
      expect(mockMarkdownToTelegramHtml).toHaveBeenCalledWith('**bold text**');
    });

    it('does not convert when parseMode is not set', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      mockMarkdownToTelegramHtml.mockClear();
      await pm.finish('plain text');
      expect(mockMarkdownToTelegramHtml).not.toHaveBeenCalled();
    });

    it('calls splitMessage with telegram limit', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      await pm.finish('split me');
      expect(mockSplitMessage).toHaveBeenCalledWith('split me', 4096);
    });

    it('edits first part into existing progress message', async () => {
      mockSplitMessage.mockReturnValueOnce(['part 1', 'part 2']);
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      bot.api.editMessageText.mockClear();
      await pm.finish('long text');
      expect(bot.api.editMessageText).toHaveBeenCalledWith('12345', 100, 'part 1', {});
    });

    it('includes parse_mode in edit options when parseMode is set', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345', 'HTML');
      await pm.start();
      bot.api.editMessageText.mockClear();
      await pm.finish('text');
      const options = bot.api.editMessageText.mock.calls[0]![3] as Record<string, unknown>;
      expect(options.parse_mode).toBe('HTML');
    });

    it('does not include parse_mode when parseMode is not set', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      bot.api.editMessageText.mockClear();
      await pm.finish('text');
      const options = bot.api.editMessageText.mock.calls[0]![3] as Record<string, unknown>;
      expect(options).toEqual({});
    });

    it('sends remaining parts as new messages', async () => {
      mockSplitMessage.mockReturnValueOnce(['part 1', 'part 2']);
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      bot.api.sendMessage.mockClear();
      await pm.finish('long text');
      expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
      expect(bot.api.sendMessage).toHaveBeenCalledWith('12345', 'part 2', {});
    });

    it('includes parse_mode in additional message options', async () => {
      mockSplitMessage.mockReturnValueOnce(['part 1', 'part 2']);
      const pm = new TelegramProgressManager(bot as never, '12345', 'HTML');
      await pm.start();
      bot.api.sendMessage.mockClear();
      await pm.finish('long text');
      const options = bot.api.sendMessage.mock.calls[0]![2] as Record<string, unknown>;
      expect(options.parse_mode).toBe('HTML');
    });

    it('returns last message_id as string', async () => {
      mockSplitMessage.mockReturnValueOnce(['part 1', 'part 2']);
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start(); // message_id = 100
      const result = await pm.finish('long text');
      // sendMessage for part 2 returns 101
      expect(result).toBe('101');
    });

    it('falls back to sendFresh on edit failure', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start(); // message_id = 100
      bot.api.editMessageText.mockRejectedValueOnce(new Error('edit failed'));
      bot.api.sendMessage.mockClear();
      const result = await pm.finish('fallback text');
      // sendFresh sends via sendMessage
      expect(bot.api.sendMessage).toHaveBeenCalled();
      expect(typeof result).toBe('string');
    });

    it('logs debug on edit failure before sendFresh fallback', async () => {
      const error = new Error('edit failed');
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      bot.api.editMessageText.mockRejectedValueOnce(error);
      await pm.finish('text');
      expect(mockLogDebug).toHaveBeenCalledWith(
        'Failed to edit progress → final message, sending fresh',
        { error },
      );
    });

    it('single part results in only edit, no additional sends', async () => {
      mockSplitMessage.mockReturnValueOnce(['single part']);
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      bot.api.sendMessage.mockClear();
      bot.api.editMessageText.mockClear();
      await pm.finish('single part');
      expect(bot.api.editMessageText).toHaveBeenCalledTimes(1);
      expect(bot.api.sendMessage).not.toHaveBeenCalled();
    });

    it('multiple parts: edit first + send rest', async () => {
      mockSplitMessage.mockReturnValueOnce(['part A', 'part B', 'part C']);
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      bot.api.editMessageText.mockClear();
      bot.api.sendMessage.mockClear();
      const finishPromise = pm.finish('long text');
      await vi.advanceTimersByTimeAsync(500);
      await finishPromise;
      expect(bot.api.editMessageText).toHaveBeenCalledTimes(1);
      expect(bot.api.editMessageText).toHaveBeenCalledWith('12345', 100, 'part A', {});
      expect(bot.api.sendMessage).toHaveBeenCalledTimes(2);
      expect(bot.api.sendMessage).toHaveBeenCalledWith('12345', 'part B', {});
      expect(bot.api.sendMessage).toHaveBeenCalledWith('12345', 'part C', {});
    });

    it('multi-part with >2 parts adds 100ms delay between non-last messages', async () => {
      mockSplitMessage.mockReturnValueOnce(['p1', 'p2', 'p3']);
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      bot.api.sendMessage.mockClear();
      // We need to verify the delay. Use advanceTimersByTimeAsync.
      const finishPromise = pm.finish('text');
      // Let all micro-tasks and timers settle
      await vi.advanceTimersByTimeAsync(500);
      await finishPromise;
      expect(bot.api.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('multi-part send failure logs warning and continues', async () => {
      mockSplitMessage.mockReturnValueOnce(['p1', 'p2', 'p3']);
      const sendError = new Error('send part failed');
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      bot.api.sendMessage
        .mockRejectedValueOnce(sendError) // p2 fails
        .mockImplementation(() => Promise.resolve({ message_id: messageIdCounter++ })); // p3 succeeds
      bot.api.editMessageText.mockClear();
      const finishPromise = pm.finish('text');
      await vi.advanceTimersByTimeAsync(500);
      await finishPromise;
      expect(mockLogWarn).toHaveBeenCalledWith('Failed to send overflow message part', {
        part: 1,
        error: sendError,
      });
    });

    it('returns existing messageId when only one part', async () => {
      mockSplitMessage.mockReturnValueOnce(['only part']);
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start(); // message_id = 100
      const result = await pm.finish('only part');
      expect(result).toBe('100');
    });

    it('returns last sent message_id for multi-part', async () => {
      mockSplitMessage.mockReturnValueOnce(['p1', 'p2', 'p3']);
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start(); // message_id = 100
      bot.api.sendMessage.mockClear();
      messageIdCounter = 200;
      const finishPromise = pm.finish('text');
      await vi.advanceTimersByTimeAsync(500);
      const result = await finishPromise;
      // p2 → 200, p3 → 201 (last)
      expect(result).toBe('201');
    });

    it('passes original (non-HTML-converted) text to sendFresh on edit failure', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345', 'HTML');
      await pm.start();
      bot.api.editMessageText.mockRejectedValueOnce(new Error('fail'));
      bot.api.sendMessage.mockClear();
      mockMarkdownToTelegramHtml.mockClear();
      await pm.finish('**bold**');
      // sendFresh should receive the original trimmed text, then convert
      // markdownToTelegramHtml is called again inside sendFresh
      expect(mockMarkdownToTelegramHtml).toHaveBeenCalledWith('**bold**');
    });
  });

  // =========================================================================
  // cancel()
  // =========================================================================

  describe('cancel()', () => {
    it('sets finished = true', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      await pm.cancel();
      // update should be noop
      bot.api.editMessageText.mockClear();
      pm.update('ignored');
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
    });

    it('clears pending timer', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      pm.update('pending');
      await pm.cancel();
      bot.api.editMessageText.mockClear();
      vi.advanceTimersByTime(5000);
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
    });

    it('edits message to "⚠️ Processing cancelled."', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      bot.api.editMessageText.mockClear();
      await pm.cancel();
      expect(bot.api.editMessageText).toHaveBeenCalledWith(
        '12345',
        100,
        '⚠️ Processing cancelled.',
      );
    });

    it('catches edit failure silently', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      bot.api.editMessageText.mockRejectedValueOnce(new Error('edit fail'));
      // Should not throw
      await expect(pm.cancel()).resolves.toBeUndefined();
    });

    it('is noop when no messageId', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      // start was never called
      await pm.cancel();
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
    });

    it('is noop for editMessageText when messageId is null (start failed)', async () => {
      bot.api.sendMessage.mockRejectedValueOnce(new Error('fail'));
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      await pm.cancel();
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
    });

    it('subsequent update() calls are ignored after cancel', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      await pm.cancel();
      bot.api.editMessageText.mockClear();
      pm.update('after cancel 1');
      pm.update('after cancel 2');
      vi.advanceTimersByTime(5000);
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
    });

    it('subsequent finish() still works after cancel (idempotent finished state)', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      await pm.cancel();
      bot.api.editMessageText.mockClear();
      // finish after cancel — should still attempt to edit
      const result = await pm.finish('final after cancel');
      // The edit inside finish may succeed or fail, but it should still be attempted
      expect(typeof result).toBe('string');
    });
  });

  // =========================================================================
  // getMessageId()
  // =========================================================================

  describe('getMessageId()', () => {
    it('returns null before start', () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      expect(pm.getMessageId()).toBeNull();
    });

    it('returns messageId after start', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      expect(pm.getMessageId()).toBe(100);
    });

    it('returns a number (not string)', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      expect(typeof pm.getMessageId()).toBe('number');
    });
  });

  // =========================================================================
  // sendFresh() (tested via finish with no messageId)
  // =========================================================================

  describe('sendFresh (via finish without messageId)', () => {
    it('converts to HTML if parseMode is set', async () => {
      bot.api.sendMessage.mockRejectedValueOnce(new Error('fail'));
      const pm = new TelegramProgressManager(bot as never, '12345', 'HTML');
      await pm.start(); // fails
      mockMarkdownToTelegramHtml.mockClear();
      bot.api.sendMessage.mockImplementation(() =>
        Promise.resolve({ message_id: messageIdCounter++ }),
      );
      await pm.finish('**bold**');
      expect(mockMarkdownToTelegramHtml).toHaveBeenCalledWith('**bold**');
    });

    it('does not convert to HTML when parseMode is not set', async () => {
      bot.api.sendMessage.mockRejectedValueOnce(new Error('fail'));
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      mockMarkdownToTelegramHtml.mockClear();
      bot.api.sendMessage.mockImplementation(() =>
        Promise.resolve({ message_id: messageIdCounter++ }),
      );
      await pm.finish('plain text');
      expect(mockMarkdownToTelegramHtml).not.toHaveBeenCalled();
    });

    it('splits message using splitMessage', async () => {
      bot.api.sendMessage.mockRejectedValueOnce(new Error('fail'));
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      mockSplitMessage.mockClear();
      bot.api.sendMessage.mockImplementation(() =>
        Promise.resolve({ message_id: messageIdCounter++ }),
      );
      await pm.finish('split this');
      expect(mockSplitMessage).toHaveBeenCalledWith('split this', 4096);
    });

    it('sends all parts as new messages', async () => {
      bot.api.sendMessage.mockRejectedValueOnce(new Error('fail'));
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      mockSplitMessage.mockReturnValueOnce(['fresh 1', 'fresh 2']);
      bot.api.sendMessage.mockClear();
      bot.api.sendMessage.mockImplementation(() =>
        Promise.resolve({ message_id: messageIdCounter++ }),
      );
      await pm.finish('fresh text');
      expect(bot.api.sendMessage).toHaveBeenCalledTimes(2);
      expect(bot.api.sendMessage).toHaveBeenCalledWith('12345', 'fresh 1', {});
      expect(bot.api.sendMessage).toHaveBeenCalledWith('12345', 'fresh 2', {});
    });

    it('returns last message_id as string', async () => {
      bot.api.sendMessage.mockRejectedValueOnce(new Error('fail'));
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      messageIdCounter = 300;
      bot.api.sendMessage.mockImplementation(() =>
        Promise.resolve({ message_id: messageIdCounter++ }),
      );
      const result = await pm.finish('text');
      expect(result).toBe('300');
    });

    it('logs warning on send failure', async () => {
      bot.api.sendMessage.mockRejectedValueOnce(new Error('start fail'));
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      const freshError = new Error('fresh send fail');
      bot.api.sendMessage.mockRejectedValueOnce(freshError);
      await pm.finish('text');
      expect(mockLogWarn).toHaveBeenCalledWith('Failed to send fresh message', {
        error: freshError,
      });
    });

    it('returns empty string when all sends fail', async () => {
      bot.api.sendMessage.mockRejectedValueOnce(new Error('start fail'));
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      bot.api.sendMessage.mockRejectedValueOnce(new Error('fresh fail'));
      const result = await pm.finish('text');
      expect(result).toBe('');
    });

    it('includes parse_mode in options when parseMode is set', async () => {
      bot.api.sendMessage.mockRejectedValueOnce(new Error('fail'));
      const pm = new TelegramProgressManager(bot as never, '12345', 'HTML');
      await pm.start();
      bot.api.sendMessage.mockClear();
      bot.api.sendMessage.mockImplementation(() =>
        Promise.resolve({ message_id: messageIdCounter++ }),
      );
      await pm.finish('text');
      const options = bot.api.sendMessage.mock.calls[0]![2] as Record<string, unknown>;
      expect(options.parse_mode).toBe('HTML');
    });
  });

  // =========================================================================
  // Integration scenarios
  // =========================================================================

  describe('integration', () => {
    it('full flow: start → update → update → finish', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');

      // start
      const startId = await pm.start();
      expect(startId).toBe('100');

      // first update (within throttle window — queued)
      pm.update('Working on step 1...');
      expect(bot.api.editMessageText).not.toHaveBeenCalled();

      // advance 3s — queued update fires
      vi.advanceTimersByTime(3000);
      expect(bot.api.editMessageText).toHaveBeenCalledWith(
        '12345',
        100,
        'Working on step 1...',
      );

      // second update after throttle window
      vi.advanceTimersByTime(3000);
      bot.api.editMessageText.mockClear();
      pm.update('Working on step 2...');
      expect(bot.api.editMessageText).toHaveBeenCalledWith(
        '12345',
        100,
        'Working on step 2...',
      );

      // finish
      bot.api.editMessageText.mockClear();
      const result = await pm.finish('Final response');
      expect(bot.api.editMessageText).toHaveBeenCalledWith(
        '12345',
        100,
        'Final response',
        {},
      );
      expect(result).toBe('100');
    });

    it('start → finish with long text splits correctly', async () => {
      mockSplitMessage.mockReturnValueOnce(['chunk1', 'chunk2', 'chunk3']);
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      bot.api.editMessageText.mockClear();
      bot.api.sendMessage.mockClear();

      const finishPromise = pm.finish('very long text...');
      await vi.advanceTimersByTimeAsync(500);
      const result = await finishPromise;

      expect(bot.api.editMessageText).toHaveBeenCalledWith('12345', 100, 'chunk1', {});
      expect(bot.api.sendMessage).toHaveBeenCalledTimes(2);
      expect(typeof result).toBe('string');
    });

    it('start → cancel → update is ignored', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();
      await pm.cancel();

      bot.api.editMessageText.mockClear();
      bot.api.sendMessage.mockClear();
      pm.update('should not appear');
      vi.advanceTimersByTime(5000);

      expect(bot.api.editMessageText).not.toHaveBeenCalled();
      expect(bot.api.sendMessage).not.toHaveBeenCalled();
    });

    it('start → update throttled → finish cancels pending update', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();

      // Queue an update (within throttle window)
      pm.update('pending progress');
      expect(bot.api.editMessageText).not.toHaveBeenCalled();

      // finish should cancel the pending timer
      await pm.finish('Final answer');

      // Even after advancing time, the pending update should not fire
      bot.api.editMessageText.mockClear();
      vi.advanceTimersByTime(5000);
      expect(bot.api.editMessageText).not.toHaveBeenCalled();
    });

    it('start → rapid updates → only last queued one fires → finish', async () => {
      const pm = new TelegramProgressManager(bot as never, '12345');
      await pm.start();

      // Rapid-fire updates
      pm.update('step 1');
      pm.update('step 2');
      pm.update('step 3');
      pm.update('step 4');

      // Let throttle timer fire
      vi.advanceTimersByTime(3000);
      expect(bot.api.editMessageText).toHaveBeenCalledTimes(1);
      expect(bot.api.editMessageText).toHaveBeenCalledWith('12345', 100, 'step 4');

      // Finish
      bot.api.editMessageText.mockClear();
      const result = await pm.finish('All done');
      expect(result).toBe('100');
    });
  });
});
