// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { VideoWidget } from './VideoWidget';

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

describe('VideoWidget', () => {
  it('renders a single video item from object with src', () => {
    const container = render(
      <VideoWidget data={{ src: 'https://example.com/video.mp4', title: 'Demo' }} />
    );

    const video = container.querySelector('video');
    expect(video).toBeTruthy();
    expect(video!.getAttribute('src')).toBe('https://example.com/video.mp4');
    expect(container.textContent).toContain('Demo');
  });

  it('renders video with custom controls and autoplay', () => {
    const container = render(
      <VideoWidget
        data={{
          src: 'https://example.com/video.mp4',
          controls: true,
          autoplay: true,
          loop: true,
          muted: false,
        }}
      />
    );

    const video = container.querySelector('video');
    expect(video).toBeTruthy();
    expect(video!.controls).toBe(true);
    expect(video!.autoplay).toBe(true);
    expect(video!.loop).toBe(true);
    expect(video!.muted).toBe(false);
  });

  it('blocks unsafe video URL', () => {
    const container = render(<VideoWidget data={{ src: 'javascript:alert(1)' }} />);

    const video = container.querySelector('video');
    expect(video).toBeNull();
    expect(container.textContent).toContain('Blocked video URL');
  });

  it('renders multiple videos from an items array', () => {
    const container = render(
      <VideoWidget
        data={{
          items: [{ src: 'https://example.com/v1.mp4' }, { src: 'https://example.com/v2.mp4' }],
        }}
      />
    );

    const videos = container.querySelectorAll('video');
    expect(videos.length).toBe(2);
    expect(videos[0]?.getAttribute('src')).toBe('https://example.com/v1.mp4');
    expect(videos[1]?.getAttribute('src')).toBe('https://example.com/v2.mp4');
  });

  it('renders multiple videos from a bare array', () => {
    const container = render(
      <VideoWidget
        data={[{ src: 'https://example.com/a.mp4' }, { src: 'https://example.com/b.mp4' }]}
      />
    );

    expect(container.querySelectorAll('video').length).toBe(2);
  });

  it('shows "No valid videos found" when items array has no valid entries', () => {
    const container = render(<VideoWidget data={{ items: [{ poster: 'no-src' }, {}] }} />);

    expect(container.querySelector('video')).toBeNull();
    expect(container.textContent).toContain('No valid videos found');
  });

  it('shows "No valid videos found" for empty object data', () => {
    const container = render(<VideoWidget data={{}} />);

    expect(container.querySelector('video')).toBeNull();
    expect(container.textContent).toContain('No valid videos found');
  });

  it('uses title prop when data has no title', () => {
    const container = render(
      <VideoWidget title="Custom Title" data={{ src: 'https://example.com/v.mp4' }} />
    );

    expect(container.textContent).toContain('Custom Title');
  });

  it('renders with poster image', () => {
    const container = render(
      <VideoWidget
        data={{
          src: 'https://example.com/video.mp4',
          poster: 'https://example.com/poster.jpg',
        }}
      />
    );

    const video = container.querySelector('video');
    expect(video?.getAttribute('poster')).toBe('https://example.com/poster.jpg');
  });

  it('handles null/undefined data gracefully', () => {
    const container = render(<VideoWidget data={null} />);
    expect(container.textContent).toContain('Video');

    const container2 = render(<VideoWidget data={undefined} />);
    expect(container2.textContent).toContain('Video');
  });

  it('sets default video attributes when not provided', () => {
    const container = render(<VideoWidget data={{ src: 'https://example.com/v.mp4' }} />);

    const video = container.querySelector('video');
    expect(video?.muted).toBe(true);
    expect(video?.controls).toBe(true);
    expect(video?.loop).toBe(false);
  });
});
