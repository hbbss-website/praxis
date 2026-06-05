import { createDecipheriv, randomBytes } from 'node:crypto';

import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

import { appConfig } from '../config';

export const KEY_ALGORITHM = 'ML-KEM-768';

const AES_TAG_LENGTH = 16;

type KeyPair = {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
};

type ManagedKey = {
  keyId: string;
  keyPair: KeyPair;
  createdAt: number;
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

const rotationIntervalMs = appConfig.password_key_rotation_ms;

let current: ManagedKey = createManagedKey();
let previous: ManagedKey | null = null;

function createManagedKey(): ManagedKey {
  const keyPair = ml_kem768.keygen();
  const createdAt = Date.now();
  return {
    keyId: randomBytes(8).toString('hex'),
    keyPair: { publicKey: keyPair.publicKey, secretKey: keyPair.secretKey },
    createdAt,
    expiresAt: createdAt + rotationIntervalMs,
  };
}

function rotate() {
  previous = current;
  current = createManagedKey();
}

const rotationTimer = setInterval(rotate, rotationIntervalMs);
rotationTimer.unref();

function toBase64Url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(value: string) {
  return Buffer.from(value, 'base64url');
}

export function getPublicKey(): PublicKeyResponse {
  return {
    key_id: current.keyId,
    public_key: toBase64Url(current.keyPair.publicKey),
    algorithm: KEY_ALGORITHM,
    expires_at: new Date(current.expiresAt).toISOString(),
  };
}

function findKeyById(keyId: string): ManagedKey | null {
  if (current.keyId === keyId) {
    return current;
  }

  if (previous && previous.keyId === keyId) {
    return previous;
  }

  return null;
}

/**
 * Decrypts a `keyId.kemCipherText.iv.aesCipherTextWithTag` envelope produced by
 * the frontend (ML-KEM-768 KEM + AES-256-GCM DEM). The shared secret is the
 * AES-256 key. Integrity rests entirely on the GCM auth tag, because ML-KEM
 * decapsulation never throws on a bad ciphertext — it silently returns a
 * different secret (FIPS-203 implicit rejection). So we select the secret key
 * strictly by keyId and let the tag verification reject anything else.
 */
export function decryptEnvelope(envelope: string): string {
  const segments = envelope.split('.');

  if (segments.length !== 4) {
    throw new EnvelopeDecryptError('密文信封格式无效。');
  }

  const [keyId, kemCipherTextB64, ivB64, aesB64] = segments;
  const managedKey = findKeyById(keyId!);

  if (!managedKey) {
    throw new EnvelopeDecryptError('密钥已轮换或不存在，请重试。');
  }

  try {
    const kemCipherText = fromBase64Url(kemCipherTextB64!);
    const iv = fromBase64Url(ivB64!);
    const aesPayload = fromBase64Url(aesB64!);

    if (aesPayload.length < AES_TAG_LENGTH) {
      throw new EnvelopeDecryptError('密文长度无效。');
    }

    const sharedSecret = ml_kem768.decapsulate(kemCipherText, managedKey.keyPair.secretKey);

    const cipherText = aesPayload.subarray(0, aesPayload.length - AES_TAG_LENGTH);
    const authTag = aesPayload.subarray(aesPayload.length - AES_TAG_LENGTH);

    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(sharedSecret), iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return plaintext.toString('utf8');
  } catch (error) {
    if (error instanceof EnvelopeDecryptError) {
      throw error;
    }

    throw new EnvelopeDecryptError('密码解密失败，请重试。');
  }
}
