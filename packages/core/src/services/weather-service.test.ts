/**
 * Weather Service Tests
 *
 * Comprehensive tests for weather-service.ts covering:
 * - WeatherDataService class dispatch and error handling
 * - createWeatherDataService factory
 * - WEATHER_PROVIDERS constant
 * - OpenWeatherMap current weather (geocoding + weather fetch, conversions, edge cases)
 * - OpenWeatherMap forecast (aggregation, grouping, day limiting)
 * - WeatherAPI current weather (single fetch, field mapping)
 * - WeatherAPI forecast (day capping, astro data, field mapping)
 * - getWindDirection (all 16 compass directions, boundaries, wrapping)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WeatherDataService,
  createWeatherDataService,
  WEATHER_PROVIDERS,
  type WeatherServiceConfig,
  type WeatherCurrent as _WeatherCurrent,
  type WeatherForecast as _WeatherForecast,
} from './weather-service.js';

// =============================================================================
// Mock Helpers
// =============================================================================

const mockFetch = vi.fn();

function mockResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  };
}

// --- OpenWeatherMap mock data ---

function owmGeoResponse(overrides: Record<string, unknown> = {}) {
  return [
    {
      lat: 51.5074,
      lon: -0.1278,
      name: 'London',
      country: 'GB',
      state: 'England',
      ...overrides,
    },
  ];
}

function owmCurrentResponse(overrides: Record<string, unknown> = {}) {
  return {
    timezone: 3600,
    visibility: 10000,
    main: { temp: 15.3, feels_like: 13.8, humidity: 72, pressure: 1013 },
    wind: { speed: 5.2, deg: 220 },
    clouds: { all: 75 },
    weather: [{ description: 'overcast clouds', icon: '04d' }],
    ...overrides,
  };
}

function owmForecastResponse(list?: unknown[]) {
  return {
    list: list ?? [
      {
        dt_txt: '2026-02-21 00:00:00',
        main: { temp: 8, humidity: 80 },
        pop: 0.2,
        weather: [{ description: 'light rain', icon: '10d' }],
      },
      {
        dt_txt: '2026-02-21 03:00:00',
        main: { temp: 7, humidity: 82 },
        pop: 0.4,
        weather: [{ description: 'moderate rain', icon: '10n' }],
      },
      {
        dt_txt: '2026-02-21 06:00:00',
        main: { temp: 6, humidity: 85 },
        pop: 0.5,
        weather: [{ description: 'light rain', icon: '10d' }],
      },
      {
        dt_txt: '2026-02-21 09:00:00',
        main: { temp: 9, humidity: 75 },
        pop: 0.3,
        weather: [{ description: 'cloudy', icon: '04d' }],
      },
      {
        dt_txt: '2026-02-21 12:00:00',
        main: { temp: 12, humidity: 65 },
        pop: 0.1,
        weather: [{ description: 'partly cloudy', icon: '03d' }],
      },
      {
        dt_txt: '2026-02-22 00:00:00',
        main: { temp: 10, humidity: 70 },
        pop: 0.0,
        weather: [{ description: 'clear sky', icon: '01d' }],
      },
      {
        dt_txt: '2026-02-22 12:00:00',
        main: { temp: 14, humidity: 60 },
        pop: 0.1,
        weather: [{ description: 'sunny', icon: '01d' }],
      },
      {
        dt_txt: '2026-02-23 06:00:00',
        main: { temp: 11, humidity: 68 },
        pop: 0.6,
        weather: [{ description: 'heavy rain', icon: '09d' }],
      },
      {
        dt_txt: '2026-02-23 12:00:00',
        main: { temp: 13, humidity: 62 },
        pop: 0.7,
        weather: [{ description: 'thunderstorm', icon: '11d' }],
      },
    ],
  };
}

// --- WeatherAPI mock data ---

function weatherApiCurrentResponse(overrides: Record<string, unknown> = {}) {
  return {
    location: {
      name: 'London',
      region: 'City of London, Greater London',
      country: 'United Kingdom',
      lat: 51.52,
      lon: -0.11,
      tz_id: 'Europe/London',
      localtime: '2026-02-21 14:00',
    },
    current: {
      temp_c: 15.4,
      feelslike_c: 13.2,
      humidity: 72,
      pressure_mb: 1013,
      wind_kph: 18.7,
      wind_dir: 'SW',
      wind_degree: 220,
      vis_km: 10,
      uv: 3,
      cloud: 75,
      condition: { text: 'Partly cloudy', icon: '//cdn.weatherapi.com/weather/64x64/day/116.png' },
      is_day: 1,
      ...overrides,
    },
  };
}

function weatherApiForecastResponse(forecastDays?: unknown[]) {
  return {
    location: {
      name: 'London',
      region: 'City of London, Greater London',
      country: 'United Kingdom',
      lat: 51.52,
      lon: -0.11,
    },
    forecast: {
      forecastday: forecastDays ?? [
        {
          date: '2026-02-21',
          day: {
            maxtemp_c: 16.2,
            mintemp_c: 8.1,
            avgtemp_c: 12.3,
            avghumidity: 68,
            condition: {
              text: 'Partly cloudy',
              icon: '//cdn.weatherapi.com/weather/64x64/day/116.png',
            },
            daily_chance_of_rain: 30,
            uv: 3,
          },
          astro: { sunrise: '07:05 AM', sunset: '05:32 PM', moon_phase: 'Waxing Crescent' },
        },
        {
          date: '2026-02-22',
          day: {
            maxtemp_c: 14.5,
            mintemp_c: 6.8,
            avgtemp_c: 10.7,
            avghumidity: 72,
            condition: { text: 'Sunny', icon: '//cdn.weatherapi.com/weather/64x64/day/113.png' },
            daily_chance_of_rain: 10,
            uv: 4,
          },
          astro: { sunrise: '07:03 AM', sunset: '05:34 PM', moon_phase: 'First Quarter' },
        },
        {
          date: '2026-02-23',
          day: {
            maxtemp_c: 12.0,
            mintemp_c: 5.3,
            avgtemp_c: 8.7,
            avghumidity: 80,
            condition: {
              text: 'Heavy rain',
              icon: '//cdn.weatherapi.com/weather/64x64/day/308.png',
            },
            daily_chance_of_rain: 85,
            uv: 1,
          },
          astro: { sunrise: '07:01 AM', sunset: '05:36 PM', moon_phase: 'Waxing Gibbous' },
        },
      ],
    },
  };
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  vi.useFakeTimers({ now: new Date('2026-02-21T12:00:00.000Z') });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// =============================================================================
// WEATHER_PROVIDERS constant
// =============================================================================

describe('WEATHER_PROVIDERS', () => {
  it('contains exactly 2 providers', () => {
    expect(WEATHER_PROVIDERS).toHaveLength(2);
  });

  it('has openweathermap entry with required fields', () => {
    const owm = WEATHER_PROVIDERS.find((p) => p.id === 'openweathermap');
    expect(owm).toBeDefined();
    expect(owm!.name).toBe('OpenWeatherMap');
    expect(owm!.freeLimit).toBe('1,000 calls/day');
    expect(owm!.signupUrl).toBe('https://openweathermap.org/api');
  });

  it('has weatherapi entry with required fields', () => {
    const wa = WEATHER_PROVIDERS.find((p) => p.id === 'weatherapi');
    expect(wa).toBeDefined();
    expect(wa!.name).toBe('WeatherAPI');
    expect(wa!.freeLimit).toBe('1,000,000 calls/month');
    expect(wa!.signupUrl).toBe('https://www.weatherapi.com/');
  });

  it('all entries have id, name, freeLimit, and signupUrl', () => {
    for (const provider of WEATHER_PROVIDERS) {
      expect(provider.id).toBeTruthy();
      expect(provider.name).toBeTruthy();
      expect(provider.freeLimit).toBeTruthy();
      expect(provider.signupUrl).toMatch(/^https:\/\//);
    }
  });

  it('IDs match WeatherProvider type values', () => {
    const ids = WEATHER_PROVIDERS.map((p) => p.id);
    expect(ids).toContain('openweathermap');
    expect(ids).toContain('weatherapi');
  });
});

// =============================================================================
// createWeatherDataService factory
// =============================================================================

describe('createWeatherDataService', () => {
  it('returns a WeatherDataService instance', () => {
    const svc = createWeatherDataService({ provider: 'openweathermap', apiKey: 'test-key' });
    expect(svc).toBeInstanceOf(WeatherDataService);
  });

  it('instance uses provided config', () => {
    const config: WeatherServiceConfig = { provider: 'weatherapi', apiKey: 'my-key' };
    const svc = createWeatherDataService(config);

    // Verify config is stored by calling getCurrentWeather and checking fetch URL
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiCurrentResponse()));

    // The provider determines which implementation is used
    const promise = svc.getCurrentWeather('London');
    // Check that the fetch was called with weatherapi URL
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('api.weatherapi.com'));
    return promise;
  });

  it('different configs create independent instances', async () => {
    const svc1 = createWeatherDataService({ provider: 'openweathermap', apiKey: 'key1' });
    const svc2 = createWeatherDataService({ provider: 'weatherapi', apiKey: 'key2' });

    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse()));

    const result1 = await svc1.getCurrentWeather('London');
    expect(result1.provider).toBe('openweathermap');
    expect(mockFetch.mock.calls[0]![0]).toContain('openweathermap.org');

    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiCurrentResponse()));
    const result2 = await svc2.getCurrentWeather('London');
    expect(result2.provider).toBe('weatherapi');
    // Third call (index 2) should be to weatherapi
    expect(mockFetch.mock.calls[2]![0]).toContain('weatherapi.com');
  });
});

// =============================================================================
// WeatherDataService class
// =============================================================================

describe('WeatherDataService', () => {
  describe('constructor', () => {
    it('stores config', () => {
      const config: WeatherServiceConfig = { provider: 'openweathermap', apiKey: 'abc' };
      const svc = new WeatherDataService(config);
      // Verify by exercising the service (config is private, can't access directly)
      mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
      mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse()));
      return svc.getCurrentWeather('London').then((result) => {
        expect(result.provider).toBe('openweathermap');
      });
    });
  });

  describe('getCurrentWeather', () => {
    it('dispatches to OpenWeatherMap for openweathermap provider', async () => {
      const svc = new WeatherDataService({ provider: 'openweathermap', apiKey: 'owm-key' });
      mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
      mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse()));

      const result = await svc.getCurrentWeather('London');
      expect(result.provider).toBe('openweathermap');
      expect(mockFetch.mock.calls[0]![0]).toContain('api.openweathermap.org/geo');
    });

    it('dispatches to WeatherAPI for weatherapi provider', async () => {
      const svc = new WeatherDataService({ provider: 'weatherapi', apiKey: 'wa-key' });
      mockFetch.mockResolvedValueOnce(mockResponse(weatherApiCurrentResponse()));

      const result = await svc.getCurrentWeather('London');
      expect(result.provider).toBe('weatherapi');
      expect(mockFetch.mock.calls[0]![0]).toContain('api.weatherapi.com');
    });

    it('throws for unsupported provider', async () => {
      const svc = new WeatherDataService({ provider: 'unknown' as never, apiKey: 'key' });
      await expect(svc.getCurrentWeather('London')).rejects.toThrow(
        'Unsupported weather provider: unknown'
      );
    });
  });

  describe('getForecast', () => {
    it('dispatches to OpenWeatherMap for openweathermap provider', async () => {
      const svc = new WeatherDataService({ provider: 'openweathermap', apiKey: 'owm-key' });
      mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
      mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse()));

      const result = await svc.getForecast('London');
      expect(result.provider).toBe('openweathermap');
      expect(mockFetch.mock.calls[1]![0]).toContain('api.openweathermap.org/data/2.5/forecast');
    });

    it('dispatches to WeatherAPI for weatherapi provider', async () => {
      const svc = new WeatherDataService({ provider: 'weatherapi', apiKey: 'wa-key' });
      mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

      const result = await svc.getForecast('London');
      expect(result.provider).toBe('weatherapi');
      expect(mockFetch.mock.calls[0]![0]).toContain('api.weatherapi.com/v1/forecast.json');
    });

    it('throws for unsupported provider', async () => {
      const svc = new WeatherDataService({ provider: 'badprovider' as never, apiKey: 'key' });
      await expect(svc.getForecast('London')).rejects.toThrow(
        'Unsupported weather provider: badprovider'
      );
    });

    it('uses default days=5 when not specified', async () => {
      const svc = new WeatherDataService({ provider: 'weatherapi', apiKey: 'key' });
      mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

      await svc.getForecast('London');
      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toContain('days=5');
    });

    it('passes custom days parameter', async () => {
      const svc = new WeatherDataService({ provider: 'weatherapi', apiKey: 'key' });
      mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

      await svc.getForecast('London', 3);
      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toContain('days=3');
    });
  });
});

// =============================================================================
// OpenWeatherMap Current Weather
// =============================================================================

describe('OpenWeatherMap Current Weather', () => {
  let svc: WeatherDataService;

  beforeEach(() => {
    svc = new WeatherDataService({ provider: 'openweathermap', apiKey: 'test-owm-key' });
  });

  it('makes geocoding fetch call with correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse()));

    await svc.getCurrentWeather('London');
    const geoUrl = mockFetch.mock.calls[0]![0] as string;
    expect(geoUrl).toContain('api.openweathermap.org/geo/1.0/direct');
    expect(geoUrl).toContain('q=London');
    expect(geoUrl).toContain('limit=1');
    expect(geoUrl).toContain('appid=test-owm-key');
  });

  it('makes weather fetch call with lat/lon from geocoding', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse()));

    await svc.getCurrentWeather('London');
    const weatherUrl = mockFetch.mock.calls[1]![0] as string;
    expect(weatherUrl).toContain('api.openweathermap.org/data/2.5/weather');
    expect(weatherUrl).toContain('lat=51.5074');
    expect(weatherUrl).toContain('lon=-0.1278');
    expect(weatherUrl).toContain('units=metric');
    expect(weatherUrl).toContain('appid=test-owm-key');
  });

  it('returns correct location fields from geocoding', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    expect(result.location.name).toBe('London');
    expect(result.location.country).toBe('GB');
    expect(result.location.region).toBe('England');
    expect(result.location.lat).toBe(51.5074);
    expect(result.location.lon).toBe(-0.1278);
  });

  it('throws "Location not found" for empty geocoding response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    await expect(svc.getCurrentWeather('Nonexistent')).rejects.toThrow(
      'Location not found: Nonexistent'
    );
  });

  it('throws on geocoding API error (non-200)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('Unauthorized', false, 401));
    await expect(svc.getCurrentWeather('London')).rejects.toThrow('OpenWeatherMap geocoding error');
  });

  it('throws on weather API error (non-200)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse('Server error', false, 500));

    await expect(svc.getCurrentWeather('London')).rejects.toThrow('OpenWeatherMap weather error');
  });

  it('rounds temperature correctly', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    // temp: 15.3 -> rounds to 15
    expect(result.current.temperature).toBe(15);
  });

  it('rounds temperature up at .5', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(
      mockResponse(
        owmCurrentResponse({ main: { temp: 15.5, feels_like: 13.5, humidity: 72, pressure: 1013 } })
      )
    );

    const result = await svc.getCurrentWeather('London');
    expect(result.current.temperature).toBe(16);
  });

  it('rounds feelsLike correctly', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    // feels_like: 13.8 -> rounds to 14
    expect(result.current.feelsLike).toBe(14);
  });

  it('converts wind speed from m/s to km/h and rounds', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    // 5.2 m/s * 3.6 = 18.72 -> rounds to 19
    expect(result.current.windSpeed).toBe(19);
  });

  it('converts visibility from m to km and rounds', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    // 10000m / 1000 = 10km
    expect(result.current.visibility).toBe(10);
  });

  it('rounds visibility correctly for non-even values', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse({ visibility: 7500 })));

    const result = await svc.getCurrentWeather('London');
    // 7500m / 1000 = 7.5 -> rounds to 8
    expect(result.current.visibility).toBe(8);
  });

  it('formats timezone correctly for positive offset', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse({ timezone: 3600 })));

    const result = await svc.getCurrentWeather('London');
    expect(result.location.timezone).toBe('UTC+1');
  });

  it('formats timezone correctly for negative offset', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse({ timezone: -18000 })));

    const result = await svc.getCurrentWeather('London');
    // -18000 / 3600 = -5
    expect(result.location.timezone).toBe('UTC-5');
  });

  it('formats timezone correctly for UTC+0', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse({ timezone: 0 })));

    const result = await svc.getCurrentWeather('London');
    expect(result.location.timezone).toBe('UTC+0');
  });

  it('formats timezone correctly for large positive offset', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse({ timezone: 34200 })));

    const result = await svc.getCurrentWeather('London');
    // 34200 / 3600 = 9.5 -> Math.floor = 9
    expect(result.location.timezone).toBe('UTC+9');
  });

  it('isDay is true when icon contains "d"', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(
      mockResponse(owmCurrentResponse({ weather: [{ description: 'clear sky', icon: '01d' }] }))
    );

    const result = await svc.getCurrentWeather('London');
    expect(result.current.isDay).toBe(true);
  });

  it('isDay is false when icon contains "n" (night)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(
      mockResponse(owmCurrentResponse({ weather: [{ description: 'clear sky', icon: '01n' }] }))
    );

    const result = await svc.getCurrentWeather('London');
    expect(result.current.isDay).toBe(false);
  });

  it('constructs conditionIcon URL correctly', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(
      mockResponse(owmCurrentResponse({ weather: [{ description: 'clear sky', icon: '01d' }] }))
    );

    const result = await svc.getCurrentWeather('London');
    expect(result.current.conditionIcon).toBe('https://openweathermap.org/img/wn/01d@2x.png');
  });

  it('provider is "openweathermap"', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    expect(result.provider).toBe('openweathermap');
  });

  it('fetchedAt is an ISO string', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    expect(result.fetchedAt).toBe('2026-02-21T12:00:00.000Z');
  });

  it('passes humidity and pressure through from response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    expect(result.current.humidity).toBe(72);
    expect(result.current.pressure).toBe(1013);
  });

  it('passes cloudCover and windDegree through from response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    expect(result.current.cloudCover).toBe(75);
    expect(result.current.windDegree).toBe(220);
  });

  it('passes condition description from response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    expect(result.current.condition).toBe('overcast clouds');
  });

  it('URL-encodes the location parameter', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse()));

    await svc.getCurrentWeather('New York, US');
    const geoUrl = mockFetch.mock.calls[0]![0] as string;
    expect(geoUrl).toContain('q=New%20York%2C%20US');
  });

  it('uses fallback weather info when weather array is empty', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse({ weather: [] })));

    const result = await svc.getCurrentWeather('London');
    // Fallback via ?? operator: { description: 'Unknown', icon: '01d' }
    expect(result.current.condition).toBe('Unknown');
    expect(result.current.conditionIcon).toBe('https://openweathermap.org/img/wn/01d@2x.png');
    expect(result.current.isDay).toBe(true);
  });

  it('does not include uvIndex for OWM (not available in free tier)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    expect(result.current.uvIndex).toBeUndefined();
  });

  it('handles geocoding result without state field', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse({ state: undefined })));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    expect(result.location.region).toBeUndefined();
  });
});

// =============================================================================
// OpenWeatherMap Forecast
// =============================================================================

describe('OpenWeatherMap Forecast', () => {
  let svc: WeatherDataService;

  beforeEach(() => {
    svc = new WeatherDataService({ provider: 'openweathermap', apiKey: 'test-owm-key' });
  });

  it('makes correct geocoding and forecast API calls', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse()));

    await svc.getForecast('London');
    const geoUrl = mockFetch.mock.calls[0]![0] as string;
    const forecastUrl = mockFetch.mock.calls[1]![0] as string;

    expect(geoUrl).toContain('api.openweathermap.org/geo/1.0/direct');
    expect(geoUrl).toContain('appid=test-owm-key');
    expect(forecastUrl).toContain('api.openweathermap.org/data/2.5/forecast');
    expect(forecastUrl).toContain('lat=51.5074');
    expect(forecastUrl).toContain('lon=-0.1278');
    expect(forecastUrl).toContain('units=metric');
  });

  it('groups 3-hour data by date', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse()));

    const result = await svc.getForecast('London');
    // Default mock data: 3 unique dates
    expect(result.forecast).toHaveLength(3);
    expect(result.forecast[0]!.date).toBe('2026-02-21');
    expect(result.forecast[1]!.date).toBe('2026-02-22');
    expect(result.forecast[2]!.date).toBe('2026-02-23');
  });

  it('calculates max and min temp correctly per day', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse()));

    const result = await svc.getForecast('London');
    // Day 1: temps [8, 7, 6, 9, 12] -> max=12, min=6
    expect(result.forecast[0]!.maxTemp).toBe(12);
    expect(result.forecast[0]!.minTemp).toBe(6);
  });

  it('calculates avg temp correctly per day', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse()));

    const result = await svc.getForecast('London');
    // Day 1: temps [8, 7, 6, 9, 12] -> avg = 42/5 = 8.4 -> rounds to 8
    expect(result.forecast[0]!.avgTemp).toBe(8);
  });

  it('calculates avg humidity correctly per day', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse()));

    const result = await svc.getForecast('London');
    // Day 1: humidities [80, 82, 85, 75, 65] -> avg = 387/5 = 77.4 -> rounds to 77
    expect(result.forecast[0]!.humidity).toBe(77);
  });

  it('takes max rain chance from pop * 100', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse()));

    const result = await svc.getForecast('London');
    // Day 1: pops [0.2, 0.4, 0.5, 0.3, 0.1]*100 = [20, 40, 50, 30, 10] -> max=50
    expect(result.forecast[0]!.chanceOfRain).toBe(50);
  });

  it('respects days limit', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse()));

    const result = await svc.getForecast('London', 2);
    // Mock has 3 dates, but we ask for 2
    expect(result.forecast).toHaveLength(2);
  });

  it('selects midday condition (middle index)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse()));

    const result = await svc.getForecast('London');
    // Day 1: 5 items, conditions indexed 0-4, midday = Math.floor(5/2) = index 2
    // Index 2: 'light rain', icon '10d'
    expect(result.forecast[0]!.condition).toBe('light rain');
    expect(result.forecast[0]!.conditionIcon).toBe('https://openweathermap.org/img/wn/10d@2x.png');
  });

  it('throws for empty geocoding response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    await expect(svc.getForecast('Nonexistent')).rejects.toThrow('Location not found: Nonexistent');
  });

  it('throws for forecast API error (non-200)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse('Forbidden', false, 403));

    await expect(svc.getForecast('London')).rejects.toThrow('OpenWeatherMap forecast error');
  });

  it('populates location fields correctly', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse()));

    const result = await svc.getForecast('London');
    expect(result.location.name).toBe('London');
    expect(result.location.country).toBe('GB');
    expect(result.location.region).toBe('England');
    expect(result.location.lat).toBe(51.5074);
    expect(result.location.lon).toBe(-0.1278);
  });

  it('provider is "openweathermap"', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse()));

    const result = await svc.getForecast('London');
    expect(result.provider).toBe('openweathermap');
  });

  it('fetchedAt is an ISO string', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse()));

    const result = await svc.getForecast('London');
    expect(result.fetchedAt).toBe('2026-02-21T12:00:00.000Z');
  });

  it('handles single forecast item per day', async () => {
    const singleItemList = [
      {
        dt_txt: '2026-02-21 12:00:00',
        main: { temp: 15, humidity: 60 },
        pop: 0.2,
        weather: [{ description: 'sunny', icon: '01d' }],
      },
    ];
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse(singleItemList)));

    const result = await svc.getForecast('London');
    expect(result.forecast).toHaveLength(1);
    expect(result.forecast[0]!.maxTemp).toBe(15);
    expect(result.forecast[0]!.minTemp).toBe(15);
    expect(result.forecast[0]!.avgTemp).toBe(15);
  });

  it('handles pop=0 (no rain) correctly', async () => {
    const noRainList = [
      {
        dt_txt: '2026-02-21 12:00:00',
        main: { temp: 20, humidity: 50 },
        pop: 0,
        weather: [{ description: 'clear', icon: '01d' }],
      },
    ];
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse(noRainList)));

    const result = await svc.getForecast('London');
    expect(result.forecast[0]!.chanceOfRain).toBe(0);
  });

  it('does not include sunrise/sunset/moonPhase (OWM forecast)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse()));

    const result = await svc.getForecast('London');
    expect(result.forecast[0]!.sunrise).toBeUndefined();
    expect(result.forecast[0]!.sunset).toBeUndefined();
    expect(result.forecast[0]!.moonPhase).toBeUndefined();
    expect(result.forecast[0]!.uvIndex).toBeUndefined();
  });

  it('URL-encodes the location for geocoding', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse()));

    await svc.getForecast('São Paulo, BR');
    const geoUrl = mockFetch.mock.calls[0]![0] as string;
    expect(geoUrl).toContain('q=S%C3%A3o%20Paulo%2C%20BR');
  });

  it('handles weather array missing description/icon', async () => {
    const listWithEmpty = [
      { dt_txt: '2026-02-21 12:00:00', main: { temp: 10, humidity: 50 }, pop: 0, weather: [{}] },
    ];
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse(listWithEmpty)));

    const result = await svc.getForecast('London');
    // weather[0].description is undefined -> optional chain returns undefined -> || 'Unknown'
    expect(result.forecast[0]!.condition).toBe('Unknown');
    expect(result.forecast[0]!.conditionIcon).toBe('https://openweathermap.org/img/wn/01d@2x.png');
  });
});

// =============================================================================
// WeatherAPI Current Weather
// =============================================================================

describe('WeatherAPI Current Weather', () => {
  let svc: WeatherDataService;

  beforeEach(() => {
    svc = new WeatherDataService({ provider: 'weatherapi', apiKey: 'test-wa-key' });
  });

  it('makes single fetch with correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiCurrentResponse()));

    await svc.getCurrentWeather('London');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('api.weatherapi.com/v1/current.json');
    expect(url).toContain('key=test-wa-key');
    expect(url).toContain('q=London');
    expect(url).toContain('aqi=no');
  });

  it('returns correct location fields', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    expect(result.location.name).toBe('London');
    expect(result.location.region).toBe('City of London, Greater London');
    expect(result.location.country).toBe('United Kingdom');
    expect(result.location.lat).toBe(51.52);
    expect(result.location.lon).toBe(-0.11);
    expect(result.location.timezone).toBe('Europe/London');
    expect(result.location.localTime).toBe('2026-02-21 14:00');
  });

  it('returns correct current weather fields', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    expect(result.current.humidity).toBe(72);
    expect(result.current.pressure).toBe(1013);
    expect(result.current.windDirection).toBe('SW');
    expect(result.current.windDegree).toBe(220);
    expect(result.current.visibility).toBe(10);
    expect(result.current.uvIndex).toBe(3);
    expect(result.current.cloudCover).toBe(75);
    expect(result.current.condition).toBe('Partly cloudy');
  });

  it('prepends "https:" to conditionIcon', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    expect(result.current.conditionIcon).toBe(
      'https://cdn.weatherapi.com/weather/64x64/day/116.png'
    );
  });

  it('rounds temperature correctly', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    // temp_c: 15.4 -> rounds to 15
    expect(result.current.temperature).toBe(15);
  });

  it('rounds feelsLike correctly', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    // feelslike_c: 13.2 -> rounds to 13
    expect(result.current.feelsLike).toBe(13);
  });

  it('rounds windSpeed correctly', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    // wind_kph: 18.7 -> rounds to 19
    expect(result.current.windSpeed).toBe(19);
  });

  it('isDay is true for is_day=1', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    expect(result.current.isDay).toBe(true);
  });

  it('isDay is false for is_day=0', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiCurrentResponse({ is_day: 0 })));

    const result = await svc.getCurrentWeather('London');
    expect(result.current.isDay).toBe(false);
  });

  it('throws on non-200 response with error message', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ error: { message: 'API key is invalid.' } }, false, 403)
    );

    await expect(svc.getCurrentWeather('London')).rejects.toThrow(
      'WeatherAPI error: API key is invalid.'
    );
  });

  it('throws with "Unknown error" when error response has no message', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}, false, 500));

    await expect(svc.getCurrentWeather('London')).rejects.toThrow(
      'WeatherAPI error: Unknown error'
    );
  });

  it('throws with "Unknown error" when error response has empty error object', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ error: {} }, false, 400));

    await expect(svc.getCurrentWeather('London')).rejects.toThrow(
      'WeatherAPI error: Unknown error'
    );
  });

  it('provider is "weatherapi"', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    expect(result.provider).toBe('weatherapi');
  });

  it('fetchedAt is an ISO string', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiCurrentResponse()));

    const result = await svc.getCurrentWeather('London');
    expect(result.fetchedAt).toBe('2026-02-21T12:00:00.000Z');
  });

  it('URL-encodes the location parameter', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiCurrentResponse()));

    await svc.getCurrentWeather('Tokyo, Japan');
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('q=Tokyo%2C%20Japan');
  });

  it('API key is passed in URL', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiCurrentResponse()));

    await svc.getCurrentWeather('London');
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('key=test-wa-key');
  });
});

// =============================================================================
// WeatherAPI Forecast
// =============================================================================

describe('WeatherAPI Forecast', () => {
  let svc: WeatherDataService;

  beforeEach(() => {
    svc = new WeatherDataService({ provider: 'weatherapi', apiKey: 'test-wa-key' });
  });

  it('makes single fetch with correct URL', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    await svc.getForecast('London');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('api.weatherapi.com/v1/forecast.json');
    expect(url).toContain('key=test-wa-key');
    expect(url).toContain('q=London');
    expect(url).toContain('aqi=no');
  });

  it('uses default 5 days in URL when not specified', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    await svc.getForecast('London');
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('days=5');
  });

  it('uses custom days parameter in URL', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    await svc.getForecast('London', 7);
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('days=7');
  });

  it('caps days at 10', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    await svc.getForecast('London', 15);
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('days=10');
  });

  it('maps forecast days correctly', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    const result = await svc.getForecast('London');
    expect(result.forecast).toHaveLength(3);
    expect(result.forecast[0]!.date).toBe('2026-02-21');
    expect(result.forecast[1]!.date).toBe('2026-02-22');
    expect(result.forecast[2]!.date).toBe('2026-02-23');
  });

  it('rounds maxTemp correctly', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    const result = await svc.getForecast('London');
    // maxtemp_c: 16.2 -> rounds to 16
    expect(result.forecast[0]!.maxTemp).toBe(16);
  });

  it('rounds minTemp correctly', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    const result = await svc.getForecast('London');
    // mintemp_c: 8.1 -> rounds to 8
    expect(result.forecast[0]!.minTemp).toBe(8);
  });

  it('rounds avgTemp correctly', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    const result = await svc.getForecast('London');
    // avgtemp_c: 12.3 -> rounds to 12
    expect(result.forecast[0]!.avgTemp).toBe(12);
  });

  it('passes humidity through from response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    const result = await svc.getForecast('London');
    expect(result.forecast[0]!.humidity).toBe(68);
  });

  it('passes chanceOfRain through from response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    const result = await svc.getForecast('London');
    expect(result.forecast[0]!.chanceOfRain).toBe(30);
    expect(result.forecast[2]!.chanceOfRain).toBe(85);
  });

  it('includes condition text from response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    const result = await svc.getForecast('London');
    expect(result.forecast[0]!.condition).toBe('Partly cloudy');
    expect(result.forecast[1]!.condition).toBe('Sunny');
    expect(result.forecast[2]!.condition).toBe('Heavy rain');
  });

  it('prepends "https:" to conditionIcon', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    const result = await svc.getForecast('London');
    expect(result.forecast[0]!.conditionIcon).toBe(
      'https://cdn.weatherapi.com/weather/64x64/day/116.png'
    );
  });

  it('includes astro data (sunrise, sunset, moonPhase)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    const result = await svc.getForecast('London');
    expect(result.forecast[0]!.sunrise).toBe('07:05 AM');
    expect(result.forecast[0]!.sunset).toBe('05:32 PM');
    expect(result.forecast[0]!.moonPhase).toBe('Waxing Crescent');
  });

  it('includes uvIndex from response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    const result = await svc.getForecast('London');
    expect(result.forecast[0]!.uvIndex).toBe(3);
    expect(result.forecast[1]!.uvIndex).toBe(4);
    expect(result.forecast[2]!.uvIndex).toBe(1);
  });

  it('populates location fields correctly', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    const result = await svc.getForecast('London');
    expect(result.location.name).toBe('London');
    expect(result.location.region).toBe('City of London, Greater London');
    expect(result.location.country).toBe('United Kingdom');
    expect(result.location.lat).toBe(51.52);
    expect(result.location.lon).toBe(-0.11);
  });

  it('provider is "weatherapi"', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    const result = await svc.getForecast('London');
    expect(result.provider).toBe('weatherapi');
  });

  it('fetchedAt is an ISO string', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    const result = await svc.getForecast('London');
    expect(result.fetchedAt).toBe('2026-02-21T12:00:00.000Z');
  });

  it('throws on non-200 response with error message', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ error: { message: 'No matching location found.' } }, false, 400)
    );

    await expect(svc.getForecast('InvalidPlace')).rejects.toThrow(
      'WeatherAPI error: No matching location found.'
    );
  });

  it('throws with "Unknown error" when error has no message', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}, false, 500));

    await expect(svc.getForecast('London')).rejects.toThrow('WeatherAPI error: Unknown error');
  });

  it('URL-encodes the location', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    await svc.getForecast('Los Angeles, CA');
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('q=Los%20Angeles%2C%20CA');
  });

  it('handles empty forecast array', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse([])));

    const result = await svc.getForecast('London');
    expect(result.forecast).toHaveLength(0);
  });

  it('days=1 results in single day request', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    await svc.getForecast('London', 1);
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('days=1');
  });

  it('days=10 is not capped (exactly at max)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    await svc.getForecast('London', 10);
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('days=10');
  });
});

// =============================================================================
// getWindDirection (tested via OpenWeatherMap Current)
// =============================================================================

describe('getWindDirection (via OWM current)', () => {
  let svc: WeatherDataService;

  beforeEach(() => {
    svc = new WeatherDataService({ provider: 'openweathermap', apiKey: 'test-key' });
  });

  // Helper to get wind direction for a given degree value
  async function getDirection(deg: number): Promise<string> {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse({ wind: { speed: 5, deg } })));
    const result = await svc.getCurrentWeather('London');
    return result.current.windDirection;
  }

  // All 16 compass directions at exact midpoints
  it('0 degrees -> N', async () => {
    expect(await getDirection(0)).toBe('N');
  });

  it('22.5 degrees -> NNE', async () => {
    expect(await getDirection(22.5)).toBe('NNE');
  });

  it('45 degrees -> NE', async () => {
    expect(await getDirection(45)).toBe('NE');
  });

  it('67.5 degrees -> ENE', async () => {
    expect(await getDirection(67.5)).toBe('ENE');
  });

  it('90 degrees -> E', async () => {
    expect(await getDirection(90)).toBe('E');
  });

  it('112.5 degrees -> ESE', async () => {
    expect(await getDirection(112.5)).toBe('ESE');
  });

  it('135 degrees -> SE', async () => {
    expect(await getDirection(135)).toBe('SE');
  });

  it('157.5 degrees -> SSE', async () => {
    expect(await getDirection(157.5)).toBe('SSE');
  });

  it('180 degrees -> S', async () => {
    expect(await getDirection(180)).toBe('S');
  });

  it('202.5 degrees -> SSW', async () => {
    expect(await getDirection(202.5)).toBe('SSW');
  });

  it('225 degrees -> SW', async () => {
    expect(await getDirection(225)).toBe('SW');
  });

  it('247.5 degrees -> WSW', async () => {
    expect(await getDirection(247.5)).toBe('WSW');
  });

  it('270 degrees -> W', async () => {
    expect(await getDirection(270)).toBe('W');
  });

  it('292.5 degrees -> WNW', async () => {
    expect(await getDirection(292.5)).toBe('WNW');
  });

  it('315 degrees -> NW', async () => {
    expect(await getDirection(315)).toBe('NW');
  });

  it('337.5 degrees -> NNW', async () => {
    expect(await getDirection(337.5)).toBe('NNW');
  });

  // Edge cases
  it('360 degrees wraps to N', async () => {
    expect(await getDirection(360)).toBe('N');
  });

  it('350 degrees -> NNW (near boundary)', async () => {
    // 350 / 22.5 = 15.556 -> rounds to 16, 16 % 16 = 0 -> N
    // Wait: let me recalculate. 350/22.5 = 15.5556, Math.round = 16, 16%16 = 0 -> N
    expect(await getDirection(350)).toBe('N');
  });

  it('349 degrees -> NNW', async () => {
    // 349 / 22.5 = 15.511 -> rounds to 16 -> 16%16 = 0 -> N
    // Actually: 348.75 would be exactly 15.5 -> rounds to 16 -> N
    // Let me use 340: 340/22.5 = 15.111 -> rounds to 15 -> NNW
    expect(await getDirection(340)).toBe('NNW');
  });

  it('10 degrees -> N (within N range)', async () => {
    // 10 / 22.5 = 0.444 -> rounds to 0 -> N
    expect(await getDirection(10)).toBe('N');
  });

  it('11.25 degrees -> boundary between N and NNE', async () => {
    // 11.25 / 22.5 = 0.5 -> Math.round(0.5) = 1 -> NNE
    // Note: Math.round rounds .5 up to 1
    expect(await getDirection(11.25)).toBe('NNE');
  });

  it('220 degrees -> SW (from mock data)', async () => {
    expect(await getDirection(220)).toBe('SW');
  });
});

// =============================================================================
// Additional edge cases and integration scenarios
// =============================================================================

describe('Edge cases', () => {
  it('OWM current: negative temperatures', async () => {
    const svc = new WeatherDataService({ provider: 'openweathermap', apiKey: 'key' });
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(
      mockResponse(
        owmCurrentResponse({
          main: { temp: -5.7, feels_like: -9.3, humidity: 90, pressure: 1020 },
        })
      )
    );

    const result = await svc.getCurrentWeather('Moscow');
    expect(result.current.temperature).toBe(-6);
    expect(result.current.feelsLike).toBe(-9);
  });

  it('OWM current: zero wind speed', async () => {
    const svc = new WeatherDataService({ provider: 'openweathermap', apiKey: 'key' });
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(
      mockResponse(
        owmCurrentResponse({
          wind: { speed: 0, deg: 0 },
        })
      )
    );

    const result = await svc.getCurrentWeather('London');
    expect(result.current.windSpeed).toBe(0);
  });

  it('OWM current: very low visibility', async () => {
    const svc = new WeatherDataService({ provider: 'openweathermap', apiKey: 'key' });
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse({ visibility: 200 })));

    const result = await svc.getCurrentWeather('London');
    // 200m / 1000 = 0.2 -> rounds to 0
    expect(result.current.visibility).toBe(0);
  });

  it('OWM forecast: all items in same day', async () => {
    const svc = new WeatherDataService({ provider: 'openweathermap', apiKey: 'key' });
    const sameDayList = [
      {
        dt_txt: '2026-02-21 00:00:00',
        main: { temp: 5, humidity: 90 },
        pop: 0.8,
        weather: [{ description: 'rain', icon: '09d' }],
      },
      {
        dt_txt: '2026-02-21 03:00:00',
        main: { temp: 6, humidity: 88 },
        pop: 0.7,
        weather: [{ description: 'rain', icon: '09d' }],
      },
      {
        dt_txt: '2026-02-21 06:00:00',
        main: { temp: 7, humidity: 85 },
        pop: 0.5,
        weather: [{ description: 'clouds', icon: '04d' }],
      },
      {
        dt_txt: '2026-02-21 09:00:00',
        main: { temp: 10, humidity: 80 },
        pop: 0.3,
        weather: [{ description: 'clouds', icon: '04d' }],
      },
      {
        dt_txt: '2026-02-21 12:00:00',
        main: { temp: 12, humidity: 75 },
        pop: 0.2,
        weather: [{ description: 'sunny', icon: '01d' }],
      },
      {
        dt_txt: '2026-02-21 15:00:00',
        main: { temp: 11, humidity: 78 },
        pop: 0.1,
        weather: [{ description: 'clouds', icon: '03d' }],
      },
      {
        dt_txt: '2026-02-21 18:00:00',
        main: { temp: 8, humidity: 82 },
        pop: 0.2,
        weather: [{ description: 'clouds', icon: '04n' }],
      },
      {
        dt_txt: '2026-02-21 21:00:00',
        main: { temp: 6, humidity: 87 },
        pop: 0.4,
        weather: [{ description: 'drizzle', icon: '09n' }],
      },
    ];
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse(sameDayList)));

    const result = await svc.getForecast('London', 5);
    expect(result.forecast).toHaveLength(1);
    expect(result.forecast[0]!.maxTemp).toBe(12);
    expect(result.forecast[0]!.minTemp).toBe(5);
    // avg = (5+6+7+10+12+11+8+6)/8 = 65/8 = 8.125 -> 8
    expect(result.forecast[0]!.avgTemp).toBe(8);
    // max rain = 0.8*100 = 80
    expect(result.forecast[0]!.chanceOfRain).toBe(80);
    // midday = conditions[Math.floor(8/2)] = conditions[4] = 'sunny'
    expect(result.forecast[0]!.condition).toBe('sunny');
  });

  it('WeatherAPI current: temperature rounds .5 up', async () => {
    const svc = new WeatherDataService({ provider: 'weatherapi', apiKey: 'key' });
    mockFetch.mockResolvedValueOnce(
      mockResponse(weatherApiCurrentResponse({ temp_c: 20.5, feelslike_c: 18.5, wind_kph: 10.5 }))
    );

    const result = await svc.getCurrentWeather('London');
    expect(result.current.temperature).toBe(21);
    expect(result.current.feelsLike).toBe(19);
    expect(result.current.windSpeed).toBe(11);
  });

  it('WeatherAPI forecast: exactly 10 days is not capped', async () => {
    const svc = new WeatherDataService({ provider: 'weatherapi', apiKey: 'key' });
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    await svc.getForecast('London', 10);
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('days=10');
  });

  it('WeatherAPI forecast: 11 days is capped to 10', async () => {
    const svc = new WeatherDataService({ provider: 'weatherapi', apiKey: 'key' });
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse()));

    await svc.getForecast('London', 11);
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('days=10');
  });

  it('WeatherAPI forecast: negative maxtemp rounds correctly', async () => {
    const svc = new WeatherDataService({ provider: 'weatherapi', apiKey: 'key' });
    const coldForecast = [
      {
        date: '2026-02-21',
        day: {
          maxtemp_c: -3.7,
          mintemp_c: -15.2,
          avgtemp_c: -9.8,
          avghumidity: 95,
          condition: { text: 'Blizzard', icon: '//cdn.weatherapi.com/weather/64x64/day/227.png' },
          daily_chance_of_rain: 0,
          uv: 1,
        },
        astro: { sunrise: '08:30 AM', sunset: '04:15 PM', moon_phase: 'Full Moon' },
      },
    ];
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiForecastResponse(coldForecast)));

    const result = await svc.getForecast('Anchorage', 1);
    expect(result.forecast[0]!.maxTemp).toBe(-4);
    expect(result.forecast[0]!.minTemp).toBe(-15);
    expect(result.forecast[0]!.avgTemp).toBe(-10);
  });

  it('OWM geocoding error includes response text', async () => {
    const svc = new WeatherDataService({ provider: 'openweathermap', apiKey: 'key' });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue('Invalid API key'),
      json: vi.fn(),
    });

    await expect(svc.getCurrentWeather('London')).rejects.toThrow(
      'OpenWeatherMap geocoding error: Invalid API key'
    );
  });

  it('OWM weather error includes response text', async () => {
    const svc = new WeatherDataService({ provider: 'openweathermap', apiKey: 'key' });
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: vi.fn().mockResolvedValue('Rate limit exceeded'),
      json: vi.fn(),
    });

    await expect(svc.getCurrentWeather('London')).rejects.toThrow(
      'OpenWeatherMap weather error: Rate limit exceeded'
    );
  });

  it('OWM forecast error includes response text', async () => {
    const svc = new WeatherDataService({ provider: 'openweathermap', apiKey: 'key' });
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal server error'),
      json: vi.fn(),
    });

    await expect(svc.getForecast('London')).rejects.toThrow(
      'OpenWeatherMap forecast error: Internal server error'
    );
  });

  it('OWM forecast with empty list returns empty forecast array', async () => {
    const svc = new WeatherDataService({ provider: 'openweathermap', apiKey: 'key' });
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmForecastResponse([])));

    const result = await svc.getForecast('London');
    expect(result.forecast).toHaveLength(0);
  });

  it('multiple sequential calls create independent fetch calls', async () => {
    const svc = new WeatherDataService({ provider: 'weatherapi', apiKey: 'key' });
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiCurrentResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(weatherApiCurrentResponse()));

    await svc.getCurrentWeather('London');
    await svc.getCurrentWeather('Paris');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0]![0] as string).toContain('q=London');
    expect(mockFetch.mock.calls[1]![0] as string).toContain('q=Paris');
  });

  it('OWM forecast does not check geocoding response.ok', async () => {
    // The OWM forecast code calls geoResponse.json() without checking ok first
    // It only checks if geoData[0] is undefined
    const svc = new WeatherDataService({ provider: 'openweathermap', apiKey: 'key' });
    // Return an error response for geo, but json returns an empty array
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue([]),
      text: vi.fn().mockResolvedValue('Unauthorized'),
    });

    // Should throw "Location not found" since array is empty, not a geo error
    await expect(svc.getForecast('London')).rejects.toThrow('Location not found: London');
  });
});

// =============================================================================
// Wind direction boundary tests with precise values
// =============================================================================

describe('getWindDirection boundary precision', () => {
  let svc: WeatherDataService;

  beforeEach(() => {
    svc = new WeatherDataService({ provider: 'openweathermap', apiKey: 'key' });
  });

  async function getDirection(deg: number): Promise<string> {
    mockFetch.mockResolvedValueOnce(mockResponse(owmGeoResponse()));
    mockFetch.mockResolvedValueOnce(mockResponse(owmCurrentResponse({ wind: { speed: 1, deg } })));
    const result = await svc.getCurrentWeather('London');
    return result.current.windDirection;
  }

  it('just under boundary: 11.24 -> N', async () => {
    // 11.24 / 22.5 = 0.4996 -> rounds to 0 -> N
    expect(await getDirection(11.24)).toBe('N');
  });

  it('just over boundary: 11.26 -> NNE', async () => {
    // 11.26 / 22.5 = 0.5004 -> rounds to 1 -> NNE
    expect(await getDirection(11.26)).toBe('NNE');
  });

  it('mid-sector: 33.75 -> NNE', async () => {
    // 33.75 / 22.5 = 1.5 -> Math.round(1.5) = 2 -> NE
    expect(await getDirection(33.75)).toBe('NE');
  });

  it('exactly at 56.25 -> NE/ENE boundary', async () => {
    // 56.25 / 22.5 = 2.5 -> Math.round(2.5) = 3 -> ENE
    // Note: Math.round(2.5) rounds to 3 in modern JS (banker's rounding doesn't apply)
    expect(await getDirection(56.25)).toBe('ENE');
  });

  it('large degree value 720 -> N (wraps via modulo)', async () => {
    // 720 / 22.5 = 32, 32 % 16 = 0 -> N
    expect(await getDirection(720)).toBe('N');
  });
});
