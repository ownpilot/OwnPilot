/**
 * Browser Tools Tests
 *
 * Tests executeBrowserTool() routing and BROWSER_TOOLS/BROWSER_TOOL_NAMES exports.
 * BrowserService calls are all mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockService = {
  isAvailable: vi.fn(async () => true),
  navigate: vi.fn(),
  click: vi.fn(),
  type: vi.fn(),
  fillForm: vi.fn(),
  screenshot: vi.fn(),
  extractData: vi.fn(),
  extractText: vi.fn(),
  wait: vi.fn(),
  scroll: vi.fn(),
  select: vi.fn(),
  pressKey: vi.fn(),
  getState: vi.fn(),
  accessibilityTree: vi.fn(),
};

vi.mock('../services/browser-service.js', () => ({
  getBrowserService: () => mockService,
}));

// Dynamic import AFTER mocks
const { executeBrowserTool, BROWSER_TOOLS, BROWSER_TOOL_NAMES } =
  await import('./browser-tools.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BROWSER_TOOLS and BROWSER_TOOL_NAMES', () => {
  it('exports 12 tool definitions', () => {
    expect(BROWSER_TOOLS).toHaveLength(12);
  });

  it('BROWSER_TOOL_NAMES matches tool names', () => {
    expect(BROWSER_TOOL_NAMES).toEqual(BROWSER_TOOLS.map((t) => t.name));
    expect(BROWSER_TOOL_NAMES).toContain('browse_web');
    expect(BROWSER_TOOL_NAMES).toContain('browser_click');
    expect(BROWSER_TOOL_NAMES).toContain('browser_type');
    expect(BROWSER_TOOL_NAMES).toContain('browser_fill_form');
    expect(BROWSER_TOOL_NAMES).toContain('browser_screenshot');
    expect(BROWSER_TOOL_NAMES).toContain('browser_extract');
    expect(BROWSER_TOOL_NAMES).toContain('browser_wait_for');
    expect(BROWSER_TOOL_NAMES).toContain('browser_scroll');
    expect(BROWSER_TOOL_NAMES).toContain('browser_select');
    expect(BROWSER_TOOL_NAMES).toContain('browser_press_key');
    expect(BROWSER_TOOL_NAMES).toContain('browser_get_state');
    expect(BROWSER_TOOL_NAMES).toContain('browser_accessibility_tree');
  });
});

describe('executeBrowserTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService.isAvailable.mockResolvedValue(true);
  });

  // =========================================================================
  // Availability check
  // =========================================================================

  it('returns error when browser is not available', async () => {
    mockService.isAvailable.mockResolvedValueOnce(false);
    const result = await executeBrowserTool('browse_web', { url: 'https://example.com' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available');
  });

  // =========================================================================
  // browse_web
  // =========================================================================

  describe('browse_web', () => {
    it('returns success with url, title, text', async () => {
      mockService.navigate.mockResolvedValueOnce({
        url: 'https://example.com',
        title: 'Example',
        text: 'Hello world',
      });
      const result = await executeBrowserTool('browse_web', { url: 'https://example.com' });
      expect(result.success).toBe(true);
      expect(result.result).toEqual({
        url: 'https://example.com',
        title: 'Example',
        text: 'Hello world',
      });
      expect(mockService.navigate).toHaveBeenCalledWith('default', 'https://example.com');
    });

    it('uses userId when provided', async () => {
      mockService.navigate.mockResolvedValueOnce({ url: 'x', title: 'x', text: '' });
      await executeBrowserTool('browse_web', { url: 'https://x.com' }, 'user-42');
      expect(mockService.navigate).toHaveBeenCalledWith('user-42', 'https://x.com');
    });

    it('returns error when url is missing', async () => {
      const result = await executeBrowserTool('browse_web', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('url is required');
    });
  });

  // =========================================================================
  // browser_click
  // =========================================================================

  describe('browser_click', () => {
    it('calls service.click and returns result', async () => {
      mockService.click.mockResolvedValueOnce({ url: 'https://example.com', title: 'Clicked' });
      const result = await executeBrowserTool('browser_click', { selector: '#submit' });
      expect(result.success).toBe(true);
      expect(mockService.click).toHaveBeenCalledWith('default', '#submit');
    });

    it('returns error when selector is missing', async () => {
      const result = await executeBrowserTool('browser_click', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('selector is required');
    });
  });

  // =========================================================================
  // browser_type
  // =========================================================================

  describe('browser_type', () => {
    it('calls service.type with selector and text', async () => {
      mockService.type.mockResolvedValueOnce({ ok: true });
      const result = await executeBrowserTool('browser_type', {
        selector: 'input#name',
        text: 'Alice',
      });
      expect(result.success).toBe(true);
      expect(mockService.type).toHaveBeenCalledWith('default', 'input#name', 'Alice');
    });

    it('returns error when selector or text is missing', async () => {
      const r1 = await executeBrowserTool('browser_type', { selector: 'input' });
      expect(r1.success).toBe(false);
      const r2 = await executeBrowserTool('browser_type', { text: 'hi' });
      expect(r2.success).toBe(false);
    });
  });

  // =========================================================================
  // browser_fill_form
  // =========================================================================

  describe('browser_fill_form', () => {
    it('calls service.fillForm with fields array', async () => {
      mockService.fillForm.mockResolvedValueOnce({
        url: 'https://form.com',
        title: 'Form',
        piiWarnings: [],
      });
      const fields = [{ selector: '#email', value: 'a@b.com' }];
      const result = await executeBrowserTool('browser_fill_form', { fields });
      expect(result.success).toBe(true);
      expect(mockService.fillForm).toHaveBeenCalledWith('default', fields);
    });

    it('omits piiWarnings from result when empty', async () => {
      mockService.fillForm.mockResolvedValueOnce({
        url: 'x',
        title: 'x',
        piiWarnings: [],
      });
      const result = await executeBrowserTool('browser_fill_form', {
        fields: [{ selector: '#x', value: 'y' }],
      });
      expect((result.result as Record<string, unknown>).piiWarnings).toBeUndefined();
    });

    it('includes piiWarnings in result when present', async () => {
      mockService.fillForm.mockResolvedValueOnce({
        url: 'x',
        title: 'x',
        piiWarnings: ['email detected'],
      });
      const result = await executeBrowserTool('browser_fill_form', {
        fields: [{ selector: '#e', value: 'x@y.com' }],
      });
      expect((result.result as Record<string, unknown>).piiWarnings).toEqual(['email detected']);
    });

    it('returns error when fields is empty array', async () => {
      const result = await executeBrowserTool('browser_fill_form', { fields: [] });
      expect(result.success).toBe(false);
      expect(result.error).toContain('fields array is required');
    });

    it('returns error when fields is not an array', async () => {
      const result = await executeBrowserTool('browser_fill_form', { fields: 'bad' });
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // browser_screenshot
  // =========================================================================

  describe('browser_screenshot', () => {
    it('calls service.screenshot and returns base64 data URL', async () => {
      mockService.screenshot.mockResolvedValueOnce({
        url: 'https://example.com',
        title: 'Page',
        screenshot: 'abc123',
      });
      const result = await executeBrowserTool('browser_screenshot', {});
      expect(result.success).toBe(true);
      expect((result.result as Record<string, unknown>).screenshot).toBe(
        'data:image/png;base64,abc123'
      );
    });

    it('passes fullPage and selector options to service', async () => {
      mockService.screenshot.mockResolvedValueOnce({ url: '', title: '', screenshot: '' });
      await executeBrowserTool('browser_screenshot', { fullPage: true, selector: '.content' });
      expect(mockService.screenshot).toHaveBeenCalledWith('default', {
        fullPage: true,
        selector: '.content',
      });
    });
  });

  // =========================================================================
  // browser_extract
  // =========================================================================

  describe('browser_extract', () => {
    it('calls extractData when dataSelectors provided', async () => {
      mockService.extractData.mockResolvedValueOnce({ title: 'Hello', price: '$10' });
      const result = await executeBrowserTool('browser_extract', {
        dataSelectors: { title: 'h1', price: '.price' },
      });
      expect(result.success).toBe(true);
      expect(mockService.extractData).toHaveBeenCalledWith('default', {
        title: 'h1',
        price: '.price',
      });
    });

    it('calls extractText when no dataSelectors', async () => {
      mockService.extractText.mockResolvedValueOnce('page text');
      const result = await executeBrowserTool('browser_extract', {});
      expect(result.success).toBe(true);
      expect(mockService.extractText).toHaveBeenCalledWith('default', undefined);
    });

    it('passes selector to extractText', async () => {
      mockService.extractText.mockResolvedValueOnce('section text');
      await executeBrowserTool('browser_extract', { selector: '.article' });
      expect(mockService.extractText).toHaveBeenCalledWith('default', '.article');
    });
  });

  // =========================================================================
  // Unknown tool
  // =========================================================================

  // =========================================================================
  // browser_wait_for
  // =========================================================================

  describe('browser_wait_for', () => {
    it('forwards selector + timeout to service.wait', async () => {
      mockService.wait.mockResolvedValueOnce({ url: 'https://a.test', title: 'A' });
      const result = await executeBrowserTool('browser_wait_for', {
        selector: '.ready',
        timeoutMs: 3000,
      });
      expect(result.success).toBe(true);
      expect(mockService.wait).toHaveBeenCalledWith('default', '.ready', 3000);
    });

    it('passes undefined selector + undefined timeout when args are empty', async () => {
      mockService.wait.mockResolvedValueOnce({ url: 'https://a', title: 'A' });
      await executeBrowserTool('browser_wait_for', {});
      expect(mockService.wait).toHaveBeenCalledWith('default', undefined, undefined);
    });
  });

  // =========================================================================
  // browser_scroll
  // =========================================================================

  describe('browser_scroll', () => {
    it('rejects invalid direction', async () => {
      const result = await executeBrowserTool('browser_scroll', { direction: 'sideways' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('direction');
    });

    it('rejects missing direction', async () => {
      const result = await executeBrowserTool('browser_scroll', {});
      expect(result.success).toBe(false);
    });

    it('forwards direction + pixels to service.scroll', async () => {
      mockService.scroll.mockResolvedValueOnce({ url: 'https://a', title: 'A' });
      const result = await executeBrowserTool('browser_scroll', {
        direction: 'down',
        pixels: 800,
      });
      expect(result.success).toBe(true);
      expect(mockService.scroll).toHaveBeenCalledWith('default', 'down', 800);
    });
  });

  // =========================================================================
  // browser_select
  // =========================================================================

  describe('browser_select', () => {
    it('rejects missing selector', async () => {
      const result = await executeBrowserTool('browser_select', { value: 'us' });
      expect(result.success).toBe(false);
    });

    it('rejects non-string value', async () => {
      const result = await executeBrowserTool('browser_select', {
        selector: 'select#country',
        value: 42,
      });
      expect(result.success).toBe(false);
    });

    it('accepts empty-string value (legitimate "clear" semantic)', async () => {
      mockService.select.mockResolvedValueOnce({ url: 'https://a', title: 'A' });
      const result = await executeBrowserTool('browser_select', {
        selector: 'select#country',
        value: '',
      });
      expect(result.success).toBe(true);
      expect(mockService.select).toHaveBeenCalledWith('default', 'select#country', '');
    });

    it('forwards selector + value to service.select', async () => {
      mockService.select.mockResolvedValueOnce({ url: 'https://a', title: 'A' });
      await executeBrowserTool('browser_select', { selector: 'select#country', value: 'us' });
      expect(mockService.select).toHaveBeenCalledWith('default', 'select#country', 'us');
    });
  });

  // =========================================================================
  // browser_press_key
  // =========================================================================

  describe('browser_press_key', () => {
    it('rejects missing key', async () => {
      const result = await executeBrowserTool('browser_press_key', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('key');
    });

    it('forwards key without selector', async () => {
      mockService.pressKey.mockResolvedValueOnce({ url: 'https://a', title: 'A' });
      const result = await executeBrowserTool('browser_press_key', { key: 'Enter' });
      expect(result.success).toBe(true);
      expect(mockService.pressKey).toHaveBeenCalledWith('default', 'Enter', undefined);
    });

    it('forwards key + selector when selector is supplied', async () => {
      mockService.pressKey.mockResolvedValueOnce({ url: 'https://a', title: 'A' });
      await executeBrowserTool('browser_press_key', { key: 'Enter', selector: 'input.search' });
      expect(mockService.pressKey).toHaveBeenCalledWith('default', 'Enter', 'input.search');
    });
  });

  // =========================================================================
  // browser_get_state
  // =========================================================================

  describe('browser_get_state', () => {
    it('returns the service result (no args required)', async () => {
      mockService.getState.mockResolvedValueOnce({ url: 'https://a.test', title: 'A' });
      const result = await executeBrowserTool('browser_get_state', {});
      expect(result.success).toBe(true);
      expect(result.result).toEqual({ url: 'https://a.test', title: 'A' });
    });

    it('passes through null when no page is open', async () => {
      mockService.getState.mockResolvedValueOnce(null);
      const result = await executeBrowserTool('browser_get_state', {});
      expect(result.success).toBe(true);
      expect(result.result).toBeNull();
    });
  });

  describe('browser_accessibility_tree', () => {
    it('returns the a11y tree, passing through an optional selector', async () => {
      mockService.accessibilityTree.mockResolvedValueOnce({
        tree: '- WebArea "Example"\n  - button "Submit"',
        url: 'https://a.test',
        title: 'A',
      });
      const result = await executeBrowserTool('browser_accessibility_tree', { selector: 'main' });
      expect(result.success).toBe(true);
      expect(mockService.accessibilityTree).toHaveBeenCalledWith('default', 'main');
      expect((result.result as { tree: string }).tree).toContain('button "Submit"');
    });

    it('works without a selector', async () => {
      mockService.accessibilityTree.mockResolvedValueOnce({
        tree: '- WebArea',
        url: '',
        title: '',
      });
      const result = await executeBrowserTool('browser_accessibility_tree', {});
      expect(result.success).toBe(true);
      expect(mockService.accessibilityTree).toHaveBeenCalledWith('default', undefined);
    });
  });

  it('returns error for unknown tool name', async () => {
    const result = await executeBrowserTool('browser_hover', { selector: '.btn' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown browser tool');
  });

  // =========================================================================
  // Error propagation
  // =========================================================================

  it('catches service errors and returns error message', async () => {
    mockService.navigate.mockRejectedValueOnce(new Error('Navigation timeout'));
    const result = await executeBrowserTool('browse_web', { url: 'https://slow.com' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Navigation timeout');
  });
});
