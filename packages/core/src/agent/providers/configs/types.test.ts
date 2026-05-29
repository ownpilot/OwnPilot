/**
 * Unit tests for the {@link ResolvedAuth} abstraction.
 *
 * Covers the two helpers (`getAuthHeader`, `isAuthExpired`) and pins the
 * "every supported method reduces to `Bearer <value>`" invariant so any
 * future method that needs a different scheme has to update the helper
 * explicitly and break this test.
 */

import { describe, it, expect } from 'vitest';
import { getAuthHeader, isAuthExpired, type ResolvedAuth } from './types.js';

describe('getAuthHeader', () => {
  it('builds Bearer header for api_key method', () => {
    const auth: ResolvedAuth = { method: 'api_key', value: 'sk-test-1234' };
    expect(getAuthHeader(auth)).toBe('Bearer sk-test-1234');
  });

  it('builds Bearer header for session_token method', () => {
    const auth: ResolvedAuth = { method: 'session_token', value: 'xai-sess-abcd' };
    expect(getAuthHeader(auth)).toBe('Bearer xai-sess-abcd');
  });

  it('builds Bearer header for oauth2_device_code method', () => {
    const auth: ResolvedAuth = {
      method: 'oauth2_device_code',
      value: 'access-token-xyz',
      refreshToken: 'refresh-xyz',
      expiresAt: Date.now() + 60_000,
    };
    expect(getAuthHeader(auth)).toBe('Bearer access-token-xyz');
  });

  it('builds Bearer header for oauth2_pkce method', () => {
    const auth: ResolvedAuth = {
      method: 'oauth2_pkce',
      value: 'pkce-access-token',
    };
    expect(getAuthHeader(auth)).toBe('Bearer pkce-access-token');
  });
});

describe('isAuthExpired', () => {
  it('returns false for api_key (no expiry)', () => {
    const auth: ResolvedAuth = { method: 'api_key', value: 'sk-test' };
    expect(isAuthExpired(auth)).toBe(false);
  });

  it('returns false when expiresAt is not set', () => {
    const auth: ResolvedAuth = { method: 'session_token', value: 'tok' };
    expect(isAuthExpired(auth)).toBe(false);
  });

  it('returns true when expiresAt is in the past', () => {
    const auth: ResolvedAuth = {
      method: 'oauth2_pkce',
      value: 'tok',
      expiresAt: Date.now() - 10_000,
    };
    expect(isAuthExpired(auth)).toBe(true);
  });

  it('returns true when expiresAt is within 30s skew window', () => {
    const now = 1_000_000;
    const auth: ResolvedAuth = {
      method: 'oauth2_device_code',
      value: 'tok',
      expiresAt: now + 15_000, // 15s in future — inside 30s skew
    };
    expect(isAuthExpired(auth, now)).toBe(true);
  });

  it('returns false when expiresAt is comfortably in the future', () => {
    const now = 1_000_000;
    const auth: ResolvedAuth = {
      method: 'oauth2_pkce',
      value: 'tok',
      expiresAt: now + 60_000, // 60s in future — outside 30s skew
    };
    expect(isAuthExpired(auth, now)).toBe(false);
  });

  it('treats expiresAt exactly at skew boundary as expired', () => {
    const now = 1_000_000;
    const auth: ResolvedAuth = {
      method: 'session_token',
      value: 'tok',
      expiresAt: now + 30_000,
    };
    expect(isAuthExpired(auth, now)).toBe(true);
  });
});
