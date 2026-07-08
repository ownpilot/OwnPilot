/**
 * Lightweight scroll-in-view hook — API-compatible with framer-motion's useInView.
 *
 * Usage: const ref = useRef(null); const isInView = useInView(ref, { once: true });
 */
import { useEffect, useRef, useState, type RefObject } from 'react';

interface UseInViewOptions {
  once?: boolean;
  margin?: string;
  amount?: number | 'some' | 'all';
}

export function useInView<T extends HTMLElement = HTMLDivElement>(
  ref: RefObject<T | null>,
  options: UseInViewOptions = {}
): boolean {
  const [isInView, setIsInView] = useState(false);
  const onceRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || onceRef.current) return;

    const margin = options.margin || '0px';
    const threshold = typeof options.amount === 'number' ? options.amount : 0;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const isVisible = entry?.isIntersecting ?? false;
        if (isVisible && options.once) {
          onceRef.current = true;
          observer.unobserve(el);
        }
        setIsInView(isVisible);
      },
      { rootMargin: margin, threshold }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, options.once, options.margin, options.amount]);

  return isInView;
}
