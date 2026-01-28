/**
 * Media Service
 *
 * Provider-agnostic service for media operations:
 * - Image Generation (OpenAI DALL-E, Fireworks FLUX, Google Imagen)
 * - Vision/Image Analysis (OpenAI GPT-4V, Anthropic Claude, Google Gemini)
 * - Text-to-Speech (OpenAI TTS, ElevenLabs)
 * - Speech-to-Text (OpenAI Whisper, Groq Whisper, Deepgram)
 *
 * Provider selection is determined by user settings.
 */

// OpenAI SDK is loaded dynamically when needed
// OpenAI SDK is loaded dynamically when needed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let OpenAIClass: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getOpenAI(): Promise<any> {
  if (!OpenAIClass) {
    try {
      // Dynamic import - only loads if openai package is installed
      const module = await import(/* webpackIgnore: true */ 'openai' as string);
      OpenAIClass = module.default;
    } catch {
      throw new Error('OpenAI SDK not installed. Run: pnpm add openai');
    }
  }
  return OpenAIClass;
}

// =============================================================================
// Types
// =============================================================================

export type MediaCapability = 'image_generation' | 'vision' | 'tts' | 'stt';

export interface MediaProviderConfig {
  provider: string;
  model?: string;
  apiKey?: string;
  config?: Record<string, unknown>;
}

export interface MediaServiceConfig {
  getProviderConfig: (capability: MediaCapability) => MediaProviderConfig | null;
  getApiKey: (keyName: string) => string | undefined;
}

// Image Generation Types
export interface ImageGenerationOptions {
  prompt: string;
  size?: '256x256' | '512x512' | '1024x1024' | '1024x1792' | '1792x1024';
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  n?: number;
}

export interface ImageGenerationResult {
  images: Array<{
    url?: string;
    base64?: string;
    revisedPrompt?: string;
  }>;
  model: string;
  provider: string;
}

// Vision/Analysis Types
export interface VisionAnalysisOptions {
  image: string; // URL or base64
  prompt: string;
  maxTokens?: number;
  detail?: 'low' | 'high' | 'auto';
}

export interface VisionAnalysisResult {
  text: string;
  model: string;
  provider: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

// TTS Types
export interface TTSOptions {
  text: string;
  voice?: string;
  speed?: number;
  format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
}

export interface TTSResult {
  audio: Buffer;
  format: string;
  model: string;
  provider: string;
}

// STT Types
export interface STTOptions {
  audio: Buffer | string; // Buffer or file path
  language?: string;
  prompt?: string;
  format?: 'json' | 'text' | 'srt' | 'vtt' | 'verbose_json';
  timestamps?: boolean;
}

export interface STTResult {
  text: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  language?: string;
  duration?: number;
  model: string;
  provider: string;
}

// =============================================================================
// Provider Implementations
// =============================================================================

/**
 * OpenAI Image Generation (DALL-E 3)
 */
async function openaiGenerateImage(
  apiKey: string,
  options: ImageGenerationOptions,
  model: string = 'dall-e-3'
): Promise<ImageGenerationResult> {
  const OpenAIClass = await getOpenAI();
  const openai = new OpenAIClass({ apiKey });

  const response = await openai.images.generate({
    model,
    prompt: options.prompt,
    size: options.size || '1024x1024',
    quality: options.quality || 'standard',
    style: options.style || 'vivid',
    n: options.n || 1,
    response_format: 'url',
  });

  return {
    images: response.data.map((img: { url?: string; revised_prompt?: string }) => ({
      url: img.url,
      revisedPrompt: img.revised_prompt,
    })),
    model,
    provider: 'openai',
  };
}

/**
 * Fireworks AI Image Generation (FLUX)
 */
async function fireworksGenerateImage(
  apiKey: string,
  options: ImageGenerationOptions,
  model: string = 'accounts/fireworks/models/flux-1-schnell-fp8'
): Promise<ImageGenerationResult> {
  const response = await fetch('https://api.fireworks.ai/inference/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt: options.prompt,
      n: options.n || 1,
      size: options.size || '1024x1024',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Fireworks API error: ${error}`);
  }

  const data = await response.json() as { data?: Array<{ url?: string; b64_json?: string }> };

  return {
    images: data.data?.map((img) => ({
      url: img.url,
      base64: img.b64_json,
    })) || [],
    model,
    provider: 'fireworks',
  };
}

/**
 * Google Imagen (via Vertex AI or Google AI Studio)
 */
async function googleGenerateImage(
  apiKey: string,
  options: ImageGenerationOptions,
  model: string = 'imagen-3.0-generate-001'
): Promise<ImageGenerationResult> {
  // Google AI Studio endpoint
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateImage?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: { text: options.prompt },
        number_of_images: options.n || 1,
        aspect_ratio: options.size === '1024x1792' ? '9:16' : options.size === '1792x1024' ? '16:9' : '1:1',
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google API error: ${error}`);
  }

  const data = await response.json() as { images?: Array<{ bytesBase64Encoded: string }> };

  return {
    images: data.images?.map((img) => ({
      base64: img.bytesBase64Encoded,
    })) || [],
    model,
    provider: 'google',
  };
}

/**
 * OpenAI Vision (GPT-4 Vision)
 */
async function openaiAnalyzeImage(
  apiKey: string,
  options: VisionAnalysisOptions,
  model: string = 'gpt-4o'
): Promise<VisionAnalysisResult> {
  const OpenAIClass = await getOpenAI();
  const openai = new OpenAIClass({ apiKey });

  // Determine image format
  const imageContent = {
    type: 'image_url' as const,
    image_url: {
      url: options.image.startsWith('data:') ? options.image : options.image,
      detail: options.detail || 'auto',
    },
  };

  const response = await openai.chat.completions.create({
    model,
    max_tokens: options.maxTokens || 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: options.prompt },
          imageContent,
        ],
      },
    ],
  });

  return {
    text: response.choices[0]?.message?.content || '',
    model,
    provider: 'openai',
    usage: response.usage ? {
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
    } : undefined,
  };
}

/**
 * Anthropic Vision (Claude)
 */
async function anthropicAnalyzeImage(
  apiKey: string,
  options: VisionAnalysisOptions,
  model: string = 'claude-3-5-sonnet-20241022'
): Promise<VisionAnalysisResult> {
  // Determine media type
  let mediaType = 'image/jpeg';
  let imageData = options.image;

  if (options.image.startsWith('data:')) {
    const match = options.image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match && match[1] && match[2]) {
      mediaType = match[1];
      imageData = match[2];
    }
  } else if (options.image.startsWith('http')) {
    // Need to fetch and convert to base64
    const response = await fetch(options.image);
    const buffer = await response.arrayBuffer();
    imageData = Buffer.from(buffer).toString('base64');
    const contentType = response.headers.get('content-type');
    if (contentType) mediaType = contentType;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens || 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: imageData,
              },
            },
            {
              type: 'text',
              text: options.prompt,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${error}`);
  }

  const data = await response.json() as {
    content?: Array<{ text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  return {
    text: data.content?.[0]?.text || '',
    model,
    provider: 'anthropic',
    usage: data.usage && data.usage.input_tokens !== undefined && data.usage.output_tokens !== undefined ? {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
    } : undefined,
  };
}

/**
 * Google Vision (Gemini)
 */
async function googleAnalyzeImage(
  apiKey: string,
  options: VisionAnalysisOptions,
  model: string = 'gemini-1.5-pro'
): Promise<VisionAnalysisResult> {
  let imageData = options.image;
  let mimeType = 'image/jpeg';

  if (options.image.startsWith('data:')) {
    const match = options.image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match && match[1] && match[2]) {
      mimeType = match[1];
      imageData = match[2];
    }
  } else if (options.image.startsWith('http')) {
    // Gemini can handle URLs directly
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: options.prompt },
              { file_data: { file_uri: options.image, mime_type: mimeType } },
            ],
          }],
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google API error: ${error}`);
    }

    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return {
      text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
      model,
      provider: 'google',
    };
  }

  // Base64 image
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: options.prompt },
            { inline_data: { mime_type: mimeType, data: imageData } },
          ],
        }],
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google API error: ${error}`);
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    model,
    provider: 'google',
  };
}

/**
 * OpenAI TTS
 */
async function openaiTTS(
  apiKey: string,
  options: TTSOptions,
  model: string = 'tts-1'
): Promise<TTSResult> {
  const OpenAIClass = await getOpenAI();
  const openai = new OpenAIClass({ apiKey });

  const response = await openai.audio.speech.create({
    model,
    voice: (options.voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer') || 'alloy',
    input: options.text,
    speed: options.speed || 1.0,
    response_format: options.format || 'mp3',
  });

  const buffer = Buffer.from(await response.arrayBuffer());

  return {
    audio: buffer,
    format: options.format || 'mp3',
    model,
    provider: 'openai',
  };
}

/**
 * ElevenLabs TTS
 */
async function elevenLabsTTS(
  apiKey: string,
  options: TTSOptions,
  model: string = 'eleven_multilingual_v2'
): Promise<TTSResult> {
  const voiceId = options.voice || '21m00Tcm4TlvDq8ikWAM'; // Default: Rachel

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text: options.text,
        model_id: model,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          speed: options.speed || 1.0,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs API error: ${error}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  return {
    audio: buffer,
    format: 'mp3',
    model,
    provider: 'elevenlabs',
  };
}

/**
 * OpenAI STT (Whisper)
 */
async function openaiSTT(
  apiKey: string,
  options: STTOptions,
  model: string = 'whisper-1'
): Promise<STTResult> {
  const OpenAIClass = await getOpenAI();
  const openai = new OpenAIClass({ apiKey });

  // Prepare audio file
  let audioFile: File;
  if (typeof options.audio === 'string') {
    // File path
    const fs = await import('node:fs');
    const path = await import('node:path');
    const buffer = fs.readFileSync(options.audio);
    const fileName = path.basename(options.audio);
    audioFile = new File([buffer], fileName, { type: 'audio/mpeg' });
  } else {
    audioFile = new File([options.audio], 'audio.mp3', { type: 'audio/mpeg' });
  }

  const response = await openai.audio.transcriptions.create({
    model,
    file: audioFile,
    language: options.language,
    prompt: options.prompt,
    response_format: options.format === 'verbose_json' ? 'verbose_json' : options.format || 'json',
    timestamp_granularities: options.timestamps ? ['segment'] : undefined,
  });

  // Handle different response formats
  if (typeof response === 'string') {
    return {
      text: response,
      model,
      provider: 'openai',
    };
  }

  type SegmentType = { start: number; end: number; text: string };
  return {
    text: response.text,
    segments: 'segments' in response ? (response.segments as SegmentType[] | undefined)?.map((seg: SegmentType) => ({
      start: seg.start,
      end: seg.end,
      text: seg.text,
    })) : undefined,
    language: 'language' in response ? (response as { language?: string }).language : undefined,
    duration: 'duration' in response ? (response as { duration?: number }).duration : undefined,
    model,
    provider: 'openai',
  };
}

/**
 * Groq STT (Whisper)
 */
async function groqSTT(
  apiKey: string,
  options: STTOptions,
  model: string = 'whisper-large-v3'
): Promise<STTResult> {
  // Prepare form data
  const formData = new FormData();

  if (typeof options.audio === 'string') {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const buffer = fs.readFileSync(options.audio);
    const fileName = path.basename(options.audio);
    formData.append('file', new Blob([buffer]), fileName);
  } else {
    formData.append('file', new Blob([options.audio]), 'audio.mp3');
  }

  formData.append('model', model);
  if (options.language) formData.append('language', options.language);
  if (options.prompt) formData.append('prompt', options.prompt);
  formData.append('response_format', options.format || 'json');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Groq API error: ${error}`);
  }

  const data = await response.json() as {
    text: string;
    segments?: Array<{ start: number; end: number; text: string }>;
    language?: string;
    duration?: number;
  };

  return {
    text: data.text,
    segments: data.segments,
    language: data.language,
    duration: data.duration,
    model,
    provider: 'groq',
  };
}

/**
 * Deepgram STT
 */
async function deepgramSTT(
  apiKey: string,
  options: STTOptions,
  model: string = 'nova-2'
): Promise<STTResult> {
  let audioBuffer: Buffer;

  if (typeof options.audio === 'string') {
    const fs = await import('node:fs');
    audioBuffer = fs.readFileSync(options.audio);
  } else {
    audioBuffer = options.audio;
  }

  const params = new URLSearchParams({
    model,
    smart_format: 'true',
    punctuate: 'true',
  });

  if (options.language) params.append('language', options.language);

  const response = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'audio/mpeg',
    },
    body: audioBuffer,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Deepgram API error: ${error}`);
  }

  const data = await response.json() as {
    results?: {
      channels?: Array<{
        alternatives?: Array<{
          transcript?: string;
          words?: Array<{ start: number; end: number; word: string }>;
        }>;
      }>;
    };
    metadata?: { duration?: number };
  };
  const result = data.results?.channels?.[0]?.alternatives?.[0];

  return {
    text: result?.transcript || '',
    segments: result?.words?.map((w) => ({
      start: w.start,
      end: w.end,
      text: w.word,
    })),
    duration: data.metadata?.duration,
    model,
    provider: 'deepgram',
  };
}

// =============================================================================
// Media Service Class
// =============================================================================

export class MediaService {
  private config: MediaServiceConfig;

  constructor(config: MediaServiceConfig) {
    this.config = config;
  }

  /**
   * Generate image using configured provider
   */
  async generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const providerConfig = this.config.getProviderConfig('image_generation');

    if (!providerConfig) {
      throw new Error('No image generation provider configured');
    }

    const apiKey = this.getApiKeyForProvider(providerConfig.provider, 'image_generation');
    if (!apiKey) {
      throw new Error(`API key not found for ${providerConfig.provider}`);
    }

    switch (providerConfig.provider) {
      case 'openai':
        return openaiGenerateImage(apiKey, options, providerConfig.model || 'dall-e-3');
      case 'fireworks':
        return fireworksGenerateImage(apiKey, options, providerConfig.model);
      case 'google':
        return googleGenerateImage(apiKey, options, providerConfig.model);
      default:
        throw new Error(`Unsupported image generation provider: ${providerConfig.provider}`);
    }
  }

  /**
   * Analyze image using configured provider
   */
  async analyzeImage(options: VisionAnalysisOptions): Promise<VisionAnalysisResult> {
    const providerConfig = this.config.getProviderConfig('vision');

    if (!providerConfig) {
      throw new Error('No vision provider configured');
    }

    const apiKey = this.getApiKeyForProvider(providerConfig.provider, 'vision');
    if (!apiKey) {
      throw new Error(`API key not found for ${providerConfig.provider}`);
    }

    switch (providerConfig.provider) {
      case 'openai':
        return openaiAnalyzeImage(apiKey, options, providerConfig.model || 'gpt-4o');
      case 'anthropic':
        return anthropicAnalyzeImage(apiKey, options, providerConfig.model || 'claude-3-5-sonnet-20241022');
      case 'google':
        return googleAnalyzeImage(apiKey, options, providerConfig.model || 'gemini-1.5-pro');
      default:
        throw new Error(`Unsupported vision provider: ${providerConfig.provider}`);
    }
  }

  /**
   * Text to speech using configured provider
   */
  async textToSpeech(options: TTSOptions): Promise<TTSResult> {
    const providerConfig = this.config.getProviderConfig('tts');

    if (!providerConfig) {
      throw new Error('No TTS provider configured');
    }

    const apiKey = this.getApiKeyForProvider(providerConfig.provider, 'tts');
    if (!apiKey) {
      throw new Error(`API key not found for ${providerConfig.provider}`);
    }

    switch (providerConfig.provider) {
      case 'openai':
        return openaiTTS(apiKey, options, providerConfig.model || 'tts-1');
      case 'elevenlabs':
        return elevenLabsTTS(apiKey, options, providerConfig.model || 'eleven_multilingual_v2');
      default:
        throw new Error(`Unsupported TTS provider: ${providerConfig.provider}`);
    }
  }

  /**
   * Speech to text using configured provider
   */
  async speechToText(options: STTOptions): Promise<STTResult> {
    const providerConfig = this.config.getProviderConfig('stt');

    if (!providerConfig) {
      throw new Error('No STT provider configured');
    }

    const apiKey = this.getApiKeyForProvider(providerConfig.provider, 'stt');
    if (!apiKey) {
      throw new Error(`API key not found for ${providerConfig.provider}`);
    }

    switch (providerConfig.provider) {
      case 'openai':
        return openaiSTT(apiKey, options, providerConfig.model || 'whisper-1');
      case 'groq':
        return groqSTT(apiKey, options, providerConfig.model || 'whisper-large-v3');
      case 'deepgram':
        return deepgramSTT(apiKey, options, providerConfig.model || 'nova-2');
      default:
        throw new Error(`Unsupported STT provider: ${providerConfig.provider}`);
    }
  }

  /**
   * Get API key for provider
   */
  private getApiKeyForProvider(provider: string, capability: MediaCapability): string | undefined {
    // Map provider to API key name
    const keyMap: Record<string, string> = {
      openai: 'openai_api_key',
      anthropic: 'anthropic_api_key',
      google: 'google_ai_api_key',
      fireworks: 'fireworks_api_key',
      elevenlabs: 'elevenlabs_api_key',
      groq: 'groq_api_key',
      deepgram: 'deepgram_api_key',
    };

    const keyName = keyMap[provider];
    if (!keyName) return undefined;

    return this.config.getApiKey(keyName);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create media service instance
 */
export function createMediaService(config: MediaServiceConfig): MediaService {
  return new MediaService(config);
}

// =============================================================================
// Provider Options
// =============================================================================

export const IMAGE_GENERATION_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', models: ['dall-e-3', 'dall-e-2'] },
  { id: 'fireworks', name: 'Fireworks', models: ['flux-1-schnell-fp8', 'flux-1-dev-fp8', 'flux-1-pro'] },
  { id: 'google', name: 'Google', models: ['imagen-3.0-generate-001'] },
];

export const VISION_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
  { id: 'anthropic', name: 'Anthropic', models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'] },
  { id: 'google', name: 'Google', models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash-exp'] },
];

export const TTS_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', models: ['tts-1', 'tts-1-hd'], voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] },
  { id: 'elevenlabs', name: 'ElevenLabs', models: ['eleven_multilingual_v2', 'eleven_monolingual_v1'], voices: [] },
];

export const STT_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', models: ['whisper-1'] },
  { id: 'groq', name: 'Groq', models: ['whisper-large-v3', 'whisper-large-v3-turbo'] },
  { id: 'deepgram', name: 'Deepgram', models: ['nova-2', 'nova-2-general', 'whisper'] },
];

export const ALL_MEDIA_PROVIDERS = {
  image_generation: IMAGE_GENERATION_PROVIDERS,
  vision: VISION_PROVIDERS,
  tts: TTS_PROVIDERS,
  stt: STT_PROVIDERS,
};
