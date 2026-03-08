// Workspaces, File Workspaces, and Custom Data types

export interface WorkspaceSelectorInfo {
  id: string;
  name: string;
  description?: string;
  status: string;
  containerStatus: string;
  createdAt: string;
  updatedAt: string;
  storageUsage?: {
    usedBytes: number;
    fileCount: number;
  };
}

// ---- File Workspaces (workspaces page) ----

export interface FileWorkspaceInfo {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  agentId?: string;
  sessionId?: string;
  description?: string;
  tags?: string[];
  size?: number;
  fileCount?: number;
}

export interface WorkspaceFile {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

// ---- Custom Data ----

export interface ColumnDefinition {
  name: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'json';
  required?: boolean;
  description?: string;
}

export interface CustomTable {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  columns: ColumnDefinition[];
  recordCount?: number;
  ownerPluginId?: string;
  isProtected?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomRecord {
  id: string;
  tableId: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
