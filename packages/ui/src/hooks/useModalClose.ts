import { useEffect, useCallback, type MouseEvent } from 'react';

/**
 * Hook that adds Escape key and backdrop click-to-close for modals.
 *
 * Usage:
 *   const { onBackdropClick } = useModalClose(onClose);
 *   <div className="fixed inset-0 ..." onClick={onBackdropClick}>
 */
export function useModalClose(onClose: () => void) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const onBackdropClick = useCallback(
    (e: MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  return { onBackdropClick };
}
