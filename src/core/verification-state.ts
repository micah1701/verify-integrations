import type {
  FaceMatchScore,
  MetafieldValue,
  ResolvedMetafield,
  ResolvedState,
  Ruleset,
  VerificationState,
} from './types.js';

// Ordered from strongest to weakest match
const SCORE_ORDER: FaceMatchScore[] = [
  'definite_match',
  'likely_match',
  'possible_match',
  'no_match',
];

export function evaluateVerificationState(
  mfValue: MetafieldValue | null | undefined,
  ruleset: Ruleset,
): VerificationState {
  if (!mfValue) return 'unverified';
  if (mfValue.status !== 'completed') return 'incomplete';

  const v = mfValue.verification;

  if (ruleset.requireOver18 && !v.over_18) return 'invalid';
  if (ruleset.requireOver21 && !v.over_21) return 'invalid';

  if (ruleset.minFaceMatchScore) {
    const minIdx = SCORE_ORDER.indexOf(ruleset.minFaceMatchScore);
    const actualIdx = SCORE_ORDER.indexOf(v.face_match_score as FaceMatchScore);
    // actualIdx === -1 means unknown score; treat as failing
    if (actualIdx < 0 || actualIdx > minIdx) return 'invalid';
  }

  return 'verified';
}

// Returns the best overall state across cart + customer metafields.
// Customer metafield takes precedence over cart; 'verified' beats everything.
export function resolveOverallState(
  cartMf: ResolvedMetafield | null,
  customerMf: ResolvedMetafield | null,
  ruleset: Ruleset,
): ResolvedState {
  const cartState = evaluateVerificationState(cartMf?.value ?? null, ruleset);
  const customerState = evaluateVerificationState(customerMf?.value ?? null, ruleset);

  const cartMfId = cartMf?.id ?? null;
  const customerMfId = customerMf?.id ?? null;

  if (customerState === 'verified') {
    return { state: 'verified', source: 'customer', cartMfId, customerMfId };
  }
  if (cartState === 'verified') {
    return { state: 'verified', source: 'cart', cartMfId, customerMfId };
  }

  // Pick the most informative non-verified state
  const priority: VerificationState[] = ['invalid', 'incomplete', 'unverified'];
  const best =
    priority.indexOf(customerState) <= priority.indexOf(cartState) ? customerState : cartState;

  return { state: best, source: 'none', cartMfId, customerMfId };
}
