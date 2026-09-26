import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}
export async function hashPassword(
  password: string,
  salt = randomBytes(16).toString('hex'),
) {
  return { hash: (await derive(password, salt)).toString('hex'), salt };
}
export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
) {
  if (!/^[a-f0-9]{128}$/i.test(expectedHash)) return false;
  try {
    return timingSafeEqual(
      await derive(password, salt),
      Buffer.from(expectedHash, 'hex'),
    );
  } catch {
    return false;
  }
}

/** Production keys must be provisioned; development keys expire when the server restarts. */
export function createAuth(
  secret = process.env.AUTH_SECRET,
  production = process.env.NODE_ENV === 'production',
) {
  if (
    (production && !secret) ||
    (secret !== undefined && Buffer.byteLength(secret) < 32)
  )
    throw new Error(
      'AUTH_SECRET must contain at least 32 bytes. Configure a random secret before starting production.',
    );
  const key = secret ?? randomBytes(32).toString('hex');
  return {
    createToken(payload: { id: string; username: string }) {
      const data = Buffer.from(
        JSON.stringify({ ...payload, exp: Date.now() + 30 * 86_400_000 }),
      ).toString('base64url');
      return (
        data + '.' + createHmac('sha256', key).update(data).digest('base64url')
      );
    },
    verifyToken(token: string): { id: string; username: string } | null {
      try {
        if (token.length > 2048) return null;
        const parts = token.split('.');
        if (parts.length !== 2) return null;
        const [data, sig] = parts;
        const expected = createHmac('sha256', key)
          .update(data)
          .digest('base64url');
        if (
          sig.length !== expected.length ||
          !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
        )
          return null;
        const payload = JSON.parse(
          Buffer.from(data, 'base64url').toString('utf8'),
        );
        if (
          !payload ||
          typeof payload.id !== 'string' ||
          !payload.id ||
          typeof payload.username !== 'string' ||
          !payload.username ||
          !Number.isSafeInteger(payload.exp) ||
          payload.exp <= Date.now()
        )
          return null;
        return { id: payload.id, username: payload.username };
      } catch {
        return null;
      }
    },
  };
}
