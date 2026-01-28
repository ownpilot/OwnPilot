/**
 * Example Marketplace Plugin: Weather Service
 *
 * This plugin demonstrates how to build a secure, marketplace-ready plugin
 * for the OwnPilot system.
 *
 * DEMONSTRATES:
 * - Proper MarketplaceManifest structure
 * - Capability-based permission requests
 * - Network domain restrictions
 * - Plugin storage usage
 * - Tool registration
 * - Security-conscious design (NO access to memory/credentials)
 *
 * USE CASES:
 * - Morning briefings with weather data
 * - Scheduled weather alerts
 * - Travel planning assistance
 */

import type { MarketplaceManifest, SecurityDeclaration } from '../marketplace.js';
import type { PluginCapability } from '../isolation.js';
import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../../agent/types.js';

// =============================================================================
// Plugin Manifest
// =============================================================================

/**
 * Security declaration for the weather plugin
 */
const WEATHER_SECURITY_DECLARATION: SecurityDeclaration = {
  dataAccess: {
    collectsPersonalData: false,
    sharesDataWithThirdParties: false,
    dataRetentionDays: 7,
  },
  networkAccess: {
    makesExternalRequests: true,
    domains: [
      'api.openweathermap.org',
      'api.weather.gov',
      'api.weatherapi.com',
    ],
    sendsUserData: false,
    receivesRemoteCode: false,
  },
  storageAccess: {
    usesLocalStorage: true,
    estimatedStorageBytes: 1024 * 1024, // 1MB
    encryptsStoredData: false,
  },
  execution: {
    executesCode: false,
    usesSandbox: false,
    spawnsProcesses: false,
  },
  privacy: {
    logsUserActivity: false,
    hasAnalytics: false,
  },
  riskLevel: 'low',
  riskFactors: [],
};

/**
 * Weather Plugin Manifest
 *
 * This is the marketplace manifest that declares all plugin metadata,
 * capabilities, and security requirements.
 */
export const WEATHER_PLUGIN_MANIFEST: MarketplaceManifest = {
  // === Basic Information ===
  id: 'dev.ownpilot.weather',
  name: 'Weather Service',
  version: '1.0.0',
  description: 'Get weather forecasts and alerts for any location',
  longDescription: 'A comprehensive weather plugin that provides current weather, forecasts, and alerts for any location worldwide. Perfect for morning briefings, travel planning, and scheduled weather notifications.',

  // === Publisher Info ===
  publisher: {
    id: 'ownpilot',
    name: 'OwnPilot Team',
    email: 'plugins@ownpilot.io',
    website: 'https://ownpilot.io',
    verified: true,
  },

  // === Marketplace Metadata ===
  category: 'utilities',
  tags: ['weather', 'forecast', 'alerts', 'location', 'scheduling'],
  homepage: 'https://github.com/ownpilot/weather-plugin',
  repository: 'https://github.com/ownpilot/weather-plugin',
  icon: 'data:image/svg+xml,...',
  screenshots: [
    'https://ownpilot.io/plugins/weather/screenshot1.png',
  ],

  // === Entry Points ===
  main: 'index.js',
  files: ['index.js', 'weather-service.js'],

  // === Compatibility ===
  compatibility: {
    minGatewayVersion: '0.1.0',
    platforms: ['windows', 'macos', 'linux'],
  },

  // === Required Capabilities ===
  capabilities: [
    'network:fetch',
    'network:domains:specific',
    'storage:read',
    'storage:write',
    'storage:quota:1mb',
    'tools:register',
    'events:subscribe',
    'events:emit',
  ] as PluginCapability[],

  // === Security Declarations ===
  security: WEATHER_SECURITY_DECLARATION,

  // === Pricing ===
  pricing: {
    type: 'free',
  },
};

// =============================================================================
// Weather Data Types
// =============================================================================

/**
 * Weather condition
 */
export interface WeatherCondition {
  main: string;
  description: string;
  icon: string;
}

/**
 * Current weather data
 */
export interface CurrentWeather {
  location: string;
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  windDirection: string;
  condition: WeatherCondition;
  visibility: number;
  pressure: number;
  timestamp: string;
}

/**
 * Weather forecast entry
 */
export interface ForecastEntry {
  date: string;
  high: number;
  low: number;
  condition: WeatherCondition;
  precipitationChance: number;
  humidity: number;
  windSpeed: number;
}

/**
 * Weather alert
 */
export interface WeatherAlert {
  type: 'warning' | 'watch' | 'advisory';
  event: string;
  headline: string;
  description: string;
  severity: 'minor' | 'moderate' | 'severe' | 'extreme';
  startTime: string;
  endTime: string;
  areas: string[];
}

/**
 * Weather API response
 */
export interface WeatherResponse {
  success: boolean;
  current?: CurrentWeather;
  forecast?: ForecastEntry[];
  alerts?: WeatherAlert[];
  error?: string;
  cached?: boolean;
}

// =============================================================================
// Plugin Configuration
// =============================================================================

/**
 * Weather plugin configuration
 */
export interface WeatherPluginConfig {
  provider: 'openweathermap' | 'weatherapi' | 'weathergov';
  defaultLocation?: string;
  unit: 'celsius' | 'fahrenheit';
  enableAlerts: boolean;
  cacheDuration: number;
  language: string;
}

/**
 * Default configuration
 */
export const DEFAULT_WEATHER_CONFIG: WeatherPluginConfig = {
  provider: 'openweathermap',
  unit: 'celsius',
  enableAlerts: true,
  cacheDuration: 30,
  language: 'en',
};

// =============================================================================
// Weather Service Implementation
// =============================================================================

/**
 * Storage interface that the weather service expects
 */
interface WeatherStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
}

/**
 * Logger interface
 */
interface WeatherLogger {
  info(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Network interface
 */
interface WeatherNetwork {
  fetch(url: string, options?: { timeout?: number }): Promise<{
    status: number;
    body: string;
  }>;
}

/**
 * Weather Service API interface
 */
export interface WeatherServiceAPI {
  storage?: WeatherStorage;
  network?: WeatherNetwork;
  log?: WeatherLogger;
}

/**
 * Weather Service
 *
 * Core weather functionality using the isolated plugin API.
 */
export class WeatherService {
  private readonly api: WeatherServiceAPI;
  private config: WeatherPluginConfig = DEFAULT_WEATHER_CONFIG;

  constructor(api: WeatherServiceAPI) {
    this.api = api;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.api.storage) {
      const stored = await this.api.storage.get('config');
      if (stored && typeof stored === 'object') {
        this.config = { ...DEFAULT_WEATHER_CONFIG, ...(stored as Partial<WeatherPluginConfig>) };
      }
    }
    this.api.log?.info('Weather service initialized', { provider: this.config.provider });
  }

  /**
   * Save configuration
   */
  async saveConfig(config: Partial<WeatherPluginConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
    if (this.api.storage) {
      await this.api.storage.set('config', this.config);
    }
  }

  /**
   * Get current weather for a location
   */
  async getCurrentWeather(location: string): Promise<WeatherResponse> {
    const cacheKey = `weather:current:${location.toLowerCase()}`;

    // Check cache
    const cached = await this.getFromCache<CurrentWeather>(cacheKey);
    if (cached) {
      return { success: true, current: cached, cached: true };
    }

    // Fetch from API
    try {
      const weather = await this.fetchCurrentWeather(location);
      await this.saveToCache(cacheKey, weather);
      return { success: true, current: weather, cached: false };
    } catch (error) {
      this.api.log?.error('Failed to fetch weather', { location, error: String(error) });
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get weather forecast
   */
  async getForecast(location: string, days: number = 5): Promise<WeatherResponse> {
    const cacheKey = `weather:forecast:${location.toLowerCase()}:${days}`;

    const cached = await this.getFromCache<ForecastEntry[]>(cacheKey);
    if (cached) {
      return { success: true, forecast: cached, cached: true };
    }

    try {
      const forecast = await this.fetchForecast(location, days);
      await this.saveToCache(cacheKey, forecast);
      return { success: true, forecast, cached: false };
    } catch (error) {
      this.api.log?.error('Failed to fetch forecast', { location, error: String(error) });
      return { success: false, error: String(error) };
    }
  }

  /**
   * Format weather for display
   */
  formatWeatherSummary(weather: CurrentWeather): string {
    const temp = this.formatTemperature(weather.temperature);
    const feelsLike = this.formatTemperature(weather.feelsLike);

    return [
      `**${weather.location}**`,
      `${weather.condition.description}`,
      `Temperature: ${temp} (feels like ${feelsLike})`,
      `Humidity: ${weather.humidity}%`,
      `Wind: ${weather.windSpeed} km/h ${weather.windDirection}`,
    ].join('\n');
  }

  /**
   * Format forecast for display
   */
  formatForecastSummary(forecast: ForecastEntry[]): string {
    return forecast.map(day => {
      const high = this.formatTemperature(day.high);
      const low = this.formatTemperature(day.low);
      return `**${day.date}**: ${day.condition.main} (${high}/${low})`;
    }).join('\n');
  }

  private formatTemperature(celsius: number): string {
    if (this.config.unit === 'fahrenheit') {
      return `${Math.round((celsius * 9 / 5) + 32)}°F`;
    }
    return `${Math.round(celsius)}°C`;
  }

  private async getFromCache<T>(key: string): Promise<T | null> {
    if (!this.api.storage) return null;

    const cached = await this.api.storage.get(key) as {
      data: T;
      timestamp: number;
    } | null;

    if (!cached) return null;

    const age = (Date.now() - cached.timestamp) / 1000 / 60;
    if (age > this.config.cacheDuration) {
      await this.api.storage.delete(key);
      return null;
    }

    return cached.data;
  }

  private async saveToCache<T>(key: string, data: T): Promise<void> {
    if (!this.api.storage) return;
    await this.api.storage.set(key, { data, timestamp: Date.now() });
  }

  private async fetchCurrentWeather(location: string): Promise<CurrentWeather> {
    if (!this.api.network) {
      throw new Error('Network access not available');
    }

    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&units=metric`;
    const response = await this.api.network.fetch(url, { timeout: 10000 });

    if (response.status !== 200) {
      throw new Error(`Weather API returned status ${response.status}`);
    }

    const data = JSON.parse(response.body);
    return this.transformCurrentWeather(data, location);
  }

  private async fetchForecast(location: string, days: number): Promise<ForecastEntry[]> {
    if (!this.api.network) {
      throw new Error('Network access not available');
    }

    const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(location)}&cnt=${days * 8}&units=metric`;
    const response = await this.api.network.fetch(url, { timeout: 10000 });

    if (response.status !== 200) {
      throw new Error(`Weather API returned status ${response.status}`);
    }

    const data = JSON.parse(response.body);
    return this.transformForecast(data);
  }

  private transformCurrentWeather(data: Record<string, unknown>, location: string): CurrentWeather {
    const main = data.main as Record<string, number> | undefined;
    const wind = data.wind as Record<string, number> | undefined;
    const weatherArr = data.weather as Array<Record<string, string>> | undefined;
    const weather = weatherArr?.[0];

    return {
      location: (data.name as string) ?? location,
      temperature: main?.temp ?? 0,
      feelsLike: main?.feels_like ?? 0,
      humidity: main?.humidity ?? 0,
      windSpeed: wind?.speed ?? 0,
      windDirection: this.degreesToDirection(wind?.deg ?? 0),
      condition: {
        main: weather?.main ?? 'Unknown',
        description: weather?.description ?? 'No data',
        icon: weather?.icon ?? '01d',
      },
      visibility: (data.visibility as number) ?? 10000,
      pressure: main?.pressure ?? 1013,
      timestamp: new Date().toISOString(),
    };
  }

  private transformForecast(data: Record<string, unknown>): ForecastEntry[] {
    const list = data.list as Array<Record<string, unknown>> | undefined;
    if (!list) return [];

    const dailyData = new Map<string, ForecastEntry>();

    for (const item of list) {
      const dt = new Date((item.dt as number) * 1000);
      const dateKey = dt.toISOString().split('T')[0]!;

      const main = item.main as Record<string, number> | undefined;
      const weatherArr = item.weather as Array<Record<string, string>> | undefined;
      const weather = weatherArr?.[0];
      const temp = main?.temp ?? 0;

      const existing = dailyData.get(dateKey);
      if (!existing) {
        dailyData.set(dateKey, {
          date: dateKey,
          high: temp,
          low: temp,
          condition: {
            main: weather?.main ?? 'Unknown',
            description: weather?.description ?? '',
            icon: weather?.icon ?? '01d',
          },
          precipitationChance: (item.pop as number) ?? 0,
          humidity: main?.humidity ?? 0,
          windSpeed: (item.wind as Record<string, number>)?.speed ?? 0,
        });
      } else {
        existing.high = Math.max(existing.high, temp);
        existing.low = Math.min(existing.low, temp);
      }
    }

    return Array.from(dailyData.values());
  }

  private degreesToDirection(degrees: number): string {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(degrees / 45) % 8]!;
  }
}

// =============================================================================
// Tool Definitions
// =============================================================================

/**
 * Weather current tool definition
 */
export const WEATHER_CURRENT_TOOL: ToolDefinition = {
  name: 'weather_current',
  description: 'Get current weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City name or location (e.g., "London, UK")',
      },
    },
    required: ['location'],
  },
};

/**
 * Weather forecast tool definition
 */
export const WEATHER_FORECAST_TOOL: ToolDefinition = {
  name: 'weather_forecast',
  description: 'Get weather forecast for a location',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City name or location',
      },
      days: {
        type: 'number',
        description: 'Number of days (1-7)',
      },
    },
    required: ['location'],
  },
};

/**
 * Weather configure tool definition
 */
export const WEATHER_CONFIGURE_TOOL: ToolDefinition = {
  name: 'weather_configure',
  description: 'Configure weather plugin settings',
  parameters: {
    type: 'object',
    properties: {
      unit: {
        type: 'string',
        enum: ['celsius', 'fahrenheit'],
        description: 'Temperature unit',
      },
      defaultLocation: {
        type: 'string',
        description: 'Default location for weather queries',
      },
      enableAlerts: {
        type: 'boolean',
        description: 'Enable weather alerts',
      },
    },
  },
};

// =============================================================================
// Tool Executor Factory
// =============================================================================

/**
 * Create tool executors for the weather plugin
 */
export function createWeatherToolExecutors(service: WeatherService): {
  current: ToolExecutor;
  forecast: ToolExecutor;
  configure: ToolExecutor;
} {
  const currentExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
    const location = args.location as string;
    const result = await service.getCurrentWeather(location);

    if (result.success && result.current) {
      return {
        content: {
          success: true,
          weather: result.current,
          summary: service.formatWeatherSummary(result.current),
          cached: result.cached,
        },
      };
    }

    return {
      content: { success: false, error: result.error },
      isError: true,
    };
  };

  const forecastExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
    const location = args.location as string;
    const days = (args.days as number) ?? 5;
    const result = await service.getForecast(location, Math.min(Math.max(days, 1), 7));

    if (result.success && result.forecast) {
      return {
        content: {
          success: true,
          forecast: result.forecast,
          summary: service.formatForecastSummary(result.forecast),
          cached: result.cached,
        },
      };
    }

    return {
      content: { success: false, error: result.error },
      isError: true,
    };
  };

  const configureExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
    await service.saveConfig(args as Partial<WeatherPluginConfig>);
    return {
      content: {
        success: true,
        message: 'Weather plugin configuration updated',
        settings: args,
      },
    };
  };

  return {
    current: currentExecutor,
    forecast: forecastExecutor,
    configure: configureExecutor,
  };
}

// =============================================================================
// Plugin Registration Helper
// =============================================================================

/**
 * Weather plugin tools bundle
 */
export interface WeatherPluginTools {
  definitions: ToolDefinition[];
  executors: Map<string, ToolExecutor>;
  service: WeatherService;
}

/**
 * Create weather plugin tools
 */
export function createWeatherPluginTools(api: WeatherServiceAPI): WeatherPluginTools {
  const service = new WeatherService(api);
  const executors = createWeatherToolExecutors(service);

  return {
    definitions: [
      WEATHER_CURRENT_TOOL,
      WEATHER_FORECAST_TOOL,
      WEATHER_CONFIGURE_TOOL,
    ],
    executors: new Map([
      ['weather_current', executors.current],
      ['weather_forecast', executors.forecast],
      ['weather_configure', executors.configure],
    ]),
    service,
  };
}

// =============================================================================
// Exports
// =============================================================================

export {
  WEATHER_PLUGIN_MANIFEST as manifest,
  WEATHER_SECURITY_DECLARATION as securityDeclaration,
};
