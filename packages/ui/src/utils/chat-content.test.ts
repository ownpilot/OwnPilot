import { describe, expect, it } from 'vitest';
import {
  cleanStreamingChatContent,
  hideIncompleteStreamingWidgets,
  parseMarkers,
  stripChatInternalTags,
  stripMarkerTags,
} from './chat-content';

describe('chat content cleanup', () => {
  it('strips closed and unclosed suggestions at the end of content', () => {
    expect(
      stripChatInternalTags('Answer\n<suggestions>[{"title":"A","detail":"B"}]</suggestions>')
    ).toBe('Answer');

    expect(stripChatInternalTags('Answer\n<suggestions>[{"title":"A","detail":"B"}]')).toBe(
      'Answer'
    );
  });

  it('strips closed and unclosed memories without leaking following suggestions', () => {
    expect(
      stripChatInternalTags(
        'Answer\n<memories>[{"type":"fact","content":"x"}]</memories>\n<suggestions>[]'
      )
    ).toBe('Answer');

    expect(stripChatInternalTags('Answer\n<memories>[{"type":"fact","content":"x"}]')).toBe(
      'Answer'
    );
  });

  it('hides incomplete widgets while streaming', () => {
    expect(hideIncompleteStreamingWidgets('Before\n<cards data=\'{"items":[{"title":"A"}]')).toBe(
      'Before'
    );
  });

  it('handles paired widget tags while streaming', () => {
    expect(hideIncompleteStreamingWidgets('Before\n<callout data=\'{"title":"A"}\'>')).toBe(
      'Before'
    );

    expect(
      hideIncompleteStreamingWidgets('Before\n<callout data=\'{"title":"A"}\'></callout>\nAfter')
    ).toBe('Before\n<callout data=\'{"title":"A"}\'></callout>\nAfter');
  });

  it('combines internal tag cleanup and streaming widget hiding', () => {
    expect(
      cleanStreamingChatContent(
        'Before\n<widget name="table" data=\'{"headers":["A"],"rows":[["B"]]}\'>'
      )
    ).toBe('Before');

    expect(cleanStreamingChatContent('Answer\n<suggestions>[{"title":"A","detail":"B"}]')).toBe(
      'Answer'
    );
  });
});

describe('parseMarkers', () => {
  it('parses widget markers', () => {
    const { widgets, suggestions } = parseMarkers(
      'Hello\n<!--WIDGET#1#table#{"headers":["A"],"rows":[["B"]]}<!--WIDGET#1#END-->\nWorld'
    );
    expect(widgets).toHaveLength(1);
    expect(widgets[0]!.id).toBe(1);
    expect(widgets[0]!.name).toBe('table');
    expect(widgets[0]!.data).toEqual({ headers: ['A'], rows: [['B']] });
    expect(suggestions).toHaveLength(0);
  });

  it('parses multiple widget markers', () => {
    const { widgets } = parseMarkers(
      '<!--WIDGET#1#metric#{"title":"CPU","value":"95%"}<!--WIDGET#1#END-->\n' +
        'Text\n' +
        '<!--WIDGET#2#table#{"headers":["X"]}<!--WIDGET#2#END-->'
    );
    expect(widgets).toHaveLength(2);
    expect(widgets[0]!.id).toBe(1);
    expect(widgets[1]!.id).toBe(2);
  });

  it('parses suggestion markers', () => {
    const { widgets, suggestions } = parseMarkers(
      'Answer\n<!--SUGGESTIONS#START-->[{"title":"View","detail":"view details"},{"title":"Dismiss","detail":""}]<!--SUGGESTIONS#END-->'
    );
    expect(widgets).toHaveLength(0);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.items).toHaveLength(2);
    expect(suggestions[0]!.items[0]).toEqual({ title: 'View', detail: 'view details' });
    expect(suggestions[0]!.items[1]).toEqual({ title: 'Dismiss', detail: '' });
  });

  it('returns empty for content without markers', () => {
    const { widgets, suggestions } = parseMarkers('Just plain text');
    expect(widgets).toHaveLength(0);
    expect(suggestions).toHaveLength(0);
  });

  it('strips marker tags cleanly', () => {
    expect(
      stripMarkerTags(
        'Text\n<!--WIDGET#1#table#{"x":1}<!--WIDGET#1#END-->\n<!--SUGGESTIONS#START-->[{"title":"A","detail":"B"}]<!--SUGGESTIONS#END-->'
      )
    ).toBe('Text');
  });
});