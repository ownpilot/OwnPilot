/**
 * Image Tool Overrides
 *
 * Replaces the placeholder executors in core/image-tools with real implementations:
 *   - analyze_image: Uses the user's configured AI provider (vision API)
 *   - generate_image: Provider-agnostic image generation via Config Center
 */

import type { ToolRegistry, ToolExecutor, ToolExecutionResult } from '@ownpilot/core';
import { createProvider, type ProviderConfig, type Message } from '@ownpilot/core';
import { resolveProviderAndModel } from '../routes/settings.js';
import { getProviderApiKey, loadProviderConfig, NATIVE_PROVIDERS } from '../routes/agent-cache.js';
import { configServicesRepo } from '../db/repositories/config-services.js';
import { getLog } from './log.js';
import { getErrorMessage } from '../routes/helpers.js';

const log = getLog('ImageOverrides');

// ============================================================================
// Constants
// ============================================================================

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const SUPPORTED_FORMATS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

const IMAGE_GEN_SERVICE = 'image_generation';

type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

// ============================================================================
// Config Center Registration
// ============================================================================

async function ensureImageGenService(): Promise<void> {
  try {
    await configServicesRepo.upsert({
      name: IMAGE_GEN_SERVICE,
      displayName: 'Image Generation',
      category: 'ai',
      description:
        'Image generation service (OpenAI DALL-E, Stability AI, FAL, Replicate, or any OpenAI-compatible API)',
      configSchema: [
        {
          name: 'provider_type',
          label: 'Provider Type',
          type: 'string' as const,
          required: true,
          description: 'openai, stability, fal, replicate, or openai-compatible',
        },
        { name: 'api_key', label: 'API Key', type: 'secret' as const, required: true },
        {
          name: 'base_url',
          label: 'Base URL',
          type: 'string' as const,
          required: false,
          description: 'Custom API endpoint (required for fal, replicate, openai-compatible)',
        },
        {
          name: 'model',
          label: 'Model',
          type: 'string' as const,
          required: false,
          description: 'e.g. dall-e-3, stable-diffusion-xl, flux-pro',
        },
      ],
    });
  } catch (error) {
    log.debug('Config upsert for image_generation:', getErrorMessage(error));
  }
}

// ============================================================================
// Helpers
// ============================================================================

function getMimeType(format: string): ImageMediaType {
  const map: Record<string, ImageMediaType> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return map[format.toLowerCase()] ?? 'image/jpeg';
}

function getFormatFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split('.').pop()?.toLowerCase() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function buildAnalysisPrompt(task: string, detailLevel: string, question?: string): string {
  switch (task) {
    case 'describe':
      return detailLevel === 'high'
        ? 'Provide a very detailed description of this image, including all visible elements, their positions, colors, textures, and any notable details.'
        : detailLevel === 'low'
          ? 'Briefly describe the main subject of this image in one or two sentences.'
          : 'Describe this image in detail, including the main subjects, setting, colors, and overall composition.';
    case 'ocr':
      return 'Extract and transcribe all text visible in this image. Format it clearly, preserving the original structure where possible.';
    case 'objects':
      return 'List all distinct objects visible in this image. For each object, provide its name, approximate position, and any notable characteristics.';
    case 'faces':
      return 'Describe any faces visible in this image, including expressions, approximate age range, and any distinguishing features. Do not attempt to identify specific individuals.';
    case 'colors':
      return 'Analyze the color palette of this image. List the dominant colors, their approximate percentages, and describe the overall color mood/tone.';
    case 'custom':
      return question ?? 'Describe this image.';
    default:
      return 'Describe this image.';
  }
}

function getStyleDescription(style: string): string {
  const desc: Record<string, string> = {
    artistic: 'artistic painting style, oil painting texture',
    cartoon: 'cartoon style, animated, vibrant colors',
    sketch: 'pencil sketch, hand-drawn, black and white',
    'digital-art': 'digital art, clean lines, modern illustration',
    '3d-render': '3D rendered, realistic lighting, CGI quality',
    anime: 'anime style, Japanese animation, cel-shaded',
    photography: 'professional photography, high resolution, detailed',
  };
  return desc[style] ?? '';
}

// ============================================================================
// analyze_image Override
// ============================================================================

const analyzeImageOverride: ToolExecutor = async (
  params,
  _context
): Promise<ToolExecutionResult> => {
  const source = params.source as string;
  const task = (params.task as string) || 'describe';
  const question = params.question as string | undefined;
  const detailLevel = (params.detailLevel as string) || 'medium';
  const maxTokens = (params.maxTokens as number) || 2048;

  try {
    // --- Validate & prepare image data ---
    let imageBase64: string;
    let mediaType: ImageMediaType;
    let isUrl = false;

    if (source.startsWith('http://') || source.startsWith('https://')) {
      // URL source — pass as URL, let provider handle it
      const format = getFormatFromUrl(source);
      if (format !== 'unknown' && !SUPPORTED_FORMATS.includes(format)) {
        return {
          content: {
            error: `Unsupported image format: ${format}`,
            supportedFormats: SUPPORTED_FORMATS,
          },
          isError: true,
        };
      }
      imageBase64 = source;
      mediaType = getMimeType(format !== 'unknown' ? format : 'jpeg');
      isUrl = true;
    } else if (source.startsWith('data:image/')) {
      // Base64 data URI
      const match = source.match(/data:image\/(\w+);base64,(.+)/);
      if (!match) return { content: { error: 'Invalid base64 image data' }, isError: true };
      mediaType = getMimeType(match[1]!);
      imageBase64 = match[2]!;
    } else {
      // File path
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      try {
        const stats = await fs.stat(source);
        if (stats.size > MAX_IMAGE_SIZE) {
          return {
            content: {
              error: `Image too large: ${Math.round(stats.size / 1024 / 1024)}MB (max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)`,
            },
            isError: true,
          };
        }
      } catch {
        return { content: { error: `Image file not found: ${source}` }, isError: true };
      }

      const ext = path.extname(source).slice(1).toLowerCase();
      if (!SUPPORTED_FORMATS.includes(ext)) {
        return {
          content: {
            error: `Unsupported image format: ${ext}`,
            supportedFormats: SUPPORTED_FORMATS,
          },
          isError: true,
        };
      }

      const buffer = await fs.readFile(source);
      mediaType = getMimeType(ext);
      imageBase64 = buffer.toString('base64');
    }

    // --- Resolve provider ---
    const { provider: resolvedProvider, model: resolvedModel } = await resolveProviderAndModel(
      'default',
      'default'
    );
    if (!resolvedProvider) {
      return {
        content: {
          error: 'No AI provider configured. Set up a provider in Settings to use image analysis.',
        },
        isError: true,
      };
    }

    const apiKey = await getProviderApiKey(resolvedProvider);
    if (!apiKey) {
      return {
        content: { error: `API key not configured for provider: ${resolvedProvider}` },
        isError: true,
      };
    }

    const config = loadProviderConfig(resolvedProvider);
    const providerType = NATIVE_PROVIDERS.has(resolvedProvider) ? resolvedProvider : 'openai';
    const provider = createProvider({
      provider: providerType as ProviderConfig['provider'],
      apiKey,
      baseUrl: config?.baseUrl,
    });

    // --- Build vision request ---
    const analysisPrompt = buildAnalysisPrompt(task, detailLevel, question);

    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text' as const, text: analysisPrompt },
          { type: 'image' as const, data: imageBase64, mediaType, isUrl },
        ],
      },
    ];

    const result = await provider.complete({
      messages,
      model: {
        model: resolvedModel ?? 'gpt-4o',
        maxTokens,
        temperature: 0.3,
      },
    });

    if (!result.ok) {
      return { content: { error: `Vision API error: ${result.error.message}` }, isError: true };
    }

    return {
      content: {
        success: true,
        analysis: result.value.content,
        task,
        detailLevel,
        provider: resolvedProvider,
        model: resolvedModel,
      },
      isError: false,
    };
  } catch (error) {
    return {
      content: { error: `Failed to analyze image: ${getErrorMessage(error)}` },
      isError: true,
    };
  }
};

// ============================================================================
// generate_image Override — Provider-Agnostic
// ============================================================================

interface ImageGenResult {
  base64: string;
  revisedPrompt?: string;
}

async function callOpenAIImageGen(
  apiKey: string,
  baseUrl: string,
  model: string,
  prompt: string,
  size: string,
  quality: string,
  n: number
): Promise<ImageGenResult[]> {
  const url = `${baseUrl}/v1/images/generations`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      model: model || 'dall-e-3',
      size,
      quality,
      n,
      response_format: 'b64_json',
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI Image API ${response.status}: ${text.slice(0, 500)}`);
  }
  const data = (await response.json()) as {
    data: Array<{ b64_json: string; revised_prompt?: string }>;
  };
  return data.data.map((d) => ({ base64: d.b64_json, revisedPrompt: d.revised_prompt }));
}

async function callStabilityImageGen(
  apiKey: string,
  baseUrl: string,
  model: string,
  prompt: string,
  width: number,
  height: number,
  n: number
): Promise<ImageGenResult[]> {
  const engineId = model || 'stable-diffusion-xl-1024-v1-0';
  const url = `${baseUrl}/v1/generation/${engineId}/text-to-image`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      text_prompts: [{ text: prompt, weight: 1 }],
      cfg_scale: 7,
      width,
      height,
      samples: n,
      steps: 30,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Stability API ${response.status}: ${text.slice(0, 500)}`);
  }
  const data = (await response.json()) as { artifacts: Array<{ base64: string }> };
  return data.artifacts.map((a) => ({ base64: a.base64 }));
}

async function callFalImageGen(
  apiKey: string,
  baseUrl: string,
  model: string,
  prompt: string,
  size: string,
  n: number
): Promise<ImageGenResult[]> {
  const url = `${baseUrl}/${model || 'fal-ai/flux-pro'}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image_size: size, num_images: n }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`FAL API ${response.status}: ${text.slice(0, 500)}`);
  }
  const data = (await response.json()) as { images: Array<{ url: string }> };
  // FAL returns URLs — download to base64
  const results: ImageGenResult[] = [];
  for (const img of data.images) {
    const imgResp = await fetch(img.url);
    const buffer = Buffer.from(await imgResp.arrayBuffer());
    results.push({ base64: buffer.toString('base64') });
  }
  return results;
}

async function callReplicateImageGen(
  apiKey: string,
  baseUrl: string,
  model: string,
  prompt: string,
  width: number,
  height: number,
  n: number
): Promise<ImageGenResult[]> {
  const url = `${baseUrl}/v1/predictions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    },
    body: JSON.stringify({
      model: model || 'black-forest-labs/flux-schnell',
      input: { prompt, width, height, num_outputs: n },
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Replicate API ${response.status}: ${text.slice(0, 500)}`);
  }
  const data = (await response.json()) as { output: string[] };
  const results: ImageGenResult[] = [];
  for (const imgUrl of data.output ?? []) {
    const imgResp = await fetch(imgUrl);
    const buffer = Buffer.from(await imgResp.arrayBuffer());
    results.push({ base64: buffer.toString('base64') });
  }
  return results;
}

function parseSizeToDimensions(size: string): { width: number; height: number } {
  const match = size.match(/(\d+)x(\d+)/);
  if (match) return { width: parseInt(match[1]!, 10), height: parseInt(match[2]!, 10) };
  return { width: 1024, height: 1024 };
}

const generateImageOverride: ToolExecutor = async (
  params,
  context
): Promise<ToolExecutionResult> => {
  const prompt = params.prompt as string;
  const style = (params.style as string) || 'realistic';
  const size = (params.size as string) || '1024x1024';
  const quality = (params.quality as string) || 'standard';
  const outputPath = params.outputPath as string | undefined;
  const n = Math.min(Math.max((params.n as number) || 1, 1), 4);

  // --- Validate prompt ---
  if (!prompt?.trim()) {
    return { content: { error: 'Prompt is required for image generation' }, isError: true };
  }
  if (prompt.length > 4000) {
    return { content: { error: 'Prompt too long. Maximum 4000 characters.' }, isError: true };
  }

  try {
    // --- Read config ---
    const providerType = configServicesRepo.getFieldValue(IMAGE_GEN_SERVICE, 'provider_type') as
      | string
      | undefined;
    const apiKey = configServicesRepo.getFieldValue(IMAGE_GEN_SERVICE, 'api_key') as
      | string
      | undefined;
    const baseUrl = configServicesRepo.getFieldValue(IMAGE_GEN_SERVICE, 'base_url') as
      | string
      | undefined;
    const model = configServicesRepo.getFieldValue(IMAGE_GEN_SERVICE, 'model') as
      | string
      | undefined;

    if (!providerType || !apiKey) {
      return {
        content: {
          error:
            'Image generation not configured. Go to Settings → Config Center → Image Generation and set provider_type + api_key.',
        },
        isError: true,
      };
    }

    // Enhance prompt with style
    const enhancedPrompt =
      style !== 'realistic' ? `${prompt}, ${getStyleDescription(style)}` : prompt;

    const { width, height } = parseSizeToDimensions(size);

    // --- Call provider ---
    let results: ImageGenResult[];
    const resolvedBaseUrl = baseUrl || getDefaultBaseUrl(providerType);

    switch (providerType) {
      case 'openai':
      case 'openai-compatible':
        results = await callOpenAIImageGen(
          apiKey,
          resolvedBaseUrl,
          model ?? '',
          enhancedPrompt,
          size,
          quality,
          n
        );
        break;
      case 'stability':
        results = await callStabilityImageGen(
          apiKey,
          resolvedBaseUrl,
          model ?? '',
          enhancedPrompt,
          width,
          height,
          n
        );
        break;
      case 'fal':
        results = await callFalImageGen(
          apiKey,
          resolvedBaseUrl,
          model ?? '',
          enhancedPrompt,
          size,
          n
        );
        break;
      case 'replicate':
        results = await callReplicateImageGen(
          apiKey,
          resolvedBaseUrl,
          model ?? '',
          enhancedPrompt,
          width,
          height,
          n
        );
        break;
      default:
        // Assume OpenAI-compatible for unknown providers
        results = await callOpenAIImageGen(
          apiKey,
          resolvedBaseUrl,
          model ?? '',
          enhancedPrompt,
          size,
          quality,
          n
        );
    }

    if (!results.length) {
      return { content: { error: 'No images generated' }, isError: true };
    }

    // --- Save to workspace ---
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workDir = context.workspaceDir || '.';
    const imagesDir = path.join(workDir, 'generated_images');
    await fs.mkdir(imagesDir, { recursive: true });

    const savedImages: Array<{ path: string; size: number; revisedPrompt?: string }> = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const filename =
        outputPath && results.length === 1
          ? outputPath
          : path.join(imagesDir, `image_${Date.now()}_${i}.png`);

      const dir = path.dirname(filename);
      await fs.mkdir(dir, { recursive: true });

      const buffer = Buffer.from(result.base64, 'base64');
      await fs.writeFile(filename, buffer);

      const stats = await fs.stat(filename);
      savedImages.push({ path: filename, size: stats.size, revisedPrompt: result.revisedPrompt });
    }

    // Build markdown for display (use relative paths so UI resolveImageUrl() works)
    const markdown = savedImages
      .map((img) => {
        const relativePath = path.relative(workDir, img.path).replace(/\\/g, '/');
        return `![Generated image](${relativePath})`;
      })
      .join('\n');

    return {
      content: {
        success: true,
        images: savedImages,
        prompt: enhancedPrompt,
        originalPrompt: prompt,
        style,
        size,
        provider: providerType,
        model: model ?? 'default',
        markdown,
      },
      isError: false,
    };
  } catch (error) {
    return {
      content: { error: `Failed to generate image: ${getErrorMessage(error)}` },
      isError: true,
    };
  }
};

function getDefaultBaseUrl(providerType: string): string {
  switch (providerType) {
    case 'openai':
      return 'https://api.openai.com';
    case 'stability':
      return 'https://api.stability.ai';
    case 'fal':
      return 'https://fal.run';
    case 'replicate':
      return 'https://api.replicate.com';
    default:
      return 'https://api.openai.com';
  }
}

// ============================================================================
// Registration
// ============================================================================

export async function registerImageOverrides(registry: ToolRegistry): Promise<void> {
  // Override analyze_image executor
  const analyzeName = 'analyze_image';
  if (registry.updateExecutor(analyzeName, analyzeImageOverride)) {
    log.info(`Overrode ${analyzeName} with vision API implementation`);
  } else {
    // Try with qualified name
    if (registry.updateExecutor(`core.${analyzeName}`, analyzeImageOverride)) {
      log.info(`Overrode core.${analyzeName} with vision API implementation`);
    }
  }

  // Override generate_image executor
  const genName = 'generate_image';
  if (registry.updateExecutor(genName, generateImageOverride)) {
    log.info(`Overrode ${genName} with provider-agnostic implementation`);
  } else {
    if (registry.updateExecutor(`core.${genName}`, generateImageOverride)) {
      log.info(`Overrode core.${genName} with provider-agnostic implementation`);
    }
  }

  // Register the image_generation Config Center service (async, non-blocking)
  ensureImageGenService().catch((err) => log.debug('ensureImageGenService:', getErrorMessage(err)));
}
