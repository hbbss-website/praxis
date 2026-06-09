import { createDecipheriv } from 'node:crypto';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

export const KEY_ALGORITHM = 'ML-KEM-768';
const AES_TAG_LENGTH = 16;
const rotationIntervalMs = 60 * 1000;
const ML_KEM_SEED_BYTES = 64;

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

// The keypair is derived deterministically from a long-lived secret + a time
// bucket, NOT generated randomly per isolate. On Cloudflare's edge the
// `/public-key` request and the `/login` request can land on different isolates;
// with random per-isolate keys the envelope encrypted against one isolate's
// public key could not be decrypted on another. Deriving from (secret, bucket)
// makes every isolate compute the identical keypair for a given minute, while
// still rotating every `rotationIntervalMs`. Same security posture in practice:
// the secret (JWT_SECRET) is already the most sensitive value, and the envelope
// is defence-in-depth over TLS.
const keyCache = new Map<number, ManagedKey>();

function bucketFor(timestampMs: number) {
  return Math.floor(timestampMs / rotationIntervalMs);
}

async function sha(input: string, algorithm: 'SHA-512' | 'SHA-256') {
  const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(input));
  return new Uint8Array(digest);
}

async function deriveKey(secret: string, bucket: number): Promise<ManagedKey> {
  const cached = keyCache.get(bucket);
  if (cached) return cached;

  const seed = await sha(`praxis-pqc-seed:${secret}:${bucket}`, 'SHA-512'); // 64 bytes
  const kp = ml_kem768.keygen(seed.subarray(0, ML_KEM_SEED_BYTES));
  const idBytes = await sha(`praxis-pqc-keyid:${secret}:${bucket}`, 'SHA-256');

  const key: ManagedKey = {
    keyId: Buffer.from(idBytes.subarray(0, 8)).toString('hex'),
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    expiresAt: (bucket + 1) * rotationIntervalMs,
  };

  keyCache.set(bucket, key);
  for (const b of keyCache.keys()) {
    if (b < bucket - 2) keyCache.delete(b);
  }
  return key;
}

function toBase64Url(b: Uint8Array) {
  return Buffer.from(b).toString('base64url');
}

export async function getPublicKey(secret: string): Promise<PublicKeyResponse> {
  const key = await deriveKey(secret, bucketFor(Date.now()));
  return {
    key_id: key.keyId,
    public_key: toBase64Url(key.publicKey),
    algorithm: KEY_ALGORITHM,
    expires_at: new Date(key.expiresAt).toISOString(),
  };
}

export async function decryptEnvelope(envelope: string, secret: string): Promise<string> {
  const segments = envelope.split('.');
  if (segments.length !== 4) throw new EnvelopeDecryptError('密文信封格式无效。');

  const [keyId, kemB64, ivB64, aesB64] = segments;

  // Accept the current bucket plus the adjacent ones to tolerate rotation at a
  // minute boundary and minor clock skew between isolates.
  const current = bucketFor(Date.now());
  let key: ManagedKey | null = null;
  for (const bucket of [current, current - 1, current + 1]) {
    const candidate = await deriveKey(secret, bucket);
    if (candidate.keyId === keyId) {
      key = candidate;
      break;
    }
  }
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
