import { randomBytes, createDecipheriv } from 'node:crypto';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

export const KEY_ALGORITHM = 'ML-KEM-768';
const AES_TAG_LENGTH = 16;
const rotationIntervalMs = 60 * 1000;

type ManagedKey = {
  keyId: string;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  expiresAt: number;
};

export type PublicKeyResponse = {
  key_id: string;
  public_key: string;
  algorithm: string;
  expires_at: string;
};

export class EnvelopeDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeDecryptError';
  }
}

function createManagedKey(): ManagedKey {
  const kp = ml_kem768.keygen();
  return {
    keyId: randomBytes(8).toString('hex'),
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    expiresAt: Date.now() + rotationIntervalMs,
  };
}

// Lazily initialized. createManagedKey() generates random key material, which
// is disallowed in Worker global scope, so it must only run inside a handler.
let current: ManagedKey | null = null;
let previous: ManagedKey | null = null;

function ensureCurrentKey(): ManagedKey {
  if (current === null) {
    current = createManagedKey();
  } else if (Date.now() > current.expiresAt) {
    previous = current;
    current = createManagedKey();
  }
  return current;
}

function toBase64Url(b: Uint8Array) {
  return Buffer.from(b).toString('base64url');
}

export function getPublicKey(): PublicKeyResponse {
  const cur = ensureCurrentKey();
  return {
    key_id: cur.keyId,
    public_key: toBase64Url(cur.publicKey),
    algorithm: KEY_ALGORITHM,
    expires_at: new Date(cur.expiresAt).toISOString(),
  };
}

export function decryptEnvelope(envelope: string): string {
  const cur = ensureCurrentKey();
  const segments = envelope.split('.');
  if (segments.length !== 4) throw new EnvelopeDecryptError('密文信封格式无效。');

  const [keyId, kemB64, ivB64, aesB64] = segments;
  const key = cur.keyId === keyId ? cur : (previous?.keyId === keyId ? previous : null);
  if (!key) throw new EnvelopeDecryptError('密钥已轮换或不存在，请重试。');

  try {
    const kemCipherText = Buffer.from(kemB64!, 'base64url');
    const iv = Buffer.from(ivB64!, 'base64url');
    const aesPayload = Buffer.from(aesB64!, 'base64url');
    if (aesPayload.length < AES_TAG_LENGTH) throw new EnvelopeDecryptError('密文长度无效。');

    const sharedSecret = ml_kem768.decapsulate(kemCipherText, key.secretKey);
    const cipherText = aesPayload.subarray(0, aesPayload.length - AES_TAG_LENGTH);
    const authTag = aesPayload.subarray(aesPayload.length - AES_TAG_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(sharedSecret), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error instanceof EnvelopeDecryptError) throw error;
    throw new EnvelopeDecryptError('密码解密失败，请重试。');
  }
}
