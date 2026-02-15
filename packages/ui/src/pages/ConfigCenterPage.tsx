import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Globe,
  Key,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Search,
  RefreshCw,
  Server,
  X,
  Edit2,
} from '../components/icons';
import { ConfigureServiceModal } from '../components/ConfigureServiceModal';
import { useDialog } from '../components/ConfirmDialog';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { configServicesApi } from '../api';
import { useToast } from '../components/ToastProvider';
import type { ConfigEntryView, ConfigServiceView, ConfigServiceStats } from '../api';


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_PALETTE = [
  'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getCategoryColor(category: string): string {
  return CATEGORY_PALETTE[hashString(category) % CATEGORY_PALETTE.length]!;
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export function ConfigCenterPage() {
  const { confirm } = useDialog();
  const toast = useToast();

  // Data state
  const [services, setServices] = useState<ConfigServiceView[]>([]);
  const [stats, setStats] = useState<ConfigServiceStats | null>(null);
  const [categories, setCategories] = useState<string[]>([]);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Modal state
  const [editingService, setEditingService] = useState<ConfigServiceView | null>(null);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [entryFormValues, setEntryFormValues] = useState<Record<string, unknown>>({});
  const [entryLabel, setEntryLabel] = useState('');
  const [entryIsActive, setEntryIsActive] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Track which fields the user has actually modified (for secret masking)
  const dirtyFieldsRef = useRef<Set<string>>(new Set());

  // ----------------------------------
  // Data fetching
  // ----------------------------------

  const fetchServices = useCallback(async () => {
    try {
      const data = await configServicesApi.list();
      setServices(data.services);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load services');
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const data = await configServicesApi.stats();
      setStats(data);
    } catch {
      // Stats are non-critical
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const data = await configServicesApi.categories();
      setCategories(data.categories);
    } catch {
      // Categories are non-critical
    }
  }, []);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    await Promise.all([fetchServices(), fetchStats(), fetchCategories()]);
    setIsLoading(false);
  }, [fetchServices, fetchStats, fetchCategories]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ----------------------------------
  // Filtering & sorting
  // ----------------------------------

  const filteredServices = services
    .filter((service) => {
      const matchesSearch =
        !searchQuery ||
        service.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        service.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (service.description ?? '')
          .toLowerCase()
          .includes(searchQuery.toLowerCase());

      const matchesCategory =
        selectedCategory === 'all' || service.category === selectedCategory;

      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => {
      // Priority: needed-but-unconfigured > has-dependents > alphabetical
      const aNeeded = a.requiredBy?.length > 0 && !a.isConfigured ? 1 : 0;
      const bNeeded = b.requiredBy?.length > 0 && !b.isConfigured ? 1 : 0;
      if (aNeeded !== bNeeded) return bNeeded - aNeeded;

      const aDeps = a.requiredBy?.length ?? 0;
      const bDeps = b.requiredBy?.length ?? 0;
      if (aDeps !== bDeps) return bDeps - aDeps;

      return a.displayName.localeCompare(b.displayName);
    });

  const unconfiguredNeeded = services.filter(
    (s) => s.requiredBy?.length > 0 && !s.isConfigured,
  );

  // ----------------------------------
  // Modal helpers
  // ----------------------------------

  const loadEntryIntoForm = useCallback(
    (entry: ConfigEntryView) => {
      setActiveEntryId(entry.id);
      setEntryFormValues({ ...entry.data });
      setEntryLabel(entry.label);
      setEntryIsActive(entry.isActive);
      dirtyFieldsRef.current = new Set();
      setSaveMessage(null);
    },
    [],
  );

  const openConfigModal = useCallback(
    (service: ConfigServiceView) => {
      setEditingService(service);
      setSaveMessage(null);
      dirtyFieldsRef.current = new Set();

      if (service.entries.length > 0) {
        // Load the default entry, or the first one
        const defaultEntry =
          service.entries.find((e) => e.isDefault) ?? service.entries[0]!;
        loadEntryIntoForm(defaultEntry);
      } else {
        // No entries yet -- prepare a blank "new entry" form
        setActiveEntryId(null);
        setEntryLabel('');
        setEntryIsActive(true);
        const defaults: Record<string, unknown> = {};
        for (const field of service.configSchema) {
          if (field.defaultValue !== undefined) {
            defaults[field.name] = field.defaultValue;
          }
        }
        setEntryFormValues(defaults);
      }
    },
    [loadEntryIntoForm],
  );

  const closeConfigModal = useCallback(() => {
    setEditingService(null);
    setActiveEntryId(null);
    setSaveMessage(null);
    dirtyFieldsRef.current = new Set();
  }, []);

  const startNewEntry = useCallback(() => {
    if (!editingService) return;
    setActiveEntryId(null);
    setEntryLabel('');
    setEntryIsActive(true);
    const defaults: Record<string, unknown> = {};
    for (const field of editingService.configSchema) {
      if (field.defaultValue !== undefined) {
        defaults[field.name] = field.defaultValue;
      }
    }
    setEntryFormValues(defaults);
    dirtyFieldsRef.current = new Set();
    setSaveMessage(null);
  }, [editingService]);

  const handleFormChange = useCallback(
    (newValues: Record<string, unknown>) => {
      // Determine which fields changed
      for (const key of Object.keys(newValues)) {
        if (newValues[key] !== entryFormValues[key]) {
          dirtyFieldsRef.current.add(key);
        }
      }
      setEntryFormValues(newValues);
    },
    [entryFormValues],
  );

  // ----------------------------------
  // Save entry (create or update)
  // ----------------------------------

  const handleSave = useCallback(async () => {
    if (!editingService) return;

    setIsSaving(true);
    setSaveMessage(null);

    const isCreating = activeEntryId === null;

    try {
      let bodyData: Record<string, unknown>;

      if (isCreating) {
        bodyData = { ...entryFormValues };
      } else {
        // PUT - only send dirty + non-secret fields
        const activeEntry = editingService.entries.find(
          (e) => e.id === activeEntryId,
        );
        const secretFieldNames = new Set(activeEntry?.secretFields ?? []);

        bodyData = {};
        for (const [key, value] of Object.entries(entryFormValues)) {
          const isSecret = secretFieldNames.has(key);
          if (isSecret) {
            if (dirtyFieldsRef.current.has(key)) {
              bodyData[key] = value;
            }
          } else {
            bodyData[key] = value;
          }
        }
      }

      const body: Record<string, unknown> = {
        data: bodyData,
        isActive: entryIsActive,
      };

      if (editingService.multiEntry) {
        body.label = entryLabel;
      }

      if (isCreating && editingService.entries.length === 0) {
        body.isDefault = true;
      }

      const result = isCreating
        ? await configServicesApi.createEntry(editingService.name, body)
        : await configServicesApi.updateEntry(editingService.name, activeEntryId!, body);

      setSaveMessage({ type: 'success', text: isCreating ? 'Entry created' : 'Entry updated' });
      toast.success(isCreating ? 'Entry created' : 'Entry updated');

      // Refresh services to get updated data
      await Promise.all([fetchServices(), fetchStats()]);

      // Re-fetch the service to get its updated entries
      try {
        const svcData = await configServicesApi.list();
        const updatedService = svcData.services.find(
          (s) => s.name === editingService.name,
        );
        if (updatedService) {
          setEditingService(updatedService);
          const targetId = result.id ?? activeEntryId;
          const targetEntry = updatedService.entries.find(
            (e) => e.id === targetId,
          );
          if (targetEntry) {
            loadEntryIntoForm(targetEntry);
          }
        }
      } catch {
        // Non-critical: modal data may be stale
      }
    } catch (err) {
      setSaveMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save entry',
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    editingService,
    activeEntryId,
    entryFormValues,
    entryLabel,
    entryIsActive,
    fetchServices,
    fetchStats,
    loadEntryIntoForm,
    toast,
  ]);

  // ----------------------------------
  // Delete entry
  // ----------------------------------

  const handleDeleteEntry = useCallback(async () => {
    if (!editingService || !activeEntryId) return;

    const activeEntry = editingService.entries.find(
      (e) => e.id === activeEntryId,
    );
    const confirmed = await confirm({
      message: `Delete entry "${activeEntry?.label ?? 'this entry'}"? This action cannot be undone.`,
      variant: 'danger',
    });
    if (!confirmed) return;

    setIsSaving(true);
    setSaveMessage(null);

    try {
      await configServicesApi.deleteEntry(editingService.name, activeEntryId);

      setSaveMessage({ type: 'success', text: 'Entry deleted' });
      toast.success('Entry deleted');
      await Promise.all([fetchServices(), fetchStats()]);

      // Refresh modal
      try {
        const svcData = await configServicesApi.list();
        const updatedService = svcData.services.find(
          (s) => s.name === editingService.name,
        );
        if (updatedService) {
          setEditingService(updatedService);
          if (updatedService.entries.length > 0) {
            const next =
              updatedService.entries.find((e) => e.isDefault) ??
              updatedService.entries[0]!;
            loadEntryIntoForm(next);
          } else {
            startNewEntry();
          }
        }
      } catch {
        closeConfigModal();
      }
    } catch (err) {
      setSaveMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to delete entry',
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    editingService,
    activeEntryId,
    fetchServices,
    fetchStats,
    loadEntryIntoForm,
    startNewEntry,
    closeConfigModal,
    toast,
  ]);

  // ----------------------------------
  // Set default entry
  // ----------------------------------

  const handleSetDefault = useCallback(async () => {
    if (!editingService || !activeEntryId) return;

    setIsSaving(true);
    setSaveMessage(null);

    try {
      await configServicesApi.setDefault(editingService.name, activeEntryId);

      setSaveMessage({ type: 'success', text: 'Set as default' });
      toast.success('Set as default');
      await Promise.all([fetchServices(), fetchStats()]);

      try {
        const svcData = await configServicesApi.list();
        const updatedService = svcData.services.find(
          (s) => s.name === editingService.name,
        );
        if (updatedService) {
          setEditingService(updatedService);
          const entry = updatedService.entries.find(
            (e) => e.id === activeEntryId,
          );
          if (entry) {
            loadEntryIntoForm(entry);
          }
        }
      } catch {
        // Non-critical
      }
    } catch (err) {
      setSaveMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to set default',
      });
    } finally {
      setIsSaving(false);
    }
  }, [editingService, activeEntryId, fetchServices, fetchStats, loadEntryIntoForm, toast]);

  // ----------------------------------
  // Render
  // ----------------------------------

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 pt-4 pb-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Config Center
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Manage service configurations and credentials for all tools
          </p>
        </div>
        <button
          onClick={loadAll}
          className="p-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Error banner */}
        {error && (
          <div className="mb-6 flex items-center gap-3 p-4 bg-error/10 border border-error/30 rounded-xl text-error">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm flex-1">{error}</p>
            <button
              onClick={() => setError(null)}
              className="p-1 hover:bg-error/10 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Loading state */}
        {isLoading ? (
          <LoadingSpinner message="Loading services..." />
        ) : (
          <>
            {/* Unconfigured Required Services Warning */}
            {unconfiguredNeeded.length > 0 && (
              <div className="mb-6 flex items-start gap-3 p-4 bg-warning/10 border border-warning/30 rounded-xl">
                <AlertCircle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                    {unconfiguredNeeded.length} service
                    {unconfiguredNeeded.length > 1 ? 's' : ''} needed by your
                    tools {unconfiguredNeeded.length > 1 ? 'are' : 'is'} not
                    configured
                  </p>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                    {unconfiguredNeeded.map((s) => s.displayName).join(', ')}
                  </p>
                </div>
              </div>
            )}

            {/* Stats Cards */}
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
                <StatsCard
                  label="Total Services"
                  value={stats.total}
                  icon={<Server className="w-5 h-5 text-primary" />}
                />
                <StatsCard
                  label="Configured"
                  value={stats.configured}
                  icon={<Key className="w-5 h-5 text-success" />}
                />
                <StatsCard
                  label="Active"
                  value={stats.active}
                  icon={<CheckCircle2 className="w-5 h-5 text-success" />}
                />
                <StatsCard
                  label="Needed by Tools"
                  value={stats.neededByTools}
                  icon={<Globe className="w-5 h-5 text-primary" />}
                />
                <StatsCard
                  label="Missing Configs"
                  value={stats.neededButUnconfigured}
                  icon={
                    <AlertCircle
                      className={`w-5 h-5 ${stats.neededButUnconfigured > 0 ? 'text-warning' : 'text-success'}`}
                    />
                  }
                />
              </div>
            )}

            {/* Search + Category Filter */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted dark:text-dark-text-muted" />
                <input
                  type="text"
                  placeholder="Search services..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-text-muted"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 min-w-[160px]"
              >
                <option value="all">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* Services Grid */}
            {filteredServices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24">
                <Server className="w-16 h-16 text-text-muted dark:text-dark-text-muted mb-4" />
                <h3 className="text-xl font-medium text-text-primary dark:text-dark-text-primary mb-2">
                  {searchQuery || selectedCategory !== 'all'
                    ? 'No services match your filters'
                    : 'No services found'}
                </h3>
                <p className="text-text-muted dark:text-dark-text-muted text-sm">
                  {searchQuery || selectedCategory !== 'all'
                    ? 'Try adjusting your search or category filter.'
                    : 'Configuration services will appear here once available.'}
                </p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredServices.map((service) => (
                  <ServiceCard
                    key={service.id}
                    service={service}
                    onConfigure={() => openConfigModal(service)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Configure Modal */}
      {editingService && (
        <ConfigureServiceModal
          service={editingService}
          activeEntryId={activeEntryId}
          entryFormValues={entryFormValues}
          entryLabel={entryLabel}
          entryIsActive={entryIsActive}
          isSaving={isSaving}
          saveMessage={saveMessage}
          onEntrySelect={loadEntryIntoForm}
          onNewEntry={startNewEntry}
          onFormChange={handleFormChange}
          onLabelChange={setEntryLabel}
          onActiveChange={setEntryIsActive}
          onSave={handleSave}
          onDelete={handleDeleteEntry}
          onSetDefault={handleSetDefault}
          onClose={closeConfigModal}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatsCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-text-muted dark:text-dark-text-muted">
          {label}
        </span>
        {icon}
      </div>
      <p className="text-2xl font-semibold text-text-primary dark:text-dark-text-primary">
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ServiceCardProps {
  service: ConfigServiceView;
  onConfigure: () => void;
}

function ServiceCard({ service, onConfigure }: ServiceCardProps) {
  const isNeededButMissing =
    service.requiredBy?.length > 0 && !service.isConfigured;

  const entryCountLabel = (() => {
    if (service.entryCount === 0) return 'Not configured';
    if (service.entryCount === 1) return '1 account configured';
    return `${service.entryCount} accounts configured`;
  })();

  // Partial: has entries but some schema-required fields may be missing;
  // for simplicity, we treat "configured" vs "not configured" as the main distinction
  const statusIndicator = (() => {
    if (!service.isConfigured) {
      if (isNeededButMissing) {
        return {
          classes: 'bg-warning/10 text-warning',
          icon: <AlertCircle className="w-3 h-3" />,
          text: 'Config needed',
        };
      }
      return {
        classes: 'bg-error/10 text-error',
        icon: <XCircle className="w-3 h-3" />,
        text: 'Missing',
      };
    }
    // Partial check: configured but not all entries active
    if (
      service.entryCount > 0 &&
      service.entries.some((e) => !e.isActive)
    ) {
      return {
        classes: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
        icon: <AlertCircle className="w-3 h-3" />,
        text: 'Partial',
      };
    }
    return {
      classes: 'bg-success/10 text-success',
      icon: <CheckCircle2 className="w-3 h-3" />,
      text: 'Configured',
    };
  })();

  return (
    <div
      className={`p-4 bg-bg-secondary dark:bg-dark-bg-secondary border rounded-xl flex flex-col ${
        isNeededButMissing
          ? 'border-warning/60 ring-1 ring-warning/20'
          : 'border-border dark:border-dark-border'
      }`}
    >
      {/* Title + Category */}
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-medium text-text-primary dark:text-dark-text-primary truncate mr-2">
          {service.displayName}
        </h3>
        <span
          className={`px-2 py-0.5 text-xs rounded-full whitespace-nowrap ${getCategoryColor(service.category)}`}
        >
          {service.category}
        </span>
      </div>

      {/* Description */}
      <p className="text-sm text-text-muted dark:text-dark-text-muted line-clamp-2 mb-3 flex-1">
        {service.description ?? 'No description available'}
      </p>

      {/* Required by badges */}
      {service.requiredBy?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {service.requiredBy.map((dep) => (
            <span
              key={dep.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary"
            >
              {dep.type === 'tool' ? 'Tool' : 'Plugin'}: {dep.name}
            </span>
          ))}
        </div>
      )}

      {/* Status indicators */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${statusIndicator.classes}`}
        >
          {statusIndicator.icon}
          {statusIndicator.text}
        </span>

        {/* Active/Inactive */}
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${
            service.isActive
              ? 'bg-success/10 text-success'
              : 'bg-text-muted/20 text-text-muted dark:text-dark-text-muted'
          }`}
        >
          {service.isActive ? 'Active' : 'Inactive'}
        </span>

        {/* Entry count */}
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary">
          {entryCountLabel}
        </span>
      </div>

      {/* Configure button */}
      <button
        onClick={onConfigure}
        className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
          isNeededButMissing
            ? 'bg-warning/10 border border-warning/30 text-warning hover:bg-warning/20'
            : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border hover:border-primary text-text-secondary dark:text-dark-text-secondary hover:text-primary'
        }`}
      >
        <Edit2 className="w-4 h-4" />
        {isNeededButMissing ? 'Set Up Now' : 'Configure'}
      </button>
    </div>
  );
}

