/**
 * Weather Tools
 *
 * Get current weather and forecasts for any location.
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../tools.js';
import { getErrorMessage } from '../../services/error-utils.js';
import {
  WeatherDataService,
  createWeatherDataService,
  type WeatherProvider,
  type WeatherForecastDay,
} from '../../services/weather-service.js';

// =============================================================================
// Configuration
// =============================================================================

/**
 * Weather service configuration function
 * This should be overridden in the gateway to use actual settings
 */
let getWeatherConfig: () => { provider: WeatherProvider; apiKey: string } | null = () => null;

/**
 * Set the configuration function (called by gateway)
 */
export function setWeatherConfig(
  configFn: () => { provider: WeatherProvider; apiKey: string } | null
): void {
  getWeatherConfig = configFn;
}

/**
 * Get weather service instance
 */
function getWeatherService(context?: {
  getApiKey?: (name: string) => string | undefined;
}): WeatherDataService | null {
  // Try API Center first
  if (context?.getApiKey) {
    const owmKey = context.getApiKey('openweathermap');
    if (owmKey) {
      return createWeatherDataService({ provider: 'openweathermap', apiKey: owmKey });
    }
    const waKey = context.getApiKey('weatherapi');
    if (waKey) {
      return createWeatherDataService({ provider: 'weatherapi', apiKey: waKey });
    }
  }
  // Fall back to legacy config
  const config = getWeatherConfig();
  if (!config) return null;
  return createWeatherDataService(config);
}

// =============================================================================
// GET WEATHER TOOL
// =============================================================================

export const getWeatherTool: ToolDefinition = {
  name: 'get_weather',
  brief: 'Get current temperature, humidity, wind for a location',
  description:
    'Get current weather conditions for a location. Returns temperature, humidity, wind, and conditions.',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description:
          'City name, address, or coordinates (e.g., "Istanbul", "New York, NY", "40.7,-74.0")',
      },
    },
    required: ['location'],
  },
  configRequirements: [
    {
      name: 'openweathermap',
      displayName: 'OpenWeatherMap',
      description: 'Weather data provider (primary)',
      category: 'weather',
      docsUrl: 'https://openweathermap.org/api',
      configSchema: [
        {
          name: 'api_key',
          label: 'API Key',
          type: 'secret',
          required: true,
          envVar: 'OPENWEATHERMAP_API_KEY',
        },
      ],
    },
    {
      name: 'weatherapi',
      displayName: 'WeatherAPI',
      description: 'Weather data provider (fallback)',
      category: 'weather',
      docsUrl: 'https://www.weatherapi.com/',
      configSchema: [
        {
          name: 'api_key',
          label: 'API Key',
          type: 'secret',
          required: true,
          envVar: 'WEATHERAPI_KEY',
        },
      ],
    },
  ],
};

export const getWeatherExecutor: ToolExecutor = async (
  params,
  context
): Promise<ToolExecutionResult> => {
  const location = params.location as string;

  if (!location || location.trim().length === 0) {
    return {
      content: { error: 'Location is required' },
      isError: true,
    };
  }

  const service = getWeatherService(context);

  if (!service) {
    return {
      content: {
        error: 'Weather service not configured',
        suggestion:
          'Add a weather API key in Settings → API Center or Settings → API Keys (OpenWeatherMap or WeatherAPI)',
      },
      isError: true,
    };
  }

  try {
    const weather = await service.getCurrentWeather(location);

    return {
      content: {
        success: true,
        location: weather.location,
        weather: {
          temperature: `${weather.current.temperature}°C`,
          feelsLike: `${weather.current.feelsLike}°C`,
          condition: weather.current.condition,
          humidity: `${weather.current.humidity}%`,
          wind: `${weather.current.windSpeed} km/h ${weather.current.windDirection}`,
          visibility: `${weather.current.visibility} km`,
          cloudCover: `${weather.current.cloudCover}%`,
          pressure: `${weather.current.pressure} hPa`,
          uvIndex: weather.current.uvIndex,
          isDay: weather.current.isDay,
          icon: weather.current.conditionIcon,
        },
        provider: weather.provider,
        fetchedAt: weather.fetchedAt,
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to get weather');
    return {
      content: { error: errorMessage },
      isError: true,
    };
  }
};

// =============================================================================
// GET FORECAST TOOL
// =============================================================================

export const getWeatherForecastTool: ToolDefinition = {
  name: 'get_weather_forecast',
  brief: 'Get multi-day weather forecast for a location',
  description:
    'Get weather forecast for the next several days. Returns daily highs, lows, conditions, and rain chance.',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City name, address, or coordinates',
      },
      days: {
        type: 'number',
        description: 'Number of days to forecast (1-10, default: 5)',
      },
    },
    required: ['location'],
  },
  configRequirements: [
    {
      name: 'openweathermap',
      displayName: 'OpenWeatherMap',
      description: 'Weather data provider (primary)',
      category: 'weather',
      docsUrl: 'https://openweathermap.org/api',
      configSchema: [
        {
          name: 'api_key',
          label: 'API Key',
          type: 'secret',
          required: true,
          envVar: 'OPENWEATHERMAP_API_KEY',
        },
      ],
    },
    {
      name: 'weatherapi',
      displayName: 'WeatherAPI',
      description: 'Weather data provider (fallback)',
      category: 'weather',
      docsUrl: 'https://www.weatherapi.com/',
      configSchema: [
        {
          name: 'api_key',
          label: 'API Key',
          type: 'secret',
          required: true,
          envVar: 'WEATHERAPI_KEY',
        },
      ],
    },
  ],
};

export const getWeatherForecastExecutor: ToolExecutor = async (
  params,
  context
): Promise<ToolExecutionResult> => {
  const location = params.location as string;
  const days = Math.min(Math.max((params.days as number) || 5, 1), 10);

  if (!location || location.trim().length === 0) {
    return {
      content: { error: 'Location is required' },
      isError: true,
    };
  }

  const service = getWeatherService(context);

  if (!service) {
    return {
      content: {
        error: 'Weather service not configured',
        suggestion: 'Add a weather API key in Settings → API Center or Settings → API Keys',
      },
      isError: true,
    };
  }

  try {
    const forecast = await service.getForecast(location, days);

    return {
      content: {
        success: true,
        location: forecast.location,
        forecast: forecast.forecast.map((day: WeatherForecastDay) => ({
          date: day.date,
          high: `${day.maxTemp}°C`,
          low: `${day.minTemp}°C`,
          avg: `${day.avgTemp}°C`,
          condition: day.condition,
          humidity: `${day.humidity}%`,
          chanceOfRain: `${day.chanceOfRain}%`,
          sunrise: day.sunrise,
          sunset: day.sunset,
          moonPhase: day.moonPhase,
          uvIndex: day.uvIndex,
          icon: day.conditionIcon,
        })),
        days: forecast.forecast.length,
        provider: forecast.provider,
        fetchedAt: forecast.fetchedAt,
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to get forecast');
    return {
      content: { error: errorMessage },
      isError: true,
    };
  }
};

// =============================================================================
// EXPORT ALL WEATHER TOOLS
// =============================================================================

export const WEATHER_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  { definition: getWeatherTool, executor: getWeatherExecutor },
  { definition: getWeatherForecastTool, executor: getWeatherForecastExecutor },
];

export const WEATHER_TOOL_NAMES = WEATHER_TOOLS.map((t) => t.definition.name);
