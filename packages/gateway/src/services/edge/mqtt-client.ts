/**
 * Edge MQTT Client
 *
 * Singleton MQTT client for communicating with IoT/edge devices.
 * Connects to an external Mosquitto (or any MQTT 3.1.1/5.0) broker.
 * Dormant if MQTT_BROKER_URL is not configured.
 */

import { getLog } from '../log.js';

const log = getLog('EdgeMqtt');

// =============================================================================
// Types
// =============================================================================

type MqttClient = {
  on(event: string, cb: (...args: unknown[]) => void): void;
  subscribe(topic: string, cb?: (err?: Error) => void): void;
  unsubscribe(topic: string, cb?: (err?: Error) => void): void;
  publish(topic: string, message: string, cb?: (err?: Error) => void): void;
  end(force?: boolean, cb?: () => void): void;
  connected: boolean;
};

type MqttConnectFn = (url: string, opts?: Record<string, unknown>) => MqttClient;

type MqttMessageHandler = (topic: string, payload: unknown) => void;

// =============================================================================
// Topic Helpers
// =============================================================================

const BASE_PREFIX = 'ownpilot';

export function telemetryTopic(userId: string, deviceId: string): string {
  return `${BASE_PREFIX}/${userId}/devices/${deviceId}/telemetry`;
}

export function commandTopic(userId: string, deviceId: string): string {
  return `${BASE_PREFIX}/${userId}/devices/${deviceId}/commands`;
}

export function statusTopic(userId: string, deviceId: string): string {
  return `${BASE_PREFIX}/${userId}/devices/${deviceId}/status`;
}

/** Wildcard topic for all telemetry across all users/devices */
export function telemetryWildcard(): string {
  return `${BASE_PREFIX}/+/devices/+/telemetry`;
}

/** Wildcard topic for all status messages */
export function statusWildcard(): string {
  return `${BASE_PREFIX}/+/devices/+/status`;
}

/**
 * Parse userId and deviceId from a topic matching the pattern:
 * ownpilot/{userId}/devices/{deviceId}/{suffix}
 */
export function parseTopicIds(topic: string): { userId: string; deviceId: string } | null {
  const parts = topic.split('/');
  if (parts.length < 5 || parts[0] !== BASE_PREFIX || parts[2] !== 'devices') return null;
  const userId = parts[1];
  const deviceId = parts[3];
  if (!userId || !deviceId) return null;
  return { userId, deviceId };
}

// =============================================================================
// EdgeMqttClient
// =============================================================================

export class EdgeMqttClient {
  private client: MqttClient | null = null;
  private brokerUrl: string | null = null;
  private handlers = new Map<string, Set<MqttMessageHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private connectFn: MqttConnectFn | null = null;

  /**
   * Connect to MQTT broker. If url is not provided, reads MQTT_BROKER_URL env.
   * Returns false if no broker URL is configured (edge features dormant).
   */
  async connect(url?: string): Promise<boolean> {
    this.brokerUrl =
      url ||
      process.env.MQTT_BROKER_URL ||
      (process.env.MQTT_BROKER_HOST
        ? `mqtt://${process.env.MQTT_BROKER_HOST}:${process.env.MQTT_PORT ?? '1883'}`
        : '');
    if (!this.brokerUrl) {
      log.info('No MQTT_BROKER_URL configured — edge MQTT features dormant');
      return false;
    }

    log.info(`Attempting MQTT connection to: ${this.brokerUrl}`);

    // Lazy-load mqtt package
    if (!this.connectFn) {
      try {
        const mqtt = await import('mqtt');
        this.connectFn = (mqtt.default?.connect ?? mqtt.connect) as MqttConnectFn;
      } catch {
        log.warn('mqtt package not installed — edge MQTT features unavailable');
        return false;
      }
    }

    return this.doConnect();
  }

  private doConnect(): boolean {
    if (!this.connectFn || !this.brokerUrl) return false;

    // doConnect runs on every reconnect (scheduleReconnect) and on a
    // re-entrant connect(). The previous client must be torn down, otherwise
    // each reconnect leaks its socket/fd, keepalive timer, and event listeners
    // (reconnectPeriod:0 means mqtt.js never reuses or closes it for us). We
    // end it AFTER wiring up the replacement below — the identity guard on each
    // handler neutralizes the old client's events, so end()'s own 'close' can't
    // trigger a spurious reconnect against the live client.
    const previous = this.client;

    try {
      const client = this.connectFn(this.brokerUrl, {
        reconnectPeriod: 0, // We handle reconnection ourselves
        connectTimeout: 10000,
        clean: true,
      });
      this.client = client;

      // Each handler no-ops once it is no longer the live client. Without this,
      // a stale client (replaced by a reconnect, or torn down by disconnect)
      // could still dispatch duplicate messages or schedule reconnects after we
      // have moved on.
      client.on('connect', () => {
        if (this.client !== client) return;
        log.info(`Connected to MQTT broker: ${this.brokerUrl}`);
        this.reconnectDelay = 1000;

        // Resubscribe to all topics
        for (const topic of this.handlers.keys()) {
          client.subscribe(topic);
        }
      });

      client.on('message', (topic: unknown, message: unknown) => {
        if (this.client !== client) return;
        const topicStr = String(topic);
        const payload = this.parsePayload(message);
        this.dispatchMessage(topicStr, payload);
      });

      client.on('error', (err: unknown) => {
        if (this.client !== client) return;
        log.warn(`MQTT error: ${err instanceof Error ? err.message : String(err)}`);
      });

      client.on('close', () => {
        if (this.client !== client) return;
        log.info('MQTT connection closed');
        this.scheduleReconnect();
      });

      client.on('offline', () => {
        if (this.client !== client) return;
        log.info('MQTT client offline');
        this.scheduleReconnect();
      });

      // Tear down the previous client now that the replacement is live and its
      // handlers are neutralized by the identity guard above.
      if (previous) {
        try {
          previous.end(true);
        } catch {
          /* best-effort teardown of the stale client */
        }
      }

      return true;
    } catch (err) {
      log.warn(`Failed to connect to MQTT: ${err instanceof Error ? err.message : String(err)}`);
      this.scheduleReconnect();
      return false;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      log.info(`Attempting MQTT reconnect (delay: ${this.reconnectDelay}ms)`);
      this.doConnect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }, this.reconnectDelay);
  }

  /**
   * Disconnect from broker.
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Null the reference BEFORE end() so the identity guard in the client's
    // event handlers neutralizes any 'close'/'offline' that end() emits —
    // otherwise an intentional disconnect would schedule a reconnect.
    const client = this.client;
    this.client = null;
    if (client) {
      try {
        client.end(true);
      } catch {
        /* best-effort */
      }
    }
    this.brokerUrl = null;
    log.info('MQTT client disconnected');
  }

  /**
   * Subscribe to a topic with a handler.
   */
  subscribe(topic: string, handler: MqttMessageHandler): () => void {
    let handlers = this.handlers.get(topic);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(topic, handlers);
      this.client?.subscribe(topic);
    }
    handlers.add(handler);

    return () => {
      handlers?.delete(handler);
      if (handlers?.size === 0) {
        this.handlers.delete(topic);
        this.client?.unsubscribe(topic);
      }
    };
  }

  /**
   * Publish a message to a topic.
   */
  publish(topic: string, payload: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client?.connected) {
        reject(new Error('MQTT client not connected'));
        return;
      }

      const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
      this.client.publish(topic, message, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Check if connected to broker.
   */
  isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  /**
   * Get broker URL (for status display).
   */
  getBrokerUrl(): string | null {
    return this.brokerUrl;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private parsePayload(message: unknown): unknown {
    if (
      message instanceof Buffer ||
      (message && typeof message === 'object' && 'toString' in message)
    ) {
      const str = String(message);
      try {
        return JSON.parse(str);
      } catch {
        return str;
      }
    }
    return message;
  }

  private dispatchMessage(topic: string, payload: unknown): void {
    // Exact match
    const exact = this.handlers.get(topic);
    if (exact) {
      for (const handler of exact) {
        try {
          handler(topic, payload);
        } catch (err) {
          log.warn(`MQTT handler error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // Wildcard matches (+ and #)
    for (const [pattern, handlers] of this.handlers) {
      if (pattern === topic) continue;
      if (this.matchesTopic(pattern, topic)) {
        for (const handler of handlers) {
          try {
            handler(topic, payload);
          } catch (err) {
            log.warn(`MQTT handler error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    }
  }

  private matchesTopic(pattern: string, topic: string): boolean {
    const patternParts = pattern.split('/');
    const topicParts = topic.split('/');

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '#') return true;
      // '+' matches exactly ONE level — which must actually exist. Without the
      // bounds check, a pattern like `a/+/#` would wrongly match the shorter
      // topic `a` (the '+' "matching" a non-existent level, then '#' returning
      // true). Per the MQTT spec, '+' requires a present level.
      if (patternParts[i] === '+') {
        if (i >= topicParts.length) return false;
        continue;
      }
      if (i >= topicParts.length || patternParts[i] !== topicParts[i]) return false;
    }

    return patternParts.length === topicParts.length;
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: EdgeMqttClient | null = null;

export function getEdgeMqttClient(): EdgeMqttClient {
  if (!instance) {
    instance = new EdgeMqttClient();
  }
  return instance;
}

/**
 * Reset the singleton (for testing or shutdown).
 */
export function resetEdgeMqttClient(): void {
  if (instance) {
    instance.disconnect();
  }
  instance = null;
}
