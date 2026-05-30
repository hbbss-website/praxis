// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { ApiResponseError, formatUploadImageMaxSize, unwrapResponse } from './api';

test('ApiResponseError stores status and message', () => {
  const error = new ApiResponseError(404, '未找到');
  expect(error.status).toBe(404);
  expect(error.message).toBe('未找到');
  expect(error).toBeInstanceOf(Error);
});

describe('formatUploadImageMaxSize', () => {
  test('formats MiB values', () => {
    expect(formatUploadImageMaxSize(5 * 1024 * 1024)).toBe('5 MiB');
  });

  test('formats KiB values', () => {
    expect(formatUploadImageMaxSize(500 * 1024)).toBe('500 KiB');
  });

  test('formats byte values', () => {
    expect(formatUploadImageMaxSize(999)).toBe('999 B');
  });

  test('handles 0 bytes', () => {
    expect(formatUploadImageMaxSize(0)).toBe('0 MiB');
  });

  test('handles 1 byte', () => {
    expect(formatUploadImageMaxSize(1)).toBe('1 B');
  });
});

describe('unwrapResponse', () => {
  test('resolves with data on success', async () => {
    const result = await unwrapResponse<{ key: string }>(
      Promise.resolve({ data: { key: 'value' }, error: null, status: 200 })
    );
    expect(result).toEqual({ key: 'value' });
  });

  test('throws ApiResponseError on error', async () => {
    await expect(
      unwrapResponse(Promise.resolve({ data: null, error: '出错啦', status: 400 }))
    ).rejects.toThrow(ApiResponseError);
  });

  test('throws ApiResponseError with correct status', async () => {
    try {
      await unwrapResponse(Promise.resolve({ data: null, error: 'Not Found', status: 404 }));
    } catch (error) {
      expect(error).toBeInstanceOf(ApiResponseError);
      expect((error as ApiResponseError).status).toBe(404);
    }
  });

  test('throws with fallback message when error is empty object', async () => {
    await expect(
      unwrapResponse(Promise.resolve({ data: null, error: {}, status: 500 }))
    ).rejects.toThrow('请求失败。');
  });

  test('handles Error instance in response', async () => {
    await expect(
      unwrapResponse(Promise.resolve({ data: null, error: new Error('自定义错误'), status: 403 }))
    ).rejects.toThrow('自定义错误');
  });
});
