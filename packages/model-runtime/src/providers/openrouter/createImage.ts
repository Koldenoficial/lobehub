import type { ModelUsage } from '@lobechat/types';
import createDebug from 'debug';

import type { CreateImageOptions } from '../../core/openaiCompatible';
import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import { AgentRuntimeError } from '../../utils/createError';
import { resolveMappedModelId } from '../../utils/modelIdMapping';
import { referenceImageUrlToBase64 } from '../../utils/referenceImageCache';
import { parseDataUri } from '../../utils/uriParser';

const log = createDebug('lobe-image:openrouter');

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

interface OpenRouterImageReference {
  image_url: { url: string };
  type: 'image_url';
}

interface OpenRouterImageRequest {
  aspect_ratio?: string;
  input_references?: OpenRouterImageReference[];
  model: string;
  n: number;
  prompt: string;
  response_format: 'b64_json' | 'url';
}

interface OpenRouterImageResponse {
  data?: Array<{ b64_json?: string | null; media_type?: string; url?: string | null }>;
  usage?: {
    completion_tokens?: number;
    cost?: number;
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Reference images are sent inline as data URLs: LobeHub's own file URLs (private buckets,
 * localhost) are not reachable from OpenRouter.
 */
const toInlineImageUrl = async (imageUrl: string) => {
  const { type, base64, mimeType } = parseDataUri(imageUrl);

  if (type === 'base64' && base64) return `data:${mimeType || 'image/png'};base64,${base64}`;
  if (type === 'url') {
    const image = await referenceImageUrlToBase64(imageUrl);
    return `data:${image.mimeType};base64,${image.base64}`;
  }

  throw new TypeError(`Unsupported reference image url: ${imageUrl}`);
};

const convertUsage = (usage: OpenRouterImageResponse['usage']): ModelUsage | undefined => {
  if (!usage) return undefined;

  const modelUsage: ModelUsage = {
    ...(usage.prompt_tokens !== undefined && { totalInputTokens: usage.prompt_tokens }),
    ...(usage.completion_tokens !== undefined && {
      outputImageTokens: usage.completion_tokens,
      totalOutputTokens: usage.completion_tokens,
    }),
    ...(usage.total_tokens !== undefined && { totalTokens: usage.total_tokens }),
    // OpenRouter reports the USD charge of the call itself
    ...(typeof usage.cost === 'number' && { cost: usage.cost }),
  };

  return Object.keys(modelUsage).length > 0 ? modelUsage : undefined;
};

/**
 * Generate images through OpenRouter's Image API (`POST /api/v1/images`). It is not the OpenAI
 * images API: it takes `aspect_ratio` and `input_references` instead of `size` and multipart
 * edits, and reports usage as `prompt_tokens` / `completion_tokens` / `cost`.
 * https://openrouter.ai/docs/guides/overview/multimodal/image-generation
 */
export async function createOpenRouterImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { apiKey, baseURL, modelIdMapping, provider } = options;
  const { model, params } = payload;

  try {
    const referenceUrls = [
      ...(params.imageUrl ? [params.imageUrl] : []),
      ...(params.imageUrls ?? []),
    ].filter((url) => url && url.trim() !== '');

    const requestBody: OpenRouterImageRequest = {
      model: resolveMappedModelId(model, { modelIdMapping }),
      n: 1,
      prompt: params.prompt,
      response_format: 'b64_json',
    };

    if (params.aspectRatio) requestBody.aspect_ratio = params.aspectRatio;

    if (referenceUrls.length > 0) {
      requestBody.input_references = await Promise.all(
        referenceUrls.map(async (url) => ({
          image_url: { url: await toInlineImageUrl(url) },
          type: 'image_url' as const,
        })),
      );
    }

    const endpoint = `${(baseURL || DEFAULT_BASE_URL).replace(/\/+$/, '')}/images`;
    log('Calling OpenRouter image API: %s with model %s', endpoint, requestBody.model);

    const response = await fetch(endpoint, {
      body: JSON.stringify(requestBody),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    if (!response.ok) {
      let message = response.statusText;
      try {
        const errorData = await response.json();
        message = errorData?.error?.message || message;
      } catch {
        // keep the status text when the error body is not JSON
      }
      throw new Error(`OpenRouter image API error (${response.status}): ${message}`);
    }

    const data: OpenRouterImageResponse = await response.json();
    const image = data.data?.[0];

    let imageUrl: string;
    if (image?.b64_json) {
      imageUrl = `data:${image.media_type || 'image/png'};base64,${image.b64_json}`;
    } else if (image?.url) {
      imageUrl = image.url;
    } else {
      throw new Error('OpenRouter returned no image');
    }

    const modelUsage = convertUsage(data.usage);

    return { imageUrl, ...(modelUsage && { modelUsage }) };
  } catch (error) {
    log('Error in createOpenRouterImage: %O', error);

    throw AgentRuntimeError.createImage({
      error: error as any,
      errorType: 'ProviderBizError',
      provider,
    });
  }
}
