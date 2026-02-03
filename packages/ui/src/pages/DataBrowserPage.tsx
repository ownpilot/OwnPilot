import { useState, useEffect, useCallback } from 'react';
import {
  Database,
  CheckCircle2,
  Bookmark,
  FileText,
  Calendar,
  Users,
  Search,
  Plus,
  Trash2,
  Edit3,
  ChevronDown,
  Table,
} from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

// Data types
type DataType = 'tasks' | 'bookmarks' | 'notes' | 'calendar' | 'contacts';

interface DataTypeConfig {
  name: string;
  icon: typeof Database;
  endpoint: string;
  columns: { key: string; label: string; type: 'text' | 'date' | 'boolean' | 'tags' }[];
  searchable: boolean;
}

const DATA_TYPES: Record<DataType, DataTypeConfig> = {
  tasks: {
    name: 'Tasks',
    icon: CheckCircle2,
    endpoint: '/api/v1/tasks',
    columns: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'priority', label: 'Priority', type: 'text' },
      { key: 'dueDate', label: 'Due Date', type: 'date' },
      { key: 'category', label: 'Category', type: 'text' },
    ],
    searchable: true,
  },
  bookmarks: {
    name: 'Bookmarks',
    icon: Bookmark,
    endpoint: '/api/v1/bookmarks',
    columns: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'url', label: 'URL', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'isFavorite', label: 'Favorite', type: 'boolean' },
      { key: 'tags', label: 'Tags', type: 'tags' },
    ],
    searchable: true,
  },
  notes: {
    name: 'Notes',
    icon: FileText,
    endpoint: '/api/v1/notes',
    columns: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'isPinned', label: 'Pinned', type: 'boolean' },
      { key: 'updatedAt', label: 'Updated', type: 'date' },
    ],
    searchable: true,
  },
  calendar: {
    name: 'Calendar Events',
    icon: Calendar,
    endpoint: '/api/v1/calendar',
    columns: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'startTime', label: 'Start', type: 'date' },
      { key: 'endTime', label: 'End', type: 'date' },
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
    ],
    searchable: true,
  },
  contacts: {
    name: 'Contacts',
    icon: Users,
    endpoint: '/api/v1/contacts',
    columns: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'company', label: 'Company', type: 'text' },
      { key: 'relationship', label: 'Relationship', type: 'text' },
    ],
    searchable: true,
  },
};

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { message: string };
}

export function DataBrowserPage() {
  const { confirm } = useDialog();
  const [selectedType, setSelectedType] = useState<DataType>('tasks');
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Record<string, unknown> | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const config = DATA_TYPES[selectedType];

  const fetchRecords = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch && config.searchable) {
        params.append('search', debouncedSearch);
      }
      params.append('limit', '100');

      const response = await fetch(`${config.endpoint}?${params}`);
      const data: ApiResponse<Record<string, unknown>[]> = await response.json();
      if (data.success && data.data) {
        setRecords(data.data);
      }
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  }, [config.endpoint, config.searchable, debouncedSearch]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    // Reset search when changing data type
    setSearchQuery('');
    setRecords([]);
  }, [selectedType]);

  const handleDelete = async (recordId: string) => {
    if (!await confirm({ message: 'Are you sure you want to delete this record?', variant: 'danger' })) return;

    try {
      const response = await fetch(`${config.endpoint}/${recordId}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (data.success) {
        fetchRecords();
      }
    } catch {
      // API client handles error reporting
    }
  };

  const formatCellValue = (value: unknown, type: string): string => {
    if (value === null || value === undefined) return '-';
    if (type === 'boolean') return value ? 'Yes' : 'No';
    if (type === 'date') {
      if (typeof value === 'string') {
        const date = new Date(value);
        return date.toLocaleDateString() + (value.includes('T') ? ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
      }
      return '-';
    }
    if (type === 'tags' && Array.isArray(value)) {
      return value.join(', ');
    }
    return String(value);
  };

  const TypeIcon = config.icon;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div className="flex items-center gap-4">
          {/* Data Type Selector */}
          <div className="relative">
            <button
              onClick={() => setShowTypeSelector(!showTypeSelector)}
              className="flex items-center gap-2 px-4 py-2 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg hover:border-primary transition-colors"
            >
              <TypeIcon className="w-5 h-5 text-primary" />
              <span className="font-medium text-text-primary dark:text-dark-text-primary">
                {config.name}
              </span>
              <ChevronDown className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
            </button>

            {showTypeSelector && (
              <div className="absolute top-full left-0 mt-1 w-56 bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg shadow-lg z-50 overflow-hidden">
                {(Object.entries(DATA_TYPES) as [DataType, DataTypeConfig][]).map(([type, typeConfig]) => {
                  const Icon = typeConfig.icon;
                  return (
                    <button
                      key={type}
                      onClick={() => {
                        setSelectedType(type);
                        setShowTypeSelector(false);
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                        selectedType === type
                          ? 'bg-primary/10 text-primary'
                          : 'text-text-primary dark:text-dark-text-primary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span>{typeConfig.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              {records.length} record{records.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted dark:text-dark-text-muted" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 w-64 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
            />
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add {config.name.replace(/s$/, '')}
          </button>
        </div>
      </header>

      {/* Click outside handler for type selector */}
      {showTypeSelector && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowTypeSelector(false)}
        />
      )}

      {/* Data Type Tabs (alternative navigation) */}
      <div className="flex gap-1 px-6 py-2 border-b border-border dark:border-dark-border overflow-x-auto">
        {(Object.entries(DATA_TYPES) as [DataType, DataTypeConfig][]).map(([type, typeConfig]) => {
          const Icon = typeConfig.icon;
          return (
            <button
              key={type}
              onClick={() => setSelectedType(type)}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors whitespace-nowrap ${
                selectedType === type
                  ? 'bg-primary text-white'
                  : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
              }`}
            >
              <Icon className="w-4 h-4" />
              {typeConfig.name}
            </button>
          );
        })}
      </div>

      {/* Table Content */}
      <div className="flex-1 overflow-auto animate-fade-in-up">
        {isLoading ? (
          <LoadingSpinner message="Loading..." />
        ) : records.length === 0 ? (
          <EmptyState
            icon={Table}
            title={searchQuery ? 'No records found' : `No ${config.name.toLowerCase()} yet`}
            description={searchQuery ? 'Try a different search term.' : `Add your first ${config.name.toLowerCase().replace(/s$/, '')} to get started.`}
          />
        ) : (
          <div className="p-6">
            <div className="overflow-x-auto border border-border dark:border-dark-border rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-bg-secondary dark:bg-dark-bg-secondary border-b border-border dark:border-dark-border">
                    {config.columns.map((col) => (
                      <th
                        key={col.key}
                        className="text-left px-4 py-3 font-medium text-text-secondary dark:text-dark-text-secondary"
                      >
                        {col.label}
                      </th>
                    ))}
                    <th className="w-24 px-4 py-3 text-right font-medium text-text-secondary dark:text-dark-text-secondary">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record, idx) => (
                    <tr
                      key={(record.id as string) || idx}
                      className="border-b border-border dark:border-dark-border last:border-b-0 hover:bg-bg-tertiary/50 dark:hover:bg-dark-bg-tertiary/50"
                    >
                      {config.columns.map((col) => (
                        <td
                          key={col.key}
                          className="px-4 py-3 text-text-primary dark:text-dark-text-primary"
                        >
                          {col.key === 'url' && record[col.key] ? (
                            <a
                              href={record[col.key] as string}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline truncate block max-w-xs"
                            >
                              {formatCellValue(record[col.key], col.type)}
                            </a>
                          ) : (
                            <span className={col.type === 'text' && col.key === 'title' ? 'font-medium' : ''}>
                              {formatCellValue(record[col.key], col.type)}
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setEditingRecord(record)}
                            className="p-1.5 text-text-muted dark:text-dark-text-muted hover:text-primary rounded transition-colors"
                            title="Edit"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(record.id as string)}
                            className="p-1.5 text-text-muted dark:text-dark-text-muted hover:text-error rounded transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-sm text-text-muted dark:text-dark-text-muted">
              Showing {records.length} record{records.length !== 1 ? 's' : ''}
            </p>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {(showAddModal || editingRecord) && (
        <RecordModal
          dataType={selectedType}
          config={config}
          record={editingRecord}
          onClose={() => {
            setShowAddModal(false);
            setEditingRecord(null);
          }}
          onSave={() => {
            setShowAddModal(false);
            setEditingRecord(null);
            fetchRecords();
          }}
        />
      )}
    </div>
  );
}

interface RecordModalProps {
  dataType: DataType;
  config: DataTypeConfig;
  record: Record<string, unknown> | null;
  onClose: () => void;
  onSave: () => void;
}

function RecordModal({ dataType, config, record, onClose, onSave }: RecordModalProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>(record || {});
  const [isSaving, setIsSaving] = useState(false);

  const handleChange = (key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const url = record
        ? `${config.endpoint}/${record.id}`
        : config.endpoint;
      const method = record ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await response.json();
      if (data.success) {
        onSave();
      }
    } catch {
      // API client handles error reporting
    } finally {
      setIsSaving(false);
    }
  };

  const getFieldsForType = (): { key: string; label: string; type: string; required?: boolean }[] => {
    switch (dataType) {
      case 'tasks':
        return [
          { key: 'title', label: 'Title', type: 'text', required: true },
          { key: 'description', label: 'Description', type: 'textarea' },
          { key: 'priority', label: 'Priority', type: 'select' },
          { key: 'dueDate', label: 'Due Date', type: 'date' },
          { key: 'category', label: 'Category', type: 'text' },
        ];
      case 'bookmarks':
        return [
          { key: 'url', label: 'URL', type: 'url', required: true },
          { key: 'title', label: 'Title', type: 'text', required: true },
          { key: 'description', label: 'Description', type: 'textarea' },
          { key: 'category', label: 'Category', type: 'text' },
        ];
      case 'notes':
        return [
          { key: 'title', label: 'Title', type: 'text', required: true },
          { key: 'content', label: 'Content', type: 'textarea', required: true },
          { key: 'category', label: 'Category', type: 'text' },
        ];
      case 'calendar':
        return [
          { key: 'title', label: 'Title', type: 'text', required: true },
          { key: 'startTime', label: 'Start Time', type: 'datetime-local', required: true },
          { key: 'endTime', label: 'End Time', type: 'datetime-local' },
          { key: 'location', label: 'Location', type: 'text' },
          { key: 'description', label: 'Description', type: 'textarea' },
          { key: 'category', label: 'Category', type: 'text' },
        ];
      case 'contacts':
        return [
          { key: 'name', label: 'Name', type: 'text', required: true },
          { key: 'email', label: 'Email', type: 'email' },
          { key: 'phone', label: 'Phone', type: 'tel' },
          { key: 'company', label: 'Company', type: 'text' },
          { key: 'jobTitle', label: 'Job Title', type: 'text' },
          { key: 'relationship', label: 'Relationship', type: 'text' },
          { key: 'notes', label: 'Notes', type: 'textarea' },
        ];
      default:
        return [];
    }
  };

  const fields = getFieldsForType();
  const inputClasses = 'w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-lg bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
          <div className="p-6 border-b border-border dark:border-dark-border">
            <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              {record ? 'Edit' : 'Add'} {config.name.replace(/s$/, '')}
            </h3>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {fields.map((field) => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  {field.label}
                  {field.required && <span className="text-error ml-1">*</span>}
                </label>
                {field.type === 'textarea' ? (
                  <textarea
                    value={(formData[field.key] as string) || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    className={`${inputClasses} resize-none`}
                    rows={3}
                    required={field.required}
                  />
                ) : field.type === 'select' && field.key === 'priority' ? (
                  <select
                    value={(formData[field.key] as string) || 'normal'}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    className={inputClasses}
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                ) : (
                  <input
                    type={field.type}
                    value={(formData[field.key] as string) || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    className={inputClasses}
                    required={field.required}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="p-4 border-t border-border dark:border-dark-border flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? 'Saving...' : record ? 'Save' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
