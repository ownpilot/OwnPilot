/**
 * Channel Plugin Builder
 *
 * Extends the existing PluginBuilder with channel-specific capabilities.
 * Uses the existing `publicApi()` slot to expose the ChannelPluginAPI.
 *
 * Usage:
 *   createChannelPlugin()
 *     .id('channel.telegram')
 *     .name('Telegram')
 *     .version('1.0.0')
 *     .platform('telegram')
 *     .meta({ requiredServices: [...] })
 *     .channelApi((config) => new TelegramChannelAPI(config))
 *     .tool(definition, executor)
 *     .build()
 */

import { PluginBuilder } from '../plugins/index.js';
import type { PluginManifest } from '../plugins/index.js';
import type { ChannelPluginAPI, ChannelPlatform } from './types.js';

// ============================================================================
// Extended Manifest (adds platform field)
// ============================================================================

export interface ChannelPluginManifest extends PluginManifest {
  /** The platform this channel connects to */
  platform: ChannelPlatform;
}

// ============================================================================
// Channel API Factory
// ============================================================================

/**
 * Factory function that creates a ChannelPluginAPI instance.
 * Receives the resolved config from Config Center (requiredServices).
 */
export type ChannelApiFactory = (config: Record<string, unknown>) => ChannelPluginAPI;

// ============================================================================
// Builder
// ============================================================================

export class ChannelPluginBuilder extends PluginBuilder {
  private _platform: ChannelPlatform = '';
  private _channelApiFactory?: ChannelApiFactory;

  /**
   * Declare which platform this channel connects to.
   * This value is stored in the manifest and used by ChannelServiceImpl
   * to discover and group channel plugins.
   */
  platform(platform: ChannelPlatform): this {
    this._platform = platform;
    return this;
  }

  /**
   * Provide the factory that creates the ChannelPluginAPI implementation.
   * The factory receives the resolved config (API keys, settings) when
   * the plugin is enabled.
   */
  channelApi(factory: ChannelApiFactory): this {
    this._channelApiFactory = factory;
    return this;
  }

  /**
   * Get the channel API factory (used by ChannelServiceImpl during enable).
   */
  getChannelApiFactory(): ChannelApiFactory | undefined {
    return this._channelApiFactory;
  }

  /**
   * Get the declared platform.
   */
  getChannelPlatform(): ChannelPlatform {
    return this._platform;
  }

  override build(): {
    manifest: ChannelPluginManifest;
    implementation: ReturnType<PluginBuilder['build']>['implementation'] & {
      channelApiFactory?: ChannelApiFactory;
    };
  } {
    if (!this._platform) {
      throw new Error('Channel plugin must declare a platform via .platform()');
    }

    // Inject channel metadata into manifest
    this.meta({ category: 'channel' as any });

    // Build via parent
    const base = super.build();

    // Create channel-specific manifest
    const manifest: ChannelPluginManifest = {
      ...base.manifest,
      platform: this._platform,
    };

    return {
      manifest,
      implementation: {
        ...base.implementation,
        channelApiFactory: this._channelApiFactory,
      },
    };
  }
}

/**
 * Create a new channel plugin builder.
 *
 * @example
 * ```typescript
 * const telegram = createChannelPlugin()
 *   .id('channel.telegram')
 *   .name('Telegram')
 *   .version('1.0.0')
 *   .platform('telegram')
 *   .channelApi((config) => new TelegramChannelAPI(config))
 *   .build();
 * ```
 */
export function createChannelPlugin(): ChannelPluginBuilder {
  return new ChannelPluginBuilder();
}
