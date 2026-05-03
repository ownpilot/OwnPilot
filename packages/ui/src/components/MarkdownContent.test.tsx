import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownContent, hideIncompleteStreamingWidgets } from './MarkdownContent';

describe('MarkdownContent', () => {
  it('renders GitHub-style markdown tables as HTML tables', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={`| Team | Pts | Form |
|---|---:|:---:|
| **Galatasaray** | 81 | GGG |
| Fenerbahce | 73 | BGB |`}
      />
    );

    expect(html).toContain('<table');
    expect(html).toContain('<th');
    expect(html).toContain('<td');
    expect(html).toContain('<strong>Galatasaray</strong>');
    expect(html).not.toContain('|---|---:|:---:|');
  });

  it('renders model-style pipe tables with loose separators', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={`| Priority | Task | Why |
|-|-|-|
| 🔴 1 | **Harcamaları kaydet** | Daily habit |
| 🟡 2 | Haftalık hedef belirle | Planning |`}
      />
    );

    expect(html).toContain('<table');
    expect(html).toContain('Priority');
    expect(html).toContain('<strong>Harcamaları kaydet</strong>');
    expect(html).not.toContain('|-|-|-|');
  });

  it('renders common markdown blocks outside code fences', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={`## Summary

- First item
- Second item

\`\`\`md
| raw | table |
|---|---|
\`\`\``}
      />
    );

    expect(html).toContain('<h3');
    expect(html).toContain('<ul');
    expect(html).toContain('<li>First item</li>');
    expect(html).toContain('| raw | table |');
  });

  it('renders standalone widget tags outside code fences', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={`Before

<widget name="metric_grid" data='{"items":[{"label":"Puan","value":"81","detail":"+52"},{"label":"Sıra","value":"1"}]}' />

After`}
      />
    );

    expect(html).toContain('Puan');
    expect(html).toContain('+52');
    expect(html).toContain('Sıra');
    expect(html).not.toContain('<widget');
  });

  it('renders html-escaped widget data produced by models', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={`<widget name="table" data="{&quot;headers&quot;:[&quot;#&quot;,&quot;Task&quot;],&quot;rows&quot;:[[&quot;1&quot;,&quot;Log today&apos;s expenses&quot;],[&quot;2&quot;,&quot;Haftalık hedef&quot;]]}" />`}
      />
    );

    expect(html).toContain('<table');
    expect(html).toContain('Log today&#x27;s expenses');
    expect(html).toContain('Haftalık hedef');
    expect(html).not.toContain('<widget');
  });

  it('renders widget tags even when they appear inside a paragraph chunk', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={`Before <widget name="callout" data='{"title":"Durum","body":"Render edildi"}' /> after`}
      />
    );

    expect(html).toContain('Durum');
    expect(html).toContain('Render edildi');
    expect(html).toContain('Before');
    expect(html).toContain('after');
  });

  it('renders shorthand widget tags produced by models', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={`<callout data='{"type":"info","title":"Haftanın en kritik maçı","body":"Başakşehir - Trabzonspor maçı önemli."}' />`}
      />
    );

    expect(html).toContain('Haftanın en kritik maçı');
    expect(html).toContain('Başakşehir - Trabzonspor maçı önemli.');
    expect(html).not.toContain('<callout');
  });

  it('renders backslash-escaped widget JSON produced inside attributes', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={`<list data="{\\"items\\":[{\\"title\\":\\"En kritik mac\\",\\"detail\\":\\"Basaksehir vs Trabzonspor\\"},{\\"title\\":\\"En cekici mac\\",\\"detail\\":\\"Galatasaray vs Samsunspor\\"}]}" />`}
      />
    );

    expect(html).toContain('En kritik mac');
    expect(html).toContain('Basaksehir vs Trabzonspor');
    expect(html).toContain('En cekici mac');
    expect(html).not.toContain('Invalid widget data');
  });

  it('recovers completed list items from truncated widget JSON', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={`<list data='{\\"items\\":[{\\"title\\":\\"En kritik mac\\",\\"detail\\":\\"Basaksehir vs Trabzonspor\\"},{\\"title\\":\\"En riskli tahmin\\",\\"detail\\":\\"Trabzonspor formda olmasina ragmen' />`}
      />
    );

    expect(html).toContain('En kritik mac');
    expect(html).toContain('Basaksehir vs Trabzonspor');
    expect(html).not.toContain('Invalid widget data');
  });

  it('hides incomplete shorthand widget tags while streaming', () => {
    const partial = hideIncompleteStreamingWidgets(
      `Before

<callout data='{"type":"info","title":"Eksik"`
    );

    expect(partial).toBe('Before');
  });

  it('renders chart and timeline widgets', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={`<widget name="bar_chart" data='{"items":[{"label":"Tasks","value":5},{"label":"Habits","value":3}]}' />

<widget name="timeline" data='{"items":[{"time":"09:00","label":"Plan","detail":"Weekly goals"},{"time":"18:00","label":"Review","status":"success"}]}' />`}
      />
    );

    expect(html).toContain('Tasks');
    expect(html).toContain('Habits');
    expect(html).toContain('09:00');
    expect(html).toContain('Weekly goals');
  });

  it('does not render widget tags inside code fences', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        content={`\`\`\`html
<widget name="callout" data='{"body":"Do not render"}' />
\`\`\``}
      />
    );

    expect(html).toContain('language-html');
    expect(html).toContain('widget');
    expect(html).not.toContain('<section');
  });

  it('hides incomplete streaming widget tags until the tag is complete', () => {
    const partial = hideIncompleteStreamingWidgets(
      `Before

<widget name="table" data='{"headers":["Task"],"rows":[["One"]]}'`
    );

    expect(partial).toBe('Before');

    const complete = hideIncompleteStreamingWidgets(
      `Before

<widget name="table" data='{"headers":["Task"],"rows":[["One"]]}' />`
    );

    expect(complete).toContain('<widget');

    const html = renderToStaticMarkup(<MarkdownContent content={complete} />);
    expect(html).toContain('<table');
    expect(html).toContain('One');
    expect(html).not.toContain('<widget');
  });

  it('does not hide widget-like text while streaming code fences', () => {
    const content = `\`\`\`html
<widget name="callout" data='{"body":"Shown as code"}'
\`\`\``;

    expect(hideIncompleteStreamingWidgets(content)).toBe(content);
  });
});
