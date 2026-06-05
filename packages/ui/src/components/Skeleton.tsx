/**
 * Skeleton Loaders
 *
 * Content-shaped placeholder components shown during initial data loading.
 * Uses Tailwind's built-in animate-pulse — no extra CSS keyframes needed.
 */

interface SkeletonProps {
  className?: string;
  count?: number;
}

export function Skeleton({ className = '', count = 1 }: SkeletonProps) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={`animate-pulse bg-bg-tertiary dark:bg-dark-bg-tertiary rounded ${className}`}
        />
      ))}
    </>
  );
}

/** Card-like list item skeleton */
export function SkeletonCard({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="animate-pulse p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg"
        >
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded w-3/4" />
              <div className="h-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded w-1/2" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Chat message bubble skeleton */

/** Dashboard stat card skeleton */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="animate-pulse flex items-center gap-3 p-3 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg"
        >
          <div className="w-10 h-10 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg" />
          <div className="space-y-2 flex-1">
            <div className="h-5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded w-12" />
            <div className="h-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}
