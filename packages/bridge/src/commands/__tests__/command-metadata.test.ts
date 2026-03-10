import { describe, it, expect } from 'vitest';
import { COMMAND_METADATA, COMMAND_INTENT_MAP } from '../command-metadata.ts';

describe('COMMAND_METADATA', () => {
  const REQUIRED_COMMANDS = ['cost', 'status', 'help', 'clear', 'compact', 'doctor'] as const;

  it('exports all required command keys', () => {
    for (const cmd of REQUIRED_COMMANDS) {
      expect(COMMAND_METADATA).toHaveProperty(cmd);
    }
  });

  it('each entry has required CommandMeta shape', () => {
    for (const cmd of REQUIRED_COMMANDS) {
      const meta = COMMAND_METADATA[cmd];
      expect(meta).toHaveProperty('name', cmd);
      expect(meta).toHaveProperty('description');
      expect(typeof meta.description).toBe('string');
      expect(Array.isArray(meta.patterns)).toBe(true);
      expect(meta.patterns.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(meta.aliases)).toBe(true);
      expect(meta.aliases.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('all patterns are RegExp instances', () => {
    for (const cmd of REQUIRED_COMMANDS) {
      for (const p of COMMAND_METADATA[cmd].patterns) {
        expect(p).toBeInstanceOf(RegExp);
      }
    }
  });

  it('/cost patterns match Turkish cost keywords', () => {
    const { patterns } = COMMAND_METADATA.cost;
    const hits = ['ne kadar harcadım', 'maliyet', 'harcama', 'token kullanımı'];
    for (const input of hits) {
      expect(patterns.some((p) => p.test(input.toLowerCase()))).toBe(true);
    }
  });

  it('/cost patterns match English cost keywords', () => {
    const { patterns } = COMMAND_METADATA.cost;
    const hits = ['how much did i spend', 'cost usage', 'token cost', 'spending'];
    for (const input of hits) {
      expect(patterns.some((p) => p.test(input.toLowerCase()))).toBe(true);
    }
  });

  it('/status patterns match Turkish session keywords', () => {
    const { patterns } = COMMAND_METADATA.status;
    const hits = ['oturum durumu', 'session aktif mi', 'durum ne'];
    for (const input of hits) {
      expect(patterns.some((p) => p.test(input.toLowerCase()))).toBe(true);
    }
  });

  it('/status patterns match English status keywords', () => {
    const { patterns } = COMMAND_METADATA.status;
    const hits = ['show status', 'session state', 'is running'];
    for (const input of hits) {
      expect(patterns.some((p) => p.test(input.toLowerCase()))).toBe(true);
    }
  });

  it('/help patterns match both languages', () => {
    const { patterns } = COMMAND_METADATA.help;
    const hits = ['yardım', 'yardim et', 'komutlar neler', 'show help', 'what can you do'];
    for (const input of hits) {
      expect(patterns.some((p) => p.test(input.toLowerCase()))).toBe(true);
    }
  });

  it('/clear patterns match both languages', () => {
    const { patterns } = COMMAND_METADATA.clear;
    const hits = ['sohbeti temizle', 'sıfırla', 'clear chat', 'new session', 'start fresh'];
    for (const input of hits) {
      expect(patterns.some((p) => p.test(input.toLowerCase()))).toBe(true);
    }
  });

  it('/compact patterns match both languages', () => {
    const { patterns } = COMMAND_METADATA.compact;
    const hits = ['baglami sikistir', 'bellegi ozetle', 'compact context', 'compress memory'];
    for (const input of hits) {
      expect(patterns.some((p) => p.test(input.toLowerCase()))).toBe(true);
    }
  });

  it('/doctor patterns match both languages', () => {
    const { patterns } = COMMAND_METADATA.doctor;
    const hits = ['doktor', 'sorunlari kontrol et', 'run doctor', 'diagnose', 'health check'];
    for (const input of hits) {
      expect(patterns.some((p) => p.test(input.toLowerCase()))).toBe(true);
    }
  });
});

describe('COMMAND_INTENT_MAP', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(COMMAND_INTENT_MAP)).toBe(true);
    expect(COMMAND_INTENT_MAP.length).toBeGreaterThan(0);
  });

  it('each entry has { pattern: RegExp, command: string } shape', () => {
    for (const entry of COMMAND_INTENT_MAP) {
      expect(entry).toHaveProperty('pattern');
      expect(entry.pattern).toBeInstanceOf(RegExp);
      expect(entry).toHaveProperty('command');
      expect(typeof entry.command).toBe('string');
      expect(entry.command.startsWith('/')).toBe(true);
    }
  });

  it('contains entries for all six commands', () => {
    const commands = new Set(COMMAND_INTENT_MAP.map((e) => e.command));
    for (const cmd of ['/cost', '/status', '/help', '/clear', '/compact', '/doctor']) {
      expect(commands.has(cmd)).toBe(true);
    }
  });
});
