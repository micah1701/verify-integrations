import { dbGet, dbSet } from '../../core/cache.js';
import { bcMetafieldsProxy, buildMetafieldPayload } from '../../core/verify-api.js';
import type { BCRawMetafield, ResolvedMetafield, VerificationOutcome, VerificationStatus } from '../../core/types.js';
import { log } from './logger.js';

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
  if (cached) {
    log('loadCart: cache hit.', cached);
    return cached;
  }

  log('loadCart: cache miss — fetching from BC Storefront API.');
  try {
    const r = await fetch(
      '/api/storefront/carts?include=lineItems.physicalItems.options,lineItems.digitalItems.options',
    );
    if (!r.ok) {
      log(`loadCart: fetch failed (HTTP ${r.status}) — returning null.`);
      return null;
    }
    const data = await r.json() as unknown[];
    if (!Array.isArray(data) || !data[0]) {
      log('loadCart: no active cart found (empty response) — returning null.');
      return null;
    }
    const cart = data[0] as { id: string; customerId?: number };
    const result: CartInfo = { cartId: cart.id, customerId: cart.customerId ?? 0 };
    log(`loadCart: cartId="${result.cartId}", customerId=${result.customerId}, loggedIn=${result.customerId !== 0}`);
    await dbSet('adhoc_cart', result, TTL_CART);
    return result;
  } catch (err) {
    log('loadCart: fetch threw an error — returning null.', (err as Error).message);
    return null;
  }
}

// ─── Customer JWT ─────────────────────────────────────────────────────────────

// bcClientId is the BC app client_id (public — same for every store).
// Injected at build time via the __ADHOC_BC_CLIENT_ID__ Vite define.
export async function loadCustomerJwt(bcClientId: string): Promise<string | null> {
  const cached = await dbGet<string>('adhoc_customer_jwt');
  if (cached) {
    log('loadCustomerJwt: cache hit.');
    return cached;
  }

  log('loadCustomerJwt: cache miss — fetching JWT from BC.');
  try {
    const r = await fetch(`/customer/current.jwt?app_client_id=${encodeURIComponent(bcClientId)}`);
    if (!r.ok) {
      log(`loadCustomerJwt: fetch failed (HTTP ${r.status}) — customer likely not logged in.`);
      return null;
    }
    const jwt = await r.text();
    if (!jwt || typeof jwt !== 'string') {
      log('loadCustomerJwt: empty or invalid JWT response — returning null.');
      return null;
    }
    log('loadCustomerJwt: JWT retrieved and cached.');
    await dbSet('adhoc_customer_jwt', jwt, TTL_JWT);
    return jwt;
  } catch (err) {
    log('loadCustomerJwt: fetch threw an error — returning null.', (err as Error).message);
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
  if (cached) {
    log(`loadCartMetafields: cache hit for cartId="${cartId}" (${cached.length} record(s)).`);
    return cached;
  }

  log(`loadCartMetafields: cache miss — fetching from proxy for cartId="${cartId}".`);
  const data = await bcMetafieldsProxy<BCMetafieldsListResponse>(apiBase, {
    action: 'read',
    storeHash,
    storeAccessToken,
    resource: 'cart',
    resourceId: cartId,
  });

  const arr = Array.isArray(data?.data) ? data.data : [];
  log(`loadCartMetafields: received ${arr.length} metafield(s) for cartId="${cartId}".`, arr);
  await dbSet(cacheKey, arr, TTL_MF);
  return arr;
}

export async function loadCustomerMetafields(
  apiBase: string,
  storeHash: string,
  storeAccessToken: string,
  customerId: number,
): Promise<BCRawMetafield[]> {
  if (!customerId || customerId === 0) {
    log('loadCustomerMetafields: customerId is 0 (guest) — skipping fetch.');
    return [];
  }
  const cacheKey = `adhoc_customer_mf_${customerId}`;
  const cached = await dbGet<BCRawMetafield[]>(cacheKey);
  if (cached) {
    log(`loadCustomerMetafields: cache hit for customerId=${customerId} (${cached.length} record(s)).`);
    return cached;
  }

  log(`loadCustomerMetafields: cache miss — fetching from proxy for customerId=${customerId}.`);
  const data = await bcMetafieldsProxy<BCMetafieldsListResponse>(apiBase, {
    action: 'read',
    storeHash,
    storeAccessToken,
    resource: 'customer',
    resourceId: String(customerId),
  });

  const arr = Array.isArray(data?.data) ? data.data : [];
  log(`loadCustomerMetafields: received ${arr.length} metafield(s) for customerId=${customerId}.`, arr);
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
        const parsed = JSON.parse(mf.value);
        log(`findVerificationMetafield: found verification metafield (id=${mf.id}).`, parsed);
        return { id: mf.id, value: parsed };
      } catch (_) {
        log('findVerificationMetafield: found metafield but failed to parse value — returning null.');
        return null;
      }
    }
  }
  log('findVerificationMetafield: no verification metafield found in the provided list.');
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
  status: VerificationStatus = 'completed',
): Promise<boolean> {
  log(`saveCartMetafield: cartId="${cartId}", verificationId="${verificationId}", status="${status}", ${existingId !== undefined ? `updating id=${existingId}` : 'creating new'}.`);
  const payload = buildMetafieldPayload(verificationId, result, status);
  const data = await bcMetafieldsProxy(apiBase, {
    action: 'write',
    storeHash,
    storeAccessToken,
    resource: 'cart',
    resourceId: cartId,
    metafieldId: existingId,
    payload,
  });
  const ok = data !== null;
  log(`saveCartMetafield: ${ok ? 'success' : 'FAILED — proxy returned null'}.`);
  return ok;
}

export async function saveCustomerMetafield(
  apiBase: string,
  storeHash: string,
  storeAccessToken: string,
  customerId: number,
  verificationId: string,
  result: VerificationOutcome | null,
  existingId?: number,
  status: VerificationStatus = 'completed',
): Promise<boolean> {
  if (!customerId || customerId === 0) {
    log('saveCustomerMetafield: customerId is 0 (guest) — skipping.');
    return false;
  }
  log(`saveCustomerMetafield: customerId=${customerId}, verificationId="${verificationId}", status="${status}", ${existingId !== undefined ? `updating id=${existingId}` : 'creating new'}.`);
  const payload = buildMetafieldPayload(verificationId, result, status);
  const data = await bcMetafieldsProxy(apiBase, {
    action: 'write',
    storeHash,
    storeAccessToken,
    resource: 'customer',
    resourceId: String(customerId),
    metafieldId: existingId,
    payload,
  });
  const ok = data !== null;
  log(`saveCustomerMetafield: ${ok ? 'success' : 'FAILED — proxy returned null'}.`);
  return ok;
}

export async function saveOrderMetafield(
  apiBase: string,
  storeHash: string,
  storeAccessToken: string,
  orderId: string,
  verificationId: string,
  result: VerificationOutcome | null,
  status: VerificationStatus = 'completed',
): Promise<boolean> {
  if (!orderId) {
    log('saveOrderMetafield: no orderId — skipping.');
    return false;
  }
  log(`saveOrderMetafield: orderId="${orderId}", verificationId="${verificationId}", status="${status}".`);
  const payload = buildMetafieldPayload(verificationId, result, status);
  const data = await bcMetafieldsProxy(apiBase, {
    action: 'write',
    storeHash,
    storeAccessToken,
    resource: 'order',
    resourceId: orderId,
    payload,
  });
  const ok = data !== null;
  log(`saveOrderMetafield: ${ok ? 'success' : 'FAILED — proxy returned null'}.`);
  return ok;
}

// ─── Cache invalidation ───────────────────────────────────────────────────────

export async function invalidateMetafieldCache(
  cartId: string,
  customerId: number,
): Promise<void> {
  log(`invalidateMetafieldCache: clearing cart cache (cartId="${cartId}")${customerId !== 0 ? ` and customer cache (customerId=${customerId})` : ''}.`);
  const { dbDel } = await import('../../core/cache.js');
  const dels: Promise<void>[] = [dbDel('adhoc_cart'), dbDel(`adhoc_cart_mf_${cartId}`)];
  if (customerId && customerId !== 0) dels.push(dbDel(`adhoc_customer_mf_${customerId}`));
  await Promise.all(dels);
  log('invalidateMetafieldCache: done.');
}
