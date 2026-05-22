import { describe, expect, it } from 'vitest';
import { normalizeChatWidgets, flattenChatWidgetsToText } from './chat-widgets.js';

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

  it('normalizes widget type aliases and single-item key-value/card payloads', () => {
    const result = normalizeChatWidgets(
      `<widget type="key_value" data='{"key":"Status","value":"Ready"}' />
<widget type="cards" data='{"title":"Fast path","detail":"Render as a card"}' />`
    );

    expect(result).toContain('<widget name="key_value"');
    expect(result).toContain('&quot;items&quot;:[{&quot;key&quot;:&quot;Status&quot;');
    expect(result).toContain('&quot;value&quot;:&quot;Ready&quot;');
    expect(result).toContain('<widget name="cards"');
    expect(result).toContain('&quot;items&quot;:[{&quot;title&quot;:&quot;Fast path&quot;');
    expect(result).toContain('Render as a card');
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

describe('flattenChatWidgetsToText', () => {
  it('flattens metric_grid to bullet list with labels and values', () => {
    const result = flattenChatWidgetsToText(
      `Report:\n<widget name="metric_grid" data='{"items":[{"label":"Total","value":"28","detail":"0 active"},{"label":"Cost","value":"$0.00"}]}' />`
    );
    expect(result).not.toContain('<widget');
    expect(result).toContain('Total');
    expect(result).toContain('28');
    expect(result).toContain('0 active');
    expect(result).toContain('Cost');
    expect(result).toContain('$0.00');
  });

  it('renders table widget as markdown table', () => {
    const result = flattenChatWidgetsToText(
      `<widget name="table" data='{"headers":["Category","Count"],"rows":[["Sport",7],["Health",4]]}' />`
    );
    expect(result).not.toContain('<widget');
    expect(result).toContain('| Category | Count |');
    expect(result).toContain('| --- | --- |');
    expect(result).toContain('| Sport | 7 |');
    expect(result).toContain('| Health | 4 |');
  });

  it('renders key_value widget as bullet list of Key: Value pairs', () => {
    const result = flattenChatWidgetsToText(
      `<widget name="key_value" data='{"items":[{"key":"Status","value":"Ready"},{"key":"Owner","value":"Chat"}]}' />`
    );
    expect(result).not.toContain('<widget');
    expect(result).toContain('**Status:** Ready');
    expect(result).toContain('**Owner:** Chat');
  });

  it('renders callout as title + body', () => {
    const result = flattenChatWidgetsToText(
      `<widget name="callout" data='{"title":"Notice","body":"Ready to ship"}' />`
    );
    expect(result).not.toContain('<widget');
    expect(result).toContain('**Notice**');
    expect(result).toContain('Ready to ship');
  });

  it('renders steps as numbered list with titles and details', () => {
    const result = flattenChatWidgetsToText(
      `<widget name="steps" data='{"items":[{"title":"Plan","detail":"Outline the work"},{"title":"Ship","detail":"Deploy it"}]}' />`
    );
    expect(result).not.toContain('<widget');
    expect(result).toContain('1. **Plan** — Outline the work');
    expect(result).toContain('2. **Ship** — Deploy it');
  });

  it('renders bar_chart as bullet list of label: value', () => {
    const result = flattenChatWidgetsToText(
      `<widget name="bar_chart" data='{"items":[{"label":"Tasks","value":5},{"label":"Habits","value":3}]}' />`
    );
    expect(result).not.toContain('<widget');
    expect(result).toContain('Tasks: 5');
    expect(result).toContain('Habits: 3');
  });

  it('renders timeline as time — label: detail lines', () => {
    const result = flattenChatWidgetsToText(
      `<widget name="timeline" data='{"items":[{"time":"09:00","label":"Plan","detail":"Weekly goals"}]}' />`
    );
    expect(result).not.toContain('<widget');
    expect(result).toContain('09:00');
    expect(result).toContain('Plan');
    expect(result).toContain('Weekly goals');
  });

  it('renders progress as Label: value/max', () => {
    const result = flattenChatWidgetsToText(
      `<widget name="progress" data='{"label":"Onboarding","value":4,"max":10}' />`
    );
    expect(result).not.toContain('<widget');
    expect(result).toContain('Onboarding: 4/10');
  });

  it('renders cards as title + description pairs', () => {
    const result = flattenChatWidgetsToText(
      `<widget name="cards" data='{"items":[{"title":"Fast path","description":"Use when clear"},{"title":"Risk","description":"Escalate if unclear"}]}' />`
    );
    expect(result).not.toContain('<widget');
    expect(result).toContain('**Fast path** — Use when clear');
    expect(result).toContain('**Risk** — Escalate if unclear');
  });

  it('strips JSX-style widgets too', () => {
    const result = flattenChatWidgetsToText(
      `<metric_grid data='{"items":[{"label":"A","value":"1"}]}' />`
    );
    expect(result).not.toContain('<metric_grid');
    expect(result).not.toContain('<widget');
    expect(result).toContain('A');
    expect(result).toContain('1');
  });

  it('preserves surrounding markdown text', () => {
    const result = flattenChatWidgetsToText(
      `Before the widget.\n<widget name="callout" data='{"body":"middle"}' />\nAfter the widget.`
    );
    expect(result).toContain('Before the widget.');
    expect(result).toContain('After the widget.');
    expect(result).toContain('middle');
    expect(result).not.toContain('<widget');
  });

  it('preserves widget-like content inside fenced code blocks', () => {
    const result = flattenChatWidgetsToText(
      'Example:\n```\n<widget name="callout" data=\'{"body":"docs"}\' />\n```'
    );
    expect(result).toContain('```');
    expect(result).toContain('<widget name="callout"');
  });

  it('drops the tag entirely when widget data is unrecoverable', () => {
    const result = flattenChatWidgetsToText(
      `Hello.\n<widget name="metric_grid" data='not json at all' />\nWorld.`
    );
    // Should not leak raw XML; the parser recovers an invalid-fallback
    // callout that produces no useful text and gets dropped.
    expect(result).not.toContain('<widget');
    expect(result).toContain('Hello.');
    expect(result).toContain('World.');
  });

  it('handles multiple widgets in one message', () => {
    const result = flattenChatWidgetsToText(
      `<widget name="metric_grid" data='{"items":[{"label":"A","value":"1"}]}' />\nSummary text.\n<widget name="key_value" data='{"items":[{"key":"K","value":"V"}]}' />`
    );
    expect(result).not.toContain('<widget');
    expect(result).toContain('A');
    expect(result).toContain('Summary text.');
    expect(result).toContain('**K:** V');
  });
});
