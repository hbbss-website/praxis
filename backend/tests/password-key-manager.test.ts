import { createCipheriv, randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, test } from 'vitest';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

type KeyManagerModule = typeof import('../src/auth/password-key-manager');

let getPublicKey: KeyManagerModule['getPublicKey'];
let decryptEnvelope: KeyManagerModule['decryptEnvelope'];
let EnvelopeDecryptError: KeyManagerModule['EnvelopeDecryptError'];

beforeAll(async () => {
  const module = await import('../src/auth/password-key-manager');
  getPublicKey = module.getPublicKey;
  decryptEnvelope = module.decryptEnvelope;
  EnvelopeDecryptError = module.EnvelopeDecryptError;
});

function toBase64Url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64url');
}

// Builds the same envelope the frontend produces, using whatever public key the
// manager currently advertises.
function encryptForCurrentKey(plaintext: string, overrideKeyId?: string) {
  const published = getPublicKey();
  const publicKey = Buffer.from(published.public_key, 'base64url');
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(publicKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(sharedSecret), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const aesPayload = Buffer.concat([encrypted, cipher.getAuthTag()]);

  return [
    overrideKeyId ?? published.key_id,
    toBase64Url(cipherText),
    toBase64Url(iv),
    toBase64Url(aesPayload)
  ].join('.');
}

describe('password key manager', () => {
  test('publishes an ML-KEM-768 public key', () => {
    const published = getPublicKey();
    expect(published.algorithm).toBe('ML-KEM-768');
    expect(published.key_id).toBeTruthy();
    expect(Buffer.from(published.public_key, 'base64url')).toHaveLength(1184);
    expect(Number.isFinite(Date.parse(published.expires_at))).toBe(true);
  });

  test('decrypts an envelope produced for the current key', () => {
    const envelope = encryptForCurrentKey('s3cr3t-password');
    expect(decryptEnvelope(envelope)).toBe('s3cr3t-password');
  });

  test('rejects a tampered auth tag', () => {
    const envelope = encryptForCurrentKey('another-password');
    const segments = envelope.split('.');
    const aesBytes = Buffer.from(segments[3]!, 'base64url');
    aesBytes[aesBytes.length - 1] ^= 0xff;
    segments[3] = aesBytes.toString('base64url');

    expect(() => decryptEnvelope(segments.join('.'))).toThrow(EnvelopeDecryptError);
  });

  test('rejects an unknown key id', () => {
    const envelope = encryptForCurrentKey('yet-another', 'deadbeefdeadbeef');
    expect(() => decryptEnvelope(envelope)).toThrow(EnvelopeDecryptError);
  });

  test('rejects a malformed envelope', () => {
    expect(() => decryptEnvelope('only.three.segments')).toThrow(EnvelopeDecryptError);
  });
});
