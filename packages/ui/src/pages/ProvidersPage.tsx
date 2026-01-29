import { ProvidersTab } from '../components/ProvidersTab';

export function ProvidersPage() {
  return (
    <div className="flex flex-col h-full">
      <header className="px-6 pt-4 pb-4 border-b border-border dark:border-dark-border">
        <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
          Providers
        </h2>
        <p className="text-sm text-text-muted dark:text-dark-text-muted">
          Manage AI providers and their configurations
        </p>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <ProvidersTab />
      </div>
    </div>
  );
}
