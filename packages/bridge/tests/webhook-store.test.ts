import { describe, it, expect, beforeEach } from 'vitest';
import { webhookStore } from '../src/webhook-store.ts';

describe('WebhookStore', () => {
  beforeEach(() => {
    webhookStore.clear();
  });

  describe('register()', () => {
    it('should register a webhook with default events', () => {
      const wh = webhookStore.register({ url: 'https://example.com/hook' });
      expect(wh.id).toBeTruthy();
      expect(wh.url).toBe('https://example.com/hook');
      expect(wh.events).toEqual(['blocking']);
      expect(wh.secret).toBeNull();
      expect(wh.createdAt).toBeTruthy();
    });

    it('should register a webhook with secret', () => {
      const wh = webhookStore.register({
        url: 'https://example.com/hook',
        secret: 'my-secret-key',
      });
      expect(wh.secret).toBe('my-secret-key');
    });

    it('should register with explicit events', () => {
      const wh = webhookStore.register({
        url: 'https://example.com/hook',
        events: ['blocking'],
      });
      expect(wh.events).toEqual(['blocking']);
    });

    it('should reject invalid URL', () => {
      expect(() => webhookStore.register({ url: 'not-a-url' })).toThrow('Invalid webhook URL');
    });

    it('should reject invalid event type', () => {
      expect(() =>
        webhookStore.register({ url: 'https://example.com/hook', events: ['invalid'] }),
      ).toThrow('Invalid event type');
    });

    it('should reject duplicate URL', () => {
      webhookStore.register({ url: 'https://example.com/hook' });
      expect(() => webhookStore.register({ url: 'https://example.com/hook' })).toThrow(
        'already registered',
      );
    });

    it('should enforce max webhooks limit', () => {
      // Register 20 webhooks (the max)
      for (let i = 0; i < 20; i++) {
        webhookStore.register({ url: `https://example.com/hook-${i}` });
      }
      expect(() =>
        webhookStore.register({ url: 'https://example.com/hook-overflow' }),
      ).toThrow('Maximum webhook limit');
    });
  });

  describe('list()', () => {
    it('should return empty array initially', () => {
      expect(webhookStore.list()).toEqual([]);
    });

    it('should return all registered webhooks', () => {
      webhookStore.register({ url: 'https://a.com/hook' });
      webhookStore.register({ url: 'https://b.com/hook' });
      expect(webhookStore.list()).toHaveLength(2);
    });
  });

  describe('get()', () => {
    it('should return webhook by ID', () => {
      const wh = webhookStore.register({ url: 'https://example.com/hook' });
      const found = webhookStore.get(wh.id);
      expect(found).not.toBeNull();
      expect(found!.url).toBe('https://example.com/hook');
    });

    it('should return null for unknown ID', () => {
      expect(webhookStore.get('nonexistent')).toBeNull();
    });
  });

  describe('delete()', () => {
    it('should delete existing webhook', () => {
      const wh = webhookStore.register({ url: 'https://example.com/hook' });
      expect(webhookStore.delete(wh.id)).toBe(true);
      expect(webhookStore.list()).toHaveLength(0);
    });

    it('should return false for unknown ID', () => {
      expect(webhookStore.delete('nonexistent')).toBe(false);
    });
  });

  describe('getByEvent()', () => {
    it('should return webhooks matching event', () => {
      webhookStore.register({ url: 'https://a.com/hook', events: ['blocking'] });
      webhookStore.register({ url: 'https://b.com/hook', events: ['blocking'] });
      expect(webhookStore.getByEvent('blocking')).toHaveLength(2);
    });

    it('should return empty for unmatched event', () => {
      webhookStore.register({ url: 'https://a.com/hook', events: ['blocking'] });
      expect(webhookStore.getByEvent('complete')).toHaveLength(0);
    });
  });

  describe('size', () => {
    it('should track count', () => {
      expect(webhookStore.size).toBe(0);
      const wh = webhookStore.register({ url: 'https://a.com/hook' });
      expect(webhookStore.size).toBe(1);
      webhookStore.delete(wh.id);
      expect(webhookStore.size).toBe(0);
    });
  });
});
