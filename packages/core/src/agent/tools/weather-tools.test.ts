/**
 * Weather Tools Tests
 * Comprehensive test suite for weather tool executors, definitions, service resolution, and exports.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Hoisted mocks (available before dynamic import)
// ============================================================================

const mockGetErrorMessage = vi.hoisted(() =>
  vi.fn((err: unknown, fallback?: string) =>
    err instanceof Error ? err.message : (fallback ?? String(err))
  )
);

const mockCreateWeatherDataService = vi.hoisted(() => vi.fn());

vi.mock('../../services/error-utils.js', () => ({
  getErrorMessage: (...args: unknown[]) => mockGetErrorMessage(...args),
}));

vi.mock('../../services/weather-service.js', () => ({
  createWeatherDataService: (...args: unknown[]) => mockCreateWeatherDataService(...args),
}));

// ============================================================================
// Dynamic import after mocks
// ============================================================================

const {
  setWeatherConfig,
  getWeatherTool,
  getWeatherForecastTool,
  getWeatherExecutor,
  getWeatherForecastExecutor,
  WEATHER_TOOLS,
  WEATHER_TOOL_NAMES,
} = await import('./weather-tools.js');

// ============================================================================
// Test helpers
// ============================================================================

function makeMockService() {
  return {
    getCurrentWeather: vi.fn(),
    getForecast: vi.fn(),
  };
}

function makeWeatherResponse(overrides = {}) {
  return {
    location: 'Istanbul, TR',
    current: {
      temperature: 22,
      feelsLike: 24,
      condition: 'Sunny',
      humidity: 45,
      windSpeed: 15,
      windDirection: 'NW',
      visibility: 10,
      cloudCover: 20,
      pressure: 1013,
      uvIndex: 5,
      isDay: true,
      conditionIcon: '☀️',
    },
    provider: 'openweathermap',
    fetchedAt: '2026-02-21T12:00:00Z',
    ...overrides,
  };
}

function makeForecastDay(overrides = {}) {
  return {
    date: '2026-02-22',
    maxTemp: 25,
    minTemp: 15,
    avgTemp: 20,
    condition: 'Sunny',
    humidity: 40,
    chanceOfRain: 10,
    sunrise: '07:00',
    sunset: '18:00',
    moonPhase: 'Waxing',
    uvIndex: 6,
    conditionIcon: '☀️',
    ...overrides,
  };
}

function makeForecastResponse(
  days: ReturnType<typeof makeForecastDay>[] = [makeForecastDay()],
  overrides = {}
) {
  return {
    location: 'Istanbul, TR',
    forecast: days,
    provider: 'openweathermap',
    fetchedAt: '2026-02-21T12:00:00Z',
    ...overrides,
  };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  setWeatherConfig(() => null);
});

// ============================================================================
// setWeatherConfig
// ============================================================================

describe('setWeatherConfig', () => {
  it('should accept a config function', () => {
    expect(() =>
      setWeatherConfig(() => ({ provider: 'openweathermap' as const, apiKey: 'key-1' }))
    ).not.toThrow();
  });

  it('should allow resetting to null-returning function', () => {
    setWeatherConfig(() => ({ provider: 'openweathermap' as const, apiKey: 'key-1' }));
    setWeatherConfig(() => null);
    // Verify null config means no service — tested indirectly via executor
  });
});

// ============================================================================
// getWeatherService (tested indirectly through executors)
// ============================================================================

describe('getWeatherService resolution order', () => {
  it('should use openweathermap key from context.getApiKey first', async () => {
    const svc = makeMockService();
    svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());
    mockCreateWeatherDataService.mockReturnValue(svc);

    const context = {
      getApiKey: vi.fn((name: string) => (name === 'openweathermap' ? 'owm-key-123' : undefined)),
    };

    await getWeatherExecutor({ location: 'Istanbul' }, context);

    expect(mockCreateWeatherDataService).toHaveBeenCalledWith({
      provider: 'openweathermap',
      apiKey: 'owm-key-123',
    });
  });

  it('should fall through to weatherapi when openweathermap key is absent', async () => {
    const svc = makeMockService();
    svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());
    mockCreateWeatherDataService.mockReturnValue(svc);

    const context = {
      getApiKey: vi.fn((name: string) => (name === 'weatherapi' ? 'wa-key-456' : undefined)),
    };

    await getWeatherExecutor({ location: 'Istanbul' }, context);

    expect(mockCreateWeatherDataService).toHaveBeenCalledWith({
      provider: 'weatherapi',
      apiKey: 'wa-key-456',
    });
  });

  it('should prefer openweathermap over weatherapi when both are available', async () => {
    const svc = makeMockService();
    svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());
    mockCreateWeatherDataService.mockReturnValue(svc);

    const context = {
      getApiKey: vi.fn((name: string) => {
        if (name === 'openweathermap') return 'owm-key';
        if (name === 'weatherapi') return 'wa-key';
        return undefined;
      }),
    };

    await getWeatherExecutor({ location: 'Istanbul' }, context);

    expect(mockCreateWeatherDataService).toHaveBeenCalledWith({
      provider: 'openweathermap',
      apiKey: 'owm-key',
    });
    expect(mockCreateWeatherDataService).toHaveBeenCalledTimes(1);
  });

  it('should fall back to legacy config when context has no getApiKey', async () => {
    const svc = makeMockService();
    svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());
    mockCreateWeatherDataService.mockReturnValue(svc);

    setWeatherConfig(() => ({ provider: 'weatherapi' as const, apiKey: 'legacy-key' }));

    await getWeatherExecutor({ location: 'Istanbul' }, {});

    expect(mockCreateWeatherDataService).toHaveBeenCalledWith({
      provider: 'weatherapi',
      apiKey: 'legacy-key',
    });
  });

  it('should fall back to legacy config when context.getApiKey returns undefined for both providers', async () => {
    const svc = makeMockService();
    svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());
    mockCreateWeatherDataService.mockReturnValue(svc);

    setWeatherConfig(() => ({ provider: 'openweathermap' as const, apiKey: 'fallback-key' }));

    const context = {
      getApiKey: vi.fn(() => undefined),
    };

    await getWeatherExecutor({ location: 'Istanbul' }, context);

    expect(context.getApiKey).toHaveBeenCalledWith('openweathermap');
    expect(context.getApiKey).toHaveBeenCalledWith('weatherapi');
    expect(mockCreateWeatherDataService).toHaveBeenCalledWith({
      provider: 'openweathermap',
      apiKey: 'fallback-key',
    });
  });

  it('should return null when no context keys and no legacy config', async () => {
    const result = await getWeatherExecutor({ location: 'Istanbul' }, {});

    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toBe(
      'Weather service not configured'
    );
  });

  it('should return null when context is undefined', async () => {
    const result = await getWeatherExecutor({ location: 'Istanbul' }, undefined);

    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toBe(
      'Weather service not configured'
    );
  });

  it('should handle context.getApiKey returning empty string (falsy)', async () => {
    const context = {
      getApiKey: vi.fn(() => ''),
    };

    const result = await getWeatherExecutor({ location: 'Istanbul' }, context);

    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toBe(
      'Weather service not configured'
    );
  });
});

// ============================================================================
// getWeatherExecutor
// ============================================================================

describe('getWeatherExecutor', () => {
  describe('location validation', () => {
    it('should return error when location is empty string', async () => {
      const result = await getWeatherExecutor({ location: '' }, {});

      expect(result.isError).toBe(true);
      expect((result.content as Record<string, unknown>).error).toBe('Location is required');
    });

    it('should return error when location is whitespace only', async () => {
      const result = await getWeatherExecutor({ location: '   ' }, {});

      expect(result.isError).toBe(true);
      expect((result.content as Record<string, unknown>).error).toBe('Location is required');
    });

    it('should return error when location is undefined', async () => {
      const result = await getWeatherExecutor({}, {});

      expect(result.isError).toBe(true);
      expect((result.content as Record<string, unknown>).error).toBe('Location is required');
    });

    it('should return error when location is null', async () => {
      const result = await getWeatherExecutor({ location: null }, {});

      expect(result.isError).toBe(true);
      expect((result.content as Record<string, unknown>).error).toBe('Location is required');
    });

    it('should not call service when location is invalid', async () => {
      await getWeatherExecutor({ location: '' }, {});

      expect(mockCreateWeatherDataService).not.toHaveBeenCalled();
    });
  });

  describe('no service configured', () => {
    it('should return error with suggestion text', async () => {
      const result = await getWeatherExecutor({ location: 'Istanbul' }, {});

      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toBe('Weather service not configured');
      expect(content.suggestion).toContain('Add a weather API key');
      expect(content.suggestion).toContain('OpenWeatherMap');
      expect(content.suggestion).toContain('WeatherAPI');
    });
  });

  describe('successful weather fetch', () => {
    let svc: ReturnType<typeof makeMockService>;

    beforeEach(() => {
      svc = makeMockService();
      mockCreateWeatherDataService.mockReturnValue(svc);
      setWeatherConfig(() => ({ provider: 'openweathermap' as const, apiKey: 'test-key' }));
    });

    it('should return formatted weather data on success', async () => {
      svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());

      const result = await getWeatherExecutor({ location: 'Istanbul' }, {});

      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      expect(content.success).toBe(true);
      expect(content.location).toBe('Istanbul, TR');
      expect(content.provider).toBe('openweathermap');
      expect(content.fetchedAt).toBe('2026-02-21T12:00:00Z');
    });

    it('should format temperature with degree-Celsius unit', async () => {
      svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());

      const result = await getWeatherExecutor({ location: 'Istanbul' }, {});
      const weather = (result.content as Record<string, Record<string, unknown>>).weather;

      expect(weather.temperature).toBe('22\u00B0C');
      expect(weather.feelsLike).toBe('24\u00B0C');
    });

    it('should format humidity with percent sign', async () => {
      svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());

      const result = await getWeatherExecutor({ location: 'Istanbul' }, {});
      const weather = (result.content as Record<string, Record<string, unknown>>).weather;

      expect(weather.humidity).toBe('45%');
    });

    it('should format wind with km/h and direction', async () => {
      svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());

      const result = await getWeatherExecutor({ location: 'Istanbul' }, {});
      const weather = (result.content as Record<string, Record<string, unknown>>).weather;

      expect(weather.wind).toBe('15 km/h NW');
    });

    it('should format visibility with km unit', async () => {
      svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());

      const result = await getWeatherExecutor({ location: 'Istanbul' }, {});
      const weather = (result.content as Record<string, Record<string, unknown>>).weather;

      expect(weather.visibility).toBe('10 km');
    });

    it('should format cloud cover with percent sign', async () => {
      svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());

      const result = await getWeatherExecutor({ location: 'Istanbul' }, {});
      const weather = (result.content as Record<string, Record<string, unknown>>).weather;

      expect(weather.cloudCover).toBe('20%');
    });

    it('should format pressure with hPa unit', async () => {
      svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());

      const result = await getWeatherExecutor({ location: 'Istanbul' }, {});
      const weather = (result.content as Record<string, Record<string, unknown>>).weather;

      expect(weather.pressure).toBe('1013 hPa');
    });

    it('should include uvIndex as raw number', async () => {
      svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());

      const result = await getWeatherExecutor({ location: 'Istanbul' }, {});
      const weather = (result.content as Record<string, Record<string, unknown>>).weather;

      expect(weather.uvIndex).toBe(5);
    });

    it('should include isDay boolean', async () => {
      svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());

      const result = await getWeatherExecutor({ location: 'Istanbul' }, {});
      const weather = (result.content as Record<string, Record<string, unknown>>).weather;

      expect(weather.isDay).toBe(true);
    });

    it('should include condition icon', async () => {
      svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());

      const result = await getWeatherExecutor({ location: 'Istanbul' }, {});
      const weather = (result.content as Record<string, Record<string, unknown>>).weather;

      expect(weather.icon).toBe('☀️');
    });

    it('should include condition string', async () => {
      svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());

      const result = await getWeatherExecutor({ location: 'Istanbul' }, {});
      const weather = (result.content as Record<string, Record<string, unknown>>).weather;

      expect(weather.condition).toBe('Sunny');
    });

    it('should pass location to service.getCurrentWeather', async () => {
      svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());

      await getWeatherExecutor({ location: 'Tokyo, Japan' }, {});

      expect(svc.getCurrentWeather).toHaveBeenCalledWith('Tokyo, Japan');
    });

    it('should handle negative temperatures', async () => {
      svc.getCurrentWeather.mockResolvedValue(
        makeWeatherResponse({
          current: {
            ...makeWeatherResponse().current,
            temperature: -5,
            feelsLike: -10,
          },
        })
      );

      const result = await getWeatherExecutor({ location: 'Moscow' }, {});
      const weather = (result.content as Record<string, Record<string, unknown>>).weather;

      expect(weather.temperature).toBe('-5\u00B0C');
      expect(weather.feelsLike).toBe('-10\u00B0C');
    });

    it('should handle zero values', async () => {
      svc.getCurrentWeather.mockResolvedValue(
        makeWeatherResponse({
          current: {
            ...makeWeatherResponse().current,
            temperature: 0,
            humidity: 0,
            windSpeed: 0,
            visibility: 0,
            cloudCover: 0,
            pressure: 0,
            uvIndex: 0,
          },
        })
      );

      const result = await getWeatherExecutor({ location: 'Test' }, {});
      const weather = (result.content as Record<string, Record<string, unknown>>).weather;

      expect(weather.temperature).toBe('0\u00B0C');
      expect(weather.humidity).toBe('0%');
      expect(weather.wind).toContain('0 km/h');
      expect(weather.visibility).toBe('0 km');
      expect(weather.cloudCover).toBe('0%');
      expect(weather.pressure).toBe('0 hPa');
      expect(weather.uvIndex).toBe(0);
    });

    it('should handle nighttime response', async () => {
      svc.getCurrentWeather.mockResolvedValue(
        makeWeatherResponse({
          current: { ...makeWeatherResponse().current, isDay: false },
        })
      );

      const result = await getWeatherExecutor({ location: 'Istanbul' }, {});
      const weather = (result.content as Record<string, Record<string, unknown>>).weather;

      expect(weather.isDay).toBe(false);
    });
  });

  describe('error handling', () => {
    let svc: ReturnType<typeof makeMockService>;

    beforeEach(() => {
      svc = makeMockService();
      mockCreateWeatherDataService.mockReturnValue(svc);
      setWeatherConfig(() => ({ provider: 'openweathermap' as const, apiKey: 'test-key' }));
    });

    it('should catch and return Error message', async () => {
      svc.getCurrentWeather.mockRejectedValue(new Error('API rate limit exceeded'));

      const result = await getWeatherExecutor({ location: 'Istanbul' }, {});

      expect(result.isError).toBe(true);
      expect((result.content as Record<string, unknown>).error).toBe('API rate limit exceeded');
    });

    it('should use fallback message for non-Error values', async () => {
      svc.getCurrentWeather.mockRejectedValue('network failure');

      const result = await getWeatherExecutor({ location: 'Istanbul' }, {});

      expect(result.isError).toBe(true);
      expect(mockGetErrorMessage).toHaveBeenCalledWith('network failure', 'Failed to get weather');
    });

    it('should call getErrorMessage with fallback "Failed to get weather"', async () => {
      svc.getCurrentWeather.mockRejectedValue(new Error('timeout'));

      await getWeatherExecutor({ location: 'Istanbul' }, {});

      expect(mockGetErrorMessage).toHaveBeenCalledWith(expect.any(Error), 'Failed to get weather');
    });
  });
});

// ============================================================================
// getWeatherForecastExecutor
// ============================================================================

describe('getWeatherForecastExecutor', () => {
  describe('location validation', () => {
    it('should return error when location is empty string', async () => {
      const result = await getWeatherForecastExecutor({ location: '' }, {});

      expect(result.isError).toBe(true);
      expect((result.content as Record<string, unknown>).error).toBe('Location is required');
    });

    it('should return error when location is whitespace only', async () => {
      const result = await getWeatherForecastExecutor({ location: '  \t  ' }, {});

      expect(result.isError).toBe(true);
      expect((result.content as Record<string, unknown>).error).toBe('Location is required');
    });

    it('should return error when location is undefined', async () => {
      const result = await getWeatherForecastExecutor({}, {});

      expect(result.isError).toBe(true);
      expect((result.content as Record<string, unknown>).error).toBe('Location is required');
    });

    it('should return error when location is null', async () => {
      const result = await getWeatherForecastExecutor({ location: null }, {});

      expect(result.isError).toBe(true);
      expect((result.content as Record<string, unknown>).error).toBe('Location is required');
    });

    it('should not call service when location is invalid', async () => {
      await getWeatherForecastExecutor({ location: '' }, {});

      expect(mockCreateWeatherDataService).not.toHaveBeenCalled();
    });
  });

  describe('days parameter clamping', () => {
    let svc: ReturnType<typeof makeMockService>;

    beforeEach(() => {
      svc = makeMockService();
      mockCreateWeatherDataService.mockReturnValue(svc);
      setWeatherConfig(() => ({ provider: 'openweathermap' as const, apiKey: 'test-key' }));
      svc.getForecast.mockResolvedValue(makeForecastResponse());
    });

    it('should default to 5 days when days is not provided', async () => {
      await getWeatherForecastExecutor({ location: 'Istanbul' }, {});

      expect(svc.getForecast).toHaveBeenCalledWith('Istanbul', 5);
    });

    it('should default to 5 days when days is undefined', async () => {
      await getWeatherForecastExecutor({ location: 'Istanbul', days: undefined }, {});

      expect(svc.getForecast).toHaveBeenCalledWith('Istanbul', 5);
    });

    it('should default to 5 days when days is 0 (falsy)', async () => {
      await getWeatherForecastExecutor({ location: 'Istanbul', days: 0 }, {});

      // 0 || 5 = 5, then Math.max(5, 1) = 5, Math.min(5, 10) = 5
      expect(svc.getForecast).toHaveBeenCalledWith('Istanbul', 5);
    });

    it('should clamp negative days to 1', async () => {
      await getWeatherForecastExecutor({ location: 'Istanbul', days: -3 }, {});

      // -3 || 5 = -3 (truthy), Math.max(-3, 1) = 1, Math.min(1, 10) = 1
      expect(svc.getForecast).toHaveBeenCalledWith('Istanbul', 1);
    });

    it('should pass through days within valid range', async () => {
      await getWeatherForecastExecutor({ location: 'Istanbul', days: 3 }, {});

      expect(svc.getForecast).toHaveBeenCalledWith('Istanbul', 3);
    });

    it('should accept exactly 1 day', async () => {
      await getWeatherForecastExecutor({ location: 'Istanbul', days: 1 }, {});

      expect(svc.getForecast).toHaveBeenCalledWith('Istanbul', 1);
    });

    it('should accept exactly 10 days', async () => {
      await getWeatherForecastExecutor({ location: 'Istanbul', days: 10 }, {});

      expect(svc.getForecast).toHaveBeenCalledWith('Istanbul', 10);
    });

    it('should clamp days exceeding 10 to 10', async () => {
      await getWeatherForecastExecutor({ location: 'Istanbul', days: 15 }, {});

      expect(svc.getForecast).toHaveBeenCalledWith('Istanbul', 10);
    });

    it('should clamp days of 100 to 10', async () => {
      await getWeatherForecastExecutor({ location: 'Istanbul', days: 100 }, {});

      expect(svc.getForecast).toHaveBeenCalledWith('Istanbul', 10);
    });

    it('should handle fractional days via Math.min/max (no rounding)', async () => {
      await getWeatherForecastExecutor({ location: 'Istanbul', days: 3.7 }, {});

      // 3.7 is truthy, Math.max(3.7, 1) = 3.7, Math.min(3.7, 10) = 3.7
      expect(svc.getForecast).toHaveBeenCalledWith('Istanbul', 3.7);
    });
  });

  describe('no service configured', () => {
    it('should return error with suggestion', async () => {
      const result = await getWeatherForecastExecutor({ location: 'Istanbul' }, {});

      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toBe('Weather service not configured');
      expect(content.suggestion).toContain('Add a weather API key');
    });
  });

  describe('successful forecast fetch', () => {
    let svc: ReturnType<typeof makeMockService>;

    beforeEach(() => {
      svc = makeMockService();
      mockCreateWeatherDataService.mockReturnValue(svc);
      setWeatherConfig(() => ({ provider: 'openweathermap' as const, apiKey: 'test-key' }));
    });

    it('should return success with mapped forecast', async () => {
      const days = [
        makeForecastDay(),
        makeForecastDay({ date: '2026-02-23', condition: 'Cloudy' }),
      ];
      svc.getForecast.mockResolvedValue(makeForecastResponse(days));

      const result = await getWeatherForecastExecutor({ location: 'Istanbul', days: 2 }, {});

      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      expect(content.success).toBe(true);
      expect(content.location).toBe('Istanbul, TR');
      expect(content.days).toBe(2);
      expect(content.provider).toBe('openweathermap');
      expect(content.fetchedAt).toBe('2026-02-21T12:00:00Z');
    });

    it('should format high/low/avg temperatures with degree-Celsius', async () => {
      svc.getForecast.mockResolvedValue(makeForecastResponse([makeForecastDay()]));

      const result = await getWeatherForecastExecutor({ location: 'Istanbul' }, {});
      const forecast = (result.content as Record<string, unknown[]>).forecast;
      const day = forecast[0] as Record<string, unknown>;

      expect(day.high).toBe('25\u00B0C');
      expect(day.low).toBe('15\u00B0C');
      expect(day.avg).toBe('20\u00B0C');
    });

    it('should format humidity and chanceOfRain with percent sign', async () => {
      svc.getForecast.mockResolvedValue(makeForecastResponse([makeForecastDay()]));

      const result = await getWeatherForecastExecutor({ location: 'Istanbul' }, {});
      const forecast = (result.content as Record<string, unknown[]>).forecast;
      const day = forecast[0] as Record<string, unknown>;

      expect(day.humidity).toBe('40%');
      expect(day.chanceOfRain).toBe('10%');
    });

    it('should include date, condition, sunrise, sunset, moonPhase, uvIndex, icon', async () => {
      svc.getForecast.mockResolvedValue(makeForecastResponse([makeForecastDay()]));

      const result = await getWeatherForecastExecutor({ location: 'Istanbul' }, {});
      const forecast = (result.content as Record<string, unknown[]>).forecast;
      const day = forecast[0] as Record<string, unknown>;

      expect(day.date).toBe('2026-02-22');
      expect(day.condition).toBe('Sunny');
      expect(day.sunrise).toBe('07:00');
      expect(day.sunset).toBe('18:00');
      expect(day.moonPhase).toBe('Waxing');
      expect(day.uvIndex).toBe(6);
      expect(day.icon).toBe('☀️');
    });

    it('should map multiple forecast days', async () => {
      const threeDays = [
        makeForecastDay({ date: '2026-02-22' }),
        makeForecastDay({ date: '2026-02-23', maxTemp: 28 }),
        makeForecastDay({ date: '2026-02-24', minTemp: 10 }),
      ];
      svc.getForecast.mockResolvedValue(makeForecastResponse(threeDays));

      const result = await getWeatherForecastExecutor({ location: 'Istanbul', days: 3 }, {});
      const content = result.content as Record<string, unknown>;
      const forecast = content.forecast as Record<string, unknown>[];

      expect(forecast).toHaveLength(3);
      expect(content.days).toBe(3);
      expect(forecast[0]!.date).toBe('2026-02-22');
      expect(forecast[1]!.high).toBe('28\u00B0C');
      expect(forecast[2]!.low).toBe('10\u00B0C');
    });

    it('should handle empty forecast array', async () => {
      svc.getForecast.mockResolvedValue(makeForecastResponse([]));

      const result = await getWeatherForecastExecutor({ location: 'Istanbul' }, {});
      const content = result.content as Record<string, unknown>;

      expect(content.success).toBe(true);
      expect(content.forecast).toEqual([]);
      expect(content.days).toBe(0);
    });

    it('should pass location to service.getForecast', async () => {
      svc.getForecast.mockResolvedValue(makeForecastResponse());

      await getWeatherForecastExecutor({ location: 'New York, NY' }, {});

      expect(svc.getForecast).toHaveBeenCalledWith('New York, NY', 5);
    });

    it('should handle forecast with optional fields undefined', async () => {
      const day = makeForecastDay({
        sunrise: undefined,
        sunset: undefined,
        moonPhase: undefined,
        uvIndex: undefined,
      });
      svc.getForecast.mockResolvedValue(makeForecastResponse([day]));

      const result = await getWeatherForecastExecutor({ location: 'Istanbul' }, {});
      const forecast = (result.content as Record<string, unknown[]>).forecast;
      const mapped = forecast[0] as Record<string, unknown>;

      expect(mapped.sunrise).toBeUndefined();
      expect(mapped.sunset).toBeUndefined();
      expect(mapped.moonPhase).toBeUndefined();
      expect(mapped.uvIndex).toBeUndefined();
    });

    it('should handle negative temperatures in forecast', async () => {
      const day = makeForecastDay({ maxTemp: -2, minTemp: -15, avgTemp: -8 });
      svc.getForecast.mockResolvedValue(makeForecastResponse([day]));

      const result = await getWeatherForecastExecutor({ location: 'Moscow' }, {});
      const forecast = (result.content as Record<string, unknown[]>).forecast;
      const mapped = forecast[0] as Record<string, unknown>;

      expect(mapped.high).toBe('-2\u00B0C');
      expect(mapped.low).toBe('-15\u00B0C');
      expect(mapped.avg).toBe('-8\u00B0C');
    });
  });

  describe('error handling', () => {
    let svc: ReturnType<typeof makeMockService>;

    beforeEach(() => {
      svc = makeMockService();
      mockCreateWeatherDataService.mockReturnValue(svc);
      setWeatherConfig(() => ({ provider: 'openweathermap' as const, apiKey: 'test-key' }));
    });

    it('should catch and return Error message', async () => {
      svc.getForecast.mockRejectedValue(new Error('Location not found'));

      const result = await getWeatherForecastExecutor({ location: 'XYZXYZ' }, {});

      expect(result.isError).toBe(true);
      expect((result.content as Record<string, unknown>).error).toBe('Location not found');
    });

    it('should use fallback for non-Error values', async () => {
      svc.getForecast.mockRejectedValue(42);

      const result = await getWeatherForecastExecutor({ location: 'Istanbul' }, {});

      expect(result.isError).toBe(true);
      expect(mockGetErrorMessage).toHaveBeenCalledWith(42, 'Failed to get forecast');
    });

    it('should call getErrorMessage with fallback "Failed to get forecast"', async () => {
      svc.getForecast.mockRejectedValue(new Error('service unavailable'));

      await getWeatherForecastExecutor({ location: 'Istanbul' }, {});

      expect(mockGetErrorMessage).toHaveBeenCalledWith(expect.any(Error), 'Failed to get forecast');
    });
  });

  describe('service resolution via forecast executor', () => {
    it('should use openweathermap key from context', async () => {
      const svc = makeMockService();
      svc.getForecast.mockResolvedValue(makeForecastResponse());
      mockCreateWeatherDataService.mockReturnValue(svc);

      const context = {
        getApiKey: vi.fn((name: string) => (name === 'openweathermap' ? 'owm-key' : undefined)),
      };

      await getWeatherForecastExecutor({ location: 'Istanbul' }, context);

      expect(mockCreateWeatherDataService).toHaveBeenCalledWith({
        provider: 'openweathermap',
        apiKey: 'owm-key',
      });
    });

    it('should fall through to weatherapi for forecast', async () => {
      const svc = makeMockService();
      svc.getForecast.mockResolvedValue(makeForecastResponse());
      mockCreateWeatherDataService.mockReturnValue(svc);

      const context = {
        getApiKey: vi.fn((name: string) => (name === 'weatherapi' ? 'wa-key' : undefined)),
      };

      await getWeatherForecastExecutor({ location: 'Istanbul' }, context);

      expect(mockCreateWeatherDataService).toHaveBeenCalledWith({
        provider: 'weatherapi',
        apiKey: 'wa-key',
      });
    });
  });
});

// ============================================================================
// getWeatherTool definition
// ============================================================================

describe('getWeatherTool', () => {
  it('should have name "get_weather"', () => {
    expect(getWeatherTool.name).toBe('get_weather');
  });

  it('should have a brief description', () => {
    expect(getWeatherTool.brief).toBeTruthy();
    expect(typeof getWeatherTool.brief).toBe('string');
  });

  it('should have a full description', () => {
    expect(getWeatherTool.description).toBeTruthy();
    expect(typeof getWeatherTool.description).toBe('string');
  });

  it('should require location parameter', () => {
    expect(getWeatherTool.parameters.required).toContain('location');
  });

  it('should define location as string type', () => {
    expect(getWeatherTool.parameters.properties.location.type).toBe('string');
  });

  it('should have configRequirements with openweathermap and weatherapi', () => {
    expect(getWeatherTool.configRequirements).toHaveLength(2);
    expect(getWeatherTool.configRequirements![0].name).toBe('openweathermap');
    expect(getWeatherTool.configRequirements![1].name).toBe('weatherapi');
  });

  it('should have weather category for both config requirements', () => {
    for (const req of getWeatherTool.configRequirements!) {
      expect(req.category).toBe('weather');
    }
  });

  it('should have api_key schema in both config requirements', () => {
    for (const req of getWeatherTool.configRequirements!) {
      const apiKeyField = req.configSchema.find(
        (f: Record<string, unknown>) => f.name === 'api_key'
      );
      expect(apiKeyField).toBeDefined();
      expect(apiKeyField!.type).toBe('secret');
      expect(apiKeyField!.required).toBe(true);
    }
  });

  it('should have docs URLs for both providers', () => {
    expect(getWeatherTool.configRequirements![0].docsUrl).toContain('openweathermap.org');
    expect(getWeatherTool.configRequirements![1].docsUrl).toContain('weatherapi.com');
  });
});

// ============================================================================
// getWeatherForecastTool definition
// ============================================================================

describe('getWeatherForecastTool', () => {
  it('should have name "get_weather_forecast"', () => {
    expect(getWeatherForecastTool.name).toBe('get_weather_forecast');
  });

  it('should have a brief description', () => {
    expect(getWeatherForecastTool.brief).toBeTruthy();
    expect(typeof getWeatherForecastTool.brief).toBe('string');
  });

  it('should have a full description', () => {
    expect(getWeatherForecastTool.description).toBeTruthy();
    expect(typeof getWeatherForecastTool.description).toBe('string');
  });

  it('should require location parameter', () => {
    expect(getWeatherForecastTool.parameters.required).toContain('location');
  });

  it('should NOT require days parameter', () => {
    expect(getWeatherForecastTool.parameters.required).not.toContain('days');
  });

  it('should define location as string and days as number', () => {
    expect(getWeatherForecastTool.parameters.properties.location.type).toBe('string');
    expect(getWeatherForecastTool.parameters.properties.days.type).toBe('number');
  });

  it('should have configRequirements with openweathermap and weatherapi', () => {
    expect(getWeatherForecastTool.configRequirements).toHaveLength(2);
    expect(getWeatherForecastTool.configRequirements![0].name).toBe('openweathermap');
    expect(getWeatherForecastTool.configRequirements![1].name).toBe('weatherapi');
  });

  it('should have matching config requirements with getWeatherTool', () => {
    // Both tools share the same provider requirements
    expect(getWeatherForecastTool.configRequirements).toEqual(getWeatherTool.configRequirements);
  });
});

// ============================================================================
// WEATHER_TOOLS export
// ============================================================================

describe('WEATHER_TOOLS', () => {
  it('should contain exactly 2 entries', () => {
    expect(WEATHER_TOOLS).toHaveLength(2);
  });

  it('should have get_weather as first entry', () => {
    expect(WEATHER_TOOLS[0].definition.name).toBe('get_weather');
    expect(WEATHER_TOOLS[0].executor).toBe(getWeatherExecutor);
  });

  it('should have get_weather_forecast as second entry', () => {
    expect(WEATHER_TOOLS[1].definition.name).toBe('get_weather_forecast');
    expect(WEATHER_TOOLS[1].executor).toBe(getWeatherForecastExecutor);
  });

  it('should pair each definition with its executor', () => {
    expect(WEATHER_TOOLS[0].definition).toBe(getWeatherTool);
    expect(WEATHER_TOOLS[0].executor).toBe(getWeatherExecutor);
    expect(WEATHER_TOOLS[1].definition).toBe(getWeatherForecastTool);
    expect(WEATHER_TOOLS[1].executor).toBe(getWeatherForecastExecutor);
  });

  it('should have definition and executor properties on each entry', () => {
    for (const tool of WEATHER_TOOLS) {
      expect(tool).toHaveProperty('definition');
      expect(tool).toHaveProperty('executor');
      expect(typeof tool.executor).toBe('function');
      expect(tool.definition.name).toBeTruthy();
    }
  });
});

// ============================================================================
// WEATHER_TOOL_NAMES export
// ============================================================================

describe('WEATHER_TOOL_NAMES', () => {
  it('should contain exactly 2 names', () => {
    expect(WEATHER_TOOL_NAMES).toHaveLength(2);
  });

  it('should contain "get_weather"', () => {
    expect(WEATHER_TOOL_NAMES).toContain('get_weather');
  });

  it('should contain "get_weather_forecast"', () => {
    expect(WEATHER_TOOL_NAMES).toContain('get_weather_forecast');
  });

  it('should match names derived from WEATHER_TOOLS definitions', () => {
    const derived = WEATHER_TOOLS.map((t) => t.definition.name);
    expect(WEATHER_TOOL_NAMES).toEqual(derived);
  });

  it('should have "get_weather" at index 0 and "get_weather_forecast" at index 1', () => {
    expect(WEATHER_TOOL_NAMES[0]).toBe('get_weather');
    expect(WEATHER_TOOL_NAMES[1]).toBe('get_weather_forecast');
  });
});

// ============================================================================
// Integration-style: config override flow
// ============================================================================

describe('config override flow', () => {
  it('should use setWeatherConfig for service when no context keys available', async () => {
    const svc = makeMockService();
    svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse({ provider: 'weatherapi' }));
    mockCreateWeatherDataService.mockReturnValue(svc);

    setWeatherConfig(() => ({ provider: 'weatherapi' as const, apiKey: 'config-key' }));

    const result = await getWeatherExecutor({ location: 'Istanbul' }, {});

    expect(result.isError).toBe(false);
    expect(mockCreateWeatherDataService).toHaveBeenCalledWith({
      provider: 'weatherapi',
      apiKey: 'config-key',
    });
  });

  it('should override legacy config with context keys', async () => {
    const svc = makeMockService();
    svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());
    mockCreateWeatherDataService.mockReturnValue(svc);

    // Set legacy config
    setWeatherConfig(() => ({ provider: 'weatherapi' as const, apiKey: 'legacy-key' }));

    // Context should take priority
    const context = {
      getApiKey: vi.fn((name: string) => (name === 'openweathermap' ? 'ctx-key' : undefined)),
    };

    await getWeatherExecutor({ location: 'Istanbul' }, context);

    expect(mockCreateWeatherDataService).toHaveBeenCalledWith({
      provider: 'openweathermap',
      apiKey: 'ctx-key',
    });
  });

  it('should reset properly between calls after setWeatherConfig(null-fn)', async () => {
    const svc = makeMockService();
    svc.getCurrentWeather.mockResolvedValue(makeWeatherResponse());
    mockCreateWeatherDataService.mockReturnValue(svc);

    // First: set config
    setWeatherConfig(() => ({ provider: 'openweathermap' as const, apiKey: 'key-a' }));
    await getWeatherExecutor({ location: 'Istanbul' }, {});
    expect(mockCreateWeatherDataService).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();

    // Second: reset to null
    setWeatherConfig(() => null);
    const result = await getWeatherExecutor({ location: 'Istanbul' }, {});
    expect(result.isError).toBe(true);
    expect(mockCreateWeatherDataService).not.toHaveBeenCalled();
  });
});
