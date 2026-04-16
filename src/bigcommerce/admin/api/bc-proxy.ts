import type {
  EnrichedCustomersResponse,
  EnrichedOrdersResponse,
  CustomerDetailResponse,
  OrderDetailResponse,
} from '../../../core/types.js';

// Relative to the same Express server that serves this SPA
const PROXY_BASE = '/bigcommerce/api';

async function proxyGet<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${PROXY_BASE}${path}`, {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchCustomersList(
  storeHash: string,
  page: number,
  limit = 25,
): Promise<EnrichedCustomersResponse | null> {
  return proxyGet<EnrichedCustomersResponse>(
    `/customers?storeHash=${encodeURIComponent(storeHash)}&page=${page}&limit=${limit}`,
  );
}

export async function fetchCustomerDetail(
  storeHash: string,
  customerId: number | string,
): Promise<CustomerDetailResponse | null> {
  return proxyGet<CustomerDetailResponse>(
    `/customers/${customerId}?storeHash=${encodeURIComponent(storeHash)}`,
  );
}

export async function fetchOrdersList(
  storeHash: string,
  page: number,
  limit = 25,
): Promise<EnrichedOrdersResponse | null> {
  return proxyGet<EnrichedOrdersResponse>(
    `/orders?storeHash=${encodeURIComponent(storeHash)}&page=${page}&limit=${limit}`,
  );
}

export async function fetchOrderDetail(
  storeHash: string,
  orderId: number | string,
): Promise<OrderDetailResponse | null> {
  return proxyGet<OrderDetailResponse>(
    `/orders/${orderId}?storeHash=${encodeURIComponent(storeHash)}`,
  );
}
