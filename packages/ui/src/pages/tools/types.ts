/**
 * Tool page types
 */

export interface CategoryInfo {
  icon: string;
  description: string;
}

export interface GroupedTools {
  categories: Record<
    string,
    {
      info: CategoryInfo;
      tools: ToolItem[];
    }
  >;
  totalTools: number;
}

export interface ToolItem {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  category?: string;
  source?: string;
}

export type TabId = 'overview' | 'schema' | 'code' | 'test';

export interface ToolParams {
  type?: string;
  properties?: Record<string, ToolParamProperty>;
  required?: string[];
}

export interface ToolParamProperty {
  type?: string;
  description?: string;
  enum?: string[];
  items?: { type?: string };
  default?: unknown;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}
