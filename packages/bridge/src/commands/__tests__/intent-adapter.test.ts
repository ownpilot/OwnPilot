import { describe, it, expect } from 'vitest';
import { resolveIntent } from '../intent-adapter.ts';

describe('resolveIntent — /cost', () => {
  it('TR: ne kadar harcadım → /cost', () => {
    expect(resolveIntent('ne kadar harcadım')).toBe('/cost');
  });
  it('TR: maliyet ne kadar → /cost', () => {
    expect(resolveIntent('maliyet ne kadar')).toBe('/cost');
  });
  it('EN: show cost usage → /cost', () => {
    expect(resolveIntent('show cost usage')).toBe('/cost');
  });
  it('EN: how much did i spend → /cost', () => {
    expect(resolveIntent('how much did i spend')).toBe('/cost');
  });
});

describe('resolveIntent — /status', () => {
  it('TR: oturum durumu nedir → /status', () => {
    expect(resolveIntent('oturum durumu nedir')).toBe('/status');
  });
  it('TR: session aktif mi → /status', () => {
    expect(resolveIntent('session aktif mi')).toBe('/status');
  });
  it('EN: show status → /status', () => {
    expect(resolveIntent('show status')).toBe('/status');
  });
  it('EN: is the session running → /status', () => {
    expect(resolveIntent('is the session running')).toBe('/status');
  });
});

describe('resolveIntent — /help', () => {
  it('TR: yardım et → /help', () => {
    expect(resolveIntent('yardım et')).toBe('/help');
  });
  it('TR: komutlar neler → /help', () => {
    expect(resolveIntent('komutlar neler')).toBe('/help');
  });
  it('EN: show help → /help', () => {
    expect(resolveIntent('show help')).toBe('/help');
  });
  it('EN: what can you do → /help', () => {
    expect(resolveIntent('what can you do')).toBe('/help');
  });
});

describe('resolveIntent — /clear', () => {
  it('TR: sohbeti temizle → /clear', () => {
    expect(resolveIntent('sohbeti temizle')).toBe('/clear');
  });
  it('TR: sıfırla → /clear', () => {
    expect(resolveIntent('sıfırla')).toBe('/clear');
  });
  it('EN: clear chat → /clear', () => {
    expect(resolveIntent('clear chat')).toBe('/clear');
  });
  it('EN: start fresh → /clear', () => {
    expect(resolveIntent('start fresh')).toBe('/clear');
  });
});

describe('resolveIntent — /compact', () => {
  it('TR: bağlamı sıkıştır → /compact', () => {
    expect(resolveIntent('bağlamı sıkıştır')).toBe('/compact');
  });
  it('TR: belleği özetle → /compact', () => {
    expect(resolveIntent('belleği özetle')).toBe('/compact');
  });
  it('EN: compact → /compact', () => {
    expect(resolveIntent('compact')).toBe('/compact');
  });
  it('EN: compress context → /compact', () => {
    expect(resolveIntent('compress context')).toBe('/compact');
  });
});

describe('resolveIntent — /doctor', () => {
  it('TR: doktor çalıştır → /doctor', () => {
    expect(resolveIntent('doktor çalıştır')).toBe('/doctor');
  });
  it('TR: sorunları kontrol et → /doctor', () => {
    expect(resolveIntent('sorunları kontrol et')).toBe('/doctor');
  });
  it('EN: run doctor → /doctor', () => {
    expect(resolveIntent('run doctor')).toBe('/doctor');
  });
  it('EN: health check → /doctor', () => {
    expect(resolveIntent('health check')).toBe('/doctor');
  });
});

describe('resolveIntent — pass-through (null)', () => {
  it('unrelated message returns null', () => {
    expect(resolveIntent('can you write me a poem?')).toBeNull();
  });
  it('empty string returns null', () => {
    expect(resolveIntent('')).toBeNull();
  });
  it('whitespace-only returns null', () => {
    expect(resolveIntent('   ')).toBeNull();
  });
  it('partial keyword without context returns null', () => {
    // "kontrol" alone is too generic — only "sorunları kontrol" matches /doctor
    // This test documents the intended specificity
    expect(resolveIntent('bu kodu kontrol et')).toBeNull();
  });
});

describe('resolveIntent — Turkish normalization', () => {
  it('harcadim (no accent) resolves same as harcadım → /cost', () => {
    expect(resolveIntent('ne kadar harcadim')).toBe('/cost');
  });
  it('yardim (no accent) resolves same as yardım → /help', () => {
    expect(resolveIntent('yardim')).toBe('/help');
  });
  it('mixed case input is normalized → /status', () => {
    expect(resolveIntent('SHOW STATUS')).toBe('/status');
  });
  it('leading/trailing whitespace is stripped → /cost', () => {
    expect(resolveIntent('  ne kadar harcadım  ')).toBe('/cost');
  });
});

describe('resolveIntent — dead alias fixes', () => {
  it('"usage" -> /cost', () => {
    expect(resolveIntent('usage')).toBe('/cost');
  });
  it('"how much" -> /cost', () => {
    expect(resolveIntent('how much')).toBe('/cost');
  });
  it('"durum" -> /status', () => {
    expect(resolveIntent('durum')).toBe('/status');
  });
  it('"aktif mi" -> /status', () => {
    expect(resolveIntent('aktif mi')).toBe('/status');
  });
  it('"komutlar" -> /help', () => {
    expect(resolveIntent('komutlar')).toBe('/help');
  });
  it('"summarize memory" -> /compact', () => {
    expect(resolveIntent('summarize memory')).toBe('/compact');
  });
  it('"değişiklikler" -> /diff', () => {
    expect(resolveIntent('değişiklikler')).toBe('/diff');
  });
});

describe('resolveIntent — long message bypass (CC task protection)', () => {
  it('long prompt with "status" keyword returns null (BUG 1 fix)', () => {
    const longPrompt =
      'Implement SOR pipeline with status TEXT DEFAULT pending and CREATE TABLE sor_queue';
    expect(resolveIntent(longPrompt)).toBeNull();
  });
  it('long CC task prompt (>80 chars) returns null', () => {
    const longPrompt =
      '# SOR Pipeline Orchestrator — GSD Execution\n\nSen bu projenin senior TypeScript geliştiricisisin.';
    expect(resolveIntent(longPrompt)).toBeNull();
  });
  it('prompt with 7+ words returns null regardless of keywords', () => {
    expect(resolveIntent('can you show me the session status please')).toBeNull();
  });
  it('short "status" still resolves to /status', () => {
    expect(resolveIntent('status')).toBe('/status');
  });
  it('short "durum nedir" still resolves to /status', () => {
    expect(resolveIntent('durum nedir')).toBe('/status');
  });
});

describe('resolveIntent — false positive tightening', () => {
  it('"maliyet hesapla" -> null', () => {
    expect(resolveIntent('maliyet hesapla')).toBeNull();
  });
  it('"status code 404" -> null', () => {
    expect(resolveIntent('status code 404')).toBeNull();
  });
  it('"clear explanation" -> null', () => {
    expect(resolveIntent('clear explanation')).toBeNull();
  });
  it('"help me write" -> null', () => {
    expect(resolveIntent('help me write')).toBeNull();
  });
  it('"doctor strange" -> null', () => {
    expect(resolveIntent('doctor strange')).toBeNull();
  });
  it('"rename this variable" -> null', () => {
    expect(resolveIntent('rename this variable')).toBeNull();
  });
  it('"cost of living" -> null', () => {
    expect(resolveIntent('cost of living')).toBeNull();
  });
});
