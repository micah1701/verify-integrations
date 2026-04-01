import { dbGet, dbSet } from '../../core/cache.js';
import { bcMetafieldsProxy, buildMetafieldPayload } from '../../core/verify-api.js';
import type { BCRawMetafield, ResolvedMetafield } from '../../core/types.js';
import type { VerificationOutcome } from '../../core/types.js';

const TTL_CART = 5 * 60 * 1000;   // 5 min
const TTL_JWT  = 30 * 60 * 1000;  // 30 min
const TTL_MF   = 5 * 60 * 1000;   // 5 min

// ─── Cart ─────────────────────────────────────────────────────────────────────

export interface CartInfo {
  cartId: string;
  customerId: number;
}

export async function loadCart(): Promise<CartInfo | null> {
  const cached = await dbGet<CartInfo>('adhoc_cart');
  if (cached) return cached;

  try {
    const r = await fetch(
      '/api/storefront/carts?include=lineItems.physicalItems.options,lineItems.digitalItems.options',
    );
    if (!r.ok) return null;
    const data = await r.json() as unknown[];
    if (!Array.isArray(data) || !data[0]) return null;
    const cart = data[0] as { id: string; customerId?: number };
    const result: CartInfo = { cartId: cart.id, customerId: cart.customerId ?? 0 };
    await dbSet('adhoc_cart', result, TTL_CART);
    return result;
  } catch (_) {
    return null;
  }
}

// ─── Customer JWT ─────────────────────────────────────────────────────────────

// bcClientId is the BC app client_id (public — same for every store).
// Injected at build time via the __ADHOC_BC_CLIENT_ID__ Vite define.
export async function loadCustomerJwt(bcClientId: string): Promise<string | null> {
  const cached = await dbGet<string>('adhoc_customer_jwt');
  if (cached) return cached;

  try {
    const r = await fetch(`/customer/current.jwt?app_client_id=${encodeURIComponent(bcClientId)}`);
    if (!r.ok) return null;
    const jwt = await r.text();
    if (!jwt || typeof jwt !== 'string') return null;
    await dbSet('adhoc_customer_jwt', jwt, TTL_JWT);
    return jwt;
  } catch (_) {
    return null;
  }
}

// ─── Metafield loading ────────────────────────────────────────────────────────

interface BCMetafieldsListResponse {
  data: BCRawMetafield[];
}

export async function loadCartMetafields(
  apiBase: string,
  storeHash: string,
  storeAccessToken: string,
  cartId: string,
): Promise<BCRawMetafield[]> {
  const cacheKey = `adhoc_cart_mf_${cartId}`;
  const cached = await dbGet<BCRawMetafield[]>(cacheKey);
  if (cached) return cached;

  const data = await bcMetafieldsProxy<BCMetafieldsListResponse>(apiBase, {
    action: 'read',
    storeHash,
    storeAccessToken,
    resource: 'cart',
    resourceId: cartId,
  });

  const arr = Array.isArray(data?.data) ? data.data : [];
  await dbSet(cacheKey, arr, TTL_MF);
  return arr;
}

export async function loadCustomerMetafields(
  apiBase: string,
  storeHash: string,
  storeAccessToken: string,
  customerId: number,
): Promise<BCRawMetafield[]> {
  if (!customerId || customerId === 0) return [];
  const cacheKey = `adhoc_customer_mf_${customerId}`;
  const cached = await dbGet<BCRawMetafield[]>(cacheKey);
  if (cached) return cached;

  const data = await bcMetafieldsProxy<BCMetafieldsListResponse>(apiBase, {
    action: 'read',
    storeHash,
    storeAccessToken,
    resource: 'customer',
    resourceId: String(customerId),
  });

  const arr = Array.isArray(data?.data) ? data.data : [];
  await dbSet(cacheKey, arr, TTL_MF);
  return arr;
}

// ─── Metafield lookup ─────────────────────────────────────────────────────────

export function findVerificationMetafield(
  metafields: BCRawMetafield[],
): ResolvedMetafield | null {
  for (const mf of metafields) {
    if (mf.namespace === 'Ad-Hoc Verify' && mf.key === 'verification') {
      try {
        return { id: mf.id, value: JSON.parse(mf.value) };
      } catch (_) {
        return null;
      }
    }
  }
  return null;
}

// ─── Metafield saving ─────────────────────────────────────────────────────────

export async function saveCartMetafield(
  apiBase: string,
  storeHash: string,
  storeAccessToken: string,
  cartId: string,
  verificationId: string,
  result: VerificationOutcome | null,
  existingId?: number,
): Promise<boolean> {
  const payload = buildMetafieldPayload(verificationId, result);
  const data = await bcMetafieldsProxy(apiBase, {
    action: 'write',
    storeHash,
    storeAccessToken,
    resource: 'cart',
    resourceId: cartId,
    metafieldId: existingId,
    payload,
  });
  return data !== null;
}

export async function saveCustomerMetafield(
  apiBase: string,
  storeHash: string,
  storeAccessToken: string,
  customerId: number,
  verificationId: string,
  result: VerificationOutcome | null,
  existingId?: number,
): Promise<boolean> {
  if (!customerId || customerId === 0) return false;
  const payload = buildMetafieldPayload(verificationId, result);
  const data = await bcMetafieldsProxy(apiBase, {
    action: 'write',
    storeHash,
    storeAccessToken,
    resource: 'customer',
    resourceId: String(customerId),
    metafieldId: existingId,
    payload,
  });
  return data !== null;
}

// ─── Cache invalidation ───────────────────────────────────────────────────────

export async function invalidateMetafieldCache(
  cartId: string,
  customerId: number,
): Promise<void> {
  const { dbDel } = await import('../../core/cache.js');
  const dels: Promise<void>[] = [dbDel('adhoc_cart'), dbDel(`adhoc_cart_mf_${cartId}`)];
  if (customerId && customerId !== 0) dels.push(dbDel(`adhoc_customer_mf_${customerId}`));
  await Promise.all(dels);
}
