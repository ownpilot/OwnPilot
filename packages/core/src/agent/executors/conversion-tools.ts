/**
 * Conversion tool executors
 *
 * Executors: convert_units, convert_currency, base64_encode, base64_decode,
 *            url_encode, hash_text, convert_color
 */

import { createHash } from 'node:crypto';
import type { ToolExecutor } from '../types.js';

export const CONVERSION_EXECUTORS: Record<string, ToolExecutor> = {
  convert_units: async (args) => {
    const value = args.value as number;
    const from = (args.from as string).toLowerCase();
    const to = (args.to as string).toLowerCase();

    // Conversion factors to base units
    const conversions: Record<string, Record<string, number>> = {
      // Length (base: meters)
      length: {
        m: 1,
        meter: 1,
        meters: 1,
        km: 1000,
        kilometer: 1000,
        kilometers: 1000,
        cm: 0.01,
        centimeter: 0.01,
        centimeters: 0.01,
        mm: 0.001,
        millimeter: 0.001,
        millimeters: 0.001,
        mi: 1609.344,
        mile: 1609.344,
        miles: 1609.344,
        yd: 0.9144,
        yard: 0.9144,
        yards: 0.9144,
        ft: 0.3048,
        foot: 0.3048,
        feet: 0.3048,
        in: 0.0254,
        inch: 0.0254,
        inches: 0.0254,
      },
      // Weight (base: grams)
      weight: {
        g: 1,
        gram: 1,
        grams: 1,
        kg: 1000,
        kilogram: 1000,
        kilograms: 1000,
        mg: 0.001,
        milligram: 0.001,
        milligrams: 0.001,
        lb: 453.592,
        pound: 453.592,
        pounds: 453.592,
        oz: 28.3495,
        ounce: 28.3495,
        ounces: 28.3495,
        ton: 1000000,
        tons: 1000000,
      },
      // Temperature (special handling)
      temperature: {
        c: 1,
        celsius: 1,
        f: 1,
        fahrenheit: 1,
        k: 1,
        kelvin: 1,
      },
    };

    // Find which category
    let category: string | null = null;
    for (const [cat, units] of Object.entries(conversions)) {
      if (from in units && to in units) {
        category = cat;
        break;
      }
    }

    if (!category) {
      return { content: `Error: Cannot convert from ${from} to ${to}`, isError: true };
    }

    let result: number;
    if (category === 'temperature') {
      // Special temperature conversion
      const fromUnit = from.startsWith('c') ? 'c' : from.startsWith('f') ? 'f' : 'k';
      const toUnit = to.startsWith('c') ? 'c' : to.startsWith('f') ? 'f' : 'k';

      // Convert to Celsius first
      let celsius: number;
      if (fromUnit === 'c') celsius = value;
      else if (fromUnit === 'f') celsius = ((value - 32) * 5) / 9;
      else celsius = value - 273.15;

      // Convert from Celsius to target
      if (toUnit === 'c') result = celsius;
      else if (toUnit === 'f') result = (celsius * 9) / 5 + 32;
      else result = celsius + 273.15;
    } else {
      const categoryUnits = conversions[category];
      if (!categoryUnits) {
        return { content: `Error: Unknown category: ${category}`, isError: true };
      }
      const fromFactor = categoryUnits[from];
      const toFactor = categoryUnits[to];
      if (fromFactor === undefined || toFactor === undefined) {
        return { content: `Error: Cannot convert from ${from} to ${to}`, isError: true };
      }
      result = (value * fromFactor) / toFactor;
    }

    return { content: `${value} ${from} = ${result.toFixed(4)} ${to}` };
  },

  convert_currency: async (args) => {
    const amount = args.amount as number;
    const from = (args.from as string).toUpperCase();
    const to = (args.to as string).toUpperCase();

    // Approximate exchange rates (USD base)
    const rates: Record<string, number> = {
      USD: 1,
      EUR: 0.92,
      GBP: 0.79,
      JPY: 149.5,
      CNY: 7.24,
      TRY: 32.5,
      AUD: 1.53,
      CAD: 1.36,
      CHF: 0.88,
      INR: 83.12,
      KRW: 1320,
      BRL: 4.97,
      MXN: 17.15,
      RUB: 89.5,
      SEK: 10.42,
      NOK: 10.58,
      DKK: 6.87,
      PLN: 3.98,
      THB: 35.2,
      SGD: 1.34,
      HKD: 7.82,
      NZD: 1.64,
      ZAR: 18.65,
      AED: 3.67,
      SAR: 3.75,
    };

    if (!rates[from] || !rates[to]) {
      return {
        content: `Error: Unknown currency code. Supported: ${Object.keys(rates).join(', ')}`,
        isError: true,
      };
    }

    const inUsd = amount / rates[from];
    const result = inUsd * rates[to];

    return {
      content: `${amount.toLocaleString()} ${from} = ${result.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${to}`,
    };
  },

  base64_encode: async (args) => {
    const text = args.text as string;
    return { content: Buffer.from(text, 'utf-8').toString('base64') };
  },

  base64_decode: async (args) => {
    const encoded = args.encoded as string;
    try {
      return { content: Buffer.from(encoded, 'base64').toString('utf-8') };
    } catch {
      return { content: 'Error: Invalid Base64 string', isError: true };
    }
  },

  url_encode: async (args) => {
    const text = args.text as string;
    const decode = args.decode as boolean;

    try {
      if (decode) {
        return { content: decodeURIComponent(text) };
      }
      return { content: encodeURIComponent(text) };
    } catch {
      return { content: 'Error: Invalid URL encoding', isError: true };
    }
  },

  hash_text: async (args) => {
    const text = args.text as string;
    const algorithm = (args.algorithm as string) ?? 'sha256';

    const validAlgorithms = ['md5', 'sha1', 'sha256', 'sha512'];
    if (!validAlgorithms.includes(algorithm)) {
      return {
        content: `Error: Invalid algorithm. Use: ${validAlgorithms.join(', ')}`,
        isError: true,
      };
    }

    const hash = createHash(algorithm).update(text).digest('hex');
    return { content: `${algorithm.toUpperCase()}: ${hash}` };
  },

  convert_color: async (args) => {
    const color = (args.color as string).trim();
    const to = args.to as string | undefined;

    let r: number, g: number, b: number;

    // Parse HEX
    const hexMatch = color.match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
    if (hexMatch && hexMatch[1]) {
      let hex = hexMatch[1];
      if (hex.length === 3) {
        hex = hex
          .split('')
          .map((c) => c + c)
          .join('');
      }
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
    // Parse RGB
    else if (color.match(/^rgb/i)) {
      const rgbMatch = color.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
      if (rgbMatch && rgbMatch[1] && rgbMatch[2] && rgbMatch[3]) {
        r = parseInt(rgbMatch[1]);
        g = parseInt(rgbMatch[2]);
        b = parseInt(rgbMatch[3]);
      } else {
        return { content: 'Error: Invalid RGB format', isError: true };
      }
    }
    // Parse HSL
    else if (color.match(/^hsl/i)) {
      const hslMatch = color.match(/hsl\s*\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*\)/i);
      if (hslMatch && hslMatch[1] && hslMatch[2] && hslMatch[3]) {
        const h = parseInt(hslMatch[1]) / 360;
        const s = parseInt(hslMatch[2]) / 100;
        const l = parseInt(hslMatch[3]) / 100;

        if (s === 0) {
          r = g = b = Math.round(l * 255);
        } else {
          const hue2rgb = (p: number, q: number, t: number) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
          };
          const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
          const p = 2 * l - q;
          r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
          g = Math.round(hue2rgb(p, q, h) * 255);
          b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
        }
      } else {
        return { content: 'Error: Invalid HSL format', isError: true };
      }
    } else {
      return { content: 'Error: Unrecognized color format', isError: true };
    }

    // Convert to all formats
    const hex = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
    const rgb = `rgb(${r}, ${g}, ${b})`;

    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const l = (max + min) / 2;
    let h = 0,
      s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      const rr = r / 255,
        gg = g / 255,
        bb = b / 255;
      if (rr === max) h = (gg - bb) / d + (gg < bb ? 6 : 0);
      else if (gg === max) h = (bb - rr) / d + 2;
      else h = (rr - gg) / d + 4;
      h /= 6;
    }
    const hsl = `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;

    if (to === 'hex') return { content: hex };
    if (to === 'rgb') return { content: rgb };
    if (to === 'hsl') return { content: hsl };

    return {
      content: `\u{1F3A8} Color Conversion:
HEX: ${hex}
RGB: ${rgb}
HSL: ${hsl}`,
    };
  },
};
