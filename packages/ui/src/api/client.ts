/**
 * Centralized API Client
 *
 * Typed wrapper around native fetch() for all OwnPilot API calls.
 * Handles:
 *   - Path prefixing (/api/v1)
 *   - ApiResponse<T> envelope unwrapping
 *   - Error normalization (ApiError)
 *   - Query parameter serialization
 *   - SSE streaming (raw Response passthrough)
 *   - Configurable global error callback
 */

// Session token key — must match STORAGE_KEYS.SESSION_TOKEN in constants/storage-keys.ts
const SESSION_TOKEN_KEY = 'ownpilot-session-token';

// ============================================================================
// Types
// ============================================================================

/** Error thrown when an API call fails (non-2xx or success:false). */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    /** HTTP status code (0 for network errors) */
    public readonly status: number,
    /** Error code from gateway (e.g. 'VALIDATION_ERROR', 'NOT_FOUND') */
    public readonly code: string,
    message: string,
    /** Optional details from gateway */
    public readonly details?: unknown,
    /** Gateway request ID (for debugging) */
    public readonly requestId?: string
  ) {
    super(message);
  }
}

export interface RequestOptions {
  /** AbortSignal for request cancellation */
  signal?: AbortSignal;
  /** Query parameters — arrays produce repeated keys: ?status=a&status=b */
  params?: Record<string, string | number | boolean | string[] | undefined>;
  /** Extra headers merged onto defaults */
  headers?: Record<string, string>;
}

export interface StreamOptions extends RequestOptions {
  /** Extra headers (Content-Type is set automatically) */
  headers?: Record<string, string>;
}

interface ApiClientConfig {
  /** Base path prepended to all requests (default: '/api/v1') */
  basePath: string;
  /** @deprecated Use addOnError/removeOnError instead */
  onError?: (error: ApiError) => void;
}

/**
 * Gateway API response envelope.
 * The client unwraps this: returns `data` on success, throws ApiError on failure.
 */
interface ApiEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown } | string;
  meta?: { requestId: string; timestamp: string; processingTime?: number };
}

// ============================================================================
// Query Parameter Serialization
// ============================================================================

function buildQueryString(
  params?: Record<string, string | number | boolean | string[] | undefined>
): string {
  if (!params) return '';

  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }

  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

// ============================================================================
// API Client
// ============================================================================

function createApiClient(config: ApiClientConfig) {
  const { basePath } = config;

  /** Multiple error listeners (replaces the old single-handler pattern) */
  const errorListeners = new Set<(error: ApiError) => void>();

  /** Build full URL from path + optional query params */
  function buildUrl(path: string, params?: RequestOptions['params']): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${basePath}${normalizedPath}${buildQueryString(params)}`;
  }

  /** Unwrap ApiEnvelope — return data on success, throw ApiError on failure */
  async function unwrap<T>(response: Response): Promise<T> {
    let body: ApiEnvelope<T>;

    try {
      body = await response.json();
    } catch {
      // Non-JSON response (e.g. 502 from proxy)
      throw createError(
        response.status,
        'PARSE_ERROR',
        `HTTP ${response.status}: Non-JSON response`
      );
    }

    if (body.success && response.ok) {
      // Successful response — return data (or empty object if no data field)
      return (body.data ?? {}) as T;
    }

    // Error response — extract code and message from the error field
    const errorInfo = normalizeErrorField(body.error);
    throw createError(
      response.status,
      errorInfo.code,
      errorInfo.message,
      errorInfo.details,
      body.meta?.requestId
    );
  }

  /** Normalize the error field which can be a string or an object */
  function normalizeErrorField(error?: ApiEnvelope['error']): {
    code: string;
    message: string;
    details?: unknown;
  } {
    if (!error) {
      return { code: 'UNKNOWN_ERROR', message: 'Unknown error' };
    }
    if (typeof error === 'string') {
      return { code: 'ERROR', message: error };
    }
    return { code: error.code, message: error.message, details: error.details };
  }

  /** Create an ApiError and invoke all error listeners */
  function createError(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    requestId?: string
  ): ApiError {
    const err = new ApiError(status, code, message, details, requestId);
    config.onError?.(err);
    for (const listener of errorListeners) {
      try {
        listener(err);
      } catch {
        // Don't let a failing listener break others
      }
    }
    return err;
  }

  /** Inject session token from localStorage if available */
  function injectSessionToken(headers: Record<string, string>): void {
    try {
      const token = localStorage.getItem(SESSION_TOKEN_KEY);
      if (token) {
        headers['X-Session-Token'] = token;
      }
    } catch {
      // localStorage may not be available
    }
  }

  /** Core request method */
  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    const url = buildUrl(path, options?.params);
    const headers: Record<string, string> = { ...options?.headers };

    injectSessionToken(headers);

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: options?.signal,
      });
    } catch (err) {
      // Network error (offline, CORS, DNS failure, abort)
      if (err instanceof Error && err.name === 'AbortError') {
        throw err; // Let callers handle abort specifically
      }
      throw createError(0, 'NETWORK_ERROR', err instanceof Error ? err.message : 'Network error');
    }

    return unwrap<T>(response);
  }

  return {
    /** GET request — returns unwrapped data */
    get<T>(path: string, options?: RequestOptions): Promise<T> {
      return request<T>('GET', path, undefined, options);
    },

    /** POST request — returns unwrapped data */
    post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
      return request<T>('POST', path, body, options);
    },

    /** PUT request — returns unwrapped data */
    put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
      return request<T>('PUT', path, body, options);
    },

    /** PATCH request — returns unwrapped data */
    patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
      return request<T>('PATCH', path, body, options);
    },

    /** DELETE request — returns unwrapped data */
    delete<T>(path: string, options?: RequestOptions): Promise<T> {
      return request<T>('DELETE', path, undefined, options);
    },

    /**
     * POST request that returns the raw Response for SSE streaming.
     * Does NOT unwrap the envelope — caller handles the stream directly.
     */
    async stream(path: string, body: unknown, options?: StreamOptions): Promise<Response> {
      const url = buildUrl(path, options?.params);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...options?.headers,
      };

      injectSessionToken(headers);

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: options?.signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw err;
        }
        throw createError(0, 'NETWORK_ERROR', err instanceof Error ? err.message : 'Network error');
      }

      if (!response.ok) {
        // Try to parse error body
        try {
          const errorBody: ApiEnvelope = await response.json();
          const errorInfo = normalizeErrorField(errorBody.error);
          throw createError(
            response.status,
            errorInfo.code,
            errorInfo.message,
            errorInfo.details,
            errorBody.meta?.requestId
          );
        } catch (parseErr) {
          if (parseErr instanceof ApiError) throw parseErr;
          throw createError(response.status, 'STREAM_ERROR', `HTTP ${response.status}`);
        }
      }

      return response;
    },

    /**
     * @deprecated Use addOnError/removeOnError instead.
     * Sets a single legacy handler (does NOT affect listeners added via addOnError).
     */
    setOnError(handler: (error: ApiError) => void): void {
      config.onError = handler;
    },

    /**
     * Add an error listener. Multiple listeners can coexist.
     * Returns unsubscribe function.
     */
    addOnError(listener: (error: ApiError) => void): () => void {
      errorListeners.add(listener);
      return () => {
        errorListeners.delete(listener);
      };
    },
  };
}

// ============================================================================
// Singleton
// ============================================================================

/** Global API client instance. Configured with /api/v1 base path. */
export const apiClient = createApiClient({
  basePath: '/api/v1',
});

export type ApiClient = ReturnType<typeof createApiClient>;
