import { describe, expect, it } from 'vitest';
import { normalizeChatWidgets } from './chat-widgets.js';

describe('normalizeChatWidgets', () => {
  it('canonicalizes shorthand list widgets', () => {
    const result = normalizeChatWidgets(`<list data='{"items":[{"title":"A","detail":"B"}]}' />`);

    expect(result).toContain('<widget name="list"');
    expect(result).toContain('&quot;title&quot;:&quot;A&quot;');
    expect(result).not.toContain('<list');
  });

  it('recovers list items that use description and truncated escaped JSON', () => {
    const result = normalizeChatWidgets(
      `<list data="{\\"items\\":[{\\"title\\":\\"AMD disproportionate hit\\",\\"description\\":\\"SK Hynix prioritizes Nvidia + OpenAI\\"},{\\"title\\":\\"broken" />`
    );

    expect(result).toContain('<widget name="list"');
    expect(result).toContain('AMD disproportionate hit');
    expect(result).toContain('SK Hynix prioritizes Nvidia + OpenAI');
    expect(result).not.toContain('Invalid widget data');
    expect(result).not.toContain('raw');
  });

  it('recovers malformed table widgets', () => {
    const result = normalizeChatWidgets(
      `<table data='{\\"headers\\":[\\"Company\\",\\"Risk\\"],\\"rows\\":[[\\"AMD\\",\\"High\\"],[\\"SK Hynix\\",\\"Medium\\"]' />`
    );

    expect(result).toContain('<widget name="table"');
    expect(result).toContain('Company');
    expect(result).toContain('SK Hynix');
    expect(result).not.toContain('Invalid widget data');
  });

  it('turns unrecoverable widgets into a safe callout payload', () => {
    const result = normalizeChatWidgets(`<progress data='{"value":' />`);

    expect(result).toContain('<widget name="callout"');
    expect(result).toContain('Widget could not be rendered');
    expect(result).not.toContain('{"value":');
    expect(result).not.toContain('raw');
  });

  it('keeps canonical valid widget data stable', () => {
    const result = normalizeChatWidgets(
      `<widget name="callout" data='{"title":"Notice","body":"Ready"}' />`
    );

    expect(result).toContain('<widget name="callout"');
    expect(result).toContain('Notice');
    expect(result).toContain('Ready');
  });
});
