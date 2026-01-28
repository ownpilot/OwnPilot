/**
 * Image Tools
 * Image analysis (Vision API) and generation (DALL-E)
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../tools.js';

// Maximum image size for analysis (10MB)
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

// Supported image formats
const SUPPORTED_FORMATS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];

// ============================================================================
// ANALYZE IMAGE TOOL
// ============================================================================

export const analyzeImageTool: ToolDefinition = {
  name: 'analyze_image',
  description: 'Analyze an image using AI vision capabilities. Can describe content, extract text (OCR), detect objects, and answer questions about images.',
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Image source: file path or URL',
      },
      task: {
        type: 'string',
        description: 'Analysis task to perform',
        enum: ['describe', 'ocr', 'objects', 'faces', 'colors', 'custom'],
      },
      question: {
        type: 'string',
        description: 'Specific question about the image (for custom task)',
      },
      detailLevel: {
        type: 'string',
        description: 'Level of detail in analysis',
        enum: ['low', 'medium', 'high'],
      },
      maxTokens: {
        type: 'number',
        description: 'Maximum response tokens',
      },
    },
    required: ['source'],
  },
};

export const analyzeImageExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const source = params.source as string;
  const task = (params.task as string) || 'describe';
  const question = params.question as string | undefined;
  const detailLevel = (params.detailLevel as string) || 'medium';

  try {
    let imageData: string;
    let imageFormat: string;
    let imageSource: 'file' | 'url' | 'base64';

    // Determine image source type
    if (source.startsWith('http://') || source.startsWith('https://')) {
      imageSource = 'url';
      imageFormat = getFormatFromUrl(source);

      // Validate format
      if (!SUPPORTED_FORMATS.includes(imageFormat.toLowerCase())) {
        return {
          content: {
            error: `Unsupported image format: ${imageFormat}`,
            supportedFormats: SUPPORTED_FORMATS,
          },
          isError: true,
        };
      }

      imageData = source;
    } else if (source.startsWith('data:image/')) {
      imageSource = 'base64';
      const match = source.match(/data:image\/(\w+);base64,/);
      imageFormat = match?.[1] || 'unknown';
      imageData = source;
    } else {
      // File path
      imageSource = 'file';
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      // Check if file exists
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
        return {
          content: { error: `Image file not found: ${source}` },
          isError: true,
        };
      }

      imageFormat = path.extname(source).slice(1).toLowerCase();

      // Validate format
      if (!SUPPORTED_FORMATS.includes(imageFormat)) {
        return {
          content: {
            error: `Unsupported image format: ${imageFormat}`,
            supportedFormats: SUPPORTED_FORMATS,
          },
          isError: true,
        };
      }

      // Read and encode
      const buffer = await fs.readFile(source);
      const mimeType = getMimeType(imageFormat);
      imageData = `data:${mimeType};base64,${buffer.toString('base64')}`;
    }

    // Build analysis prompt based on task
    let prompt: string;
    switch (task) {
      case 'describe':
        prompt = detailLevel === 'high'
          ? 'Provide a very detailed description of this image, including all visible elements, their positions, colors, textures, and any notable details.'
          : detailLevel === 'low'
            ? 'Briefly describe the main subject of this image in one or two sentences.'
            : 'Describe this image in detail, including the main subjects, setting, colors, and overall composition.';
        break;
      case 'ocr':
        prompt = 'Extract and transcribe all text visible in this image. Format it clearly, preserving the original structure where possible.';
        break;
      case 'objects':
        prompt = 'List all distinct objects visible in this image. For each object, provide its name, approximate position (e.g., top-left, center), and any notable characteristics.';
        break;
      case 'faces':
        prompt = 'Describe any faces visible in this image, including expressions, approximate age range, and any distinguishing features. Do not attempt to identify specific individuals.';
        break;
      case 'colors':
        prompt = 'Analyze the color palette of this image. List the dominant colors, their approximate percentages, and describe the overall color mood/tone.';
        break;
      case 'custom':
        if (!question) {
          return {
            content: { error: 'Question is required for custom analysis task' },
            isError: true,
          };
        }
        prompt = question;
        break;
      default:
        prompt = 'Describe this image.';
    }

    // Return placeholder - actual analysis requires Vision API integration
    return {
      content: {
        source: imageSource,
        format: imageFormat,
        task,
        prompt,
        detailLevel,
        imageDataProvided: imageSource !== 'url' ? 'base64' : 'url',
        requiresVisionAPI: true,
        note: 'Image analysis requires Vision API integration. Override this executor in gateway with AI provider.',
      },
      isError: false,
    };
  } catch (error: unknown) {
    const err = error as Error;
    return {
      content: { error: `Failed to process image: ${err.message}` },
      isError: true,
    };
  }
};

// ============================================================================
// GENERATE IMAGE TOOL
// ============================================================================

export const generateImageTool: ToolDefinition = {
  name: 'generate_image',
  description: 'Generate an image from a text description using AI (DALL-E or similar)',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Detailed description of the image to generate',
      },
      style: {
        type: 'string',
        description: 'Art style for the image',
        enum: ['realistic', 'artistic', 'cartoon', 'sketch', 'digital-art', '3d-render', 'anime', 'photography'],
      },
      size: {
        type: 'string',
        description: 'Image dimensions',
        enum: ['256x256', '512x512', '1024x1024', '1024x1792', '1792x1024'],
      },
      quality: {
        type: 'string',
        description: 'Image quality (affects generation time and cost)',
        enum: ['standard', 'hd'],
      },
      outputPath: {
        type: 'string',
        description: 'Path to save the generated image (optional)',
      },
      n: {
        type: 'number',
        description: 'Number of images to generate (1-4)',
      },
    },
    required: ['prompt'],
  },
};

export const generateImageExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const prompt = params.prompt as string;
  const style = (params.style as string) || 'realistic';
  const size = (params.size as string) || '1024x1024';
  const quality = (params.quality as string) || 'standard';
  const outputPath = params.outputPath as string | undefined;
  const n = Math.min(Math.max((params.n as number) || 1, 1), 4);

  // Validate prompt
  if (!prompt || prompt.trim().length === 0) {
    return {
      content: { error: 'Prompt is required for image generation' },
      isError: true,
    };
  }

  if (prompt.length > 4000) {
    return {
      content: { error: 'Prompt too long. Maximum 4000 characters.' },
      isError: true,
    };
  }

  // Enhance prompt with style
  const enhancedPrompt = style !== 'realistic'
    ? `${prompt}, ${getStyleDescription(style)}`
    : prompt;

  // Return placeholder - actual generation requires DALL-E API integration
  return {
    content: {
      prompt: enhancedPrompt,
      originalPrompt: prompt,
      style,
      size,
      quality,
      count: n,
      outputPath,
      requiresImageGenerationAPI: true,
      note: 'Image generation requires DALL-E or similar API integration. Override this executor in gateway.',
    },
    isError: false,
  };
};

/**
 * Get style description for prompt enhancement
 */
function getStyleDescription(style: string): string {
  const styleDescriptions: Record<string, string> = {
    artistic: 'artistic painting style, oil painting texture',
    cartoon: 'cartoon style, animated, vibrant colors',
    sketch: 'pencil sketch, hand-drawn, black and white',
    'digital-art': 'digital art, clean lines, modern illustration',
    '3d-render': '3D rendered, realistic lighting, CGI quality',
    anime: 'anime style, Japanese animation, cel-shaded',
    photography: 'professional photography, high resolution, detailed',
  };
  return styleDescriptions[style] || '';
}

// ============================================================================
// EDIT IMAGE TOOL
// ============================================================================

export const editImageTool: ToolDefinition = {
  name: 'edit_image',
  description: 'Edit an existing image using AI (inpainting/outpainting)',
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Path to the source image',
      },
      mask: {
        type: 'string',
        description: 'Path to mask image (transparent areas will be edited) or description of area to edit',
      },
      prompt: {
        type: 'string',
        description: 'Description of what to generate in the masked area',
      },
      outputPath: {
        type: 'string',
        description: 'Path to save the edited image',
      },
    },
    required: ['source', 'prompt'],
  },
};

export const editImageExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const source = params.source as string;
  const mask = params.mask as string | undefined;
  const prompt = params.prompt as string;
  const outputPath = params.outputPath as string | undefined;

  // Validate source exists
  try {
    const fs = await import('node:fs/promises');
    await fs.access(source);
  } catch {
    return {
      content: { error: `Source image not found: ${source}` },
      isError: true,
    };
  }

  return {
    content: {
      source,
      mask,
      prompt,
      outputPath,
      requiresImageEditAPI: true,
      note: 'Image editing requires DALL-E edit API or similar. Override this executor in gateway.',
    },
    isError: false,
  };
};

// ============================================================================
// IMAGE VARIATION TOOL
// ============================================================================

export const imageVariationTool: ToolDefinition = {
  name: 'image_variation',
  description: 'Generate variations of an existing image',
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Path to the source image',
      },
      n: {
        type: 'number',
        description: 'Number of variations to generate (1-4)',
      },
      size: {
        type: 'string',
        description: 'Output image size',
        enum: ['256x256', '512x512', '1024x1024'],
      },
      outputDir: {
        type: 'string',
        description: 'Directory to save variations',
      },
    },
    required: ['source'],
  },
};

export const imageVariationExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const source = params.source as string;
  const n = Math.min(Math.max((params.n as number) || 1, 1), 4);
  const size = (params.size as string) || '1024x1024';
  const outputDir = params.outputDir as string | undefined;

  // Validate source exists
  try {
    const fs = await import('node:fs/promises');
    await fs.access(source);
  } catch {
    return {
      content: { error: `Source image not found: ${source}` },
      isError: true,
    };
  }

  return {
    content: {
      source,
      count: n,
      size,
      outputDir,
      requiresVariationAPI: true,
      note: 'Image variation requires DALL-E variation API or similar. Override this executor in gateway.',
    },
    isError: false,
  };
};

// ============================================================================
// RESIZE IMAGE TOOL
// ============================================================================

export const resizeImageTool: ToolDefinition = {
  name: 'resize_image',
  description: 'Resize an image to specified dimensions',
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Path to the source image',
      },
      width: {
        type: 'number',
        description: 'Target width in pixels',
      },
      height: {
        type: 'number',
        description: 'Target height in pixels',
      },
      maintainAspectRatio: {
        type: 'boolean',
        description: 'Maintain original aspect ratio (default: true)',
      },
      outputPath: {
        type: 'string',
        description: 'Path to save resized image (optional, defaults to source with _resized suffix)',
      },
      quality: {
        type: 'number',
        description: 'Output quality for JPEG (1-100, default: 90)',
      },
    },
    required: ['source'],
  },
};

export const resizeImageExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const source = params.source as string;
  const width = params.width as number | undefined;
  const height = params.height as number | undefined;
  const maintainAspectRatio = params.maintainAspectRatio !== false;
  const outputPath = params.outputPath as string | undefined;
  const quality = Math.min(Math.max((params.quality as number) || 90, 1), 100);

  if (!width && !height) {
    return {
      content: { error: 'At least one of width or height is required' },
      isError: true,
    };
  }

  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    // Check if file exists
    await fs.access(source);

    // Try to use sharp if available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sharp: any;
    try {
      sharp = (await import(/* webpackIgnore: true */ 'sharp' as string)).default;
    } catch {
      return {
        content: {
          error: 'sharp library not installed for image processing',
          suggestion: 'Install with: pnpm add sharp',
        },
        isError: true,
      };
    }

    // Process image
    let image = sharp(source);
    const metadata = await image.metadata();

    // Calculate dimensions
    let targetWidth = width;
    let targetHeight = height;

    if (maintainAspectRatio && metadata.width && metadata.height) {
      const aspectRatio = metadata.width / metadata.height;
      if (width && !height) {
        targetHeight = Math.round(width / aspectRatio);
      } else if (height && !width) {
        targetWidth = Math.round(height * aspectRatio);
      }
    }

    // Resize
    image = image.resize(targetWidth, targetHeight, {
      fit: maintainAspectRatio ? 'inside' : 'fill',
    });

    // Determine output path
    const ext = path.extname(source);
    const baseName = path.basename(source, ext);
    const dir = path.dirname(source);
    const output = outputPath || path.join(dir, `${baseName}_resized${ext}`);

    // Apply quality for JPEG
    if (ext.toLowerCase() === '.jpg' || ext.toLowerCase() === '.jpeg') {
      image = image.jpeg({ quality });
    } else if (ext.toLowerCase() === '.png') {
      image = image.png({ quality });
    } else if (ext.toLowerCase() === '.webp') {
      image = image.webp({ quality });
    }

    // Save
    await image.toFile(output);

    const outputStats = await fs.stat(output);

    return {
      content: {
        success: true,
        source,
        output,
        originalDimensions: {
          width: metadata.width,
          height: metadata.height,
        },
        newDimensions: {
          width: targetWidth,
          height: targetHeight,
        },
        fileSize: outputStats.size,
        quality,
      },
      isError: false,
    };
  } catch (error: unknown) {
    const err = error as Error;
    return {
      content: { error: `Failed to resize image: ${err.message}` },
      isError: true,
    };
  }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getFormatFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split('.').pop()?.toLowerCase();
    return ext || 'unknown';
  } catch {
    return 'unknown';
  }
}

function getMimeType(format: string): string {
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
  };
  return mimeTypes[format.toLowerCase()] || 'application/octet-stream';
}

// ============================================================================
// EXPORT ALL IMAGE TOOLS
// ============================================================================

export const IMAGE_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  { definition: analyzeImageTool, executor: analyzeImageExecutor },
  { definition: generateImageTool, executor: generateImageExecutor },
  { definition: editImageTool, executor: editImageExecutor },
  { definition: imageVariationTool, executor: imageVariationExecutor },
  { definition: resizeImageTool, executor: resizeImageExecutor },
];

export const IMAGE_TOOL_NAMES = IMAGE_TOOLS.map((t) => t.definition.name);
