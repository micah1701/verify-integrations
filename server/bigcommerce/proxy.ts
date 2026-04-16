import type { RequestHandler } from 'express';
import { getToken } from '../core/db';

// ─── Local type aliases (mirroring src/core/types.ts — server tsconfig cannot import from src/) ──

type FaceMatchScore = 'definite_match' | 'likely_match' | 'possible_match' | 'no_match';
type VerificationStatus = 'pending' | 'started' | 'completed' | 'manual_review' | 'expired';
type VerificationState = 'verified' | 'invalid' | 'incomplete' | 'unverified' | 'pending_review';

interface VerificationOutcome {
  success: boolean | null;
  over_18: boolean | null;
  over_21: boolean | null;
  face_match_score: FaceMatchScore | null;
}

interface MetafieldValue {
  verificationId: string;
  status: VerificationStatus;
  completedAt: string;
  verification: VerificationOutcome;
}

interface BCRawMetafield {
  id: number;
  namespace: string;
  key: string;
  value: string;
  permission_set: string;
}

interface BCCustomer {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  date_created: string;
  date_modified: string;
  company: string;
  phone: string;
  address_count: number;
  order_count: number;
  customer_group_id: number;
}

interface BCOrder {
  id: number;
  customer_id: number;
  billing_address: {
    first_name: string;
    last_name: string;
    email: string;
    company: string;
  };
  status: string;
  status_id: number;
  total_inc_tax: string;
  currency_code: string;
  date_created: string;
  date_modified: string;
  items_total: number;
}

// ─── BC API Base ───────────────────────────────────────────────────────────────

const BC_API = 'https://api.bigcommerce.com/stores';

// ─── Auth Guard ────────────────────────────────────────────────────────────────

function resolveToken(
  storeHash: unknown,
): { accessToken: string } | { error: string; status: number } {
  if (typeof storeHash !== 'string' || !storeHash.trim()) {
    return { error: 'storeHash query parameter is required', status: 400 };
  }
  const record = getToken(storeHash.trim());
  if (!record) {
    return { error: 'Store not found or app not installed for this store', status: 404 };
  }
  return { accessToken: record.access_token };
}

// ─── BC Fetch Helper ───────────────────────────────────────────────────────────

async function bcFetch<T>(
  storeHash: string,
  accessToken: string,
  path: string,
): Promise<T | null> {
  try {
    const url = `${BC_API}/${storeHash}${path}`;
    const r = await fetch(url, {
      headers: {
        'X-Auth-Token': accessToken,
        Accept: 'application/json',
      },
    });
    if (!r.ok) {
      console.warn(`[bc-proxy] BC API ${r.status} for ${path}`);
      return null;
    }
    // v2 /orders returns an empty body (not JSON) when there are no orders
    const text = await r.text();
    if (!text.trim()) return null;
    return JSON.parse(text) as T;
  } catch (err) {
    console.error('[bc-proxy] fetch error:', err);
    return null;
  }
}

// ─── Metafield Parsing ─────────────────────────────────────────────────────────

function parseVerifyMetafield(raw: BCRawMetafield[]): MetafieldValue | null {
  const mf = raw.find(
    (m) => m.namespace === 'Ad-Hoc Verify' && m.key === 'verification',
  );
  if (!mf) return null;
  try {
    return JSON.parse(mf.value) as MetafieldValue;
  } catch {
    return null;
  }
}

// ─── evaluateVerificationState ────────────────────────────────────────────────
// Duplicated from src/core/verification-state.ts — keep in sync.

const SCORE_ORDER: FaceMatchScore[] = [
  'definite_match',
  'likely_match',
  'possible_match',
  'no_match',
];

const DEFAULT_RULESET = {
  requireVerification: false,
  minFaceMatchScore: null as FaceMatchScore | null,
  requireOver18: false,
  requireOver21: false,
};

function evaluateVerificationState(
  mfValue: MetafieldValue | null | undefined,
): VerificationState {
  if (!mfValue) return 'unverified';
  if (mfValue.status === 'manual_review') return 'pending_review';
  if (mfValue.status !== 'completed') return 'incomplete';

  const v = mfValue.verification;

  if (DEFAULT_RULESET.requireOver18 && !v.over_18) return 'invalid';
  if (DEFAULT_RULESET.requireOver21 && !v.over_21) return 'invalid';

  if (DEFAULT_RULESET.minFaceMatchScore) {
    const minIdx = SCORE_ORDER.indexOf(DEFAULT_RULESET.minFaceMatchScore);
    const actualIdx = SCORE_ORDER.indexOf(v.face_match_score as FaceMatchScore);
    if (actualIdx < 0 || actualIdx > minIdx) return 'invalid';
  }

  return 'verified';
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/** GET /bigcommerce/api/customers?storeHash=&page=&limit= */
export const handleCustomersList: RequestHandler = async (req, res) => {
  const tokenResult = resolveToken(req.query.storeHash);
  if ('error' in tokenResult) {
    res.status(tokenResult.status).json({ error: tokenResult.error });
    return;
  }
  const { accessToken } = tokenResult;
  const storeHash = (req.query.storeHash as string).trim();
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 25));

  interface BCCustomersResponse {
    data: BCCustomer[];
    meta: {
      pagination: {
        total: number;
        count: number;
        per_page: number;
        current_page: number;
        total_pages: number;
      };
    };
  }

  const customersData = await bcFetch<BCCustomersResponse>(
    storeHash,
    accessToken,
    `/v3/customers?limit=${limit}&page=${page}&sort=date_created%3Adesc`,
  );

  if (!customersData) {
    res.status(502).json({ error: 'Failed to fetch customers from BigCommerce' });
    return;
  }

  // Fan out: fetch metafields for each customer in parallel
  const metafieldResults = await Promise.all(
    customersData.data.map((customer) =>
      bcFetch<{ data: BCRawMetafield[] }>(
        storeHash,
        accessToken,
        `/v3/customers/${customer.id}/metafields?namespace=Ad-Hoc+Verify`,
      ).then((r) => r?.data ?? []),
    ),
  );

  const enriched = customersData.data.map((customer, i) => ({
    customer,
    metafield: parseVerifyMetafield(metafieldResults[i]),
    verificationState: evaluateVerificationState(parseVerifyMetafield(metafieldResults[i])),
  }));

  res.json({ data: enriched, meta: customersData.meta });
};

/** GET /bigcommerce/api/customers/:id?storeHash= */
export const handleCustomerDetail: RequestHandler = async (req, res) => {
  const tokenResult = resolveToken(req.query.storeHash);
  if ('error' in tokenResult) {
    res.status(tokenResult.status).json({ error: tokenResult.error });
    return;
  }
  const { accessToken } = tokenResult;
  const storeHash = (req.query.storeHash as string).trim();
  const customerId = parseInt(req.params.id, 10);

  if (!customerId) {
    res.status(400).json({ error: 'Invalid customer ID' });
    return;
  }

  interface BCCustomersResponse {
    data: BCCustomer[];
  }

  const [customersData, metafieldsData] = await Promise.all([
    bcFetch<BCCustomersResponse>(
      storeHash,
      accessToken,
      `/v3/customers?id%3Ain=${customerId}`,
    ),
    bcFetch<{ data: BCRawMetafield[] }>(
      storeHash,
      accessToken,
      `/v3/customers/${customerId}/metafields?namespace=Ad-Hoc+Verify`,
    ),
  ]);

  const customer = customersData?.data?.[0];
  if (!customer) {
    res.status(404).json({ error: `Customer ${customerId} not found` });
    return;
  }

  const metafield = parseVerifyMetafield(metafieldsData?.data ?? []);

  res.json({
    customer,
    metafield,
    verificationState: evaluateVerificationState(metafield),
  });
};

/** GET /bigcommerce/api/orders?storeHash=&page=&limit= */
export const handleOrdersList: RequestHandler = async (req, res) => {
  const tokenResult = resolveToken(req.query.storeHash);
  if ('error' in tokenResult) {
    res.status(tokenResult.status).json({ error: tokenResult.error });
    return;
  }
  const { accessToken } = tokenResult;
  const storeHash = (req.query.storeHash as string).trim();
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 25));

  // BC v2 orders returns a plain array; fetch count separately for pagination
  const [ordersRaw, countData] = await Promise.all([
    bcFetch<BCOrder[]>(
      storeHash,
      accessToken,
      `/v2/orders?limit=${limit}&page=${page}&sort=date_created&direction=desc`,
    ),
    bcFetch<{ count: number }>(storeHash, accessToken, '/v2/orders/count'),
  ]);

  if (!ordersRaw) {
    res.status(502).json({ error: 'Failed to fetch orders from BigCommerce' });
    return;
  }

  const orders = ordersRaw; // may be empty array
  const total = countData?.count ?? 0;
  const total_pages = limit > 0 ? Math.ceil(total / limit) : 1;

  // First wave: fetch order-level metafields for all orders in parallel
  const orderMetafieldResults = await Promise.all(
    orders.map((order) =>
      bcFetch<BCRawMetafield[]>(
        storeHash,
        accessToken,
        `/v2/orders/${order.id}/metafields`,
      ).then((r) => r ?? []),
    ),
  );

  // Second wave: for orders with no metafield that have a linked customer, try customer metafields
  const needsCustomerFallback = orders
    .map((order, i) => ({
      order,
      i,
      orderMf: parseVerifyMetafield(orderMetafieldResults[i]),
    }))
    .filter(({ orderMf, order }) => !orderMf && order.customer_id > 0);

  // Deduplicate customer IDs to avoid redundant fetches
  const uniqueCustomerIds = [...new Set(needsCustomerFallback.map((x) => x.order.customer_id))];
  const customerMetafieldMap = new Map<number, MetafieldValue | null>();

  await Promise.all(
    uniqueCustomerIds.map(async (customerId) => {
      const r = await bcFetch<{ data: BCRawMetafield[] }>(
        storeHash,
        accessToken,
        `/v3/customers/${customerId}/metafields?namespace=Ad-Hoc+Verify`,
      );
      customerMetafieldMap.set(customerId, parseVerifyMetafield(r?.data ?? []));
    }),
  );

  const enriched = orders.map((order, i) => {
    const orderMf = parseVerifyMetafield(orderMetafieldResults[i]);
    let metafield: MetafieldValue | null = orderMf;
    let metafieldSource: 'order' | 'customer' | 'none' = 'none';

    if (orderMf) {
      metafieldSource = 'order';
    } else if (order.customer_id > 0) {
      const customerMf = customerMetafieldMap.get(order.customer_id) ?? null;
      if (customerMf) {
        metafield = customerMf;
        metafieldSource = 'customer';
      }
    }

    return {
      order,
      metafield,
      verificationState: evaluateVerificationState(metafield),
      metafieldSource,
    };
  });

  res.json({
    data: enriched,
    meta: {
      pagination: {
        total,
        count: orders.length,
        per_page: limit,
        current_page: page,
        total_pages,
      },
    },
  });
};

/** GET /bigcommerce/api/orders/:id?storeHash= */
export const handleOrderDetail: RequestHandler = async (req, res) => {
  const tokenResult = resolveToken(req.query.storeHash);
  if ('error' in tokenResult) {
    res.status(tokenResult.status).json({ error: tokenResult.error });
    return;
  }
  const { accessToken } = tokenResult;
  const storeHash = (req.query.storeHash as string).trim();
  const orderId = parseInt(req.params.id, 10);

  if (!orderId) {
    res.status(400).json({ error: 'Invalid order ID' });
    return;
  }

  const [order, orderMetafieldsRaw] = await Promise.all([
    bcFetch<BCOrder>(storeHash, accessToken, `/v2/orders/${orderId}`),
    bcFetch<BCRawMetafield[]>(storeHash, accessToken, `/v2/orders/${orderId}/metafields`),
  ]);

  if (!order) {
    res.status(404).json({ error: `Order ${orderId} not found` });
    return;
  }

  let metafield = parseVerifyMetafield(orderMetafieldsRaw ?? []);
  let metafieldSource: 'order' | 'customer' | 'none' = metafield ? 'order' : 'none';
  let linkedCustomer: BCCustomer | null = null;

  if (order.customer_id > 0) {
    interface BCCustomersResponse {
      data: BCCustomer[];
    }

    if (!metafield) {
      // Need customer metafields as fallback + customer details
      const [customerMfData, customerData] = await Promise.all([
        bcFetch<{ data: BCRawMetafield[] }>(
          storeHash,
          accessToken,
          `/v3/customers/${order.customer_id}/metafields?namespace=Ad-Hoc+Verify`,
        ),
        bcFetch<BCCustomersResponse>(
          storeHash,
          accessToken,
          `/v3/customers?id%3Ain=${order.customer_id}`,
        ),
      ]);
      const customerMf = parseVerifyMetafield(customerMfData?.data ?? []);
      if (customerMf) {
        metafield = customerMf;
        metafieldSource = 'customer';
      }
      linkedCustomer = customerData?.data?.[0] ?? null;
    } else {
      // Order metafield found — still fetch customer details for display
      const customerData = await bcFetch<BCCustomersResponse>(
        storeHash,
        accessToken,
        `/v3/customers?id%3Ain=${order.customer_id}`,
      );
      linkedCustomer = customerData?.data?.[0] ?? null;
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
