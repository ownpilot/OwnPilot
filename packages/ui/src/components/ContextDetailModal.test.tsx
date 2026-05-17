import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContextDetailModal } from './ContextDetailModal';

describe('ContextDetailModal', () => {
  it('summarizes remaining context and recommends compacting near the limit', () => {
    const html = renderToStaticMarkup(
      <ContextDetailModal
        sessionInfo={{
          sessionId: 'session-1',
          messageCount: 42,
          estimatedTokens: 92_000,
          maxContextTokens: 100_000,
          contextFillPercent: 92,
          cachedTokens: 12_000,
        }}
        provider="openai"
        model="gpt-test"
        onClose={() => undefined}
        onCompact={async () => undefined}
        onClear={() => undefined}
      />
    );

    expect(html).toContain('92% used');
    expect(html).toContain('8.0K left');
    expect(html).toContain('Free (8.0K)');
    expect(html).toContain('Near limit');
    expect(html).toContain('Compact this session');
    expect(html).toContain('12.0K tokens served from prompt cache');
    expect(html).toContain('aria-valuenow="92"');
  });
});
