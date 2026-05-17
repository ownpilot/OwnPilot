import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContextBar } from './ContextBar';

describe('ContextBar', () => {
  it('shows context health, remaining tokens, and accessible progress', () => {
    const html = renderToStaticMarkup(
      <ContextBar
        sessionInfo={{
          sessionId: 'session-1',
          messageCount: 18,
          estimatedTokens: 90_000,
          maxContextTokens: 100_000,
          contextFillPercent: 90,
        }}
        onNewSession={() => undefined}
        onShowDetail={() => undefined}
      />
    );

    expect(html).toContain('18 msgs');
    expect(html).toContain('Near limit');
    expect(html).toContain('10.0K left');
    expect(html).toContain('aria-valuenow="90"');
    expect(html).toContain('Context window usage');
  });

  it('derives fill percent before the API returns session percentage', () => {
    const html = renderToStaticMarkup(
      <ContextBar
        sessionInfo={{
          sessionId: 'session-1',
          messageCount: 4,
          estimatedTokens: 32_000,
          maxContextTokens: 128_000,
          contextFillPercent: 0,
        }}
        onNewSession={() => undefined}
        onShowDetail={() => undefined}
      />
    );

    expect(html).toContain('25%');
    expect(html).toContain('96.0K left');
  });

  it('keeps prompt-cache visibility when usage includes cached tokens', () => {
    const html = renderToStaticMarkup(
      <ContextBar
        sessionInfo={{
          sessionId: 'session-1',
          messageCount: 12,
          estimatedTokens: 40_000,
          maxContextTokens: 100_000,
          contextFillPercent: 40,
          cachedTokens: 8_000,
        }}
        onNewSession={() => undefined}
        onShowDetail={() => undefined}
      />
    );

    expect(html).toContain('8.0K cached');
  });
});
