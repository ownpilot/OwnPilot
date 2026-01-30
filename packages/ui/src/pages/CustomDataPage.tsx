import { useState, useEffect, useCallback } from 'react';
import { Database, Plus, Trash2, Search, Table, ChevronRight, Edit3 } from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';

interface ColumnDefinition {
  name: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'json';
  required?: boolean;
  description?: string;
}

interface CustomTable {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  columns: ColumnDefinition[];
  recordCount?: number;
  createdAt: string;
  updatedAt: string;
}

interface CustomRecord {
  id: string;
  tableId: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { message: string };
}

export function CustomDataPage() {
  const { confirm } = useDialog();
  const [tables, setTables] = useState<CustomTable[]>([]);
  const [selectedTable, setSelectedTable] = useState<CustomTable | null>(null);
  const [records, setRecords] = useState<CustomRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateTableModal, setShowCreateTableModal] = useState(false);
  const [showAddRecordModal, setShowAddRecordModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CustomRecord | null>(null);
  const [totalRecords, setTotalRecords] = useState(0);

  const fetchTables = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/custom-data/tables');
      const data: ApiResponse<CustomTable[]> = await response.json();
      if (data.success && data.data) {
        setTables(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch tables:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchRecords = useCallback(async (tableId: string, search?: string) => {
    setIsLoadingRecords(true);
    try {
      if (search) {
        const response = await fetch(`/api/v1/custom-data/tables/${tableId}/search?q=${encodeURIComponent(search)}`);
        const data: ApiResponse<CustomRecord[]> = await response.json();
        if (data.success && data.data) {
          setRecords(data.data);
          setTotalRecords(data.data.length);
        }
      } else {
        const response = await fetch(`/api/v1/custom-data/tables/${tableId}/records?limit=100`);
        const data: ApiResponse<{ records: CustomRecord[]; total: number }> = await response.json();
        if (data.success && data.data) {
          setRecords(data.data.records);
          setTotalRecords(data.data.total);
        }
      }
    } catch (err) {
      console.error('Failed to fetch records:', err);
    } finally {
      setIsLoadingRecords(false);
    }
  }, []);

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  useEffect(() => {
    if (selectedTable) {
      fetchRecords(selectedTable.id, searchQuery || undefined);
    }
  }, [selectedTable, searchQuery, fetchRecords]);

  const handleSelectTable = (table: CustomTable) => {
    setSelectedTable(table);
    setSearchQuery('');
    setRecords([]);
  };

  const handleDeleteTable = async (tableId: string) => {
    if (!await confirm({ message: 'Are you sure you want to delete this table and ALL its data? This cannot be undone.', variant: 'danger' })) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/custom-data/tables/${tableId}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (data.success) {
        if (selectedTable?.id === tableId) {
          setSelectedTable(null);
          setRecords([]);
        }
        fetchTables();
      }
    } catch (err) {
      console.error('Failed to delete table:', err);
    }
  };

  const handleDeleteRecord = async (recordId: string) => {
    if (!await confirm({ message: 'Are you sure you want to delete this record?', variant: 'danger' })) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/custom-data/records/${recordId}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (data.success && selectedTable) {
        fetchRecords(selectedTable.id, searchQuery || undefined);
      }
    } catch (err) {
      console.error('Failed to delete record:', err);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Custom Data
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {tables.length} table{tables.length !== 1 ? 's' : ''} created by AI
          </p>
        </div>
        <button
          onClick={() => setShowCreateTableModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Table
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Table List */}
        <aside className="w-64 border-r border-border dark:border-dark-border overflow-y-auto">
          <div className="p-3">
            <h3 className="text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wide mb-2">
              Tables
            </h3>
            {isLoading ? (
              <p className="text-sm text-text-muted dark:text-dark-text-muted p-2">Loading...</p>
            ) : tables.length === 0 ? (
              <p className="text-sm text-text-muted dark:text-dark-text-muted p-2">
                No tables yet. Ask AI to create one!
              </p>
            ) : (
              <ul className="space-y-1">
                {tables.map((table) => (
                  <li key={table.id}>
                    <button
                      onClick={() => handleSelectTable(table)}
                      className={`w-full flex items-center justify-between p-2 rounded-lg text-left transition-colors ${
                        selectedTable?.id === table.id
                          ? 'bg-primary text-white'
                          : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Table className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate text-sm">{table.displayName}</span>
                      </div>
                      <span className={`text-xs ${selectedTable?.id === table.id ? 'text-white/70' : 'text-text-muted dark:text-dark-text-muted'}`}>
                        {table.recordCount ?? 0}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {selectedTable ? (
            <>
              {/* Table Header */}
              <div className="flex items-center justify-between px-6 py-3 border-b border-border dark:border-dark-border">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-text-primary dark:text-dark-text-primary">
                      {selectedTable.displayName}
                    </h3>
                    <button
                      onClick={() => handleDeleteTable(selectedTable.id)}
                      className="p-1 text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
                      title="Delete table"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  {selectedTable.description && (
                    <p className="text-sm text-text-muted dark:text-dark-text-muted">
                      {selectedTable.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted dark:text-dark-text-muted" />
                    <input
                      type="text"
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 pr-4 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <button
                    onClick={() => setShowAddRecordModal(true)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Record
                  </button>
                </div>
              </div>

              {/* Records Table */}
              <div className="flex-1 overflow-auto p-6">
                {isLoadingRecords ? (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-text-muted dark:text-dark-text-muted">Loading records...</p>
                  </div>
                ) : records.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full">
                    <Database className="w-16 h-16 text-text-muted dark:text-dark-text-muted mb-4" />
                    <h3 className="text-xl font-medium text-text-primary dark:text-dark-text-primary mb-2">
                      {searchQuery ? 'No records found' : 'No records yet'}
                    </h3>
                    <p className="text-text-muted dark:text-dark-text-muted mb-4">
                      {searchQuery
                        ? 'Try a different search term.'
                        : 'Add your first record or ask AI to add data.'}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border dark:border-dark-border">
                          {selectedTable.columns.map((col) => (
                            <th
                              key={col.name}
                              className="text-left p-3 font-medium text-text-secondary dark:text-dark-text-secondary"
                            >
                              {col.name}
                              <span className="ml-1 text-xs text-text-muted dark:text-dark-text-muted">
                                ({col.type})
                              </span>
                            </th>
                          ))}
                          <th className="w-20"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.map((record) => (
                          <tr
                            key={record.id}
                            className="border-b border-border dark:border-dark-border hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary"
                          >
                            {selectedTable.columns.map((col) => (
                              <td
                                key={col.name}
                                className="p-3 text-text-primary dark:text-dark-text-primary"
                              >
                                {formatCellValue(record.data[col.name], col.type)}
                              </td>
                            ))}
                            <td className="p-3">
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => setEditingRecord(record)}
                                  className="p-1 text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteRecord(record.id)}
                                  className="p-1 text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-4 text-sm text-text-muted dark:text-dark-text-muted">
                      Showing {records.length} of {totalRecords} record{totalRecords !== 1 ? 's' : ''}
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full">
              <Database className="w-16 h-16 text-text-muted dark:text-dark-text-muted mb-4" />
              <h3 className="text-xl font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Select a table
              </h3>
              <p className="text-text-muted dark:text-dark-text-muted mb-4">
                Choose a table from the sidebar or ask AI to create one.
              </p>
              <div className="text-sm text-text-muted dark:text-dark-text-muted max-w-md text-center">
                <p className="mb-2">Try asking the AI:</p>
                <ul className="space-y-1 text-left">
                  <li className="flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-primary" />
                    "Create a table to track my favorite movies"
                  </li>
                  <li className="flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-primary" />
                    "Store my book reading list"
                  </li>
                  <li className="flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-primary" />
                    "Keep track of my project ideas"
                  </li>
                </ul>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Create Table Modal */}
      {showCreateTableModal && (
        <CreateTableModal
          onClose={() => setShowCreateTableModal(false)}
          onSave={() => {
            setShowCreateTableModal(false);
            fetchTables();
          }}
        />
      )}

      {/* Add/Edit Record Modal */}
      {(showAddRecordModal || editingRecord) && selectedTable && (
        <RecordModal
          table={selectedTable}
          record={editingRecord}
          onClose={() => {
            setShowAddRecordModal(false);
            setEditingRecord(null);
          }}
          onSave={() => {
            setShowAddRecordModal(false);
            setEditingRecord(null);
            fetchRecords(selectedTable.id, searchQuery || undefined);
          }}
        />
      )}
    </div>
  );
}

function formatCellValue(value: unknown, type: string): string {
  if (value === null || value === undefined) {
    return '-';
  }
  if (type === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (type === 'json') {
    return JSON.stringify(value);
  }
  return String(value);
}

interface CreateTableModalProps {
  onClose: () => void;
  onSave: () => void;
}

function CreateTableModal({ onClose, onSave }: CreateTableModalProps) {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [columns, setColumns] = useState<ColumnDefinition[]>([
    { name: '', type: 'text', required: false },
  ]);
  const [isSaving, setIsSaving] = useState(false);

  const handleAddColumn = () => {
    setColumns([...columns, { name: '', type: 'text', required: false }]);
  };

  const handleRemoveColumn = (index: number) => {
    setColumns(columns.filter((_, i) => i !== index));
  };

  const handleColumnChange = (index: number, field: keyof ColumnDefinition, value: unknown) => {
    const newColumns = [...columns];
    const col = newColumns[index];
    if (col) {
      // Using Object.assign to update the column
      Object.assign(col, { [field]: value });
    }
    setColumns(newColumns);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !displayName.trim() || columns.length === 0) return;

    // Validate columns
    const validColumns = columns.filter((c) => c.name.trim());
    if (validColumns.length === 0) return;

    setIsSaving(true);
    try {
      const response = await fetch('/api/v1/custom-data/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
          displayName,
          description: description || undefined,
          columns: validColumns.map((c) => ({
            ...c,
            name: c.name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
          })),
        }),
      });

      const data = await response.json();
      if (data.success) {
        onSave();
      }
    } catch (err) {
      console.error('Failed to create table:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-2xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl">
        <form onSubmit={handleSubmit}>
          <div className="p-6 border-b border-border dark:border-dark-border">
            <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Create Custom Table
            </h3>
          </div>

          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Table Name (internal)
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my_movies"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="My Movies"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this table stores..."
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary">
                  Columns
                </label>
                <button
                  type="button"
                  onClick={handleAddColumn}
                  className="text-sm text-primary hover:underline"
                >
                  + Add Column
                </button>
              </div>
              <div className="space-y-2">
                {columns.map((col, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={col.name}
                      onChange={(e) => handleColumnChange(index, 'name', e.target.value)}
                      placeholder="Column name"
                      className="flex-1 px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <select
                      value={col.type}
                      onChange={(e) => handleColumnChange(index, 'type', e.target.value)}
                      className="px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="boolean">Boolean</option>
                      <option value="date">Date</option>
                      <option value="datetime">DateTime</option>
                      <option value="json">JSON</option>
                    </select>
                    <label className="flex items-center gap-1 text-sm text-text-muted dark:text-dark-text-muted">
                      <input
                        type="checkbox"
                        checked={col.required ?? false}
                        onChange={(e) => handleColumnChange(index, 'required', e.target.checked)}
                        className="w-4 h-4"
                      />
                      Req
                    </label>
                    {columns.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveColumn(index)}
                        className="p-1 text-text-muted dark:text-dark-text-muted hover:text-error"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
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
              disabled={!name.trim() || !displayName.trim() || isSaving}
              className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? 'Creating...' : 'Create Table'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface RecordModalProps {
  table: CustomTable;
  record: CustomRecord | null;
  onClose: () => void;
  onSave: () => void;
}

function RecordModal({ table, record, onClose, onSave }: RecordModalProps) {
  const [data, setData] = useState<Record<string, unknown>>(record?.data ?? {});
  const [isSaving, setIsSaving] = useState(false);

  const handleFieldChange = (name: string, value: unknown, type: string) => {
    let processedValue = value;
    if (type === 'number' && typeof value === 'string') {
      processedValue = value === '' ? null : parseFloat(value);
    }
    if (type === 'boolean') {
      processedValue = value === 'true' || value === true;
    }
    setData({ ...data, [name]: processedValue });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsSaving(true);
    try {
      const url = record
        ? `/api/v1/custom-data/records/${record.id}`
        : `/api/v1/custom-data/tables/${table.id}/records`;
      const method = record ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });

      const result = await response.json();
      if (result.success) {
        onSave();
      }
    } catch (err) {
      console.error('Failed to save record:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-lg bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl">
        <form onSubmit={handleSubmit}>
          <div className="p-6 border-b border-border dark:border-dark-border">
            <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              {record ? 'Edit Record' : 'Add Record'}
            </h3>
          </div>

          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            {table.columns.map((col) => (
              <div key={col.name}>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  {col.name}
                  {col.required && <span className="text-error ml-1">*</span>}
                  <span className="ml-1 text-xs text-text-muted dark:text-dark-text-muted">
                    ({col.type})
                  </span>
                </label>
                {renderFieldInput(col, data[col.name], (value) =>
                  handleFieldChange(col.name, value, col.type)
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

function renderFieldInput(
  col: ColumnDefinition,
  value: unknown,
  onChange: (value: unknown) => void
) {
  const inputClasses =
    'w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50';

  switch (col.type) {
    case 'boolean':
      return (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value === 'true')}
          className={inputClasses}
        >
          <option value="">-</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    case 'number':
      return (
        <input
          type="number"
          value={value !== null && value !== undefined ? String(value) : ''}
          onChange={(e) => onChange(e.target.value)}
          className={inputClasses}
        />
      );
    case 'date':
      return (
        <input
          type="date"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className={inputClasses}
        />
      );
    case 'datetime':
      return (
        <input
          type="datetime-local"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className={inputClasses}
        />
      );
    case 'json':
      return (
        <textarea
          value={typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '')}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value));
            } catch {
              onChange(e.target.value);
            }
          }}
          rows={4}
          className={`${inputClasses} resize-none font-mono text-sm`}
        />
      );
    default:
      return (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className={inputClasses}
        />
      );
  }
}
