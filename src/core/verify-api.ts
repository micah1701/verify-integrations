import type { MetafieldValue, VerificationOutcome } from './types.js';

// ─── Generic fetch helper ─────────────────────────────────────────────────────

async function safeFetch<T>(url: string, options?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(url, options ?? {});
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) return (await r.json()) as T;
    return (await r.text()) as unknown as T;
  } catch (_) {
    return null;
  }
}

// ─── Verification creation ────────────────────────────────────────────────────

export interface CreateVerificationBody {
  template_id?: string;
  webhook_url?: string;
  requested_fields?: string[];
}

export interface CreateVerificationResponse {
  id: string;
  url: string;
  created_at: string;
}

export async function createVerification(
  apiBase: string,
  integrationKey: string,
  body: CreateVerificationBody,
): Promise<CreateVerificationResponse> {
  const r = await fetch(`${apiBase}/create-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': integrationKey },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `Request failed (${r.status})`);
  }
  return r.json() as Promise<CreateVerificationResponse>;
}

// ─── Poll for result (public endpoint — no auth, safe outcome fields only) ────

export interface VerificationResultResponse {
  status: string;
  result: VerificationOutcome | null;
  completed_at?: string;
}

export async function getVerificationResult(
  apiBase: string,
  id: string,
): Promise<VerificationResultResponse | null> {
  return safeFetch<VerificationResultResponse>(
    `${apiBase}/get-verification-result?id=${encodeURIComponent(id)}`,
  );
}

// ─── BC Metafields proxy ──────────────────────────────────────────────────────

export type BCMetafieldsAction = 'read' | 'write';
export type BCMetafieldsResource = 'cart' | 'customer' | 'order';

export interface BCMetafieldsProxyBody {
  action: BCMetafieldsAction;
  storeHash: string;
  storeAccessToken: string;
  resource: BCMetafieldsResource;
  resourceId: string;
  metafieldId?: number;
  payload?: object;
}

export async function bcMetafieldsProxy<T>(
  apiBase: string,
  body: BCMetafieldsProxyBody,
): Promise<T | null> {
  return safeFetch<T>(`${apiBase}/bc-metafields`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Metafield payload builder ────────────────────────────────────────────────

export function buildMetafieldPayload(
  verificationId: string,
  result: VerificationOutcome | null,
): object {
  const value: MetafieldValue = {
    verificationId,
    status: 'completed',
    completedAt: new Date().toISOString(),
    verification: {
      success: result?.success ?? null,
      over_18: result?.over_18 ?? null,
      over_21: result?.over_21 ?? null,
      face_match_score: result?.face_match_score ?? null,
    },
  };
  return {
    namespace: 'Ad-Hoc Verify',
    key: 'verification',
    // app_only keeps verification data private — only readable by this app's credentials.
    permission_set: 'app_only',
    value: JSON.stringify(value),
  };
}
