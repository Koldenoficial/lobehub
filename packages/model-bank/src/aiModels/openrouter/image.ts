import type { ModelParamsSchema } from '../../standard-parameters';
import type { AIImageModelCard } from '../../types/aiModel';

/**
 * Request fields OpenRouter's Image API (`POST /api/v1/images`) accepts for the MAI-Image models:
 * `aspect_ratio` and up to five `input_references`. There is no `size` field.
 * https://openrouter.ai/microsoft/mai-image-2.7/llms.txt
 */
const maiImageParameters: ModelParamsSchema = {
  aspectRatio: {
    default: '1:1',
    enum: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
  },
  imageUrls: { default: [], maxCount: 5 },
  prompt: { default: '' },
};

// https://openrouter.ai/api/v1/models?output_modalities=image
export const openrouterImageModels: AIImageModelCard[] = [
  {
    description:
      'MAI-Image-2.7 is the precision tier of Microsoft AI’s MAI-Image-2.7 family, an image generation and editing model suited for design-ready visuals.',
    displayName: 'MAI-Image-2.7',
    enabled: true,
    id: 'microsoft/mai-image-2.7',
    parameters: maiImageParameters,
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 34, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-11-17',
    type: 'image',
  },
  {
    description:
      'MAI-Image-2.7 Flash is the lower-latency, lower-cost member of Microsoft AI’s MAI-Image-2.7 family, built for high-throughput image generation and editing.',
    displayName: 'MAI-Image-2.7 Flash',
    enabled: true,
    id: 'microsoft/mai-image-2.7-flash',
    parameters: maiImageParameters,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-11-17',
    type: 'image',
  },
  {
    description:
      'MAI-Image-2.6 is the precision tier of Microsoft AI’s MAI-Image-2.6 family, an image generation and editing model suited for design-ready visuals.',
    displayName: 'MAI-Image-2.6',
    id: 'microsoft/mai-image-2.6',
    parameters: maiImageParameters,
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 38, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-04',
    type: 'image',
  },
  {
    description:
      'MAI-Image-2.6 Flash is the lower-latency, lower-cost member of Microsoft AI’s MAI-Image-2.6 family, built for high-throughput image generation and editing.',
    displayName: 'MAI-Image-2.6 Flash',
    id: 'microsoft/mai-image-2.6-flash',
    parameters: maiImageParameters,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 19, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-04',
    type: 'image',
  },
];
