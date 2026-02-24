export function StatCard({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
      <div className="text-primary">{icon}</div>
      <div>
        <div className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
          {value}
        </div>
        <div className="text-xs text-text-muted dark:text-dark-text-muted">{label}</div>
      </div>
    </div>
  );
}
