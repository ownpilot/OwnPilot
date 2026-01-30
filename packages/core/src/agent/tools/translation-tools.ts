/**
 * Translation Tools
 * Multi-language translation and language detection
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../tools.js';

// Supported languages with their codes
const SUPPORTED_LANGUAGES: Record<string, string> = {
  auto: 'Auto-detect',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  hi: 'Hindi',
  tr: 'Turkish',
  pl: 'Polish',
  nl: 'Dutch',
  sv: 'Swedish',
  da: 'Danish',
  fi: 'Finnish',
  no: 'Norwegian',
  el: 'Greek',
  he: 'Hebrew',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ms: 'Malay',
  cs: 'Czech',
  sk: 'Slovak',
  hu: 'Hungarian',
  ro: 'Romanian',
  bg: 'Bulgarian',
  uk: 'Ukrainian',
  ca: 'Catalan',
  hr: 'Croatian',
  lt: 'Lithuanian',
  lv: 'Latvian',
  et: 'Estonian',
  sl: 'Slovenian',
};

// ============================================================================
// TRANSLATE TEXT TOOL
// ============================================================================

export const translateTextTool: ToolDefinition = {
  name: 'translate_text',
  description: 'Translate text between languages using AI. Supports 40+ languages with automatic source language detection.',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to translate',
      },
      targetLanguage: {
        type: 'string',
        description: 'Target language code (e.g., "en", "es", "fr", "de", "ja", "zh", "tr")',
      },
      sourceLanguage: {
        type: 'string',
        description: 'Source language code. Use "auto" for auto-detection (default)',
      },
      preserveFormatting: {
        type: 'boolean',
        description: 'Preserve markdown/HTML formatting in translation',
      },
      context: {
        type: 'string',
        description: 'Additional context to improve translation accuracy (e.g., "technical documentation", "casual conversation")',
      },
    },
    required: ['text', 'targetLanguage'],
  },
};

export const translateTextExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const text = params.text as string;
  const targetLanguage = params.targetLanguage as string;
  const sourceLanguage = (params.sourceLanguage as string) || 'auto';
  const preserveFormatting = params.preserveFormatting === true;
  const translationContext = params.context as string | undefined;

  // Validate languages
  if (!SUPPORTED_LANGUAGES[targetLanguage]) {
    return {
      content: {
        error: `Unsupported target language: ${targetLanguage}`,
        supportedLanguages: Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => ({ code, name })),
      },
      isError: true,
    };
  }

  if (sourceLanguage !== 'auto' && !SUPPORTED_LANGUAGES[sourceLanguage]) {
    return {
      content: {
        error: `Unsupported source language: ${sourceLanguage}`,
        supportedLanguages: Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => ({ code, name })),
      },
      isError: true,
    };
  }

  // For translation, we'll use the AI provider configured in the gateway
  // This is a definition-only tool - the executor will be overridden in the gateway
  // with proper AI provider integration

  // Detect source language if auto
  const detectedSource = sourceLanguage === 'auto' ? detectLanguage(text) : sourceLanguage;

  // If same language, return original
  if (detectedSource === targetLanguage) {
    return {
      content: {
        originalText: text,
        translatedText: text,
        sourceLanguage: detectedSource,
        targetLanguage,
        note: 'Source and target languages are the same',
      },
      isError: false,
    };
  }

  // This executor provides a placeholder response
  // The actual translation should be done by the AI provider in the gateway
  return {
    content: {
      originalText: text,
      sourceLanguage: detectedSource,
      targetLanguage,
      preserveFormatting,
      context: translationContext,
      note: 'Translation requires AI provider integration. Override this executor in gateway.',
      requiresAI: true,
    },
    isError: false,
  };
};

/**
 * Basic language detection using character analysis
 */
function detectLanguage(text: string): string {
  // Check for specific character ranges
  const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF]/.test(text);
  const hasKorean = /[\uAC00-\uD7AF\u1100-\u11FF]/.test(text);
  const hasChinese = /[\u4E00-\u9FFF]/.test(text) && !hasJapanese && !hasKorean;
  const hasArabic = /[\u0600-\u06FF]/.test(text);
  const hasHebrew = /[\u0590-\u05FF]/.test(text);
  const hasThai = /[\u0E00-\u0E7F]/.test(text);
  const hasCyrillic = /[\u0400-\u04FF]/.test(text);
  const hasGreek = /[\u0370-\u03FF]/.test(text);
  const hasDevanagari = /[\u0900-\u097F]/.test(text);

  if (hasJapanese) return 'ja';
  if (hasKorean) return 'ko';
  if (hasChinese) return 'zh';
  if (hasArabic) return 'ar';
  if (hasHebrew) return 'he';
  if (hasThai) return 'th';
  if (hasDevanagari) return 'hi';
  if (hasCyrillic) return 'ru'; // Could be Russian, Ukrainian, Bulgarian, etc.
  if (hasGreek) return 'el';

  // For Latin-based languages, use common word detection
  const lowerText = text.toLowerCase();

  // Turkish indicators (special characters)
  if (/[ğşıöçĞŞİÖÇ]/.test(text)) {
    return 'tr';
  }

  // Spanish indicators
  if (/\b(el|la|los|las|un|una|es|son|está|están|que|de|en|y|con)\b/.test(lowerText) ||
      /[ñ¿¡]/.test(lowerText)) {
    return 'es';
  }

  // French indicators
  if (/\b(le|la|les|un|une|est|sont|que|de|en|et|avec|pour|dans)\b/.test(lowerText) ||
      /[éèêëàâùûôîç]/.test(lowerText)) {
    return 'fr';
  }

  // German indicators
  if (/\b(der|die|das|ein|eine|ist|sind|und|mit|für|auf|zu)\b/.test(lowerText) ||
      /[äöüß]/.test(lowerText)) {
    return 'de';
  }

  // Italian indicators
  if (/\b(il|la|lo|gli|le|un|una|è|sono|che|di|in|e|con|per)\b/.test(lowerText)) {
    return 'it';
  }

  // Portuguese indicators
  if (/\b(o|a|os|as|um|uma|é|são|que|de|em|e|com|para)\b/.test(lowerText) ||
      /[ãõ]/.test(lowerText)) {
    return 'pt';
  }

  // Dutch indicators
  if (/\b(de|het|een|is|zijn|dat|van|in|en|met|voor|op)\b/.test(lowerText)) {
    return 'nl';
  }

  // Default to English
  return 'en';
}

// ============================================================================
// DETECT LANGUAGE TOOL
// ============================================================================

export const detectLanguageTool: ToolDefinition = {
  name: 'detect_language',
  description: 'Detect the language of a given text',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to analyze',
      },
    },
    required: ['text'],
  },
};

export const detectLanguageExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const text = params.text as string;

  if (!text || text.trim().length === 0) {
    return {
      content: { error: 'Text is required for language detection' },
      isError: true,
    };
  }

  const detected = detectLanguage(text);
  const confidence = calculateConfidence(text, detected);

  return {
    content: {
      text: text.length > 100 ? text.substring(0, 100) + '...' : text,
      detectedLanguage: detected,
      languageName: SUPPORTED_LANGUAGES[detected] || 'Unknown',
      confidence,
      alternativeCandidates: getAlternativeCandidates(text, detected),
    },
    isError: false,
  };
};

/**
 * Calculate confidence score for detected language
 */
function calculateConfidence(text: string, detected: string): number {
  // Script-based detection is highly reliable
  const scriptBased = ['ja', 'ko', 'zh', 'ar', 'he', 'th', 'hi', 'el'];
  if (scriptBased.includes(detected)) {
    return 0.95;
  }

  // Cyrillic could be multiple languages
  if (detected === 'ru') {
    return 0.75;
  }

  // Latin-based languages have lower confidence
  const wordCount = text.split(/\s+/).length;
  if (wordCount < 5) {
    return 0.6;
  } else if (wordCount < 20) {
    return 0.75;
  }

  return 0.85;
}

/**
 * Get alternative language candidates
 */
function getAlternativeCandidates(text: string, primary: string): Array<{ code: string; name: string }> {
  const candidates: Array<{ code: string; name: string }> = [];

  // If Cyrillic, could be Russian, Ukrainian, or Bulgarian
  if (primary === 'ru') {
    candidates.push({ code: 'uk', name: 'Ukrainian' });
    candidates.push({ code: 'bg', name: 'Bulgarian' });
  }

  // If Portuguese, could be Spanish
  if (primary === 'pt') {
    candidates.push({ code: 'es', name: 'Spanish' });
  }

  // If Spanish, could be Portuguese
  if (primary === 'es') {
    candidates.push({ code: 'pt', name: 'Portuguese' });
  }

  // If Dutch, could be German
  if (primary === 'nl') {
    candidates.push({ code: 'de', name: 'German' });
  }

  return candidates;
}

// ============================================================================
// LIST LANGUAGES TOOL
// ============================================================================

export const listLanguagesTool: ToolDefinition = {
  name: 'list_languages',
  description: 'List all supported languages for translation',
  parameters: {
    type: 'object',
    properties: {
      filter: {
        type: 'string',
        description: 'Filter languages by name or code',
      },
    },
  },
};

export const listLanguagesExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const filter = (params.filter as string)?.toLowerCase();

  let languages = Object.entries(SUPPORTED_LANGUAGES)
    .filter(([code]) => code !== 'auto')
    .map(([code, name]) => ({ code, name }));

  if (filter) {
    languages = languages.filter(
      ({ code, name }) =>
        code.toLowerCase().includes(filter) ||
        name.toLowerCase().includes(filter)
    );
  }

  return {
    content: {
      languages,
      count: languages.length,
      total: Object.keys(SUPPORTED_LANGUAGES).length - 1, // Exclude 'auto'
    },
    isError: false,
  };
};

// ============================================================================
// BATCH TRANSLATE TOOL
// ============================================================================

export const batchTranslateTool: ToolDefinition = {
  name: 'batch_translate',
  description: 'Translate multiple texts at once',
  parameters: {
    type: 'object',
    properties: {
      texts: {
        type: 'array',
        description: 'Array of texts to translate',
        items: { type: 'string' },
      },
      targetLanguage: {
        type: 'string',
        description: 'Target language code',
      },
      sourceLanguage: {
        type: 'string',
        description: 'Source language code (default: auto)',
      },
    },
    required: ['texts', 'targetLanguage'],
  },
};

export const batchTranslateExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const texts = params.texts as string[];
  const targetLanguage = params.targetLanguage as string;
  const sourceLanguage = (params.sourceLanguage as string) || 'auto';

  if (!Array.isArray(texts) || texts.length === 0) {
    return {
      content: { error: 'texts must be a non-empty array' },
      isError: true,
    };
  }

  if (texts.length > 100) {
    return {
      content: { error: 'Maximum 100 texts per batch' },
      isError: true,
    };
  }

  // Validate target language
  if (!SUPPORTED_LANGUAGES[targetLanguage]) {
    return {
      content: {
        error: `Unsupported target language: ${targetLanguage}`,
        supportedLanguages: Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => ({ code, name })),
      },
      isError: true,
    };
  }

  // This is a placeholder - actual translation requires AI provider integration
  const results = texts.map((text, index) => ({
    index,
    originalText: text,
    sourceLanguage: sourceLanguage === 'auto' ? detectLanguage(text) : sourceLanguage,
    targetLanguage,
    requiresAI: true,
  }));

  return {
    content: {
      results,
      count: texts.length,
      targetLanguage,
      note: 'Batch translation requires AI provider integration. Override this executor in gateway.',
    },
    isError: false,
  };
};

// ============================================================================
// EXPORT ALL TRANSLATION TOOLS
// ============================================================================

export const TRANSLATION_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  { definition: translateTextTool, executor: translateTextExecutor },
  { definition: detectLanguageTool, executor: detectLanguageExecutor },
  { definition: listLanguagesTool, executor: listLanguagesExecutor },
  { definition: batchTranslateTool, executor: batchTranslateExecutor },
];

export const TRANSLATION_TOOL_NAMES = TRANSLATION_TOOLS.map((t) => t.definition.name);

// Export supported languages for use elsewhere
export { SUPPORTED_LANGUAGES };
