import { describe, expect, it } from 'vitest';
import {
  cleanStreamingChatContent,
  hideIncompleteStreamingWidgets,
  stripChatInternalTags,
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
