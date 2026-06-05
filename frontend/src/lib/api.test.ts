// @vitest-environment node
import { createDecipheriv } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { ApiResponseError, encryptPasswordForApi, formatUploadImageMaxSize, unwrapResponse, validatePlainPassword } from './api';

function base64UrlToBuffer(value: string) {
  return Buffer.from(value, 'base64url');
}

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

describe('password helpers', () => {
  test('encrypts a password into a decryptable ML-KEM + AES-GCM envelope', async () => {
    const { publicKey, secretKey } = ml_kem768.keygen();
    const envelope = await encryptPasswordForApi('correct horse battery', {
      keyId: 'test-key',
      publicKey,
      expiresAtMs: Date.now() + 60_000
    });

    const [keyId, kemCipherTextB64, ivB64, aesB64] = envelope.split('.');
    expect(keyId).toBe('test-key');
    expect(envelope.split('.')).toHaveLength(4);

    const sharedSecret = ml_kem768.decapsulate(base64UrlToBuffer(kemCipherTextB64), secretKey);
    const aesPayload = base64UrlToBuffer(aesB64);
    const cipherText = aesPayload.subarray(0, aesPayload.length - 16);
    const authTag = aesPayload.subarray(aesPayload.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(sharedSecret), base64UrlToBuffer(ivB64));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8');

    expect(plaintext).toBe('correct horse battery');
  });

  test('validates plain password length', () => {
    expect(validatePlainPassword('12345678')).toBeNull();
    expect(validatePlainPassword('1234567')).toBe('密码至少需要 8 位。');
    expect(validatePlainPassword('1'.repeat(33))).toBe('密码不能超过 32 位。');
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
