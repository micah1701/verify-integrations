import jwt from 'jsonwebtoken';

export interface BCSignedClaims {
  sub: string; // "stores/HASH"
  iss: string;
  aud?: string;
  iat: number;
  exp: number;
  user: { id: number; email: string };
  url?: string; // resolved extension path, e.g. "/bigcommerce/ext/orders/106"
}

/** Verifies a BC `signed_payload_jwt` (HS256, app client secret). Throws on any failure. */
export function verifyBcJwt(token: string): BCSignedClaims {
  const clientSecret = process.env.BC_CLIENT_SECRET;
  if (!clientSecret) throw new Error('BC_CLIENT_SECRET env var is not set');
  return jwt.verify(token, clientSecret, { algorithms: ['HS256'] }) as BCSignedClaims;
}

export function storeHashFromClaims(claims: BCSignedClaims): string | undefined {
  return claims.sub.split('/')[1];
}

// ── Extension panel session tokens ────────────────────────────────────────────
// Short-lived tokens minted after a verified BC JWT so panel API calls are bound
// to a store without relying on the unauthenticated ?storeHash= pattern.

const SESSION_AUDIENCE = 'adhoc-verify-ext';
const SESSION_TTL_SECONDS = 15 * 60;

function sessionKey(): string {
  const secret = process.env.BC_CLIENT_SECRET;
  if (!secret) throw new Error('BC_CLIENT_SECRET env var is not set');
  return `${secret}:ext-session`;
}

export function mintSessionToken(storeHash: string): string {
  return jwt.sign({ storeHash }, sessionKey(), {
    algorithm: 'HS256',
    audience: SESSION_AUDIENCE,
    expiresIn: SESSION_TTL_SECONDS,
  });
}

/** Returns the store hash bound to the session token, or null if invalid/expired. */
export function verifySessionToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, sessionKey(), {
      algorithms: ['HS256'],
      audience: SESSION_AUDIENCE,
    }) as { storeHash?: string };
    return payload.storeHash ?? null;
  } catch {
    return null;
  }
}
