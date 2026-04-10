import type { IntegrationConfig, MetafieldValue, VerificationOutcome, VerificationStatus } from './types.js';

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

// ─── Template integration_config ─────────────────────────────────────────────

export type TemplateConfigResult =
  | { ok: true; data: IntegrationConfig }
  | { ok: false; status: number; error: string };

export async function getTemplateIntegrationConfig(
  apiBase: string,
  integrationKey: string,
  templateId: string,
): Promise<TemplateConfigResult | null> {
  try {
    const r = await fetch(
      `${apiBase}/get-template-config?template_id=${encodeURIComponent(templateId)}`,
      { headers: { 'X-API-Key': integrationKey } },
    );
    if (r.ok) {
      const raw = (await r.json()) as IntegrationConfig & { integration_config?: IntegrationConfig };
      const data = raw.integration_config ?? raw;
      return { ok: true, data };
    }
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, status: r.status, error: body.error ?? `Request failed (${r.status})` };
  } catch (_) {
    return null;
  }
}

export interface AdhocAuthResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function loginToAdhocApi(
  apiBase: string,
  email: string,
  password: string,
): Promise<AdhocAuthResponse | null> {
  return safeFetch<AdhocAuthResponse>(`${apiBase}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

export async function refreshAdhocToken(
  apiBase: string,
  refreshToken: string,
): Promise<AdhocAuthResponse | null> {
  return safeFetch<AdhocAuthResponse>(`${apiBase}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

export async function updateTemplateIntegrationConfig(
  apiBase: string,
  bearerToken: string,
  templateId: string,
  config: IntegrationConfig,
): Promise<boolean> {
  try {
    const r = await fetch(`${apiBase}/api/templates/${encodeURIComponent(templateId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({ integration_config: config }),
    });
    if (r.status === 401) throw new Error('unauthorized');
    return r.ok;
  } catch (e) {
    if (e instanceof Error && e.message === 'unauthorized') throw e;
    return false;
  }
}

// ─── Metafield payload builder ────────────────────────────────────────────────

export function buildMetafieldPayload(
  verificationId: string,
  result: VerificationOutcome | null,
  status: VerificationStatus = 'completed',
): object {
  const value: MetafieldValue = {
    verificationId,
    status,
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
    // write_and_sf_access allows any Management API credentials to read (both the storefront's
    // V2 API key and the admin's OAuth token). app_only would bind the metafield to the specific
    // credential type that wrote it, making it invisible to the OAuth app token.
    permission_set: 'write_and_sf_access',
    value: JSON.stringify(value),
  };
}
