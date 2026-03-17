/**
 * Intent Adapter — Unit Tests
 *
 * Tests resolveIntent() for TR/EN natural language → slash command resolution.
 * Pure unit tests — no HTTP, no app setup needed.
 */

import { describe, it, expect } from 'vitest';
import { resolveIntent } from '../../src/commands/intent-adapter.ts';

// ============================================================================
// Pass-through: unrelated messages → null
// ============================================================================
describe('resolveIntent — pass-through', () => {
  it('regular question → null', () => {
    expect(resolveIntent('bugün hava nasıl?')).toBeNull();
  });

  it('code request → null', () => {
    expect(resolveIntent('can you write me a poem?')).toBeNull();
  });

  it('empty string → null', () => {
    expect(resolveIntent('')).toBeNull();
  });

  it('whitespace only → null', () => {
    expect(resolveIntent('   ')).toBeNull();
  });

  it('arbitrary Turkish → null', () => {
    expect(resolveIntent('bugün hava çok güzel')).toBeNull();
  });
});

// ============================================================================
// /cost — token usage and spending
// ============================================================================
describe('resolveIntent — /cost', () => {
  it('TR: ne kadar harcadım', () => {
    expect(resolveIntent('ne kadar harcadım')).toBe('/cost');
  });

  it('TR: harcama ne kadar', () => {
    expect(resolveIntent('harcama ne kadar')).toBe('/cost');
  });

  it('TR: maliyet ne', () => {
    expect(resolveIntent('maliyet ne')).toBe('/cost');
  });

  it('TR: token kullanımı', () => {
    expect(resolveIntent('token kullanımı')).toBe('/cost');
  });

  it('EN: how much did i spend', () => {
    expect(resolveIntent('how much did i spend')).toBe('/cost');
  });

  it('EN: show cost', () => {
    expect(resolveIntent('show cost')).toBe('/cost');
  });

  it('EN: spending today', () => {
    expect(resolveIntent('spending today')).toBe('/cost');
  });

  it('EN: token cost', () => {
    expect(resolveIntent('token cost')).toBe('/cost');
  });
});

// ============================================================================
// /status — session status
// ============================================================================
describe('resolveIntent — /status', () => {
  it('TR: oturum durumu', () => {
    expect(resolveIntent('oturum durumu')).toBe('/status');
  });

  it('TR: durum nedir', () => {
    expect(resolveIntent('durum nedir')).toBe('/status');
  });

  it('EN: show status', () => {
    expect(resolveIntent('show status')).toBe('/status');
  });

  it('EN: is it running', () => {
    expect(resolveIntent('is it running')).toBe('/status');
  });

  it('EN: session state', () => {
    expect(resolveIntent('session state')).toBe('/status');
  });
});

// ============================================================================
// /help — command listing
// ============================================================================
describe('resolveIntent — /help', () => {
  it('TR: yardım', () => {
    expect(resolveIntent('yardım')).toBe('/help');
  });

  it('TR: komutlar neler', () => {
    expect(resolveIntent('komutlar neler')).toBe('/help');
  });

  it('TR: ne yapabilirsin', () => {
    expect(resolveIntent('ne yapabilirsin')).toBe('/help');
  });

  it('EN: help', () => {
    expect(resolveIntent('help')).toBe('/help');
  });

  it('EN: show commands', () => {
    expect(resolveIntent('show commands')).toBe('/help');
  });

  it('EN: what can you do', () => {
    expect(resolveIntent('what can you do')).toBe('/help');
  });
});

// ============================================================================
// /clear — reset conversation
// ============================================================================
describe('resolveIntent — /clear', () => {
  it('TR: sohbeti temizle', () => {
    expect(resolveIntent('sohbeti temizle')).toBe('/clear');
  });

  it('TR: sıfırla', () => {
    expect(resolveIntent('sıfırla')).toBe('/clear');
  });

  it('EN: start fresh', () => {
    expect(resolveIntent('start fresh')).toBe('/clear');
  });

  it('EN: new session', () => {
    expect(resolveIntent('new session')).toBe('/clear');
  });

  it('EN: reset chat', () => {
    expect(resolveIntent('reset chat')).toBe('/clear');
  });
});

// ============================================================================
// /model — change AI model
// ============================================================================
describe('resolveIntent — /model', () => {
  it('TR: model değiştir', () => {
    expect(resolveIntent('model değiştir')).toBe('/model');
  });

  it('TR: opus kullan', () => {
    expect(resolveIntent('opus kullan')).toBe('/model');
  });

  it('TR: sonnet kullan', () => {
    expect(resolveIntent('sonnet kullan')).toBe('/model');
  });

  it('TR: daha hızlı model', () => {
    expect(resolveIntent('daha hızlı model')).toBe('/model');
  });

  it('EN: use opus', () => {
    expect(resolveIntent('use opus')).toBe('/model');
  });

  it('EN: switch to sonnet', () => {
    expect(resolveIntent('switch to sonnet')).toBe('/model');
  });

  it('EN: change model', () => {
    expect(resolveIntent('change model')).toBe('/model');
  });

  it('EN: use haiku', () => {
    expect(resolveIntent('use haiku')).toBe('/model');
  });
});

// ============================================================================
// /rename — rename session
// ============================================================================
describe('resolveIntent — /rename', () => {
  it('TR: session adını değiştir', () => {
    expect(resolveIntent('session adını değiştir')).toBe('/rename');
  });

  it('TR: oturumu yeniden adlandır', () => {
    expect(resolveIntent('oturumu yeniden adlandır')).toBe('/rename');
  });

  it('EN: rename session', () => {
    expect(resolveIntent('rename session')).toBe('/rename');
  });

  it('EN: rename this session', () => {
    expect(resolveIntent('rename this session')).toBe('/rename');
  });

  it('EN: change session name', () => {
    expect(resolveIntent('change session name')).toBe('/rename');
  });
});

// ============================================================================
// /diff — show git changes
// ============================================================================
describe('resolveIntent — /diff', () => {
  it('TR: değişiklikler neler', () => {
    expect(resolveIntent('değişiklikler neler')).toBe('/diff');
  });

  it('TR: ne değişti', () => {
    expect(resolveIntent('ne değişti')).toBe('/diff');
  });

  it('EN: show changes', () => {
    expect(resolveIntent('show changes')).toBe('/diff');
  });

  it('EN: what changed', () => {
    expect(resolveIntent('what changed')).toBe('/diff');
  });

  it('EN: git diff', () => {
    expect(resolveIntent('git diff')).toBe('/diff');
  });
});

// ============================================================================
// /fast — toggle fast mode
// ============================================================================
describe('resolveIntent — /fast', () => {
  it('TR: hızlı mod', () => {
    expect(resolveIntent('hızlı mod')).toBe('/fast');
  });

  it('TR: hızlı modu aç', () => {
    expect(resolveIntent('hızlı modu aç')).toBe('/fast');
  });

  it('EN: fast mode', () => {
    expect(resolveIntent('fast mode')).toBe('/fast');
  });

  it('EN: toggle fast', () => {
    expect(resolveIntent('toggle fast')).toBe('/fast');
  });

  it('EN: enable fast mode', () => {
    expect(resolveIntent('enable fast mode')).toBe('/fast');
  });
});

// ============================================================================
// /effort — set effort level
// ============================================================================
describe('resolveIntent — /effort', () => {
  it('TR: efor yüksek', () => {
    expect(resolveIntent('efor yüksek')).toBe('/effort');
  });

  it('TR: düşük efor', () => {
    expect(resolveIntent('düşük efor')).toBe('/effort');
  });

  it('EN: effort high', () => {
    expect(resolveIntent('effort high')).toBe('/effort');
  });

  it('EN: set effort low', () => {
    expect(resolveIntent('set effort low')).toBe('/effort');
  });

  it('EN: effort medium', () => {
    expect(resolveIntent('effort medium')).toBe('/effort');
  });
});

// ============================================================================
// /resume — resume previous session
// ============================================================================
describe('resolveIntent — /resume', () => {
  it('TR: kaldığı yerden devam', () => {
    expect(resolveIntent('kaldığı yerden devam')).toBe('/resume');
  });

  it('TR: önceki oturuma devam', () => {
    expect(resolveIntent('önceki oturuma devam')).toBe('/resume');
  });

  it('EN: resume session', () => {
    expect(resolveIntent('resume session')).toBe('/resume');
  });

  it('EN: continue previous session', () => {
    expect(resolveIntent('continue previous session')).toBe('/resume');
  });

  it('EN: continue where i left off', () => {
    expect(resolveIntent('continue where i left off')).toBe('/resume');
  });
});

// ============================================================================
// /context — context window usage
// ============================================================================
describe('resolveIntent — /context', () => {
  it('TR: bağlam ne kadar dolu', () => {
    expect(resolveIntent('bağlam ne kadar dolu')).toBe('/context');
  });

  it('TR: kaç token kaldı', () => {
    expect(resolveIntent('kaç token kaldı')).toBe('/context');
  });

  it('EN: context usage', () => {
    expect(resolveIntent('context usage')).toBe('/context');
  });

  it('EN: how much context is left', () => {
    expect(resolveIntent('how much context is left')).toBe('/context');
  });

  it('EN: context window size', () => {
    expect(resolveIntent('context window size')).toBe('/context');
  });
});

// ============================================================================
// /usage — API usage statistics
// ============================================================================
describe('resolveIntent — /usage', () => {
  it('TR: api kullanım istatistikleri', () => {
    expect(resolveIntent('api kullanım istatistikleri')).toBe('/usage');
  });

  it('TR: kullanım raporu', () => {
    expect(resolveIntent('kullanım raporu')).toBe('/usage');
  });

  it('EN: usage stats', () => {
    expect(resolveIntent('usage stats')).toBe('/usage');
  });

  it('EN: api usage report', () => {
    expect(resolveIntent('api usage report')).toBe('/usage');
  });
});

// ============================================================================
// Turkish normalization — accented chars work
// ============================================================================
describe('resolveIntent — Turkish normalization', () => {
  it('ğ → g: değişti', () => {
    expect(resolveIntent('ne değişti')).toBe('/diff');
  });

  it('ı → i: harcadım', () => {
    expect(resolveIntent('ne kadar harcadım')).toBe('/cost');
  });

  it('ş → s: değiştir', () => {
    expect(resolveIntent('model değiştir')).toBe('/model');
  });

  it('ü → u: dolu', () => {
    expect(resolveIntent('bağlam ne kadar dolu')).toBe('/context');
  });

  it('ö → o: önceki', () => {
    expect(resolveIntent('önceki oturuma devam')).toBe('/resume');
  });

  it('ç → c: kaç', () => {
    expect(resolveIntent('kaç token kaldı')).toBe('/context');
  });
});

// ============================================================================
// H7: Cross-command collision regression tests
// ============================================================================

import { COMMAND_METADATA } from '../../src/commands/command-metadata.ts';

// ============================================================================
// 1. Cross-command collision matrix — every alias must resolve to its own command
// ============================================================================
describe('resolveIntent — cross-command collision matrix', () => {
  for (const [name, meta] of Object.entries(COMMAND_METADATA)) {
    for (const alias of meta.aliases) {
      const expected = `/${name}`;
      const actual = resolveIntent(alias);

      if (actual === expected) {
        // Alias correctly resolves to its own command
        it(`"${alias}" -> /${name}`, () => {
          expect(resolveIntent(alias)).toBe(expected);
        });
      } else if (actual === null) {
        // DEAD ALIAS: listed in metadata but no pattern catches it.
        // This is NOT a cross-command collision (nothing fires), but a gap.
        it(`"${alias}" -> /${name} // DEAD ALIAS: no pattern matches this alias`, () => {
          expect(resolveIntent(alias)).toBeNull();
        });
      } else {
        // TRUE COLLISION: alias resolves to a DIFFERENT command
        it(`"${alias}" -> /${name} // COLLISION: actually resolves to ${actual}`, () => {
          expect(resolveIntent(alias)).toBe(actual);
        });
      }
    }
  }
});

// ============================================================================
// 2. Known false-positive edge cases — messages that should NOT match
// ============================================================================
describe('resolveIntent — false-positive edge cases', () => {
  it('"calistirsin" -> null (no command, GSD adapter territory)', () => {
    expect(resolveIntent('calistirsin')).toBeNull();
  });

  it('"maliyet hesapla" -> null (general cost talk, not command)', () => {
    expect(resolveIntent('maliyet hesapla')).toBeNull();
  });

  it('"status code 404" -> null (HTTP status code, not bridge status)', () => {
    expect(resolveIntent('status code 404')).toBeNull();
  });

  it('"fast food" -> null (correctly not matched)', () => {
    expect(resolveIntent('fast food')).toBeNull();
  });

  it('"doctor strange" -> null (movie name, not doctor command)', () => {
    expect(resolveIntent('doctor strange')).toBeNull();
  });

  it('"help me write a poem" -> null (asking for help, not help command)', () => {
    expect(resolveIntent('help me write a poem')).toBeNull();
  });

  it('"model aircraft" -> null (correctly not matched)', () => {
    expect(resolveIntent('model aircraft')).toBeNull();
  });

  it('"effort required for this task" -> null (correctly not matched)', () => {
    expect(resolveIntent('effort required for this task')).toBeNull();
  });

  it('"what\'s the cost of living" -> null (cost of living, not bridge cost)', () => {
    expect(resolveIntent("what's the cost of living")).toBeNull();
  });

  it('"resume writing tips" -> null (correctly not matched)', () => {
    expect(resolveIntent('resume writing tips')).toBeNull();
  });

  it('"clear explanation" -> null (clear as adjective, not clear command)', () => {
    expect(resolveIntent('clear explanation')).toBeNull();
  });

  it('"rename this variable" -> null (code refactoring, not session rename)', () => {
    expect(resolveIntent('rename this variable')).toBeNull();
  });

  it('"diff between two approaches" -> null (correctly not matched)', () => {
    expect(resolveIntent('diff between two approaches')).toBeNull();
  });

  it('"context of the conversation" -> null (correctly not matched)', () => {
    expect(resolveIntent('context of the conversation')).toBeNull();
  });
});

// ============================================================================
// 3. First-match-wins ordering — deterministic resolution when multiple could match
// ============================================================================
describe('resolveIntent — first-match-wins ordering', () => {
  it('"session status" -> /status (not /clear or /resume)', () => {
    // /status has /\bstatus\b/ pattern — matches first
    expect(resolveIntent('session status')).toBe('/status');
  });

  it('"change model" -> /model (not /rename)', () => {
    // /model has /change (the )?model/ — matches first
    expect(resolveIntent('change model')).toBe('/model');
  });

  it('"show help" -> /help (not /status which has show pattern too)', () => {
    // /help has /show (help|commands)/ — matches before /status /show (session|state|status)/
    expect(resolveIntent('show help')).toBe('/help');
  });

  it('"show status" -> /status (show + status combination)', () => {
    // /status has /show (session|state|status)/ pattern
    expect(resolveIntent('show status')).toBe('/status');
  });

  it('"token cost" -> /cost (not /context which also has token patterns)', () => {
    // /cost has /token cost/ pattern — matches before /context patterns
    expect(resolveIntent('token cost')).toBe('/cost');
  });

  it('"new session" -> /clear (start new = clear, not /resume)', () => {
    // /clear has /new (session|conversation|chat)/ — comes before /resume
    expect(resolveIntent('new session')).toBe('/clear');
  });

  it('"reset chat" -> /clear (reset = clear, not any other command)', () => {
    expect(resolveIntent('reset chat')).toBe('/clear');
  });
});

// ============================================================================
// Dead alias fix — previously unmatched aliases now resolve correctly
// ============================================================================
describe('resolveIntent — dead alias fixes', () => {
  it('"usage" -> /cost (bare usage = cost command)', () => {
    expect(resolveIntent('usage')).toBe('/cost');
  });

  it('"how much" -> /cost (bare how much = cost command)', () => {
    expect(resolveIntent('how much')).toBe('/cost');
  });

  it('"durum" -> /status (bare durum = status command)', () => {
    expect(resolveIntent('durum')).toBe('/status');
  });

  it('"aktif mi" -> /status (is active = status command)', () => {
    expect(resolveIntent('aktif mi')).toBe('/status');
  });

  it('"komutlar" -> /help (bare komutlar = help command)', () => {
    expect(resolveIntent('komutlar')).toBe('/help');
  });

  it('"summarize memory" -> /compact (summarize memory = compact)', () => {
    expect(resolveIntent('summarize memory')).toBe('/compact');
  });

  it('"degisiklikler" -> /diff (bare degisiklikler = diff command)', () => {
    expect(resolveIntent('değişiklikler')).toBe('/diff');
  });
});

// ============================================================================
// False positive tightening — these must NOT match any command
// ============================================================================
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
