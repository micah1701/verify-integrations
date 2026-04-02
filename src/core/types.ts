// ─── Verification API Types ───────────────────────────────────────────────────

export type FaceMatchScore =
  | 'definite_match'
  | 'likely_match'
  | 'possible_match'
  | 'no_match';

export type VerificationStatus =
  | 'pending'
  | 'started'
  | 'completed'
  | 'manual_review'
  | 'expired';

export type VerificationState = 'verified' | 'invalid' | 'incomplete' | 'unverified';

// ─── Ruleset ──────────────────────────────────────────────────────────────────

export interface Ruleset {
  requireVerification: boolean;
  minFaceMatchScore: FaceMatchScore | null;
  requireOver18: boolean;
  requireOver21: boolean;
}

// ─── Verification Result (from get-verification-result / webhook) ──────────────

export interface VerificationOutcome {
  success: boolean | null;
  over_18: boolean | null;
  over_21: boolean | null;
  face_match_score: FaceMatchScore | null;
}

// ─── BC Metafield Stored Value ────────────────────────────────────────────────

export interface MetafieldValue {
  verificationId: string;
  status: VerificationStatus;
  completedAt: string;
  verification: VerificationOutcome;
}

// A parsed BC metafield record (id + decoded value)
export interface ResolvedMetafield {
  id: number;
  value: MetafieldValue;
}

// ─── State Resolution ─────────────────────────────────────────────────────────

export interface ResolvedState {
  state: VerificationState;
  source: 'customer' | 'cart' | 'none';
  cartMfId: number | null;
  customerMfId: number | null;
}

// ─── Plugin Config (window.AdHocVerifyConfig) ─────────────────────────────────

export interface AdHocVerifyConfig {
  integrationKey: string;
  apiBase: string;
  verifyBase: string;
  storeHash?: string;
  storeAccessToken?: string;
  templateId?: string;
  buttonText: string;
  selector: string;
  pages: string[];
  ruleset: Ruleset;
  onComplete?: (id: string) => void;
  onResult?: (result: VerificationResultCallback) => void;
}

export interface VerificationResultCallback {
  verificationId: string;
  success: boolean | null;
  over_18: boolean | null;
  over_21: boolean | null;
  face_match_score: FaceMatchScore | null;
}

// ─── Admin Config (window.AdHocAdminConfig) ───────────────────────────────────

export interface AdHocAdminConfig {
  apiBase: string;
  storeHash: string;
  storeAccessToken: string;
}

// ─── BC Raw Metafield (from proxy response) ───────────────────────────────────

export interface BCRawMetafield {
  id: number;
  namespace: string;
  key: string;
  value: string;
  permission_set: string;
}
