/**
 * WhatsApp Channel Plugin — builder Tests
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  MockWhatsAppChannelAPI,
  mockConfigServicesRepo,
  capturedMeta,
  capturedPlatform,
  capturedChannelApiFactory,
} = vi.hoisted(() => {
  const capturedMeta: any[] = [];
  const capturedPlatform: string[] = [];
  const capturedChannelApiFactory: Function[] = [];
  const MockWhatsAppChannelAPI = vi.fn().mockImplementation(function (
    config: any,
    pluginId: string
  ) {
    return { config, pluginId };
  });
  const mockConfigServicesRepo = { getFieldValue: vi.fn() };
  return {
    MockWhatsAppChannelAPI,
    mockConfigServicesRepo,
    capturedMeta,
    capturedPlatform,
    capturedChannelApiFactory,
  };
});

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ownpilot/core')>();
  return {
    ...actual,
    createChannelPlugin: vi.fn(() => {
      const b: any = {
        meta: vi.fn((m: any) => {
          capturedMeta.push(m);
          return b;
        }),
        platform: vi.fn((p: string) => {
          capturedPlatform.push(p);
          return b;
        }),
        channelApi: vi.fn((f: Function) => {
          capturedChannelApiFactory.push(f);
          return b;
        }),
        build: vi.fn(() => ({ id: capturedMeta[0]?.id })),
      };
      return b;
    }),
  };
});

vi.mock('./whatsapp-api.js', () => ({ WhatsAppChannelAPI: MockWhatsAppChannelAPI }));
vi.mock('../../../db/repositories/config-services.js', () => ({
  configServicesRepo: mockConfigServicesRepo,
}));

import { buildWhatsAppChannelPlugin } from './index.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildWhatsAppChannelPlugin', () => {
  it('returns a plugin object', () => {
    expect(buildWhatsAppChannelPlugin()).toBeDefined();
  });

  it('sets plugin id to channel.whatsapp', () => {
    buildWhatsAppChannelPlugin();
    expect(capturedMeta[0]?.id).toBe('channel.whatsapp');
  });

  it('sets platform to whatsapp', () => {
    buildWhatsAppChannelPlugin();
    expect(capturedPlatform[0]).toBe('whatsapp');
  });

  it('channelApi factory creates WhatsAppChannelAPI with config', () => {
    buildWhatsAppChannelPlugin();
    const factory = capturedChannelApiFactory[0]!;
    mockConfigServicesRepo.getFieldValue.mockReturnValue(undefined);
    factory({ my_phone: '905551234567' });
    expect(MockWhatsAppChannelAPI).toHaveBeenCalledWith(
      expect.objectContaining({ my_phone: '905551234567' }),
      'channel.whatsapp'
    );
  });

  it('channelApi factory falls back to configServicesRepo for my_phone', () => {
    buildWhatsAppChannelPlugin();
    const factory = capturedChannelApiFactory[0]!;
    mockConfigServicesRepo.getFieldValue.mockImplementation((service: string, field: string) => {
      if (service === 'whatsapp_baileys' && field === 'my_phone') return '901234567890';
      return undefined;
    });
    factory({});
    const last = MockWhatsAppChannelAPI.mock.calls[MockWhatsAppChannelAPI.mock.calls.length - 1];
    expect(last?.[0]?.my_phone).toBe('901234567890');
  });

  it('has requiredServices entry for whatsapp_baileys', () => {
    buildWhatsAppChannelPlugin();
    expect(capturedMeta[0]?.requiredServices?.[0]?.name).toBe('whatsapp_baileys');
  });
});
