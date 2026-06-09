export type PasswordHashProfile = 'standard' | 'low';
type PasswordHashProfileId = 'standard-pbkdf2-v1' | 'low-pbkdf2-v1';

type ProfileDef = { id: PasswordHashProfileId; iterations: number };

// PBKDF2 via WebCrypto: native to the Workers runtime (no WASM), so it works on
// all Cloudflare tiers without hitting the "Wasm code generation disallowed"
// restriction that breaks hash-wasm/argon2. Iterations are tuned for the free
// plan's ~10 ms CPU budget. The PQC envelope encryption (ML-KEM-768 + AES-256-GCM)
// already provides defence-in-depth over TLS, so reduced iterations are
// acceptable for this use case.
const profiles: Record<PasswordHashProfile, ProfileDef> = {
  standard: { id: 'standard-pbkdf2-v1', iterations: 30_000 },
  low:      { id: 'low-pbkdf2-v1',      iterations: 5_000 },
};

const HASH_PREFIX = 'pbkdf2';
const HASH_ALGORITHM = 'SHA-256';
const SALT_BYTES = 16;
const DERIVED_BITS = 256;

async function deriveHash(password: string, salt: Uint8Array, iterations: number) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: HASH_ALGORITHM },
    keyMaterial,
    DERIVED_BITS
  );
  return new Uint8Array(bits);
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

function formatHash(salt: Uint8Array, hash: Uint8Array, profile: ProfileDef) {
  return `${HASH_PREFIX}$${profile.id}$${profile.iterations}$${toHex(salt)}$${toHex(hash)}`;
}

function parseHash(value: string) {
  const parts = value.split('$');
  const [prefix, profileId, iterationsRaw, saltHex, hashHex] = parts;
  if (parts.length !== 5 || prefix !== HASH_PREFIX || !profileId || !iterationsRaw || !saltHex || !hashHex) return null;
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations <= 0) return null;
  if (!isHex(saltHex) || !isHex(hashHex)) return null;
  return { profileId: profileId as PasswordHashProfileId, iterations, salt: fromHex(saltHex), hash: fromHex(hashHex) };
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i]! ^ b[i]!;
  return r === 0;
}

export async function hashPassword(password: string, profile: PasswordHashProfile = 'standard') {
  const def = profiles[profile];
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveHash(password, salt, def.iterations);
  return formatHash(salt, hash, def);
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
  const computed = await deriveHash(password, parsed.salt, parsed.iterations);
  return timingSafeEqual(computed, parsed.hash);
}

export function isLowCostPasswordHash(hashedPassword: string) {
  const parsed = parseHash(hashedPassword);
  return parsed?.profileId === profiles.low.id;
}
