import { argon2, argon2Sync, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';

type Argon2Params = {
  memory: number;
  passes: number;
  parallelism: number;
  tagLength: number;
};

export type PasswordHashProfile = 'standard' | 'low';
type PasswordHashProfileId = 'standard-v2' | 'low-v2';
type PasswordHashProfileDefinition = {
  id: PasswordHashProfileId;
  params: Argon2Params;
};

const argon2Async = promisify(argon2);
const nonceSize = 16;
const hashPrefix = 'argon2id';
const minWorkerBatchSize = 64;
const maxHashWorkers = Math.min(Math.max(availableParallelism(), 1), 16);
const passwordHashProfiles: Record<PasswordHashProfile, PasswordHashProfileDefinition> = {
  standard: {
    id: 'standard-v2',
    params: {
      memory: 16_384,
      passes: 3,
      parallelism: 4,
      tagLength: 64
    }
  },
  low: {
    id: 'low-v2',
    params: {
      memory: 4_096,
      passes: 1,
      parallelism: 1,
      tagLength: 64
    }
  }
};
const passwordHashProfilesById = Object.fromEntries(
  Object.values(passwordHashProfiles).map((profile) => [profile.id, profile])
) as Record<PasswordHashProfileId, PasswordHashProfileDefinition>;
const passwordHashWorkerScript = `
const { argon2Sync, randomBytes } = require('node:crypto');
const { parentPort, workerData } = require('node:worker_threads');

const nonceSize = ${nonceSize};
const hashPrefix = ${JSON.stringify(hashPrefix)};
function formatHash(nonce, tag, profileId) {
  return \`\${hashPrefix}\\$\${profileId}\\$\${nonce.toString('hex')}\\$\${tag.toString('hex')}\`;
}

const hashes = workerData.passwords.map((password) => {
  const params = workerData.params;
  const nonce = randomBytes(nonceSize);
  const tag = argon2Sync(hashPrefix, { message: password, nonce, ...params });
  return formatHash(nonce, tag, workerData.profileId);
});

parentPort.postMessage(hashes);
`;

export function digestPasswordForStorage(password: string) {
  return createHash('sha256').update(password).digest('hex');
}

function isHex(value: string) {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
}

function formatHash(nonce: Buffer, tag: Buffer, profileId: PasswordHashProfileId) {
  return `${hashPrefix}$${profileId}$${nonce.toString('hex')}$${tag.toString('hex')}`;
}

function parseHash(value: string) {
  const parts = value.split('$');
  const [prefix, profileId, nonceHex, tagHex] = parts;

  if (parts.length !== 4 || prefix !== hashPrefix || !profileId || !nonceHex || !tagHex) {
    return null;
  }

  try {
    const profile = passwordHashProfilesById[profileId as PasswordHashProfileId];

    if (!profile || !isHex(nonceHex) || !isHex(tagHex)) {
      return null;
    }

    return {
      profileId: profile.id,
      params: profile.params,
      nonce: Buffer.from(nonceHex, 'hex'),
      tag: Buffer.from(tagHex, 'hex')
    };
  } catch {
    return null;
  }
}

function resolvePasswordHashProfile(profile: PasswordHashProfile) {
  return passwordHashProfiles[profile];
}

export async function hashPassword(password: string, profile: PasswordHashProfile = 'standard') {
  const resolvedProfile = resolvePasswordHashProfile(profile);
  const nonce = randomBytes(nonceSize);
  const tag = await argon2Async(hashPrefix, {
    message: password,
    nonce,
    ...resolvedProfile.params
  });
  return formatHash(nonce, tag, resolvedProfile.id);
}

export function hashPasswordSync(password: string, profile: PasswordHashProfile = 'standard') {
  const resolvedProfile = resolvePasswordHashProfile(profile);
  const nonce = randomBytes(nonceSize);
  const tag = argon2Sync(hashPrefix, {
    message: password,
    nonce,
    ...resolvedProfile.params
  });
  return formatHash(nonce, tag, resolvedProfile.id);
}

function hashPasswordsInWorker(passwords: string[], profileId: PasswordHashProfileId, params: Argon2Params) {
  return new Promise<string[]>((resolve, reject) => {
    const worker = new Worker(passwordHashWorkerScript, {
      eval: true,
      workerData: { passwords, profileId, params }
    });
    let settled = false;

    worker.once('message', (hashes: string[]) => {
      settled = true;
      resolve(hashes);
    });
    worker.once('error', (error) => {
      settled = true;
      reject(error);
    });
    worker.once('exit', (code) => {
      if (!settled && code !== 0) {
        reject(new Error(`密码哈希工作线程异常退出，退出码：${code}`));
      }
    });
  });
}

export async function hashPasswords(passwords: string[], profile: PasswordHashProfile = 'standard') {
  if (passwords.length === 0) {
    return [];
  }

  const resolvedProfile = resolvePasswordHashProfile(profile);
  const workerCount = Math.min(maxHashWorkers, passwords.length);

  if (workerCount <= 1 || passwords.length < minWorkerBatchSize) {
    return Promise.all(passwords.map((password) => hashPassword(password, profile)));
  }

  const chunkSize = Math.ceil(passwords.length / workerCount);
  const chunks: string[][] = [];

  for (let index = 0; index < passwords.length; index += chunkSize) {
    chunks.push(passwords.slice(index, index + chunkSize));
  }

  const hashedChunks = await Promise.all(
    chunks.map((chunk) => hashPasswordsInWorker(chunk, resolvedProfile.id, resolvedProfile.params))
  );
  return hashedChunks.flat();
}

export async function verifyPassword(password: string, hashedPassword: string) {
  const parsed = parseHash(hashedPassword);

  if (!parsed) {
    return false;
  }

  const tag = await argon2Async(hashPrefix, {
    message: password,
    nonce: parsed.nonce,
    ...parsed.params
  });
  return tag.length === parsed.tag.length && timingSafeEqual(tag, parsed.tag);
}

export function isLowCostPasswordHash(hashedPassword: string) {
  const parsed = parseHash(hashedPassword);
  return parsed?.profileId === passwordHashProfiles.low.id;
}
