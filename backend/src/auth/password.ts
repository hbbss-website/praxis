import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';

type ScryptParams = {
  cost: number;
  blockSize: number;
  parallelization: number;
  keyLength: number;
};

export type PasswordHashProfile = 'standard' | 'low';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options?: { cost: number; blockSize: number; parallelization: number; maxmem: number }
) => Promise<Buffer>;
const saltSize = 16;
const hashPrefix = 'scrypt';
const minWorkerBatchSize = 64;
const maxHashWorkers = Math.min(Math.max(availableParallelism(), 1), 16);
const scryptParamsByProfile: Record<PasswordHashProfile, ScryptParams> = {
  standard: {
    cost: 16_384,
    blockSize: 8,
    parallelization: 1,
    keyLength: 64
  },
  low: {
    cost: 4_096,
    blockSize: 8,
    parallelization: 1,
    keyLength: 64
  }
};
const passwordHashWorkerScript = `
const { randomBytes, scryptSync } = require('node:crypto');
const { parentPort, workerData } = require('node:worker_threads');

const saltSize = ${saltSize};
const hashPrefix = ${JSON.stringify(hashPrefix)};

function formatParams(params) {
  return [
    \`cost=\${params.cost}\`,
    \`blockSize=\${params.blockSize}\`,
    \`parallelization=\${params.parallelization}\`,
    \`keyLength=\${params.keyLength}\`
  ].join(',');
}

function formatHash(salt, derivedKey, params) {
  return \`\${hashPrefix}\\$\${formatParams(params)}\\$\${salt.toString('hex')}\\$\${derivedKey.toString('hex')}\`;
}

const hashes = workerData.passwords.map((password) => {
  const params = workerData.params;
  const salt = randomBytes(saltSize);
  const derivedKey = scryptSync(password, salt, params.keyLength, params);
  return formatHash(salt, derivedKey, params);
});

parentPort.postMessage(hashes);
`;

function toScryptOptions(params: ScryptParams) {
  return {
    ...params,
    maxmem: Math.max(32 * 1024 * 1024, 128 * params.cost * params.blockSize)
  };
}

function formatParams(params: ScryptParams) {
  return [
    `cost=${params.cost}`,
    `blockSize=${params.blockSize}`,
    `parallelization=${params.parallelization}`,
    `keyLength=${params.keyLength}`
  ].join(',');
}

function parseParams(value: string) {
  const parts = value.split(',');
  const parsed: Partial<ScryptParams> = {};

  for (const part of parts) {
    const [key, rawValue] = part.split('=');
    const nextValue = Number(rawValue);

    if (!rawValue || !Number.isInteger(nextValue) || nextValue <= 0) {
      return null;
    }

    if (key === 'cost') {
      parsed.cost = nextValue;
      continue;
    }

    if (key === 'blockSize') {
      parsed.blockSize = nextValue;
      continue;
    }

    if (key === 'parallelization') {
      parsed.parallelization = nextValue;
      continue;
    }

    if (key === 'keyLength') {
      parsed.keyLength = nextValue;
      continue;
    }

    return null;
  }

  if (!parsed.cost || !parsed.blockSize || !parsed.parallelization || !parsed.keyLength) {
    return null;
  }

  return parsed as ScryptParams;
}

function formatHash(salt: Buffer, derivedKey: Buffer, params: ScryptParams) {
  return `${hashPrefix}$${formatParams(params)}$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

function parseHash(value: string) {
  const parts = value.split('$');

  if (parts.length === 3) {
    const [prefix, saltHex, hashHex] = parts;

    if (prefix !== hashPrefix || !saltHex || !hashHex) {
      return null;
    }

    try {
      return {
        params: scryptParamsByProfile.standard,
        salt: Buffer.from(saltHex, 'hex'),
        hash: Buffer.from(hashHex, 'hex')
      };
    } catch {
      return null;
    }
  }

  const [prefix, paramsValue, saltHex, hashHex] = parts;

  if (prefix !== hashPrefix || !paramsValue || !saltHex || !hashHex) {
    return null;
  }

  try {
    const params = parseParams(paramsValue);

    if (!params) {
      return null;
    }

    return {
      params,
      salt: Buffer.from(saltHex, 'hex'),
      hash: Buffer.from(hashHex, 'hex')
    };
  } catch {
    return null;
  }
}

function resolveScryptParams(profile: PasswordHashProfile) {
  return scryptParamsByProfile[profile];
}

function isSameParams(left: ScryptParams, right: ScryptParams) {
  return left.cost === right.cost
    && left.blockSize === right.blockSize
    && left.parallelization === right.parallelization
    && left.keyLength === right.keyLength;
}

export async function hashPassword(password: string, profile: PasswordHashProfile = 'standard') {
  const params = resolveScryptParams(profile);
  const salt = randomBytes(saltSize);
  const derivedKey = await scryptAsync(password, salt, params.keyLength, toScryptOptions(params));
  return formatHash(salt, derivedKey, params);
}

export function hashPasswordSync(password: string, profile: PasswordHashProfile = 'standard') {
  const params = resolveScryptParams(profile);
  const salt = randomBytes(saltSize);
  const derivedKey = scryptSync(password, salt, params.keyLength, toScryptOptions(params));
  return formatHash(salt, derivedKey, params);
}

function hashPasswordsInWorker(passwords: string[], params: ScryptParams) {
  return new Promise<string[]>((resolve, reject) => {
    const worker = new Worker(passwordHashWorkerScript, {
      eval: true,
      workerData: { passwords, params }
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

  const params = resolveScryptParams(profile);
  const workerCount = Math.min(maxHashWorkers, passwords.length);

  if (workerCount <= 1 || passwords.length < minWorkerBatchSize) {
    return Promise.all(passwords.map((password) => hashPassword(password, profile)));
  }

  const chunkSize = Math.ceil(passwords.length / workerCount);
  const chunks: string[][] = [];

  for (let index = 0; index < passwords.length; index += chunkSize) {
    chunks.push(passwords.slice(index, index + chunkSize));
  }

  const hashedChunks = await Promise.all(chunks.map((chunk) => hashPasswordsInWorker(chunk, params)));
  return hashedChunks.flat();
}

export async function verifyPassword(password: string, hashedPassword: string) {
  const parsed = parseHash(hashedPassword);

  if (!parsed) {
    return false;
  }

  const derivedKey = await scryptAsync(password, parsed.salt, parsed.hash.length, toScryptOptions(parsed.params));
  return derivedKey.length === parsed.hash.length && timingSafeEqual(derivedKey, parsed.hash);
}

export function isLowCostPasswordHash(hashedPassword: string) {
  const parsed = parseHash(hashedPassword);
  return parsed ? isSameParams(parsed.params, scryptParamsByProfile.low) : false;
}
