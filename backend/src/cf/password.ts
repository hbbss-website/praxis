import { argon2id } from 'hash-wasm';

export type PasswordHashProfile = 'standard' | 'low';
type PasswordHashProfileId = 'standard-v2' | 'low-v2';

type Argon2Params = { memory: number; passes: number; parallelism: number; tagLength: number };
type ProfileDef = { id: PasswordHashProfileId; params: Argon2Params };

const profiles: Record<PasswordHashProfile, ProfileDef> = {
  standard: { id: 'standard-v2', params: { memory: 16_384, passes: 3, parallelism: 4, tagLength: 64 } },
  low:      { id: 'low-v2',      params: { memory: 4_096,  passes: 1, parallelism: 1, tagLength: 64 } },
};
const profilesById = Object.fromEntries(
  Object.values(profiles).map((p) => [p.id, p])
) as Record<PasswordHashProfileId, ProfileDef>;

const nonceSize = 16;
const hashPrefix = 'argon2id';
const secretKey = new TextEncoder().encode(hashPrefix);

function randomBytes(n: number) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

function toHex(b: Uint8Array) {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) b[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return b;
}

function isHex(v: string) {
  return v.length > 0 && v.length % 2 === 0 && /^[0-9a-f]+$/i.test(v);
}

function formatHash(nonce: Uint8Array, tag: Uint8Array, id: PasswordHashProfileId) {
  return `${hashPrefix}$${id}$${toHex(nonce)}$${toHex(tag)}`;
}

function parseHash(value: string) {
  const parts = value.split('$');
  const [prefix, profileId, nonceHex, tagHex] = parts;
  if (parts.length !== 4 || prefix !== hashPrefix || !profileId || !nonceHex || !tagHex) return null;
  const profile = profilesById[profileId as PasswordHashProfileId];
  if (!profile || !isHex(nonceHex) || !isHex(tagHex)) return null;
  return { profile, nonce: fromHex(nonceHex), tag: fromHex(tagHex) };
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i]! ^ b[i]!;
  return r === 0;
}

async function computeHash(password: string, nonce: Uint8Array, params: Argon2Params) {
  return argon2id({
    password,
    salt: nonce,
    secret: secretKey,
    iterations: params.passes,
    parallelism: params.parallelism,
    memorySize: params.memory,
    hashLength: params.tagLength,
    outputType: 'binary',
  }) as Promise<Uint8Array>;
}

export async function hashPassword(password: string, profile: PasswordHashProfile = 'standard') {
  const { id, params } = profiles[profile];
  const nonce = randomBytes(nonceSize);
  const tag = await computeHash(password, nonce, params);
  return formatHash(nonce, tag, id);
}

export async function hashPasswordSync(password: string, profile: PasswordHashProfile = 'standard') {
  return hashPassword(password, profile);
}

export async function hashPasswords(passwords: string[], profile: PasswordHashProfile = 'standard') {
  return Promise.all(passwords.map((p) => hashPassword(p, profile)));
}

export async function verifyPassword(password: string, hashedPassword: string) {
  const parsed = parseHash(hashedPassword);
  if (!parsed) return false;
  const tag = await computeHash(password, parsed.nonce, parsed.profile.params);
  return timingSafeEqual(tag, parsed.tag);
}

export function isLowCostPasswordHash(hashedPassword: string) {
  const parsed = parseHash(hashedPassword);
  return parsed?.profile.id === profiles.low.id;
}
