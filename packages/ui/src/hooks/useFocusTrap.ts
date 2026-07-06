/**
 * useFocusTrap — Traps keyboard focus within a container element.
 *
 * Moves focus to the first focusable element on mount, traps Tab cycling,
 * and optionally restores focus to the previously active element on unmount.
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useFocusTrap(ref, isOpen);
 *   <div ref={ref}>...</div>
 */

import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function useFocusTrap(
  containerRef: React.RefObject<HTMLDivElement | null>,
  isActive: boolean
) {
  const previousActiveRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!isActive) return;

    // Store the previously focused element for restoration
    previousActiveRef.current = document.activeElement;

    const container = containerRef.current;
    if (!container) return;

    // Focus the first focusable element inside the container
    const focusableElements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusableElements.length > 0) {
      focusableElements[0]!.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !container) return;

      const elements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (elements.length === 0) {
        e.preventDefault();
        return;
      }

      const firstEl = elements[0]!;
      const lastEl = elements[elements.length - 1]!;

      if (e.shiftKey) {
        // Shift+Tab: if focus is on first element, wrap to last
        if (document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        // Tab: if focus is on last element, wrap to first
        if (document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);

      // Restore focus to the element that triggered the modal
      // Use a microtask to avoid conflicts with other unmount handlers
      const previous = previousActiveRef.current;
      if (previous instanceof HTMLElement) {
        queueMicrotask(() => previous.focus());
      }
    };
  }, [containerRef, isActive]);
}
