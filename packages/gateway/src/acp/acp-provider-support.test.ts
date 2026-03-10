import { describe, it, expect } from 'vitest';
import { isAcpSupported, buildAcpArgs, getAcpBinary } from './acp-provider-support.js';

describe('acp-provider-support', () => {
  // ===========================================================================
  // isAcpSupported
  // ===========================================================================
  describe('isAcpSupported', () => {
    it('returns true for gemini-cli', () => {
      expect(isAcpSupported('gemini-cli')).toBe(true);
    });

    it('returns false for claude-code', () => {
      expect(isAcpSupported('claude-code')).toBe(false);
    });

    it('returns false for codex', () => {
      expect(isAcpSupported('codex')).toBe(false);
    });

    it('returns false for custom providers', () => {
      expect(isAcpSupported({ id: 'custom', name: 'Custom', binary: 'foo' } as any)).toBe(false);
    });
  });

  // ===========================================================================
  // buildAcpArgs
  // ===========================================================================
  describe('buildAcpArgs', () => {
    it('returns --experimental-acp for gemini-cli', () => {
      const args = buildAcpArgs('gemini-cli');
      expect(args).toEqual(['--experimental-acp']);
    });

    it('includes --model when model option is provided', () => {
      const args = buildAcpArgs('gemini-cli', { model: 'gemini-2.5-pro' });
      expect(args).toEqual(['--experimental-acp', '--model', 'gemini-2.5-pro']);
    });

    it('returns null for unsupported providers', () => {
      expect(buildAcpArgs('claude-code')).toBeNull();
      expect(buildAcpArgs('codex')).toBeNull();
    });

    it('returns null for custom providers', () => {
      expect(buildAcpArgs({ id: 'custom' } as any)).toBeNull();
    });
  });

  // ===========================================================================
  // getAcpBinary
  // ===========================================================================
  describe('getAcpBinary', () => {
    it('maps claude-code to claude', () => {
      expect(getAcpBinary('claude-code')).toBe('claude');
    });

    it('maps codex to codex', () => {
      expect(getAcpBinary('codex')).toBe('codex');
    });

    it('maps gemini-cli to gemini', () => {
      expect(getAcpBinary('gemini-cli')).toBe('gemini');
    });
  });
});
