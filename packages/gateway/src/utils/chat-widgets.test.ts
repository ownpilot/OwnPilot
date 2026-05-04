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

  it('canonicalizes new widget aliases', () => {
    const result = normalizeChatWidgets(
      `<cards data='{"items":[{"title":"A","detail":"B"}]}' />
<steps data='{"items":[{"title":"One","detail":"Do it"}]}' />
<key_value data='{"items":[{"label":"Status","value":"Ready"}]}' />`
    );

    expect(result).toContain('<widget name="cards"');
    expect(result).toContain('<widget name="steps"');
    expect(result).toContain('<widget name="key_value"');
    expect(result).not.toContain('<cards');
    expect(result).not.toContain('<steps');
    expect(result).not.toContain('<key_value');
  });

  it('canonicalizes single-quoted widget JSON with apostrophes inside strings', () => {
    const result = normalizeChatWidgets(
      `<widget name="key_value" data='{"title":"Survival Formula","items":[{"key":"Genclerbirligi","value":"Kasimpasa'yi beat + Trabzonspor'da points stolen -> Play-Out'u skips"},{"key":"Karagumruk","value":"Needs Kayserispor'un loss"}]}' />`
    );

    expect(result).toContain('<widget name="key_value"');
    expect(result).toContain('Survival Formula');
    expect(result).toContain("Kasimpasa'yi beat");
    expect(result).toContain("Trabzonspor'da points");
    expect(result).toContain("Play-Out'u skips");
    expect(result).toContain("Kayserispor'un loss");
    expect(result).not.toContain('Widget could not be rendered');
  });

  it('recovers malformed key-value widgets that use key and value fields', () => {
    const result = normalizeChatWidgets(
      `<widget name="key_value" data='{\\"title\\":\\"Survival Formula\\",\\"items\\":[{\\"key\\":\\"Genclerbirligi\\",\\"value\\":\\"Beat Kasimpasa and steal points from Trabzonspor\\"},{\\"key\\":\\"Kayserispor\\",\\"value\\":\\"Needs at least one away point' />`
    );

    expect(result).toContain('<widget name="key_value"');
    expect(result).toContain('Survival Formula');
    expect(result).toContain('Genclerbirligi');
    expect(result).toContain('Beat Kasimpasa and steal points from Trabzonspor');
    expect(result).toContain('Kayserispor');
    expect(result).toContain('Needs at least one away point');
    expect(result).not.toContain('Widget could not be rendered');
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
