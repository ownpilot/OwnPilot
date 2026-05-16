/**
 * Workflow Executors — I/O
 *
 * Nodes that touch the outside world:
 *  - executeHttpRequestNode      — generic HTTP client with SSRF-safe fetch
 *  - executeDelayNode            — abortable wait
 *  - executeNotificationNode     — broadcast via WebSocket
 *  - executeWebhookResponseNode  — configure the HTTP response for webhook triggers
 */

import type {
  WorkflowNode,
  HttpRequestNodeData,
  DelayNodeData,
  WebhookResponseNodeData,
  NodeResult,
} from '../../../db/repositories/workflows.js';
import { getErrorMessage } from '../../../routes/helpers.js';
import { safeFetch, DEFAULT_MAX_REQUEST_BODY_SIZE } from '../../../utils/safe-fetch.js';
import { resolveTemplates } from '../template-resolver.js';
import { log } from './utils.js';

const MAX_RESPONSE_SIZE = 1_048_576; // 1MB default

/**
 * Execute an HTTP Request node: make an API call with configurable method, headers, auth, body.
 */
export async function executeHttpRequestNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): Promise<NodeResult> {
  const startTime = Date.now();
  try {
    const data = node.data as HttpRequestNodeData;

    const resolveMap: Record<string, unknown> = { _url: data.url };
    if (data.body) resolveMap._body = data.body;
    if (data.headers) {
      for (const [k, v] of Object.entries(data.headers)) {
        resolveMap[`_h_${k}`] = v;
      }
    }
    if (data.queryParams) {
      for (const [k, v] of Object.entries(data.queryParams)) {
        resolveMap[`_q_${k}`] = v;
      }
    }
    if (data.auth?.token) resolveMap._authToken = data.auth.token;
    if (data.auth?.username) resolveMap._authUser = data.auth.username;
    if (data.auth?.password) resolveMap._authPass = data.auth.password;

    const resolved = resolveTemplates(resolveMap, nodeOutputs, variables);

    const url = resolved._url as string;

    const headers: Record<string, string> = {};
    if (data.headers) {
      for (const k of Object.keys(data.headers)) {
        headers[k] = resolved[`_h_${k}`] as string;
      }
    }

    if (data.auth && data.auth.type !== 'none') {
      const authToken = (resolved._authToken as string) ?? '';
      switch (data.auth.type) {
        case 'bearer':
          headers['Authorization'] = `Bearer ${authToken}`;
          break;
        case 'basic': {
          const user = (resolved._authUser as string) ?? '';
          const pass = (resolved._authPass as string) ?? '';
          headers['Authorization'] = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
          break;
        }
        case 'apiKey':
          headers[data.auth.headerName ?? 'X-API-Key'] = authToken;
          break;
      }
    }

    const urlObj = new URL(url);
    if (data.queryParams) {
      for (const k of Object.keys(data.queryParams)) {
        urlObj.searchParams.set(k, resolved[`_q_${k}`] as string);
      }
    }

    const fetchOptions: RequestInit = {
      method: data.method,
      headers,
      signal: AbortSignal.timeout(data.timeoutMs ?? 30_000),
    };

    if (['POST', 'PUT', 'PATCH'].includes(data.method) && data.body) {
      fetchOptions.body = resolved._body as string;
      if (data.bodyType === 'json' && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      } else if (data.bodyType === 'form' && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
    }

    const response = await safeFetch(urlObj.toString(), {
      ...fetchOptions,
      maxRequestBodySize: DEFAULT_MAX_REQUEST_BODY_SIZE,
    });

    const maxSize = data.maxResponseSize ?? MAX_RESPONSE_SIZE;
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > maxSize) {
      return {
        nodeId: node.id,
        status: 'error',
        error: `Response too large: ${contentLength} bytes (max: ${maxSize})`,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    const responseText = await response.text();

    let responseBody: unknown = responseText;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        /* keep as text */
      }
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      responseHeaders[k] = v;
    });

    const output = {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
    };

    return {
      nodeId: node.id,
      status: response.ok ? 'success' : 'error',
      output,
      resolvedArgs: { method: data.method, url: urlObj.toString() },
      error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'HTTP request failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Execute a Delay node: wait for a specified duration before continuing.
 */
export async function executeDelayNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>,
  abortSignal?: AbortSignal
): Promise<NodeResult> {
  const startTime = Date.now();
  try {
    const data = node.data as DelayNodeData;

    const resolved = resolveTemplates({ _dur: data.duration }, nodeOutputs, variables);
    const durationValue = Number(resolved._dur);

    if (isNaN(durationValue) || durationValue < 0) {
      return {
        nodeId: node.id,
        status: 'error',
        error: `Invalid delay duration: ${String(resolved._dur)}`,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    const multiplier = data.unit === 'hours' ? 3_600_000 : data.unit === 'minutes' ? 60_000 : 1000;
    const delayMs = durationValue * multiplier;

    const MAX_DELAY_MS = 3_600_000;
    const actualDelay = Math.min(delayMs, MAX_DELAY_MS);
    const resolvedUnit = data.unit ?? 'seconds';

    if (delayMs > MAX_DELAY_MS) {
      log.warn('Delay capped to maximum 1 hour', {
        nodeId: node.id,
        requestedMs: delayMs,
        cappedMs: MAX_DELAY_MS,
      });
    }

    log.info('Delay applied', { nodeId: node.id, delayMs: actualDelay, unit: resolvedUnit });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, actualDelay);
      if (abortSignal) {
        if (abortSignal.aborted) {
          clearTimeout(timer);
          reject(new Error('Workflow execution cancelled'));
          return;
        }
        abortSignal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new Error('Workflow execution cancelled'));
          },
          { once: true }
        );
      }
    });

    return {
      nodeId: node.id,
      status: 'success',
      output: { delayMs: actualDelay, unit: data.unit, value: durationValue },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'Delay execution failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Execute a Notification node: resolve message template, broadcast via WebSocket.
 */
export async function executeNotificationNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): Promise<NodeResult> {
  const startTime = Date.now();
  try {
    const data = node.data as unknown as Record<string, unknown>;
    const severity = (data.severity as string) || 'info';

    const resolvedMsg = resolveTemplates({ _msg: data.message as string }, nodeOutputs, variables)
      ._msg as string;

    let warning: string | undefined;
    try {
      const { wsGateway } = await import('../../../ws/server.js');
      await wsGateway.broadcast('system:notification', {
        type: severity as 'info' | 'warning' | 'error' | 'success',
        message: resolvedMsg,
        source: 'workflow',
      });
      log.info('Notification broadcast sent', { nodeId: node.id, severity });
    } catch {
      warning = 'WebSocket broadcast failed — delivery not confirmed';
      log.warn(`Notification node ${node.id}: failed to broadcast via WebSocket`);
    }

    return {
      nodeId: node.id,
      status: 'success',
      output: {
        sent: !warning,
        channel: 'websocket',
        message: resolvedMsg,
        severity,
        ...(warning ? { warning } : {}),
      },
      resolvedArgs: { message: resolvedMsg, severity },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'Notification node failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Execute a WebhookResponse node: configure the HTTP response for webhook-triggered workflows.
 */
export function executeWebhookResponseNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as WebhookResponseNodeData;

    const resolveMap: Record<string, unknown> = {};
    if (data.body) resolveMap._body = data.body;
    if (data.headers) {
      for (const [k, v] of Object.entries(data.headers)) {
        resolveMap[`_h_${k}`] = v;
      }
    }
    const resolved = resolveTemplates(resolveMap, nodeOutputs, variables);

    const headers: Record<string, string> = {};
    if (data.headers) {
      for (const k of Object.keys(data.headers)) {
        headers[k] = resolved[`_h_${k}`] as string;
      }
    }

    const output = {
      statusCode: data.statusCode ?? 200,
      body: resolved._body ?? '',
      headers,
      contentType: data.contentType ?? 'application/json',
    };

    log.info('WebhookResponse configured', { nodeId: node.id, statusCode: output.statusCode });
    return {
      nodeId: node.id,
      status: 'success',
      output,
      resolvedArgs: { statusCode: output.statusCode, contentType: output.contentType },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'WebhookResponse node failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}
