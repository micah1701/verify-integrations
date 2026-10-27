import type { RequestHandler } from 'express';
import { getToken } from '../core/db';
import { verifySessionToken, type ExtSession } from './bc-jwt';
import {
  bcFetch,
  evaluateVerificationState,
  parseVerifyMetafield,
  type BCCustomer,
  type BCOrder,
  type BCRawMetafield,
} from './proxy';

const BC_API = 'https://api.bigcommerce.com/stores';
const NAMESPACE = 'Ad-Hoc Verify';
export const PRODUCT_FLAG_KEY = 'requires_verification';

type Locals = { ext: ExtSession; accessToken: string };

/**
 * Authenticates /api/ext/:entity/:id calls with the panel session token
 * (Authorization: Bearer ...). The token is bound to one store + one record.
 */
export function extAuth(entity: 'orders' | 'customers' | 'products'): RequestHandler[] {
  return [
    (req, res, next) => {
      const header = req.headers.authorization ?? '';
      const session = header.startsWith('Bearer ') ? verifySessionToken(header.slice(7)) : null;
      if (!session) {
        res.status(401).json({ error: 'Invalid or expired panel session. Reopen the panel from BigCommerce.' });
        return;
      }
      if (session.entity !== entity || String(session.id) !== req.params.id) {
        res.status(403).json({ error: 'Session does not grant access to this record.' });
        return;
      }
      const record = getToken(session.storeHash);
      if (!record) {
        res.status(404).json({ error: 'Store not found or app not installed for this store.' });
        return;
      }
      (res.locals as Locals).ext = session;
      (res.locals as Locals).accessToken = record.access_token;
      next();
    },
  ];
}

async function customerMetafield(storeHash: string, token: string, customerId: number) {
  const r = await bcFetch<{ data: BCRawMetafield[] }>(
    storeHash, token, `/v3/customers/${customerId}/metafields?namespace=Ad-Hoc+Verify`,
  );
  return parseVerifyMetafield(r?.data ?? []);
}

/** GET /bigcommerce/api/ext/customers/:id */
export const extCustomer: RequestHandler = async (_req, res) => {
  const { ext, accessToken } = res.locals as Locals;
  const customers = await bcFetch<{ data: BCCustomer[] }>(
    ext.storeHash, accessToken, `/v3/customers?id%3Ain=${ext.id}`,
  );
  const customer = customers?.data?.[0];
  if (!customer) {
    res.status(404).json({ error: `Customer ${ext.id} not found` });
    return;
  }
  const metafield = await customerMetafield(ext.storeHash, accessToken, ext.id);
  res.json({ customer, metafield, verificationState: evaluateVerificationState(metafield) });
};

/**
 * GET /bigcommerce/api/ext/orders/:id
 * Lookup order: order metafield → cart metafield (where bc-metafields actually writes for
 * orders) → customer metafield. The legacy v2 order-metafields endpoint does not exist.
 */
export const extOrder: RequestHandler = async (_req, res) => {
  const { ext, accessToken } = res.locals as Locals;
  const { storeHash, id } = ext;

  const order = await bcFetch<BCOrder>(storeHash, accessToken, `/v2/orders/${id}`);
  if (!order) {
    res.status(404).json({ error: `Order ${id} not found` });
    return;
  }

  let metafield = null as ReturnType<typeof parseVerifyMetafield>;
  let metafieldSource: 'order' | 'cart' | 'customer' | 'none' = 'none';

  const orderMf = await bcFetch<{ data: BCRawMetafield[] }>(
    storeHash, accessToken, `/v3/orders/${id}/metafields?namespace=Ad-Hoc+Verify`,
  );
  metafield = parseVerifyMetafield(orderMf?.data ?? []);
  if (metafield) metafieldSource = 'order';

  if (!metafield && order.cart_id) {
    const cartMf = await bcFetch<{ data: BCRawMetafield[] }>(
      storeHash, accessToken, `/v3/carts/${order.cart_id}/metafields?namespace=Ad-Hoc+Verify`,
    );
    metafield = parseVerifyMetafield(cartMf?.data ?? []);
    if (metafield) metafieldSource = 'cart';
  }

  let linkedCustomer: BCCustomer | null = null;
  if (order.customer_id > 0) {
    const [customers, customerMf] = await Promise.all([
      bcFetch<{ data: BCCustomer[] }>(storeHash, accessToken, `/v3/customers?id%3Ain=${order.customer_id}`),
      metafield ? Promise.resolve(null) : customerMetafield(storeHash, accessToken, order.customer_id),
    ]);
    linkedCustomer = customers?.data?.[0] ?? null;
    if (!metafield && customerMf) {
      metafield = customerMf;
      metafieldSource = 'customer';
    }
  }

  res.json({
    order,
    metafield,
    verificationState: evaluateVerificationState(metafield),
    metafieldSource,
    linkedCustomer,
  });
};

// ─── Products: per-product "requires verification" flag (product metafield) ────

async function readProductFlag(
  storeHash: string, token: string, productId: number,
): Promise<{ metafieldId: number | null; required: boolean } | null> {
  const r = await bcFetch<{ data: BCRawMetafield[] }>(
    storeHash, token,
    `/v3/catalog/products/${productId}/metafields?namespace=Ad-Hoc+Verify&key=${PRODUCT_FLAG_KEY}`,
  );
  if (!r) return null;
  const mf = r.data.find((m) => m.namespace === NAMESPACE && m.key === PRODUCT_FLAG_KEY);
  return { metafieldId: mf?.id ?? null, required: mf?.value === 'true' };
}

/** GET /bigcommerce/api/ext/products/:id */
export const extProduct: RequestHandler = async (_req, res) => {
  const { ext, accessToken } = res.locals as Locals;
  const [product, flag] = await Promise.all([
    bcFetch<{ data: { id: number; name: string; sku?: string } }>(
      ext.storeHash, accessToken, `/v3/catalog/products/${ext.id}?include_fields=id,name,sku`,
    ),
    readProductFlag(ext.storeHash, accessToken, ext.id),
  ]);
  if (!product) {
    res.status(404).json({ error: `Product ${ext.id} not found` });
    return;
  }
  if (!flag) {
    // Most likely the app lacks the Products scope (merchant must re-authorize).
    res.status(502).json({ error: 'Could not read product metafields. The app may need the Products scope.' });
    return;
  }
  res.json({ product: product.data, requiresVerification: flag.required });
};

/** PUT /bigcommerce/api/ext/products/:id   body: { requiresVerification: boolean } */
export const extProductSetFlag: RequestHandler = async (req, res) => {
  const { ext, accessToken } = res.locals as Locals;
  const required = req.body?.requiresVerification;
  if (typeof required !== 'boolean') {
    res.status(400).json({ error: 'requiresVerification (boolean) is required' });
    return;
  }

  const flag = await readProductFlag(ext.storeHash, accessToken, ext.id);
  if (!flag) {
    res.status(502).json({ error: 'Could not read product metafields. The app may need the Products scope.' });
    return;
  }

  const base = `${BC_API}/${ext.storeHash}/v3/catalog/products/${ext.id}/metafields`;
  const body = JSON.stringify({
    namespace: NAMESPACE,
    key: PRODUCT_FLAG_KEY,
    value: String(required),
    permission_set: 'write_and_sf_access', // storefront script must be able to read it
    description: 'Ad-Hoc Verify: require ID verification when this product is in the cart',
  });
  try {
    const r = await fetch(flag.metafieldId ? `${base}/${flag.metafieldId}` : base, {
      method: flag.metafieldId ? 'PUT' : 'POST',
      headers: { 'X-Auth-Token': accessToken, 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    });
    if (!r.ok) {
      console.error(`[ext-api] product flag write failed ${r.status}:`, await r.text());
      res.status(502).json({ error: 'BigCommerce rejected the update.' });
      return;
    }
  } catch (err) {
    console.error('[ext-api] product flag write error:', err);
    res.status(502).json({ error: 'Could not reach BigCommerce.' });
    return;
  }
  res.json({ requiresVerification: required });
};
