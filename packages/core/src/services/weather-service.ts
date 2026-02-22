/**
 * Weather Service
 *
 * Provider-agnostic weather data service.
 * Supports: OpenWeatherMap, WeatherAPI
 */

// =============================================================================
// Types
// =============================================================================

export type WeatherProvider = 'openweathermap' | 'weatherapi';

export interface WeatherServiceConfig {
  provider: WeatherProvider;
  apiKey: string;
}

export interface WeatherCurrent {
  location: {
    name: string;
    region?: string;
    country: string;
    lat: number;
    lon: number;
    timezone?: string;
    localTime?: string;
  };
  current: {
    temperature: number;
    feelsLike: number;
    humidity: number;
    pressure: number;
    windSpeed: number;
    windDirection: string;
    windDegree: number;
    visibility: number;
    uvIndex?: number;
    cloudCover: number;
    condition: string;
    conditionIcon: string;
    isDay: boolean;
  };
  provider: string;
  fetchedAt: string;
}

export interface WeatherForecastDay {
  date: string;
  maxTemp: number;
  minTemp: number;
  avgTemp: number;
  humidity: number;
  condition: string;
  conditionIcon: string;
  chanceOfRain: number;
  sunrise?: string;
  sunset?: string;
  moonPhase?: string;
  uvIndex?: number;
}

export interface WeatherForecast {
  location: {
    name: string;
    region?: string;
    country: string;
    lat: number;
    lon: number;
  };
  forecast: WeatherForecastDay[];
  provider: string;
  fetchedAt: string;
}

export interface WeatherHourly {
  time: string;
  temperature: number;
  feelsLike: number;
  humidity: number;
  condition: string;
  conditionIcon: string;
  chanceOfRain: number;
  windSpeed: number;
}

// =============================================================================
// OpenWeatherMap Implementation
// =============================================================================

async function openWeatherMapCurrent(apiKey: string, location: string): Promise<WeatherCurrent> {
  // First, geocode the location
  const geoUrl = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(location)}&limit=1&appid=${apiKey}`;
  const geoResponse = await fetch(geoUrl);

  if (!geoResponse.ok) {
    throw new Error(`OpenWeatherMap geocoding error: ${await geoResponse.text()}`);
  }

  interface GeoLocation {
    lat: number;
    lon: number;
    name: string;
    country: string;
    state?: string;
  }

  interface OWMWeatherResponse {
    timezone: number;
    visibility: number;
    main: { temp: number; feels_like: number; humidity: number; pressure: number };
    wind: { speed: number; deg: number };
    clouds: { all: number };
    weather: Array<{ description: string; icon: string }>;
  }

  const geoData = (await geoResponse.json()) as GeoLocation[];
  const geoLocation = geoData[0];
  if (!geoLocation) {
    throw new Error(`Location not found: ${location}`);
  }

  const { lat, lon, name, country, state } = geoLocation;

  // Get current weather
  const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`;
  const weatherResponse = await fetch(weatherUrl);

  if (!weatherResponse.ok) {
    throw new Error(`OpenWeatherMap weather error: ${await weatherResponse.text()}`);
  }

  const data = (await weatherResponse.json()) as OWMWeatherResponse;
  const weatherInfo = data.weather[0] ?? { description: 'Unknown', icon: '01d' };

  return {
    location: {
      name,
      region: state,
      country,
      lat,
      lon,
      timezone: `UTC${data.timezone >= 0 ? '+' : ''}${Math.floor(data.timezone / 3600)}`,
    },
    current: {
      temperature: Math.round(data.main.temp),
      feelsLike: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      pressure: data.main.pressure,
      windSpeed: Math.round(data.wind.speed * 3.6), // m/s to km/h
      windDirection: getWindDirection(data.wind.deg),
      windDegree: data.wind.deg,
      visibility: Math.round(data.visibility / 1000), // m to km
      cloudCover: data.clouds.all,
      condition: weatherInfo.description,
      conditionIcon: `https://openweathermap.org/img/wn/${weatherInfo.icon}@2x.png`,
      isDay: weatherInfo.icon.includes('d'),
    },
    provider: 'openweathermap',
    fetchedAt: new Date().toISOString(),
  };
}

async function openWeatherMapForecast(
  apiKey: string,
  location: string,
  days: number = 5
): Promise<WeatherForecast> {
  interface GeoLocation {
    lat: number;
    lon: number;
    name: string;
    country: string;
    state?: string;
  }

  interface ForecastItem {
    dt_txt: string;
    main: { temp: number; humidity: number };
    pop: number;
    weather: Array<{ description: string; icon: string }>;
  }

  interface OWMForecastResponse {
    list: ForecastItem[];
  }

  // Geocode location
  const geoUrl = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(location)}&limit=1&appid=${apiKey}`;
  const geoResponse = await fetch(geoUrl);
  const geoData = (await geoResponse.json()) as GeoLocation[];
  const geoLocation = geoData[0];

  if (!geoLocation) {
    throw new Error(`Location not found: ${location}`);
  }

  const { lat, lon, name, country, state } = geoLocation;

  // Get forecast (free tier: 5-day/3-hour forecast)
  const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`;
  const forecastResponse = await fetch(forecastUrl);

  if (!forecastResponse.ok) {
    throw new Error(`OpenWeatherMap forecast error: ${await forecastResponse.text()}`);
  }

  const data = (await forecastResponse.json()) as OWMForecastResponse;

  // Group by day and aggregate
  const dailyData: Map<string, ForecastItem[]> = new Map();

  for (const item of data.list) {
    const datePart = item.dt_txt.split(' ')[0] || item.dt_txt;
    if (!dailyData.has(datePart)) {
      dailyData.set(datePart, []);
    }
    dailyData.get(datePart)!.push(item);
  }

  const forecast: WeatherForecastDay[] = [];
  let count = 0;

  for (const [dateKey, items] of dailyData) {
    if (count >= days) break;

    const temps = items.map((i) => i.main.temp);
    const humidities = items.map((i) => i.main.humidity);
    const rainChances = items.map((i) => (i.pop || 0) * 100);

    // Find most common condition
    const conditions = items.map((i) => ({
      desc: i.weather[0]?.description || 'Unknown',
      icon: i.weather[0]?.icon || '01d',
    }));
    const midday = conditions[Math.floor(conditions.length / 2)] || conditions[0];

    forecast.push({
      date: dateKey,
      maxTemp: Math.round(Math.max(...temps)),
      minTemp: Math.round(Math.min(...temps)),
      avgTemp: Math.round(temps.reduce((a, b) => a + b, 0) / temps.length),
      humidity: Math.round(humidities.reduce((a, b) => a + b, 0) / humidities.length),
      condition: midday?.desc || 'Unknown',
      conditionIcon: `https://openweathermap.org/img/wn/${midday?.icon || '01d'}@2x.png`,
      chanceOfRain: Math.round(Math.max(...rainChances)),
    });

    count++;
  }

  return {
    location: {
      name,
      region: state,
      country,
      lat,
      lon,
    },
    forecast,
    provider: 'openweathermap',
    fetchedAt: new Date().toISOString(),
  };
}

// =============================================================================
// WeatherAPI Implementation
// =============================================================================

async function weatherAPICurrent(apiKey: string, location: string): Promise<WeatherCurrent> {
  interface WeatherAPICurrentResponse {
    location: {
      name: string;
      region: string;
      country: string;
      lat: number;
      lon: number;
      tz_id: string;
      localtime: string;
    };
    current: {
      temp_c: number;
      feelslike_c: number;
      humidity: number;
      pressure_mb: number;
      wind_kph: number;
      wind_dir: string;
      wind_degree: number;
      vis_km: number;
      uv: number;
      cloud: number;
      condition: { text: string; icon: string };
      is_day: number;
    };
  }

  const url = `https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${encodeURIComponent(location)}&aqi=no`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = (await response.json()) as { error?: { message?: string } };
    throw new Error(`WeatherAPI error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = (await response.json()) as WeatherAPICurrentResponse;

  return {
    location: {
      name: data.location.name,
      region: data.location.region,
      country: data.location.country,
      lat: data.location.lat,
      lon: data.location.lon,
      timezone: data.location.tz_id,
      localTime: data.location.localtime,
    },
    current: {
      temperature: Math.round(data.current.temp_c),
      feelsLike: Math.round(data.current.feelslike_c),
      humidity: data.current.humidity,
      pressure: data.current.pressure_mb,
      windSpeed: Math.round(data.current.wind_kph),
      windDirection: data.current.wind_dir,
      windDegree: data.current.wind_degree,
      visibility: data.current.vis_km,
      uvIndex: data.current.uv,
      cloudCover: data.current.cloud,
      condition: data.current.condition.text,
      conditionIcon: `https:${data.current.condition.icon}`,
      isDay: data.current.is_day === 1,
    },
    provider: 'weatherapi',
    fetchedAt: new Date().toISOString(),
  };
}

async function weatherAPIForecast(
  apiKey: string,
  location: string,
  days: number = 5
): Promise<WeatherForecast> {
  interface ForecastDayData {
    date: string;
    day: {
      maxtemp_c: number;
      mintemp_c: number;
      avgtemp_c: number;
      avghumidity: number;
      condition: { text: string; icon: string };
      daily_chance_of_rain: number;
      uv: number;
    };
    astro: {
      sunrise: string;
      sunset: string;
      moon_phase: string;
    };
  }

  interface WeatherAPIForecastResponse {
    location: {
      name: string;
      region: string;
      country: string;
      lat: number;
      lon: number;
    };
    forecast: {
      forecastday: ForecastDayData[];
    };
  }

  // WeatherAPI free tier supports up to 3 days, paid up to 14 days
  const actualDays = Math.min(days, 10);
  const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${encodeURIComponent(location)}&days=${actualDays}&aqi=no`;
  const response = await fetch(url);

  if (!response.ok) {
    const error = (await response.json()) as { error?: { message?: string } };
    throw new Error(`WeatherAPI error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = (await response.json()) as WeatherAPIForecastResponse;

  const forecast: WeatherForecastDay[] = data.forecast.forecastday.map((day) => ({
    date: day.date,
    maxTemp: Math.round(day.day.maxtemp_c),
    minTemp: Math.round(day.day.mintemp_c),
    avgTemp: Math.round(day.day.avgtemp_c),
    humidity: day.day.avghumidity,
    condition: day.day.condition.text,
    conditionIcon: `https:${day.day.condition.icon}`,
    chanceOfRain: day.day.daily_chance_of_rain,
    sunrise: day.astro.sunrise,
    sunset: day.astro.sunset,
    moonPhase: day.astro.moon_phase,
    uvIndex: day.day.uv,
  }));

  return {
    location: {
      name: data.location.name,
      region: data.location.region,
      country: data.location.country,
      lat: data.location.lat,
      lon: data.location.lon,
    },
    forecast,
    provider: 'weatherapi',
    fetchedAt: new Date().toISOString(),
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

function getWindDirection(degrees: number): string {
  const directions = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index] || 'N';
}

// =============================================================================
// Weather Service Class
// =============================================================================

export class WeatherDataService {
  private config: WeatherServiceConfig;

  constructor(config: WeatherServiceConfig) {
    this.config = config;
  }

  /**
   * Get current weather for a location
   */
  async getCurrentWeather(location: string): Promise<WeatherCurrent> {
    switch (this.config.provider) {
      case 'openweathermap':
        return openWeatherMapCurrent(this.config.apiKey, location);
      case 'weatherapi':
        return weatherAPICurrent(this.config.apiKey, location);
      default:
        throw new Error(`Unsupported weather provider: ${this.config.provider}`);
    }
  }

  /**
   * Get weather forecast for a location
   */
  async getForecast(location: string, days: number = 5): Promise<WeatherForecast> {
    switch (this.config.provider) {
      case 'openweathermap':
        return openWeatherMapForecast(this.config.apiKey, location, days);
      case 'weatherapi':
        return weatherAPIForecast(this.config.apiKey, location, days);
      default:
        throw new Error(`Unsupported weather provider: ${this.config.provider}`);
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createWeatherDataService(config: WeatherServiceConfig): WeatherDataService {
  return new WeatherDataService(config);
}

// =============================================================================
// Available Providers
// =============================================================================

export const WEATHER_PROVIDERS = [
  {
    id: 'openweathermap',
    name: 'OpenWeatherMap',
    freeLimit: '1,000 calls/day',
    signupUrl: 'https://openweathermap.org/api',
  },
  {
    id: 'weatherapi',
    name: 'WeatherAPI',
    freeLimit: '1,000,000 calls/month',
    signupUrl: 'https://www.weatherapi.com/',
  },
];
