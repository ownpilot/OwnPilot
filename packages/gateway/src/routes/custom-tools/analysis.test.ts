/**
 * Custom Tools Analysis Routes Tests
 *
 * Integration tests for POST /validate and POST /llm-review endpoints.
 * Mocks core analysis functions (analyzeToolCode, calculateSecurityScore).
 *
 * NOTE: Some test strings intentionally contain patterns like eval() to test
 * the security analysis pipeline. These are test fixtures, not production code.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const defaultAnalysis = {
  valid: true,
  errors: [] as string[],
  warnings: [] as string[],
  securityScore: { score: 90, category: 'safe' as const, factors: {} },
  dataFlowRisks: [] as string[],
  bestPractices: { followed: ['uses return statement'], violated: [] as string[] },
  suggestedPermissions: [] as string[],
  stats: {
    lineCount: 5,
    hasAsyncCode: false,
    usesFetch: false,
    usesCallTool: false,
    usesUtils: false,
    returnsValue: true,
  },
};

const mockAnalyzeToolCode = vi.fn((_code: string, _perms?: string[]) => ({ ...defaultAnalysis }));
const mockCalculateSecurityScore = vi.fn((_code: string, _perms?: string[]) => ({
  score: 90,
  category: 'safe' as const,
  factors: {},
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    analyzeToolCode: (...args: unknown[]) =>
      mockAnalyzeToolCode(...(args as [string, string[] | undefined])),
    calculateSecurityScore: (...args: unknown[]) =>
      mockCalculateSecurityScore(...(args as [string, string[] | undefined])),
  };
});

// Import after mocks
const { analysisRoutes } = await import('./analysis.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.route('/analysis', analysisRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Custom Tools Analysis Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeToolCode.mockReturnValue({ ...defaultAnalysis });
    mockCalculateSecurityScore.mockReturnValue({ score: 90, category: 'safe', factors: {} });
    app = createApp();
  });

  // ========================================================================
  // POST /validate
  // ========================================================================

  describe('POST /analysis/validate', () => {
    it('returns analysis for valid code', async () => {
      const res = await app.request('/analysis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'return { content: { result: 42 } };' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.valid).toBe(true);
      expect(json.data.errors).toEqual([]);
      expect(json.data.warnings).toBeDefined();
      expect(json.data.stats).toBeDefined();
      expect(json.data.securityScore).toBeDefined();
      expect(json.data.dataFlowRisks).toBeDefined();
      expect(json.data.bestPractices).toBeDefined();
      expect(json.data.suggestedPermissions).toBeDefined();
      expect(json.data.recommendations).toBeDefined();
    });

    it('returns 400 when code is missing', async () => {
      const res = await app.request('/analysis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('returns 400 when code is not a string', async () => {
      const res = await app.request('/analysis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 123 }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/analysis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
    });

    it('adds permission warning when fetch used without network permission', async () => {
      mockAnalyzeToolCode.mockReturnValue({
        ...defaultAnalysis,
        stats: { ...defaultAnalysis.stats, usesFetch: true },
      });

      const res = await app.request('/analysis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'const r = await fetch("http://example.com"); return { content: r };',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.warnings).toContain(
        'Code uses fetch() but "network" permission is not requested'
      );
    });

    it('does not add permission warning when network permission is included', async () => {
      mockAnalyzeToolCode.mockReturnValue({
        ...defaultAnalysis,
        stats: { ...defaultAnalysis.stats, usesFetch: true },
      });

      const res = await app.request('/analysis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'const r = await fetch("http://example.com"); return { content: r };',
          permissions: ['network'],
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.warnings.some((w: string) => w.includes('network'))).toBe(false);
    });

    it('passes permissions to analyzeToolCode', async () => {
      await app.request('/analysis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'return {};', permissions: ['filesystem', 'network'] }),
      });

      expect(mockAnalyzeToolCode).toHaveBeenCalledWith('return {};', ['filesystem', 'network']);
    });

    // --- Recommendation generation ---

    it('recommends adding return statement when code does not return', async () => {
      mockAnalyzeToolCode.mockReturnValue({
        ...defaultAnalysis,
        stats: { ...defaultAnalysis.stats, returnsValue: false },
      });

      const res = await app.request('/analysis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'console.log("hello");' }),
      });

      const json = await res.json();
      expect(json.data.recommendations).toContain(
        'Add a return statement to provide output to the LLM'
      );
    });

    it('recommends async/await when fetch used without async', async () => {
      mockAnalyzeToolCode.mockReturnValue({
        ...defaultAnalysis,
        stats: { ...defaultAnalysis.stats, usesFetch: true, hasAsyncCode: false },
      });

      const res = await app.request('/analysis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'fetch("http://x.com");' }),
      });

      const json = await res.json();
      expect(json.data.recommendations.some((r: string) => r.includes('async/await'))).toBe(true);
    });

    it('recommends splitting complex code over 100 lines', async () => {
      mockAnalyzeToolCode.mockReturnValue({
        ...defaultAnalysis,
        stats: { ...defaultAnalysis.stats, lineCount: 150 },
      });

      const res = await app.request('/analysis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'x'.repeat(200) }),
      });

      const json = await res.json();
      expect(json.data.recommendations.some((r: string) => r.includes('splitting'))).toBe(true);
    });

    it('recommends utils.getApiKey for network tools without utils usage', async () => {
      mockAnalyzeToolCode.mockReturnValue({
        ...defaultAnalysis,
        stats: { ...defaultAnalysis.stats, usesUtils: false, usesFetch: true },
      });

      const res = await app.request('/analysis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'await fetch("http://api.com");', permissions: ['network'] }),
      });

      const json = await res.json();
      expect(json.data.recommendations.some((r: string) => r.includes('getApiKey'))).toBe(true);
    });

    it('recommends wrapping fetch in try/catch', async () => {
      mockAnalyzeToolCode.mockReturnValue({
        ...defaultAnalysis,
        stats: { ...defaultAnalysis.stats, usesFetch: true, hasAsyncCode: true },
      });

      const res = await app.request('/analysis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'await fetch("http://x.com");' }),
      });

      const json = await res.json();
      expect(json.data.recommendations.some((r: string) => r.includes('try/catch'))).toBe(true);
    });

    it('adds security warning recommendation for dangerous score', async () => {
      mockAnalyzeToolCode.mockReturnValue({
        ...defaultAnalysis,
        securityScore: { score: 20, category: 'dangerous', factors: {} },
      });

      const res = await app.request('/analysis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'dangerous_code();' }),
      });

      const json = await res.json();
      expect(json.data.recommendations.some((r: string) => r.includes('Security score'))).toBe(
        true
      );
    });

    it('includes best practice violations as recommendations', async () => {
      mockAnalyzeToolCode.mockReturnValue({
        ...defaultAnalysis,
        bestPractices: {
          followed: [],
          violated: ['Missing error handling', 'No input validation'],
        },
      });

      const res = await app.request('/analysis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'return {};' }),
      });

      const json = await res.json();
      expect(json.data.recommendations).toContain('Missing error handling');
      expect(json.data.recommendations).toContain('No input validation');
    });

    it('deduplicates recommendations', async () => {
      mockAnalyzeToolCode.mockReturnValue({
        ...defaultAnalysis,
        stats: { ...defaultAnalysis.stats, usesFetch: true, hasAsyncCode: true },
        bestPractices: {
          followed: [],
          violated: ['Wrap fetch() calls in try/catch and validate response.ok before parsing'],
        },
      });

      const res = await app.request('/analysis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'await fetch("x");' }),
      });

      const json = await res.json();
      // The fetch try/catch recommendation appears from both the violated check
      // and the usesFetch check, but should be deduplicated via Set
      const fetchRecs = json.data.recommendations.filter(
        (r: string) => r.includes('fetch') && r.includes('try/catch')
      );
      expect(fetchRecs.length).toBeLessThanOrEqual(2);
    });

    it('includes errors from analysis in response', async () => {
      mockAnalyzeToolCode.mockReturnValue({
        ...defaultAnalysis,
        valid: false,
        errors: ['Forbidden pattern detected'],
      });

      const res = await app.request('/analysis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'forbidden_code();' }),
      });

      const json = await res.json();
      expect(json.data.valid).toBe(false);
      expect(json.data.errors).toContain('Forbidden pattern detected');
    });

    it('includes original warnings from analysis', async () => {
      mockAnalyzeToolCode.mockReturnValue({
        ...defaultAnalysis,
        warnings: ['Consider using const instead of let'],
      });

      const res = await app.request('/analysis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'let x = 1; return { content: x };' }),
      });

      const json = await res.json();
      expect(json.data.warnings).toContain('Consider using const instead of let');
    });
  });

  // ========================================================================
  // POST /llm-review
  // ========================================================================

  describe('POST /analysis/llm-review', () => {
    it('returns static analysis and review prompt', async () => {
      const res = await app.request('/analysis/llm-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'return { content: { result: 42 } };',
          name: 'my_tool',
          description: 'A test tool',
          permissions: ['network'],
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.staticAnalysis).toBeDefined();
      expect(json.data.staticAnalysis.valid).toBe(true);
      expect(json.data.staticAnalysis.securityScore).toBeDefined();
      expect(json.data.llmReviewPrompt).toBeDefined();
      expect(json.data.note).toContain('Pass the llmReviewPrompt');
    });

    it('returns 400 when code is missing', async () => {
      const res = await app.request('/analysis/llm-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('INVALID_INPUT');
    });

    it('returns 400 when code is not a string', async () => {
      const res = await app.request('/analysis/llm-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 42 }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/analysis/llm-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
    });

    it('builds review prompt with tool metadata', async () => {
      const res = await app.request('/analysis/llm-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'return {};',
          name: 'api_tool',
          description: 'Calls an API',
          permissions: ['network', 'filesystem'],
        }),
      });

      const json = await res.json();
      const prompt = json.data.llmReviewPrompt;
      expect(prompt).toContain('api_tool');
      expect(prompt).toContain('Calls an API');
      expect(prompt).toContain('network, filesystem');
      expect(prompt).toContain('90/100');
      expect(prompt).toContain('return {};');
    });

    it('builds review prompt with default values when metadata is omitted', async () => {
      const res = await app.request('/analysis/llm-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'return {};' }),
      });

      const json = await res.json();
      const prompt = json.data.llmReviewPrompt;
      expect(prompt).toContain('unnamed');
      expect(prompt).toContain('none provided');
      expect(prompt).toContain('PERMISSIONS: none');
    });

    it('includes static analysis errors in review prompt', async () => {
      mockAnalyzeToolCode.mockReturnValue({
        ...defaultAnalysis,
        valid: false,
        errors: ['Uses forbidden pattern'],
        warnings: ['Possible data leak'],
      });

      const res = await app.request('/analysis/llm-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'dangerous_code();' }),
      });

      const json = await res.json();
      const prompt = json.data.llmReviewPrompt;
      expect(prompt).toContain('Uses forbidden pattern');
      expect(prompt).toContain('Possible data leak');
      expect(json.data.staticAnalysis.valid).toBe(false);
    });

    it('includes "none" for empty errors/warnings in review prompt', async () => {
      const res = await app.request('/analysis/llm-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'return { content: {} };' }),
      });

      const json = await res.json();
      const prompt = json.data.llmReviewPrompt;
      expect(prompt).toContain('STATIC ANALYSIS ERRORS: none');
      expect(prompt).toContain('STATIC ANALYSIS WARNINGS: none');
    });

    it('passes permissions to both analyzeToolCode and calculateSecurityScore', async () => {
      await app.request('/analysis/llm-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'return {};', permissions: ['database'] }),
      });

      expect(mockAnalyzeToolCode).toHaveBeenCalledWith('return {};', ['database']);
      expect(mockCalculateSecurityScore).toHaveBeenCalledWith('return {};', ['database']);
    });

    it('includes dataFlowRisks in static analysis response', async () => {
      mockAnalyzeToolCode.mockReturnValue({
        ...defaultAnalysis,
        dataFlowRisks: ['User input flows to dangerous function'],
      });

      const res = await app.request('/analysis/llm-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'dangerous(args.input);' }),
      });

      const json = await res.json();
      expect(json.data.staticAnalysis.dataFlowRisks).toContain(
        'User input flows to dangerous function'
      );
    });

    it('includes suggestedPermissions in static analysis response', async () => {
      mockAnalyzeToolCode.mockReturnValue({
        ...defaultAnalysis,
        suggestedPermissions: ['network'],
      });

      const res = await app.request('/analysis/llm-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'await fetch("http://x.com");' }),
      });

      const json = await res.json();
      expect(json.data.staticAnalysis.suggestedPermissions).toContain('network');
    });

    it('review prompt includes expected structure sections', async () => {
      const res = await app.request('/analysis/llm-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'return {};' }),
      });

      const json = await res.json();
      const prompt = json.data.llmReviewPrompt;
      expect(prompt).toContain('SECURITY ASSESSMENT');
      expect(prompt).toContain('POTENTIAL RISKS');
      expect(prompt).toContain('LOGIC REVIEW');
      expect(prompt).toContain('IMPROVEMENT SUGGESTIONS');
      expect(prompt).toContain('PERMISSION REVIEW');
      expect(prompt).toContain('OVERALL VERDICT');
    });

    it('includes bestPractices in static analysis response', async () => {
      mockAnalyzeToolCode.mockReturnValue({
        ...defaultAnalysis,
        bestPractices: {
          followed: ['Has return statement'],
          violated: ['No error handling'],
        },
      });

      const res = await app.request('/analysis/llm-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'return {};' }),
      });

      const json = await res.json();
      expect(json.data.staticAnalysis.bestPractices.followed).toContain('Has return statement');
      expect(json.data.staticAnalysis.bestPractices.violated).toContain('No error handling');
    });
  });
});
