/**
 * Advanced Calculator Plugin
 *
 * Provides mathematical calculations, unit conversions, and financial tools.
 * Demonstrates: tools, handlers
 */

import { createPlugin, type MessageHandler, type HandlerContext, type HandlerResult } from '../index.js';
import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../../agent/types.js';

// =============================================================================
// Unit Conversion Data
// =============================================================================

const UNIT_CONVERSIONS: Record<string, Record<string, number>> = {
  length: {
    m: 1, meter: 1, meters: 1,
    km: 1000, kilometer: 1000, kilometers: 1000,
    cm: 0.01, centimeter: 0.01, centimeters: 0.01,
    mm: 0.001, millimeter: 0.001, millimeters: 0.001,
    mi: 1609.344, mile: 1609.344, miles: 1609.344,
    ft: 0.3048, foot: 0.3048, feet: 0.3048,
    in: 0.0254, inch: 0.0254, inches: 0.0254,
    yd: 0.9144, yard: 0.9144, yards: 0.9144,
  },
  weight: {
    g: 1, gram: 1, grams: 1,
    kg: 1000, kilogram: 1000, kilograms: 1000,
    mg: 0.001, milligram: 0.001, milligrams: 0.001,
    lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
    oz: 28.3495, ounce: 28.3495, ounces: 28.3495,
    ton: 1000000, tons: 1000000,
  },
  volume: {
    l: 1, liter: 1, liters: 1,
    ml: 0.001, milliliter: 0.001, milliliters: 0.001,
    gal: 3.78541, gallon: 3.78541, gallons: 3.78541,
    qt: 0.946353, quart: 0.946353, quarts: 0.946353,
    pt: 0.473176, pint: 0.473176, pints: 0.473176,
    cup: 0.236588, cups: 0.236588,
  },
  temperature: {
    c: 1, celsius: 1, f: 1, fahrenheit: 1, k: 1, kelvin: 1,
  },
  time: {
    s: 1, sec: 1, second: 1, seconds: 1,
    min: 60, minute: 60, minutes: 60,
    h: 3600, hr: 3600, hour: 3600, hours: 3600,
    d: 86400, day: 86400, days: 86400,
    week: 604800, weeks: 604800,
    month: 2592000, months: 2592000,
    year: 31536000, years: 31536000,
  },
  data: {
    b: 1, byte: 1, bytes: 1,
    kb: 1024, kilobyte: 1024, kilobytes: 1024,
    mb: 1048576, megabyte: 1048576, megabytes: 1048576,
    gb: 1073741824, gigabyte: 1073741824, gigabytes: 1073741824,
    tb: 1099511627776, terabyte: 1099511627776, terabytes: 1099511627776,
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

function evaluateExpression(expression: string): number {
  let cleaned = expression
    .replace(/\s+/g, '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/\^/g, '**');

  cleaned = cleaned
    .replace(/sqrt\(/g, 'Math.sqrt(')
    .replace(/sin\(/g, 'Math.sin(')
    .replace(/cos\(/g, 'Math.cos(')
    .replace(/tan\(/g, 'Math.tan(')
    .replace(/log\(/g, 'Math.log10(')
    .replace(/ln\(/g, 'Math.log(')
    .replace(/abs\(/g, 'Math.abs(')
    .replace(/floor\(/g, 'Math.floor(')
    .replace(/ceil\(/g, 'Math.ceil(')
    .replace(/round\(/g, 'Math.round(')
    .replace(/pi/gi, 'Math.PI')
    .replace(/e(?![a-z])/gi, 'Math.E');

  if (!/^[0-9+\-*/%().Math\s,PIEsqrtincoabloflerund]+$/.test(cleaned)) {
    throw new Error('Invalid characters in expression');
  }

  const fn = new Function(`"use strict"; return (${cleaned})`);
  const result = fn();

  if (typeof result !== 'number' || !isFinite(result)) {
    throw new Error('Result is not a valid number');
  }

  return result;
}

function convertTemperature(value: number, from: string, to: string): number {
  let celsius: number;
  if (from === 'c' || from === 'celsius') {
    celsius = value;
  } else if (from === 'f' || from === 'fahrenheit') {
    celsius = (value - 32) * (5 / 9);
  } else if (from === 'k' || from === 'kelvin') {
    celsius = value - 273.15;
  } else {
    throw new Error(`Unknown temperature unit: ${from}`);
  }

  if (to === 'c' || to === 'celsius') {
    return celsius;
  } else if (to === 'f' || to === 'fahrenheit') {
    return celsius * (9 / 5) + 32;
  } else if (to === 'k' || to === 'kelvin') {
    return celsius + 273.15;
  } else {
    throw new Error(`Unknown temperature unit: ${to}`);
  }
}

function convertUnits(value: number, fromUnit: string, toUnit: string): { result: number; category: string } {
  const from = fromUnit.toLowerCase();
  const to = toUnit.toLowerCase();

  let category: string | null = null;
  for (const [cat, units] of Object.entries(UNIT_CONVERSIONS)) {
    if (from in units && to in units) {
      category = cat;
      break;
    }
  }

  if (!category) {
    throw new Error(`Cannot convert between ${fromUnit} and ${toUnit}`);
  }

  if (category === 'temperature') {
    return { result: convertTemperature(value, from, to), category };
  }

  const units = UNIT_CONVERSIONS[category]!;
  const baseValue = value * units[from]!;
  const result = baseValue / units[to]!;

  return { result, category };
}

// =============================================================================
// Tool Definitions
// =============================================================================

const evaluateTool: ToolDefinition = {
  name: 'calc_evaluate',
  description: 'Evaluate a mathematical expression. Supports +, -, *, /, ^, %, sqrt, sin, cos, tan, log, ln, abs, floor, ceil, round, pi, e',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Mathematical expression (e.g., "2 + 2", "sqrt(16)", "sin(pi/2)")',
      },
    },
    required: ['expression'],
  },
};

const convertTool: ToolDefinition = {
  name: 'calc_convert',
  description: 'Convert between units (length, weight, volume, temperature, time, data)',
  parameters: {
    type: 'object',
    properties: {
      value: {
        type: 'number',
        description: 'Value to convert',
      },
      from: {
        type: 'string',
        description: 'Source unit (e.g., km, lb, celsius, gb)',
      },
      to: {
        type: 'string',
        description: 'Target unit (e.g., miles, kg, fahrenheit, mb)',
      },
    },
    required: ['value', 'from', 'to'],
  },
};

const percentageTool: ToolDefinition = {
  name: 'calc_percentage',
  description: 'Percentage calculations: "of" (X% of Y), "increase", "decrease", "change", "what" (X is what % of Y)',
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['of', 'increase', 'decrease', 'change', 'what'],
        description: 'Type of percentage calculation',
      },
      values: {
        type: 'array',
        items: { type: 'number' },
        description: 'Values for calculation (2 numbers)',
      },
    },
    required: ['operation', 'values'],
  },
};

const statisticsTool: ToolDefinition = {
  name: 'calc_statistics',
  description: 'Calculate statistics: mean, median, mode, min, max, range, variance, standard deviation',
  parameters: {
    type: 'object',
    properties: {
      numbers: {
        type: 'array',
        items: { type: 'number' },
        description: 'Array of numbers to analyze',
      },
    },
    required: ['numbers'],
  },
};

const financialTool: ToolDefinition = {
  name: 'calc_financial',
  description: 'Financial calculations: compound interest, loan payments, tip, discount',
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['compound', 'loan', 'tip', 'discount'],
        description: 'Type of financial calculation',
      },
      params: {
        type: 'object',
        description: 'Parameters: compound(principal, rate, time, compounds?), loan(principal, rate, years), tip(amount, tipPercent?), discount(originalPrice, discountPercent)',
      },
    },
    required: ['operation', 'params'],
  },
};

const dateTool: ToolDefinition = {
  name: 'calc_date',
  description: 'Date calculations: difference between dates, add/subtract time periods',
  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['difference', 'add', 'subtract'],
        description: 'Type of date calculation',
      },
      params: {
        type: 'object',
        description: 'Parameters: difference(date1, date2), add/subtract(date, amount, unit)',
      },
    },
    required: ['operation', 'params'],
  },
};

// =============================================================================
// Tool Executors
// =============================================================================

const evaluateExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const expression = params.expression as string;

  try {
    const result = evaluateExpression(expression);
    return {
      content: {
        expression,
        result,
        formatted: Number.isInteger(result) ? result.toString() : result.toFixed(6).replace(/\.?0+$/, ''),
      },
    };
  } catch (error) {
    return {
      content: { error: (error as Error).message },
      isError: true,
    };
  }
};

const convertExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const value = params.value as number;
  const from = params.from as string;
  const to = params.to as string;

  try {
    const { result, category } = convertUnits(value, from, to);
    return {
      content: {
        original: { value, unit: from },
        converted: { value: result, unit: to },
        category,
        formatted: `${value} ${from} = ${result.toFixed(4).replace(/\.?0+$/, '')} ${to}`,
      },
    };
  } catch (error) {
    return {
      content: { error: (error as Error).message },
      isError: true,
    };
  }
};

const percentageExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const operation = params.operation as string;
  const values = params.values as number[];

  if (!values || values.length < 2) {
    return {
      content: { error: 'Need at least 2 values for percentage calculation' },
      isError: true,
    };
  }

  const a = values[0]!;
  const b = values[1]!;
  let result: number;
  let description: string;

  switch (operation) {
    case 'of':
      result = (a / 100) * b;
      description = `${a}% of ${b} = ${result}`;
      break;
    case 'increase':
      result = a * (1 + b / 100);
      description = `${a} increased by ${b}% = ${result}`;
      break;
    case 'decrease':
      result = a * (1 - b / 100);
      description = `${a} decreased by ${b}% = ${result}`;
      break;
    case 'change':
      result = ((b - a) / a) * 100;
      description = `Change from ${a} to ${b} = ${result.toFixed(2)}%`;
      break;
    case 'what':
      result = (a / b) * 100;
      description = `${a} is ${result.toFixed(2)}% of ${b}`;
      break;
    default:
      return {
        content: { error: `Unknown operation: ${operation}` },
        isError: true,
      };
  }

  return {
    content: { result, description },
  };
};

const statisticsExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const numbers = params.numbers as number[];

  if (!numbers || numbers.length === 0) {
    return {
      content: { error: 'No numbers provided' },
      isError: true,
    };
  }

  const sorted = [...numbers].sort((a, b) => a - b);
  const count = numbers.length;
  const sum = numbers.reduce((a, b) => a + b, 0);
  const mean = sum / count;

  const mid = Math.floor(count / 2);
  const median = count % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;

  const frequency: Record<number, number> = {};
  let maxFreq = 0;
  for (const n of numbers) {
    frequency[n] = (frequency[n] || 0) + 1;
    maxFreq = Math.max(maxFreq, frequency[n]);
  }
  const mode = Object.entries(frequency)
    .filter(([, freq]) => freq === maxFreq)
    .map(([val]) => Number(val));

  const variance = numbers.reduce((acc, n) => acc + Math.pow(n - mean, 2), 0) / count;
  const stdDev = Math.sqrt(variance);

  return {
    content: {
      count,
      sum,
      mean,
      median,
      mode,
      min: sorted[0]!,
      max: sorted[count - 1]!,
      range: sorted[count - 1]! - sorted[0]!,
      variance,
      stdDev,
    },
  };
};

const financialExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const operation = params.operation as string;
  const p = params.params as Record<string, number>;

  switch (operation) {
    case 'compound': {
      const { principal = 0, rate = 0, time = 0, compounds = 12 } = p;
      const r = rate / 100;
      const amount = principal * Math.pow(1 + r / compounds, compounds * time);
      const interest = amount - principal;
      return {
        content: {
          result: amount,
          details: {
            principal,
            finalAmount: amount,
            interestEarned: interest,
            effectiveRate: `${((Math.pow(1 + r / compounds, compounds) - 1) * 100).toFixed(2)}%`,
          },
        },
      };
    }
    case 'loan': {
      const { principal = 0, rate = 0, years = 0 } = p;
      const monthlyRate = rate / 100 / 12;
      const payments = years * 12;
      const monthly = (principal * monthlyRate * Math.pow(1 + monthlyRate, payments)) /
        (Math.pow(1 + monthlyRate, payments) - 1);
      const totalPaid = monthly * payments;
      return {
        content: {
          result: monthly,
          details: {
            monthlyPayment: monthly,
            totalPayments: payments,
            totalPaid,
            totalInterest: totalPaid - principal,
          },
        },
      };
    }
    case 'tip': {
      const { amount = 0, tipPercent = 15 } = p;
      const tip = amount * (tipPercent / 100);
      return {
        content: {
          result: amount + tip,
          details: {
            originalAmount: amount,
            tipAmount: tip,
            total: amount + tip,
            tipPercent: `${tipPercent}%`,
          },
        },
      };
    }
    case 'discount': {
      const { originalPrice = 0, discountPercent = 0 } = p;
      const discount = originalPrice * (discountPercent / 100);
      return {
        content: {
          result: originalPrice - discount,
          details: {
            originalPrice,
            discountAmount: discount,
            finalPrice: originalPrice - discount,
            savings: `${discountPercent}%`,
          },
        },
      };
    }
    default:
      return {
        content: { error: `Unknown operation: ${operation}` },
        isError: true,
      };
  }
};

const dateExecutor: ToolExecutor = async (params): Promise<ToolExecutionResult> => {
  const operation = params.operation as string;
  const p = params.params as { date?: string; date1?: string; date2?: string; amount?: number; unit?: string };

  switch (operation) {
    case 'difference': {
      if (!p.date1 || !p.date2) {
        return { content: { error: 'Need date1 and date2' }, isError: true };
      }
      const d1 = new Date(p.date1);
      const d2 = new Date(p.date2);
      const diffMs = Math.abs(d2.getTime() - d1.getTime());
      const diffDays = Math.floor(diffMs / 86400000);
      return {
        content: {
          result: diffDays,
          details: {
            days: diffDays,
            weeks: Math.floor(diffDays / 7),
            months: Math.floor(diffDays / 30.44),
            years: Math.floor(diffDays / 365.25),
            hours: Math.floor(diffMs / 3600000),
          },
        },
      };
    }
    case 'add':
    case 'subtract': {
      if (!p.date || p.amount === undefined || !p.unit) {
        return { content: { error: 'Need date, amount, and unit' }, isError: true };
      }
      const date = new Date(p.date);
      const amount = operation === 'subtract' ? -p.amount : p.amount;
      const unit = p.unit.toLowerCase();

      switch (unit) {
        case 'day': case 'days':
          date.setDate(date.getDate() + amount);
          break;
        case 'week': case 'weeks':
          date.setDate(date.getDate() + amount * 7);
          break;
        case 'month': case 'months':
          date.setMonth(date.getMonth() + amount);
          break;
        case 'year': case 'years':
          date.setFullYear(date.getFullYear() + amount);
          break;
        default:
          return { content: { error: `Unknown unit: ${unit}` }, isError: true };
      }

      return {
        content: {
          result: date.toISOString().split('T')[0],
          details: {
            originalDate: p.date,
            operation: `${operation} ${Math.abs(p.amount)} ${p.unit}`,
            resultDate: date.toISOString().split('T')[0],
            dayOfWeek: date.toLocaleDateString('en-US', { weekday: 'long' }),
          },
        },
      };
    }
    default:
      return {
        content: { error: `Unknown operation: ${operation}` },
        isError: true,
      };
  }
};

// =============================================================================
// Message Handler
// =============================================================================

const calculatorHandler: MessageHandler = {
  name: 'calculator-handler',
  description: 'Handles calculation-related queries',
  priority: 30,

  canHandle: async (message: string): Promise<boolean> => {
    const lower = message.toLowerCase();
    return (
      /\d+\s*[+\-*/^%]\s*\d+/.test(message) ||
      /\b(calculate|convert|percent|average|compute|sum|total)\b/i.test(lower) ||
      /\d+\s*(km|mi|lb|kg|celsius|fahrenheit|gb|mb)\s*(to|in)\s*\w+/i.test(message)
    );
  },

  handle: async (message: string, _context: HandlerContext): Promise<HandlerResult> => {
    // Try to detect conversion pattern
    const convMatch = message.match(/(\d+(?:\.\d+)?)\s*(\w+)\s*(?:to|in|as)\s*(\w+)/i);
    if (convMatch && convMatch[1] && convMatch[2] && convMatch[3]) {
      return {
        handled: true,
        toolCalls: [
          {
            tool: 'calc_convert',
            args: { value: parseFloat(convMatch[1]), from: convMatch[2], to: convMatch[3] },
          },
        ],
      };
    }

    // Try to detect simple math
    const mathMatch = message.match(/(\d+[\d\s+\-*/^%.()]+\d+)/);
    if (mathMatch) {
      return {
        handled: true,
        toolCalls: [
          {
            tool: 'calc_evaluate',
            args: { expression: mathMatch[1] },
          },
        ],
      };
    }

    return { handled: false };
  },
};

// =============================================================================
// Plugin Definition
// =============================================================================

export const calculatorPlugin = createPlugin()
  .meta({
    id: 'advanced-calculator',
    name: 'Advanced Calculator',
    version: '1.0.0',
    description: 'Mathematical expressions, unit conversions, statistics, and financial calculations',
    author: {
      name: 'OwnPilot',
    },
    capabilities: ['tools', 'handlers'],
    permissions: [],
    icon: '🔢',
    pluginConfigSchema: [
      { name: 'precision', label: 'Precision', type: 'number', description: 'Decimal precision for results', defaultValue: 6 },
    ],
    defaultConfig: {
      precision: 6,
    },
  })
  .tools([
    { definition: evaluateTool, executor: evaluateExecutor },
    { definition: convertTool, executor: convertExecutor },
    { definition: percentageTool, executor: percentageExecutor },
    { definition: statisticsTool, executor: statisticsExecutor },
    { definition: financialTool, executor: financialExecutor },
    { definition: dateTool, executor: dateExecutor },
  ])
  .handler(calculatorHandler)
  .hooks({
    onLoad: async () => {
      console.log('[CalculatorPlugin] Loaded');
    },
  })
  .build();
