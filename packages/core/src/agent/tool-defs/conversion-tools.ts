/**
 * Conversion Tool Definitions
 *
 * Tool schemas for unit conversion, currency, encoding, hashing, and color conversion.
 */

import type { ToolDefinition } from '../types.js';

export const CONVERSION_TOOL_DEFS: readonly ToolDefinition[] = [
  // ===== CONVERSION TOOLS =====
  {
    name: 'convert_units',
    description: 'Convert between units (length, weight, temperature, etc.)',
    parameters: {
      type: 'object',
      properties: {
        value: {
          type: 'number',
          description: 'Value to convert',
        },
        from: {
          type: 'string',
          description: 'Source unit (e.g., "km", "lb", "celsius")',
        },
        to: {
          type: 'string',
          description: 'Target unit (e.g., "miles", "kg", "fahrenheit")',
        },
      },
      required: ['value', 'from', 'to'],
    },
  },
  {
    name: 'convert_currency',
    description: 'Convert between currencies (uses approximate rates)',
    parameters: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          description: 'Amount to convert',
        },
        from: {
          type: 'string',
          description: 'Source currency code (e.g., "USD", "EUR", "TRY")',
        },
        to: {
          type: 'string',
          description: 'Target currency code',
        },
      },
      required: ['amount', 'from', 'to'],
    },
  },
  // ===== ENCODING TOOLS =====
  {
    name: 'base64_encode',
    description: 'Encode text to Base64',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to encode',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'base64_decode',
    description: 'Decode Base64 to text',
    parameters: {
      type: 'object',
      properties: {
        encoded: {
          type: 'string',
          description: 'Base64 encoded string to decode',
        },
      },
      required: ['encoded'],
    },
  },
  {
    name: 'url_encode',
    description: 'URL encode/decode text',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to encode or decode',
        },
        decode: {
          type: 'boolean',
          description: 'If true, decode instead of encode (default: false)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'hash_text',
    description: 'Generate hash of text (MD5, SHA256, etc.)',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to hash',
        },
        algorithm: {
          type: 'string',
          description: 'Hash algorithm: md5, sha1, sha256, sha512 (default: sha256)',
        },
      },
      required: ['text'],
    },
  },
  // ===== COLOR TOOLS =====
  {
    name: 'convert_color',
    description: 'Convert between color formats (HEX, RGB, HSL)',
    parameters: {
      type: 'object',
      properties: {
        color: {
          type: 'string',
          description: 'Color value (e.g., "#ff5733", "rgb(255,87,51)", "hsl(11,100%,60%)")',
        },
        to: {
          type: 'string',
          description: 'Target format: hex, rgb, hsl (default: all)',
        },
      },
      required: ['color'],
    },
  },
];
