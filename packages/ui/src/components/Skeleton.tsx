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
export function SkeletonMessage({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3 max-w-3xl mx-auto">
      {Array.from({ length: count }, (_, i) => {
        const isOutgoing = i % 3 === 1;
        return (
          <div key={i} className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`animate-pulse rounded-2xl px-4 py-3 ${
                isOutgoing
                  ? 'bg-primary/20 w-[60%]'
                  : 'bg-bg-tertiary dark:bg-dark-bg-tertiary w-[70%]'
              }`}
            >
              <div className="h-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded w-1/3 mb-2" />
              <div className="space-y-1.5">
                <div className="h-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded w-full" />
                <div className="h-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded w-4/5" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

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
