/**
 * HTTP Request Config Panel — configuration for HTTP request workflow nodes.
 * Supports GET/POST/PUT/PATCH/DELETE with auth, headers, query params, and body.
 */

import { useState, useCallback, useEffect } from 'react';
import { X, Trash2, Globe, Plus } from '../../icons';
import type { NodeExecutionStatus } from '../../../api/types';
import { OutputTreeBrowser } from '../OutputTreeBrowser';
import { TemplateValidator } from '../TemplateValidator';
import { JsonTreeView } from '../JsonTreeView';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import {
  statusBadgeStyles,
  statusIcons,
  OutputAliasField,
  RetryTimeoutFields,
  RetryAttemptsDisplay,
  INPUT_CLS,
} from '../NodeConfigPanel';

// ============================================================================
// Types
// ============================================================================

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type AuthType = 'none' | 'bearer' | 'basic' | 'apiKey';
type BodyType = 'json' | 'text' | 'form';

interface KeyValuePair {
  key: string;
  value: string;
}

interface HttpRequestNodeData {
  label?: string;
  method?: HttpMethod;
  url?: string;
  authType?: AuthType;
  authToken?: string;
  authUsername?: string;
  authPassword?: string;
  authHeaderName?: string;
  headers?: KeyValuePair[];
  queryParams?: KeyValuePair[];
  body?: string;
  bodyType?: BodyType;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
  executionStatus?: NodeExecutionStatus;
  executionDuration?: number;
  executionOutput?: unknown;
  executionError?: string;
  retryAttempts?: number;
  responseStatusCode?: number;
  responseHeaders?: Record<string, string>;
}

// ============================================================================
// Constants
// ============================================================================

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const AUTH_TYPES: { value: AuthType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'apiKey', label: 'API Key' },
];
const BODY_TYPES: { value: BodyType; label: string }[] = [
  { value: 'json', label: 'JSON' },
  { value: 'text', label: 'Text' },
  { value: 'form', label: 'Form' },
];
const METHODS_WITH_BODY: HttpMethod[] = ['POST', 'PUT', 'PATCH'];

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  POST: 'bg-green-500/20 text-green-600 dark:text-green-400',
  PUT: 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
  PATCH: 'bg-orange-500/20 text-orange-600 dark:text-orange-400',
  DELETE: 'bg-red-500/20 text-red-600 dark:text-red-400',
};

// ============================================================================
// Sub-components
// ============================================================================

function KeyValueEditor({
  label,
  pairs,
  onChange,
}: {
  label: string;
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
        {label}
      </label>
      <div className="space-y-1.5">
        {pairs.map((pair, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="text"
              value={pair.key}
              onChange={(e) => {
                const next = [...pairs];
                next[i] = { ...pair, key: e.target.value };
                onChange(next);
              }}
              placeholder="Key"
              className={`${INPUT_CLS} flex-1`}
            />
            <input
              type="text"
              value={pair.value}
              onChange={(e) => {
                const next = [...pairs];
                next[i] = { ...pair, value: e.target.value };
                onChange(next);
              }}
              placeholder="Value"
              className={`${INPUT_CLS} flex-1`}
            />
            <button
              type="button"
              onClick={() => onChange(pairs.filter((_, j) => j !== i))}
              className="p-1 text-text-muted hover:text-error transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...pairs, { key: '', value: '' }])}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add {label.replace(/s$/, '')}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Main component
// ============================================================================

export function HttpRequestConfigPanel({
  node,
  upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
  className = '',
}: NodeConfigPanelProps) {
  const data = node.data as HttpRequestNodeData;

  const [label, setLabel] = useState(data.label ?? 'HTTP Request');
  const [method, setMethod] = useState<HttpMethod>(data.method ?? 'GET');
  const [url, setUrl] = useState(data.url ?? '');
  const [authType, setAuthType] = useState<AuthType>(data.authType ?? 'none');
  const [authToken, setAuthToken] = useState(data.authToken ?? '');
  const [authUsername, setAuthUsername] = useState(data.authUsername ?? '');
  const [authPassword, setAuthPassword] = useState(data.authPassword ?? '');
  const [authHeaderName, setAuthHeaderName] = useState(data.authHeaderName ?? '');
  const [headers, setHeaders] = useState<KeyValuePair[]>(data.headers ?? []);
  const [queryParams, setQueryParams] = useState<KeyValuePair[]>(data.queryParams ?? []);
  const [body, setBody] = useState(data.body ?? '');
  const [bodyType, setBodyType] = useState<BodyType>(data.bodyType ?? 'json');
  const [description, setDescription] = useState(data.description ?? '');

  const hasResults = !!(data.executionStatus as string) && data.executionStatus !== 'pending';
  const [activeTab, setActiveTab] = useState<'config' | 'results'>(
    hasResults ? 'results' : 'config'
  );

  useEffect(() => {
    setLabel(data.label ?? 'HTTP Request');
    setMethod(data.method ?? 'GET');
    setUrl(data.url ?? '');
    setAuthType(data.authType ?? 'none');
    setAuthToken(data.authToken ?? '');
    setAuthUsername(data.authUsername ?? '');
    setAuthPassword(data.authPassword ?? '');
    setAuthHeaderName(data.authHeaderName ?? '');
    setHeaders(data.headers ?? []);
    setQueryParams(data.queryParams ?? []);
    setBody(data.body ?? '');
    setBodyType(data.bodyType ?? 'json');
    setDescription(data.description ?? '');
    setActiveTab(data.executionStatus && data.executionStatus !== 'pending' ? 'results' : 'config');
  }, [node.id]);

  useEffect(() => {
    if (hasResults) setActiveTab('results');
  }, [hasResults]);

  const pushUpdate = useCallback(
    (partial: Partial<HttpRequestNodeData>) => {
      onUpdate(node.id, { ...data, ...partial });
    },
    [node.id, data, onUpdate]
  );

  const injectTemplate = useCallback(
    (template: string) => {
      setUrl((prev) => prev + template);
      pushUpdate({ url: url + template });
    },
    [url, pushUpdate]
  );

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard?.writeText(text);
  }, []);

  const showBody = METHODS_WITH_BODY.includes(method);

  const statusCode = data.responseStatusCode;
  const statusCodeColor =
    statusCode != null
      ? statusCode >= 200 && statusCode < 300
        ? 'bg-success/10 text-success'
        : statusCode >= 400
          ? 'bg-error/10 text-error'
          : 'bg-warning/10 text-warning'
      : '';

  return (
    <div
      className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${className}`}
    >
      {/* Header with tabs */}
      <div className="flex items-center gap-2 p-3 border-b border-border dark:border-dark-border">
        <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
          <Globe className="w-3 h-3 text-blue-600 dark:text-blue-400" />
        </div>
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1 truncate">
          {data.label ?? 'HTTP Request'}
        </h3>
        {hasResults && (
          <div className="flex bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md p-0.5 shrink-0">
            <button
              onClick={() => setActiveTab('config')}
              className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                activeTab === 'config'
                  ? 'bg-bg-primary dark:bg-dark-bg-primary shadow-sm font-medium text-text-primary dark:text-dark-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Config
            </button>
            <button
              onClick={() => setActiveTab('results')}
              className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                activeTab === 'results'
                  ? 'bg-bg-primary dark:bg-dark-bg-primary shadow-sm font-medium text-text-primary dark:text-dark-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Results
            </button>
          </div>
        )}
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {activeTab === 'results' ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Status row */}
          <div className="flex items-center gap-2">
            {(() => {
              const status = data.executionStatus as NodeExecutionStatus;
              const StatusIcon = statusIcons[status];
              return (
                <>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${statusBadgeStyles[status]}`}
                  >
                    {StatusIcon && <StatusIcon className="w-3 h-3" />}
                    {status}
                  </span>
                  {statusCode != null && (
                    <span
                      className={`inline-flex items-center px-2 py-0.5 text-xs font-mono font-medium rounded-full ${statusCodeColor}`}
                    >
                      {statusCode}
                    </span>
                  )}
                  {data.executionDuration != null && (
                    <span className="text-xs text-text-muted dark:text-dark-text-muted">
                      {(data.executionDuration as number) < 1000
                        ? `${data.executionDuration}ms`
                        : `${((data.executionDuration as number) / 1000).toFixed(1)}s`}
                    </span>
                  )}
                  {(data.retryAttempts as number) > 0 && (
                    <RetryAttemptsDisplay
                      retryAttempts={data.retryAttempts as number}
                      status={String(data.executionStatus)}
                    />
                  )}
                </>
              );
            })()}
          </div>

          {/* Response headers */}
          {data.responseHeaders && Object.keys(data.responseHeaders).length > 0 && (
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Response Headers
              </label>
              <div className="px-2 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md max-h-40 overflow-y-auto">
                <JsonTreeView
                  data={data.responseHeaders}
                  pathPrefix={`${node.id}.output.headers`}
                  onClickPath={copyToClipboard}
                />
              </div>
            </div>
          )}

          {/* Response body */}
          {data.executionOutput !== undefined && data.executionOutput !== null && (
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Response Body
              </label>
              {typeof data.executionOutput === 'string' ? (
                <pre className="px-3 py-2 text-xs font-mono bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md overflow-x-auto max-h-64 overflow-y-auto text-text-primary dark:text-dark-text-primary whitespace-pre-wrap break-words">
                  {data.executionOutput}
                </pre>
              ) : (
                <div className="px-2 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md max-h-64 overflow-y-auto">
                  <JsonTreeView
                    data={data.executionOutput}
                    pathPrefix={`${node.id}.output.body`}
                    onClickPath={copyToClipboard}
                  />
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {data.executionError && (
            <div>
              <label className="block text-xs font-medium text-error mb-1">Error</label>
              <pre className="px-3 py-2 text-xs font-mono bg-error/5 border border-error/20 rounded-md overflow-x-auto max-h-32 overflow-y-auto text-error whitespace-pre-wrap break-words">
                {data.executionError as string}
              </pre>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* Label */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Label
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onBlur={() => {
                  if (label !== data.label) pushUpdate({ label });
                }}
                className={INPUT_CLS}
              />
            </div>

            {/* Method + URL */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Method
              </label>
              <div className="flex gap-1">
                {HTTP_METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setMethod(m);
                      pushUpdate({ method: m });
                    }}
                    className={`px-2 py-1 text-[10px] font-mono font-medium rounded transition-colors ${
                      method === m
                        ? METHOD_COLORS[m]
                        : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted hover:text-text-secondary'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                URL
                <span className="ml-1 font-normal text-text-muted/60">
                  (supports {'{{templates}}'})
                </span>
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={() => pushUpdate({ url })}
                className={`${INPUT_CLS} font-mono text-xs`}
                placeholder="https://api.example.com/data/{{node_2.output.id}}"
              />
              <TemplateValidator value={url} upstreamNodes={upstreamNodes} />
            </div>

            {/* Auth */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Auth Type
              </label>
              <select
                value={authType}
                onChange={(e) => {
                  const next = e.target.value as AuthType;
                  setAuthType(next);
                  pushUpdate({ authType: next });
                }}
                className={INPUT_CLS}
              >
                {AUTH_TYPES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {authType === 'bearer' && (
              <div>
                <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                  Token
                </label>
                <input
                  type="text"
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  onBlur={() => pushUpdate({ authToken })}
                  className={`${INPUT_CLS} font-mono text-xs`}
                  placeholder="Bearer token or {{template}}"
                />
              </div>
            )}

            {authType === 'basic' && (
              <div className="space-y-2">
                <div>
                  <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={authUsername}
                    onChange={(e) => setAuthUsername(e.target.value)}
                    onBlur={() => pushUpdate({ authUsername })}
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    onBlur={() => pushUpdate({ authPassword })}
                    className={INPUT_CLS}
                  />
                </div>
              </div>
            )}

            {authType === 'apiKey' && (
              <div className="space-y-2">
                <div>
                  <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                    Header Name
                  </label>
                  <input
                    type="text"
                    value={authHeaderName}
                    onChange={(e) => setAuthHeaderName(e.target.value)}
                    onBlur={() => pushUpdate({ authHeaderName })}
                    className={INPUT_CLS}
                    placeholder="X-API-Key"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                    Token
                  </label>
                  <input
                    type="text"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    onBlur={() => pushUpdate({ authToken })}
                    className={`${INPUT_CLS} font-mono text-xs`}
                    placeholder="API key value or {{template}}"
                  />
                </div>
              </div>
            )}

            {/* Headers */}
            <KeyValueEditor
              label="Headers"
              pairs={headers}
              onChange={(next) => {
                setHeaders(next);
                pushUpdate({ headers: next });
              }}
            />

            {/* Query Params */}
            <KeyValueEditor
              label="Query Params"
              pairs={queryParams}
              onChange={(next) => {
                setQueryParams(next);
                pushUpdate({ queryParams: next });
              }}
            />

            {/* Body (only for POST/PUT/PATCH) */}
            {showBody && (
              <>
                <div>
                  <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                    Body Type
                  </label>
                  <select
                    value={bodyType}
                    onChange={(e) => {
                      const next = e.target.value as BodyType;
                      setBodyType(next);
                      pushUpdate({ bodyType: next });
                    }}
                    className={INPUT_CLS}
                  >
                    {BODY_TYPES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                    Body
                    <span className="ml-1 font-normal text-text-muted/60">
                      (supports {'{{templates}}'})
                    </span>
                  </label>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    onBlur={() => pushUpdate({ body })}
                    rows={5}
                    className={`${INPUT_CLS} resize-y font-mono text-xs`}
                    placeholder={
                      bodyType === 'json'
                        ? '{\n  "key": "{{node_2.output.value}}"\n}'
                        : 'Request body...'
                    }
                  />
                  <TemplateValidator value={body} upstreamNodes={upstreamNodes} />
                </div>
              </>
            )}

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => pushUpdate({ description: description || undefined })}
                rows={2}
                className={`${INPUT_CLS} resize-none`}
                placeholder="Optional: describe this HTTP request"
              />
            </div>

            {/* Upstream outputs */}
            {upstreamNodes.length > 0 && (
              <OutputTreeBrowser upstreamNodes={upstreamNodes} onInsert={injectTemplate} />
            )}
            <OutputAliasField
              data={data as unknown as Record<string, unknown>}
              nodeId={node.id}
              onUpdate={onUpdate}
            />

            {/* Retry / Timeout */}
            <RetryTimeoutFields
              data={data as unknown as Record<string, unknown>}
              nodeId={node.id}
              onUpdate={onUpdate}
            />
          </div>

          {/* Delete button */}
          <div className="p-3 border-t border-border dark:border-dark-border">
            <button
              onClick={() => onDelete(node.id)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-error bg-error/10 hover:bg-error/20 rounded-md transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete HTTP Request
            </button>
          </div>
        </>
      )}
    </div>
  );
}
