import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const AUTH_SECRET =
  process.env.AUTH_SECRET ||
  'chrono-card-auth-secret-key-super-secure-production-2026';

export function hashPassword(
  password: string,
  salt = randomBytes(16).toString('hex'),
) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
) {
  try {
    const hash = scryptSync(password, salt, 64).toString('hex');
    const bufA = Buffer.from(hash, 'hex');
    const bufB = Buffer.from(expectedHash, 'hex');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function createToken(payload: { id: string; username: string }): string {
  const data = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + 30 * 86_400_000 }),
  ).toString('base64url');
  const sig = createHmac('sha256', AUTH_SECRET)
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(
  token: string,
): { id: string; username: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [data, sig] = parts;
    if (!data || !sig) return null;
    const expectedSig = createHmac('sha256', AUTH_SECRET)
      .update(data)
      .digest('base64url');
    const bufSig = Buffer.from(sig);
    const bufExpected = Buffer.from(expectedSig);
    if (bufSig.length !== bufExpected.length) return null;
    if (!timingSafeEqual(bufSig, bufExpected)) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (typeof payload.exp === 'number' && Date.now() > payload.exp)
      return null;
    if (!payload.id || !payload.username) return null;
    return { id: String(payload.id), username: String(payload.username) };
  } catch {
    return null;
  }
}
