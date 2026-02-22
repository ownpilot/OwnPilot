/**
 * Utility Generation & Encoding Tools
 *
 * - UUID generation
 * - Password generation with strength rating
 * - Random number generation
 * - Cryptographic hashing (MD5, SHA-1, SHA-256, SHA-512)
 * - Encoding/decoding (Base64, URL, HTML, Hex)
 */

import * as crypto from 'node:crypto';
import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../types.js';
import { getErrorMessage } from '../../services/error-utils.js';

// =============================================================================
// UUID GENERATION
// =============================================================================

export const generateUuidTool: ToolDefinition = {
  name: 'generate_uuid',
  brief: 'Generate one or more unique UUIDs',
  description:
    'Generate a unique ID (UUID v4). Call this when the user needs a unique identifier, reference code, or tracking ID. Can generate multiple UUIDs at once.',
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      count: {
        type: 'number',
        description: 'Number of UUIDs to generate (default: 1, max: 10)',
      },
      format: {
        type: 'string',
        enum: ['standard', 'no-dashes', 'uppercase'],
        description: 'UUID format (default: standard)',
      },
    },
    required: [],
  },
};

export const generateUuidExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const count = Math.min((args.count as number) || 1, 10);
    const format = (args.format as string) || 'standard';

    const uuids: string[] = [];
    for (let i = 0; i < count; i++) {
      let uuid: string = crypto.randomUUID();
      if (format === 'no-dashes') {
        uuid = uuid.replace(/-/g, '');
      } else if (format === 'uppercase') {
        uuid = uuid.toUpperCase();
      }
      uuids.push(uuid);
    }

    return {
      content: JSON.stringify(count === 1 ? { uuid: uuids[0] } : { uuids, count }),
    };
  } catch (error) {
    return {
      content: `Error generating UUID: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// PASSWORD GENERATION
// =============================================================================

export const generatePasswordTool: ToolDefinition = {
  name: 'generate_password',
  brief: 'Generate secure random passwords with strength rating',
  description:
    'Generate a secure random password. Call this when the user asks for a password, passphrase, or secure random string. Configurable length, character types, and strength indicator.',
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      length: {
        type: 'number',
        description: 'Password length (default: 16, min: 8, max: 128)',
      },
      includeUppercase: {
        type: 'boolean',
        description: 'Include uppercase letters (default: true)',
      },
      includeLowercase: {
        type: 'boolean',
        description: 'Include lowercase letters (default: true)',
      },
      includeNumbers: {
        type: 'boolean',
        description: 'Include numbers (default: true)',
      },
      includeSymbols: {
        type: 'boolean',
        description: 'Include symbols (default: true)',
      },
      excludeAmbiguous: {
        type: 'boolean',
        description: 'Exclude ambiguous characters like 0, O, l, 1, I (default: false)',
      },
      count: {
        type: 'number',
        description: 'Number of passwords to generate (default: 1, max: 5)',
      },
    },
    required: [],
  },
};

export const generatePasswordExecutor: ToolExecutor = async (
  args
): Promise<ToolExecutionResult> => {
  try {
    const length = Math.max(8, Math.min((args.length as number) || 16, 128));
    const includeUppercase = args.includeUppercase !== false;
    const includeLowercase = args.includeLowercase !== false;
    const includeNumbers = args.includeNumbers !== false;
    const includeSymbols = args.includeSymbols !== false;
    const excludeAmbiguous = args.excludeAmbiguous === true;
    const count = Math.min((args.count as number) || 1, 5);

    let chars = '';
    if (includeUppercase)
      chars += excludeAmbiguous ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (includeLowercase)
      chars += excludeAmbiguous ? 'abcdefghjkmnpqrstuvwxyz' : 'abcdefghijklmnopqrstuvwxyz';
    if (includeNumbers) chars += excludeAmbiguous ? '23456789' : '0123456789';
    if (includeSymbols) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';

    if (chars.length === 0) {
      return {
        content: JSON.stringify({ error: 'At least one character type must be included' }),
        isError: true,
      };
    }

    const passwords: string[] = [];
    for (let i = 0; i < count; i++) {
      let password = '';
      const randomBytes = crypto.randomBytes(length);
      for (let j = 0; j < length; j++) {
        password += chars[randomBytes[j]! % chars.length];
      }
      passwords.push(password);
    }

    // Calculate password strength
    const entropyPerChar = Math.log2(chars.length);
    const totalEntropy = entropyPerChar * length;
    const strength =
      totalEntropy >= 128
        ? 'very strong'
        : totalEntropy >= 80
          ? 'strong'
          : totalEntropy >= 60
            ? 'moderate'
            : totalEntropy >= 40
              ? 'weak'
              : 'very weak';

    return {
      content: JSON.stringify(
        count === 1
          ? { password: passwords[0], length, strength, entropyBits: Math.round(totalEntropy) }
          : { passwords, count, length, strength, entropyBits: Math.round(totalEntropy) }
      ),
    };
  } catch (error) {
    return {
      content: `Error generating password: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// RANDOM NUMBER GENERATION
// =============================================================================

export const generateRandomNumberTool: ToolDefinition = {
  name: 'random_number',
  brief: 'Generate random numbers in a range',
  description:
    'Generate random numbers. Call this when the user wants a random number, dice roll, coin flip, lottery numbers, or random selection from a range. Supports integer and decimal output.',
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      min: {
        type: 'number',
        description: 'Minimum value (default: 0)',
      },
      max: {
        type: 'number',
        description: 'Maximum value (default: 100)',
      },
      count: {
        type: 'number',
        description: 'Number of random numbers to generate (default: 1, max: 100)',
      },
      integer: {
        type: 'boolean',
        description: 'Generate integer only (default: true)',
      },
    },
    required: [],
  },
};

export const generateRandomNumberExecutor: ToolExecutor = async (
  args
): Promise<ToolExecutionResult> => {
  try {
    const min = (args.min as number) ?? 0;
    const max = (args.max as number) ?? 100;
    const count = Math.min((args.count as number) || 1, 100);
    const integer = args.integer !== false;

    if (min >= max) {
      return {
        content: JSON.stringify({ error: 'min must be less than max' }),
        isError: true,
      };
    }

    const numbers: number[] = [];
    for (let i = 0; i < count; i++) {
      const rand = Math.random() * (max - min) + min;
      numbers.push(integer ? Math.floor(rand) : Number(rand.toFixed(4)));
    }

    return {
      content: JSON.stringify(
        count === 1 ? { number: numbers[0], min, max } : { numbers, count, min, max }
      ),
    };
  } catch (error) {
    return {
      content: `Error generating random number: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// HASHING
// =============================================================================

export const hashTextTool: ToolDefinition = {
  name: 'hash_text',
  brief: 'Hash text with MD5, SHA-1, SHA-256, or SHA-512',
  description:
    'Generate a cryptographic hash of text. Call this when the user wants to hash a string, verify integrity, or create a checksum. Supports MD5, SHA-1, SHA-256, SHA-512.',
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to hash',
      },
      algorithm: {
        type: 'string',
        enum: ['md5', 'sha1', 'sha256', 'sha512'],
        description: 'Hash algorithm (default: sha256)',
      },
    },
    required: ['text'],
  },
};

export const hashTextExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const text = args.text as string;
    const algorithm = (args.algorithm as string) || 'sha256';

    const hash = crypto.createHash(algorithm).update(text).digest('hex');

    return {
      content: JSON.stringify({
        input: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
        algorithm,
        hash,
        length: hash.length,
      }),
    };
  } catch (error) {
    return {
      content: `Error hashing text: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// ENCODING/DECODING
// =============================================================================

export const encodeDecodeTool: ToolDefinition = {
  name: 'encode_decode',
  brief: 'Encode/decode text: Base64, URL, HTML, or Hex',
  description:
    'Encode or decode text. Call this when the user wants to convert text to/from Base64, URL-encode, HTML-encode, or Hex. Useful for encoding data for APIs, URLs, or debugging encoded strings.',
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to encode or decode',
      },
      method: {
        type: 'string',
        enum: ['base64', 'url', 'html', 'hex'],
        description: 'Encoding method',
      },
      operation: {
        type: 'string',
        enum: ['encode', 'decode'],
        description: 'Whether to encode or decode',
      },
    },
    required: ['text', 'method', 'operation'],
  },
};

export const encodeDecodeExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const text = args.text as string;
    const method = args.method as string;
    const operation = args.operation as 'encode' | 'decode';

    let result: string;

    switch (method) {
      case 'base64':
        result =
          operation === 'encode'
            ? Buffer.from(text).toString('base64')
            : Buffer.from(text, 'base64').toString('utf-8');
        break;
      case 'url':
        result = operation === 'encode' ? encodeURIComponent(text) : decodeURIComponent(text);
        break;
      case 'html':
        if (operation === 'encode') {
          result = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        } else {
          result = text
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'");
        }
        break;
      case 'hex':
        result =
          operation === 'encode'
            ? Buffer.from(text).toString('hex')
            : Buffer.from(text, 'hex').toString('utf-8');
        break;
      default:
        return {
          content: JSON.stringify({ error: `Unknown encoding method: ${method}` }),
          isError: true,
        };
    }

    return {
      content: JSON.stringify({
        input: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
        output: result,
        method,
        operation,
      }),
    };
  } catch (error) {
    return {
      content: `Error ${args.operation}ing text: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};
