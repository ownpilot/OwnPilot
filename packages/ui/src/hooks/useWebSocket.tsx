/**
 * WebSocket Hook
 *
 * Real-time communication with the gateway
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface WSMessage<T = unknown> {
  type: string;
  payload: T;
  timestamp: string;
  correlationId?: string;
}

export interface UseWebSocketOptions {
  url?: string;
  reconnect?: boolean;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

export interface UseWebSocketResult {
  status: ConnectionStatus;
  sessionId: string | null;
  send: <T>(type: string, payload: T) => void;
  subscribe: <T>(event: string, handler: (data: T) => void) => () => void;
  connect: () => void;
  disconnect: () => void;
}

/**
 * WebSocket hook for real-time gateway communication
 */
export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketResult {
  // Use current location for WebSocket (goes through Vite proxy in dev)
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHost = window.location.host; // includes port

  const {
    url = `${wsProtocol}//${wsHost}/ws`,
    reconnect = true,
    reconnectDelay = 3000,
    maxReconnectAttempts = 5,
  } = options;

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [sessionId, setSessionId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const handlersRef = useRef(new Map<string, Set<(data: unknown) => void>>());

  /**
   * Handle incoming messages
   */
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data) as WSMessage;

      // Handle connection ready
      if (message.type === 'connection:ready') {
        const payload = message.payload as { sessionId: string };
        setSessionId(payload.sessionId);
        reconnectAttemptsRef.current = 0;
      }

      // Notify subscribers
      const handlers = handlersRef.current.get(message.type);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(message.payload);
          } catch (error) {
            console.error(`Error in WebSocket handler for ${message.type}:`, error);
          }
        }
      }

      // Also notify wildcard subscribers
      const wildcardHandlers = handlersRef.current.get('*');
      if (wildcardHandlers) {
        for (const handler of wildcardHandlers) {
          try {
            handler({ type: message.type, payload: message.payload });
          } catch (error) {
            console.error('Error in wildcard WebSocket handler:', error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }, []);

  /**
   * Connect to WebSocket
   */
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setStatus('connecting');

    try {
      wsRef.current = new WebSocket(url);

      wsRef.current.onopen = () => {
        setStatus('connected');
        console.log('WebSocket connected');
      };

      wsRef.current.onmessage = handleMessage;

      wsRef.current.onclose = (event) => {
        setStatus('disconnected');
        setSessionId(null);
        console.log(`WebSocket closed: ${event.code} ${event.reason}`);

        // Attempt reconnection
        if (reconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          console.log(
            `Reconnecting (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`
          );

          reconnectTimerRef.current = setTimeout(() => {
            connect();
          }, reconnectDelay);
        }
      };

      wsRef.current.onerror = (error) => {
        setStatus('error');
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      setStatus('error');
      console.error('Failed to create WebSocket:', error);
    }
  }, [url, reconnect, reconnectDelay, maxReconnectAttempts, handleMessage]);

  /**
   * Disconnect from WebSocket
   */
  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setStatus('disconnected');
    setSessionId(null);
  }, []);

  /**
   * Send a message
   */
  const send = useCallback(<T,>(type: string, payload: T) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot send message');
      return;
    }

    const message: WSMessage<T> = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };

    wsRef.current.send(JSON.stringify(message));
  }, []);

  /**
   * Subscribe to an event
   */
  const subscribe = useCallback(<T,>(event: string, handler: (data: T) => void) => {
    if (!handlersRef.current.has(event)) {
      handlersRef.current.set(event, new Set());
    }

    handlersRef.current.get(event)!.add(handler as (data: unknown) => void);

    // Return unsubscribe function
    return () => {
      handlersRef.current.get(event)?.delete(handler as (data: unknown) => void);
    };
  }, []);

  // Auto-connect on mount - only run once
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only connect on mount

  return {
    status,
    sessionId,
    send,
    subscribe,
    connect,
    disconnect,
  };
}

/**
 * WebSocket context for sharing connection across components
 */
import { createContext, useContext, type ReactNode } from 'react';

const WebSocketContext = createContext<UseWebSocketResult | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const ws = useWebSocket();

  return <WebSocketContext.Provider value={ws}>{children}</WebSocketContext.Provider>;
}

export function useGateway(): UseWebSocketResult {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useGateway must be used within a WebSocketProvider');
  }
  return context;
}
