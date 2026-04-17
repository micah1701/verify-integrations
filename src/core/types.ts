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

export type VerificationState = 'verified' | 'invalid' | 'incomplete' | 'unverified' | 'pending_review';

// ─── Ruleset ──────────────────────────────────────────────────────────────────

export interface Ruleset {
  requireVerification: boolean;
  minFaceMatchScore: FaceMatchScore | null;
  requireOver18: boolean;
  requireOver21: boolean;
}

// ─── Trigger Rule (when to show the Verify ID widget) ─────────────────────────

/** Controls which carts trigger the Verify ID widget. */
export type VerifyTriggerMode =
  | 'always'            // Show on every transaction (default)
  | 'exclude_products'  // Show unless the cart contains one of the specified product IDs
  | 'only_products';    // Only show if the cart contains at least one specified product ID

export interface VerifyTriggerRule {
  mode: VerifyTriggerMode;
  /** Product IDs to exclude or require, depending on mode. Unused when mode is 'always'. */
  productIds?: number[];
}

// ─── Checkout Enforcement (what happens at checkout when not verified) ─────────

/** Controls checkout behaviour when the customer has not completed verification. */
export type CheckoutEnforcementMode =
  | 'block'  // Disable the checkout button until verification is complete
  | 'warn'   // Allow checkout but show a customisable warning message
  | 'none';  // Take no action (widget is informational only)

export interface CheckoutEnforcement {
  mode: CheckoutEnforcementMode;
  /** Message shown when mode is 'warn'. Falsy = use the built-in default. */
  warningMessage?: string | null;
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

export interface ManualReviewConfig {
  /** Block checkout while verification is pending review. Default: false (allow checkout). */
  blockCheckout: boolean;
  /**
   * Message shown to the customer when their verification is pending manual review.
   * Set to null, false, or '' to suppress the message entirely.
   * Default: "Your verification is pending a manual review. You may continue to place your
   * order, but there may be a delay in processing while we confirm your verification."
   */
  message: string | null | false;
}

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
  manualReview?: Partial<ManualReviewConfig>;
  triggerRule?: VerifyTriggerRule;
  checkoutEnforcement?: CheckoutEnforcement;
  /** Set to true to enable verbose debug logging to the browser console. */
  logging?: boolean;
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

// ─── Integration Config (stored in verification_templates.integration_config) ──

export interface IntegrationConfig {
  storeHash?: string;
  storeAccessToken?: string;
  pages?: Array<'cart' | 'checkout' | 'order-confirmation'>;
  ruleset?: Ruleset;
  manualReview?: Partial<ManualReviewConfig>;
  triggerRule?: VerifyTriggerRule;
  checkoutEnforcement?: CheckoutEnforcement;
  buttonText?: string;
  selector?: string;
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

// ─── BC Entity Shapes (BC Management API) ─────────────────────────────────────

export interface BCCustomer {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  date_created: string;    // ISO 8601
  date_modified: string;
  company: string;
  phone: string;
  address_count: number;
  order_count: number;
  customer_group_id: number;
}

export interface BCOrder {
  id: number;
  customer_id: number;     // 0 for guests
  billing_address: {
    first_name: string;
    last_name: string;
    email: string;
    company: string;
  };
  status: string;
  status_id: number;
  total_inc_tax: string;   // string decimal, e.g. "123.45"
  currency_code: string;
  date_created: string;    // RFC 2822 from v2 API
  date_modified: string;
  items_total: number;
}

// ─── Enriched Response Types (proxy returns these, verification already resolved) ─

export interface EnrichedCustomer {
  customer: BCCustomer;
  metafield: MetafieldValue | null;
  verificationState: VerificationState;
}

export interface EnrichedOrder {
  order: BCOrder;
  metafield: MetafieldValue | null;
  verificationState: VerificationState;
  metafieldSource: 'order' | 'customer' | 'none';
}

export interface BCListMeta {
  pagination: {
    total: number;
    count: number;
    per_page: number;
    current_page: number;
    total_pages: number;
  };
}

export interface EnrichedCustomersResponse {
  data: EnrichedCustomer[];
  meta: BCListMeta;
}

export interface EnrichedOrdersResponse {
  data: EnrichedOrder[];
  meta: BCListMeta;
}

export interface CustomerDetailResponse {
  customer: BCCustomer;
  metafield: MetafieldValue | null;
  verificationState: VerificationState;
}

export interface OrderDetailResponse {
  order: BCOrder;
  metafield: MetafieldValue | null;
  verificationState: VerificationState;
  metafieldSource: 'order' | 'customer' | 'none';
  linkedCustomer: BCCustomer | null;
}
