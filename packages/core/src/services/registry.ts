/**
 * ServiceRegistry - Typed Service Container
 *
 * Central registry for all services in the system.
 * Replaces ad-hoc singleton patterns (getXxx/setXxx) with a typed,
 * lifecycle-aware container.
 *
 * Usage:
 *   import { getServiceRegistry, Services } from '@ownpilot/core';
 *   const log = getServiceRegistry().get(Services.Log);
 *   const events = getServiceRegistry().get(Services.Event);
 */

// ============================================================================
// ServiceToken
// ============================================================================

/**
 * Typed key for service registration and retrieval.
 * The generic parameter T ensures type safety at get/set time.
 */
export class ServiceToken<T> {
  /** @internal Brand field to preserve generic type information */
  declare readonly _type: T;

  constructor(public readonly name: string) {}

  toString(): string {
    return `ServiceToken(${this.name})`;
  }
}

// ============================================================================
// Disposable interface
// ============================================================================

export interface Disposable {
  dispose(): Promise<void> | void;
}

function isDisposable(value: unknown): value is Disposable {
  return (
    value !== null &&
    typeof value === 'object' &&
    'dispose' in value &&
    typeof (value as Disposable).dispose === 'function'
  );
}

// ============================================================================
// ServiceRegistry
// ============================================================================

export class ServiceRegistry {
  private readonly instances = new Map<string, unknown>();
  private readonly factories = new Map<string, () => unknown>();
  private readonly disposables: Disposable[] = [];

  /**
   * Register a service instance.
   * If the instance implements Disposable, it will be cleaned up on dispose().
   */
  register<T>(token: ServiceToken<T>, instance: T): void {
    this.instances.set(token.name, instance);
    if (isDisposable(instance)) {
      this.disposables.push(instance);
    }
  }

  /**
   * Register a lazy factory. The factory is called once on first get().
   */
  registerFactory<T>(token: ServiceToken<T>, factory: () => T): void {
    this.factories.set(token.name, factory);
  }

  /**
   * Get a registered service. Throws if not found.
   */
  get<T>(token: ServiceToken<T>): T {
    const existing = this.instances.get(token.name);
    if (existing !== undefined) return existing as T;

    const factory = this.factories.get(token.name);
    if (factory) {
      const instance = factory() as T;
      this.instances.set(token.name, instance);
      this.factories.delete(token.name);
      if (isDisposable(instance)) {
        this.disposables.push(instance);
      }
      return instance;
    }

    throw new Error(
      `Service '${token.name}' not registered. ` +
      `Make sure it is registered during startup before use.`
    );
  }

  /**
   * Get a registered service, or null if not found.
   */
  tryGet<T>(token: ServiceToken<T>): T | null {
    try {
      return this.get(token);
    } catch {
      return null;
    }
  }

  /**
   * Check if a service is registered (either as instance or factory).
   */
  has<T>(token: ServiceToken<T>): boolean {
    return this.instances.has(token.name) || this.factories.has(token.name);
  }

  /**
   * List all registered service names.
   */
  list(): string[] {
    const names = new Set([
      ...this.instances.keys(),
      ...this.factories.keys(),
    ]);
    return [...names];
  }

  /**
   * Dispose all disposable services in reverse registration order.
   */
  async dispose(): Promise<void> {
    const toDispose = [...this.disposables].reverse();
    for (const d of toDispose) {
      try {
        await d.dispose();
      } catch {
        // Best-effort cleanup
      }
    }
    this.instances.clear();
    this.factories.clear();
    this.disposables.length = 0;
  }
}

// ============================================================================
// Singleton Access
// ============================================================================

let _registry: ServiceRegistry | null = null;

/**
 * Initialize the global ServiceRegistry.
 * Call once during application startup, before registering services.
 */
export function initServiceRegistry(): ServiceRegistry {
  if (_registry) {
    throw new Error(
      'ServiceRegistry already initialized. Call resetServiceRegistry() first if re-initializing.'
    );
  }
  _registry = new ServiceRegistry();
  return _registry;
}

/**
 * Get the global ServiceRegistry.
 * Throws if not initialized.
 */
export function getServiceRegistry(): ServiceRegistry {
  if (!_registry) {
    throw new Error(
      'ServiceRegistry not initialized. Call initServiceRegistry() during startup.'
    );
  }
  return _registry;
}

/**
 * Check if the ServiceRegistry has been initialized.
 */
export function hasServiceRegistry(): boolean {
  return _registry !== null;
}

/**
 * Reset the global ServiceRegistry (for testing).
 * Disposes all registered services.
 */
export async function resetServiceRegistry(): Promise<void> {
  if (_registry) {
    await _registry.dispose();
  }
  _registry = null;
}
