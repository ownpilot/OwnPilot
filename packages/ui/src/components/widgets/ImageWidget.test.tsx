// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ImageWidget } from './ImageWidget';

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

describe('ImageWidget', () => {
  it('renders a single image from string data', () => {
    const container = render(<ImageWidget data="https://example.com/image.png" />);

    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toBe('https://example.com/image.png');
  });

  it('renders a single image from object data with src and alt', () => {
    const container = render(
      <ImageWidget
        data={{ src: 'https://example.com/photo.jpg', alt: 'A photo', title: 'Photo Title' }}
      />
    );

    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toBe('https://example.com/photo.jpg');
    expect(img!.getAttribute('alt')).toBe('A photo');
    expect(container.textContent).toContain('Photo Title');
  });

  it('renders multiple images as a grid', () => {
    const container = render(
      <ImageWidget
        title="Gallery"
        data={{
          items: [
            { src: 'https://example.com/img1.png', alt: 'First' },
            { src: 'https://example.com/img2.png', alt: 'Second' },
          ],
        }}
      />
    );

    const images = container.querySelectorAll('img');
    expect(images.length).toBe(2);
    expect(container.textContent).toContain('Gallery');
  });

  it('renders image with caption', () => {
    const container = render(
      <ImageWidget data={{ src: 'https://example.com/img.png', caption: 'Beautiful landscape' }} />
    );

    expect(container.textContent).toContain('Beautiful landscape');
  });

  it('shows blocked image URL fallback for unsafe data', () => {
    const container = render(<ImageWidget data={{ src: 'javascript:alert(1)' }} />);

    expect(container.textContent).toContain('Blocked image URL');
  });

  it('shows failed to load fallback after image error event', () => {
    const container = render(<ImageWidget data={{ src: 'https://example.com/nonexistent.png' }} />);

    const img = container.querySelector('img');
    expect(img).toBeTruthy();

    // Trigger error event
    act(() => {
      img!.dispatchEvent(new Event('error'));
    });

    expect(container.textContent).toContain('Failed to load');
  });

  it('shows no valid images warning when items are empty', () => {
    const container = render(<ImageWidget data={{ items: [] }} />);

    expect(container.textContent).toContain('No valid images found');
  });

  it('shows no valid images warning when data is empty object', () => {
    const container = render(<ImageWidget data={{}} />);

    expect(container.textContent).toContain('No valid images found');
  });

  it('renders images from array data directly', () => {
    const container = render(
      <ImageWidget
        data={[
          { src: 'https://example.com/a.png' },
          { src: 'https://example.com/b.png' },
          { src: 'https://example.com/c.png' },
        ]}
      />
    );

    const images = container.querySelectorAll('img');
    expect(images.length).toBe(3);
  });

  it('displays spinner before image loads', () => {
    const container = render(
      <ImageWidget data={{ src: 'https://example.com/img.png', lazy: true }} />
    );

    // Before load, there should be a spinner element
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('shows image loaded state after onLoad', () => {
    const container = render(<ImageWidget data={{ src: 'https://example.com/img.png' }} />);

    const img = container.querySelector('img');
    act(() => {
      img!.dispatchEvent(new Event('load'));
    });

    // After load, spinner should be gone and image should be visible
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
});
