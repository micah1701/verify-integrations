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

export interface ExtSession {
  storeHash: string;
  entity: string; // 'orders' | 'customers' | 'products'
  id: number;
}

/** Token is bound to one store AND one record, so it can't be used to browse other records. */
export function mintSessionToken(session: ExtSession): string {
  return jwt.sign(session, sessionKey(), {
    algorithm: 'HS256',
    audience: SESSION_AUDIENCE,
    expiresIn: SESSION_TTL_SECONDS,
  });
}

/** Returns the session bound to the token, or null if invalid/expired. */
export function verifySessionToken(token: string): ExtSession | null {
  try {
    const p = jwt.verify(token, sessionKey(), {
      algorithms: ['HS256'],
      audience: SESSION_AUDIENCE,
    }) as Partial<ExtSession>;
    if (!p.storeHash || !p.entity || typeof p.id !== 'number') return null;
    return { storeHash: p.storeHash, entity: p.entity, id: p.id };
  } catch {
    return null;
  }
}
