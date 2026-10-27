import type {
  AdHocExtensionConfig,
  CustomerDetailResponse,
  ExtOrderResponse,
  ExtProductResponse,
} from '../../../core/types.js';

const BASE = '/bigcommerce/api/ext';

export type ExtResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(
  cfg: AdHocExtensionConfig,
  method: 'GET' | 'PUT',
  body?: unknown,
): Promise<ExtResult<T>> {
  try {
    const r = await fetch(`${BASE}/${cfg.entity}/${cfg.id}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${cfg.sessionToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, error: json?.error ?? `Request failed (${r.status})` };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: 'Could not reach the server.' };
  }
}

export const fetchExtCustomer = (cfg: AdHocExtensionConfig) => call<CustomerDetailResponse>(cfg, 'GET');
export const fetchExtOrder = (cfg: AdHocExtensionConfig) => call<ExtOrderResponse>(cfg, 'GET');
export const fetchExtProduct = (cfg: AdHocExtensionConfig) => call<ExtProductResponse>(cfg, 'GET');
export const setExtProductFlag = (cfg: AdHocExtensionConfig, requiresVerification: boolean) =>
  call<{ requiresVerification: boolean }>(cfg, 'PUT', { requiresVerification });
