import { describe, expect, it } from 'vitest';
import { normalizeChatWidgets } from './chat-widgets.js';

describe('normalizeChatWidgets', () => {
  it('canonicalizes shorthand list widgets', () => {
    const result = normalizeChatWidgets(`<list data='{"items":[{"title":"A","detail":"B"}]}' />`);

    expect(result).toContain('<widget name="list"');
    expect(result).toContain('&quot;title&quot;:&quot;A&quot;');
    expect(result).not.toContain('<list');
  });

  it('canonicalizes paired widget tags', () => {
    const result = normalizeChatWidgets(
      `<widget name="callout" data='{"title":"Notice","body":"Ready"}'></widget>
<callout data='{"title":"Inline","body":"Paired shorthand"}'></callout>`
    );

    expect(result).toContain('<widget name="callout"');
    expect(result).toContain('Notice');
    expect(result).toContain('Ready');
    expect(result).toContain('Inline');
    expect(result).toContain('Paired shorthand');
    expect(result).not.toContain('</widget>');
    expect(result).not.toContain('</callout>');
  });

  it('canonicalizes paired widget tags with JSON body data', () => {
    const result = normalizeChatWidgets(
      `<widget name="callout">{"title":"Body Notice","body":"Body payload"}</widget>
<callout>{"title":"Body Inline","body":"Shorthand body"}</callout>`
    );

    expect(result).toContain('<widget name="callout"');
    expect(result).toContain('Body Notice');
    expect(result).toContain('Body payload');
    expect(result).toContain('Body Inline');
    expect(result).toContain('Shorthand body');
    expect(result).not.toContain('</widget>');
    expect(result).not.toContain('</callout>');
  });

  it('canonicalizes JSX-style unquoted widget attributes', () => {
    const result = normalizeChatWidgets(
      `<widget name=callout data={"title":"JSX Notice","body":"Unquoted payload"} />
<callout data={"title":"JSX Shorthand","body":"Balanced data"} />`
    );

    expect(result).toContain('<widget name="callout"');
    expect(result).toContain('JSX Notice');
    expect(result).toContain('Unquoted payload');
    expect(result).toContain('JSX Shorthand');
    expect(result).toContain('Balanced data');
    expect(result).not.toContain('data={');
    expect(result).not.toContain('Invalid widget data');
  });

  it('does not end widget tags on markers inside quoted data strings', () => {
    const result = normalizeChatWidgets(
      `<callout data='{"title":"Operators","body":"Use a > b and keep literal /> markers"}' />
<widget name="callout" data='{"title":"Paired","body":"Body has > and /> safely"}'></widget>`
    );

    expect(result).toContain('<widget name="callout"');
    expect(result).toContain('Operators');
    expect(result).toContain('Use a &gt; b and keep literal /&gt; markers');
    expect(result).toContain('Paired');
    expect(result).toContain('Body has &gt; and /&gt; safely');
    expect(result).not.toContain('Invalid widget data');
  });

  it('does not normalize widget examples inside fenced code blocks', () => {
    const result = normalizeChatWidgets(`Before

\`\`\`html
<widget name="callout" data='{"title":"Example","body":"Do not normalize"}' />
\`\`\`

<callout data='{"title":"Live","body":"Normalize this"}' />`);

    expect(result).toContain(
      `<widget name="callout" data='{"title":"Example","body":"Do not normalize"}' />`
    );
    expect(result).toContain('<widget name="callout" data="{&quot;title&quot;:&quot;Live&quot;');
    expect(result).toContain('Normalize this');
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

  it('recovers malformed table widgets with object rows', () => {
    const result = normalizeChatWidgets(
      `<table data='{\\"columns\\":[\\"Company\\",\\"Risk\\"],\\"rows\\":[{\\"Company\\":\\"AMD\\",\\"Risk\\":\\"High\\"},{\\"Company\\":\\"SK Hynix\\",\\"Risk\\":\\"Medium' />`
    );

    expect(result).toContain('<widget name="table"');
    expect(result).toContain('Company');
    expect(result).toContain('Risk');
    expect(result).toContain('AMD');
    expect(result).toContain('SK Hynix');
    expect(result).toContain('Medium');
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

  it('repairs balanced widget JSON when only closing containers are missing', () => {
    const result = normalizeChatWidgets(
      `<metric_grid data='{"items":[{"label":"Total","value":"12"},{"label":"Open","value":"3"}' />`
    );

    expect(result).toContain('<widget name="metric_grid"');
    expect(result).toContain('Total');
    expect(result).toContain('Open');
    expect(result).toContain('&quot;value&quot;:&quot;3&quot;');
    expect(result).not.toContain('Widget could not be rendered');
    expect(result).not.toContain('Invalid widget data');
  });

  it('normalizes valid widget data with schema aliases', () => {
    const result = normalizeChatWidgets(
      `<metric_grid data='{"metrics":[{"label":"Total","value":"12"}]}' />
<key_value data='{"title":"Snapshot","Owner":"OwnPilot","Open":3}' />`
    );

    expect(result).toContain('<widget name="metric_grid"');
    expect(result).toContain('&quot;items&quot;:[{&quot;label&quot;:&quot;Total&quot;');
    expect(result).toContain('<widget name="key_value"');
    expect(result).toContain('&quot;key&quot;:&quot;Owner&quot;');
    expect(result).toContain('&quot;value&quot;:&quot;OwnPilot&quot;');
    expect(result).toContain('&quot;key&quot;:&quot;Open&quot;');
    expect(result).toContain('&quot;value&quot;:3');
    expect(result).not.toContain('Invalid widget data');
  });

  it('normalizes valid table data with row and column aliases', () => {
    const result = normalizeChatWidgets(
      `<table data='{"columns":["Company","Risk"],"items":[{"Company":"AMD","Risk":"High"}]}' />`
    );

    expect(result).toContain('<widget name="table"');
    expect(result).toContain('&quot;headers&quot;:[&quot;Company&quot;,&quot;Risk&quot;]');
    expect(result).toContain('&quot;rows&quot;:[{&quot;Company&quot;:&quot;AMD&quot;');
    expect(result).toContain('&quot;Risk&quot;:&quot;High&quot;');
    expect(result).not.toContain('Invalid widget data');
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

  it('recovers malformed metric, progress, chart, and timeline widgets', () => {
    const result = normalizeChatWidgets(
      `<metric_grid data='{\\"items\\":[{\\"label\\":\\"Total\\",\\"value\\":\\"12\\"},{\\"label\\":\\"Open\\",\\"value\\":' />
<progress data='{\\"label\\":\\"Setup\\",\\"value\\":' />
<bar_chart data='{\\"items\\":[{\\"label\\":\\"Done\\",\\"value\\":8},{\\"label\\":\\"Waiting\\",\\"value\\":' />
<timeline data='{\\"items\\":[{\\"time\\":\\"09:00\\",\\"label\\":\\"Plan\\",\\"detail\\":\\"Start\\"},{\\"time\\":\\"10:00\\",\\"label\\":\\"Review' />`
    );

    expect(result).toContain('<widget name="metric_grid"');
    expect(result).toContain('Total');
    expect(result).toContain('Setup');
    expect(result).toContain('<widget name="progress"');
    expect(result).toContain('<widget name="bar_chart"');
    expect(result).toContain('Done');
    expect(result).toContain('<widget name="timeline"');
    expect(result).toContain('09:00');
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

  it('falls back to a callout when generic text can be recovered', () => {
    const result = normalizeChatWidgets(
      `<progress data='{\\"message\\":\\"Only part of the widget arrived\\",\\"value\\":' />`
    );

    expect(result).toContain('<widget name="callout"');
    expect(result).toContain('Recovered widget content');
    expect(result).toContain('Only part of the widget arrived');
    expect(result).not.toContain('Widget could not be rendered');
    expect(result).not.toContain('Invalid widget data');
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
