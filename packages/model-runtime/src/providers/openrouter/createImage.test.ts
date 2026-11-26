// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateImageOptions } from '../../core/openaiCompatible';
import { createOpenRouterImage } from './createImage';

vi.mock('../../utils/referenceImageCache', () => ({
  referenceImageUrlToBase64: vi.fn(async () => ({ base64: 'cmVm', mimeType: 'image/jpeg' })),
}));

const options: CreateImageOptions = {
  apiKey: 'test-key',
  baseURL: 'https://openrouter.ai/api/v1',
  provider: 'openrouter',
};

const mockFetchResponse = (body: unknown, init: { ok?: boolean; status?: number } = {}) => {
  global.fetch = vi.fn().mockResolvedValueOnce({
    json: async () => body,
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: 'Not Found',
  });
};

const requestBody = () => JSON.parse((fetch as any).mock.calls[0][1].body);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createOpenRouterImage', () => {
  it('posts to the Image API with the model id and aspect ratio', async () => {
    mockFetchResponse({
      data: [{ b64_json: 'aW1n', media_type: 'image/webp' }],
      usage: { completion_tokens: 4175, cost: 0.04, prompt_tokens: 0, total_tokens: 4175 },
    });

    const result = await createOpenRouterImage(
      {
        model: 'microsoft/mai-image-2.7',
        params: { aspectRatio: '9:16', prompt: 'a poster' },
      },
      options,
    );

    expect((fetch as any).mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/images');
    expect((fetch as any).mock.calls[0][1].headers.Authorization).toBe('Bearer test-key');
    expect(requestBody()).toEqual({
      aspect_ratio: '9:16',
      model: 'microsoft/mai-image-2.7',
      n: 1,
      prompt: 'a poster',
      response_format: 'b64_json',
    });
    expect(result).toEqual({
      imageUrl: 'data:image/webp;base64,aW1n',
      modelUsage: {
        cost: 0.04,
        outputImageTokens: 4175,
        totalInputTokens: 0,
        totalOutputTokens: 4175,
        totalTokens: 4175,
      },
    });
  });

  it('sends reference images inline as input_references', async () => {
    mockFetchResponse({ data: [{ url: 'https://cdn.openrouter.ai/out.png' }] });

    const result = await createOpenRouterImage(
      {
        model: 'microsoft/mai-image-2.7-flash',
        params: {
          imageUrls: ['https://files.example.com/a.jpg', 'data:image/png;base64,Yg=='],
          prompt: 'edit',
        },
      },
      options,
    );

    expect(requestBody().input_references).toEqual([
      { image_url: { url: 'data:image/jpeg;base64,cmVm' }, type: 'image_url' },
      { image_url: { url: 'data:image/png;base64,Yg==' }, type: 'image_url' },
    ]);
    expect(result).toEqual({ imageUrl: 'https://cdn.openrouter.ai/out.png' });
  });

  it('applies the model id mapping', async () => {
    mockFetchResponse({ data: [{ b64_json: 'aW1n' }] });

    await createOpenRouterImage(
      { model: 'mai', params: { prompt: 'x' } },
      { ...options, modelIdMapping: { mai: 'microsoft/mai-image-2.7' } },
    );

    expect(requestBody().model).toBe('microsoft/mai-image-2.7');
  });

  it('surfaces the upstream error message', async () => {
    mockFetchResponse(
      { error: { code: 404, message: 'No model found for "foo"' } },
      { ok: false, status: 404 },
    );

    await expect(
      createOpenRouterImage({ model: 'foo', params: { prompt: 'x' } }, options),
    ).rejects.toMatchObject({
      error: expect.objectContaining({
        message: 'OpenRouter image API error (404): No model found for "foo"',
      }),
      errorType: 'ProviderBizError',
      provider: 'openrouter',
    });
  });

  it('fails when the response carries no image', async () => {
    mockFetchResponse({ data: [] });

    await expect(
      createOpenRouterImage({ model: 'microsoft/mai-image-2.7', params: { prompt: 'x' } }, options),
    ).rejects.toMatchObject({ errorType: 'ProviderBizError' });
  });
});
