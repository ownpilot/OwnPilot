// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioWidget } from './AudioWidget';

function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(element);
  });
  return container;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('AudioWidget', () => {
  it('renders a single audio item from object with src', () => {
    const container = render(
      <AudioWidget data={{ src: 'https://example.com/audio.mp3', title: 'Podcast' }} />
    );

    const audio = container.querySelector('audio');
    expect(audio).toBeTruthy();
    expect(audio!.getAttribute('src')).toBe('https://example.com/audio.mp3');
    expect(container.textContent).toContain('Podcast');
  });

  it('renders audio with custom controls', () => {
    const container = render(
      <AudioWidget
        data={{
          src: 'https://example.com/audio.mp3',
          controls: true,
          autoplay: false,
          loop: false,
        }}
      />
    );

    const audio = container.querySelector('audio');
    expect(audio).toBeTruthy();
    expect(audio!.controls).toBe(true);
    expect(audio!.autoplay).toBe(false);
    expect(audio!.loop).toBe(false);
  });

  it('blocks unsafe audio URL', () => {
    const container = render(<AudioWidget data={{ src: 'javascript:alert(1)' }} />);

    expect(container.textContent).toContain('Blocked audio URL');
    expect(container.querySelector('audio')).toBeNull();
  });

  it('renders multiple audio items', () => {
    const container = render(
      <AudioWidget
        data={{
          items: [
            { src: 'https://example.com/a.mp3', title: 'Track 1' },
            { src: 'https://example.com/b.mp3', title: 'Track 2' },
          ],
        }}
      />
    );

    const audios = container.querySelectorAll('audio');
    expect(audios.length).toBe(2);
    expect(container.textContent).toContain('Track 1');
    expect(container.textContent).toContain('Track 2');
  });

  it('renders audio from array data directly', () => {
    const container = render(
      <AudioWidget
        data={[
          { src: 'https://example.com/1.mp3' },
          { src: 'https://example.com/2.mp3' },
          { src: 'https://example.com/3.mp3' },
        ]}
      />
    );

    const audios = container.querySelectorAll('audio');
    expect(audios.length).toBe(3);
  });

  it('shows no valid audio warning when items are empty', () => {
    const container = render(<AudioWidget data={{ items: [] }} />);

    expect(container.textContent).toContain('No valid audio files found');
    expect(container.querySelector('audio')).toBeNull();
  });

  it('shows no valid audio warning when data is empty object', () => {
    const container = render(<AudioWidget data={{}} />);

    expect(container.textContent).toContain('No valid audio files found');
  });

  it('shows no valid audio warning when items lack src', () => {
    const container = render(
      <AudioWidget
        data={{
          items: [{ title: 'Missing source' }],
        }}
      />
    );

    expect(container.textContent).toContain('No valid audio files found');
  });

  it('uses title prop when not provided in data', () => {
    const container = render(
      <AudioWidget title="My Podcast" data={{ src: 'https://example.com/episode.mp3' }} />
    );

    expect(container.textContent).toContain('My Podcast');
  });

  it('renders audio item without title', () => {
    const container = render(<AudioWidget data={{ src: 'https://example.com/sound.mp3' }} />);

    const audio = container.querySelector('audio');
    expect(audio).toBeTruthy();
    // No title element should appear
    const titleElements = container.querySelectorAll('.font-medium');
    expect(titleElements.length).toBe(0);
  });
});
