/**
 * Modal — shared shell for centered dialogs.
 *
 * Owns the backdrop (with backdrop-click + Escape close via useModalClose),
 * the panel, the bordered header, the scrollable body, and an optional
 * footer. MultiStepModal composes this with step tabs + nav buttons; plain
 * dialogs use it directly instead of copying the wrapper markup.
 *
 * Deliberately minimal: exotic dialogs (full-height viewers, forms that wrap
 * body+footer in a <form>, animated popovers) should keep their own markup
 * rather than grow this primitive.
 */

import type { ReactNode } from 'react';
import { useModalClose } from '../hooks';

const SIZE_CLASSES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
} as const;

export interface ModalProps {
  onClose: () => void;
  /** Header title (h3). Omit together with headerContent for a headerless body. */
  title?: ReactNode;
  /** Extra header content below the title (e.g. filter chips, step tabs). */
  headerContent?: ReactNode;
  /** Panel width preset. Defaults to '2xl'. */
  size?: keyof typeof SIZE_CLASSES;
  /** Footer content. Rendered right-aligned by default (footerClassName overrides). */
  footer?: ReactNode;
  footerClassName?: string;
  /** Override the body wrapper classes (default: scrollable with p-6). */
  bodyClassName?: string;
  children: ReactNode;
}

export function Modal({
  onClose,
  title,
  headerContent,
  size = '2xl',
  footer,
  footerClassName,
  bodyClassName,
  children,
}: ModalProps) {
  const { onBackdropClick } = useModalClose(onClose);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onBackdropClick}
    >
      <div
        className={`w-full ${SIZE_CLASSES[size]} bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col`}
      >
        {(title || headerContent) && (
          <div className="p-4 border-b border-border dark:border-dark-border">
            {title && (
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                {title}
              </h3>
            )}
            {headerContent}
          </div>
        )}

        <div className={bodyClassName ?? 'flex-1 overflow-y-auto p-6'}>{children}</div>

        {footer && (
          <div
            className={
              footerClassName ??
              'p-4 border-t border-border dark:border-dark-border flex justify-end gap-2'
            }
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
