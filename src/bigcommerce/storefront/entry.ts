/**
 * Ad-Hoc Verify — BigCommerce Storefront Plugin
 *
 * Include via Script Manager (all pages, footer):
 *
 *   <script>
 *     window.AdHocVerifyConfig = {
 *       integrationKey:   'ahv_pub_...',
 *       storeHash:        'abc123',
 *       storeAccessToken: 'TOKEN',
 *       pages:            ['cart', 'checkout'],
 *       ruleset: {
 *         requireVerification: true,
 *         minFaceMatchScore: null,
 *         requireOver18: false,
 *         requireOver21: false,
 *       }
 *     };
 *   </script>
 *   <script src="https://verify.ad-hoc.app/plugin/bigcommerce.js"></script>
 */

import StatusCard from './components/StatusCard.svelte';
import VerifyModal from './components/VerifyModal.svelte';
import {
  loadCart,
  loadCustomerJwt,
  loadCartMetafields,
  loadCustomerMetafields,
  findVerificationMetafield,
  saveCartMetafield,
  saveCustomerMetafield,
  saveOrderMetafield,
  invalidateMetafieldCache,
} from './bc-adapter.js';
import { renderCheckoutBlock, removeCheckoutBlock, renderCheckoutWarn, insertShippingNameNotice, removeShippingNameNotice } from './checkout-block.js';
import { resolveOverallState } from '../../core/verification-state.js';
import { createVerification, getTemplateIntegrationConfig, getVerificationResult, computeNameHash } from '../../core/verify-api.js';
import type { AdHocVerifyConfig, CheckoutEnforcement, IntegrationConfig, MetafieldValue, VerificationOutcome, VerificationState, VerificationStatus, VerifyTriggerRule } from '../../core/types.js';
import { log, setLogging } from './logger.js';

// Injected at build time via Vite define
declare const __ADHOC_BC_CLIENT_ID__: string;

// ─── 1. Defaults & Config ────────────────────────────────────────────────────

const defaults: Omit<AdHocVerifyConfig, 'integrationKey'> = {
  apiBase: 'https://verify-api.ad-hoc.app',
  verifyBase: 'https://verify.ad-hoc.app',
  buttonText: 'Verify ID',
  selector: '.cart-actions',
  pages: ['cart', 'checkout'],
  ruleset: {
    requireVerification: true,
    minFaceMatchScore: null,
    requireOver18: false,
    requireOver21: false,
  },
  manualReview: {
    blockCheckout: false,
    message:
      'Your verification is pending a manual review. You may continue to place your order, but there may be a delay in processing while we confirm your verification.',
  },
  triggerRule: { mode: 'always' },
};

const DEFAULT_WARN_MESSAGE =
  'Your order may incur shipping delays or be cancelled until your identity can be verified.';

const DEFAULT_NAME_NOTICE =
  'Important: The first and last name you enter here must exactly match the name on the driver\'s license used to verify your identity.';

/** Returns true if the widget should be shown given the cart's product IDs and the configured trigger rule. */
function evaluateTriggerRule(productIds: number[], rule?: VerifyTriggerRule): boolean {
  if (!rule || rule.mode === 'always') return true;
  if (rule.mode === 'exclude_products') {
    const excluded = rule.productIds ?? [];
    return excluded.length === 0 || !productIds.some((id) => excluded.includes(id));
  }
  // only_products
  const required = rule.productIds ?? [];
  return required.length > 0 && productIds.some((id) => required.includes(id));
}

/** Resolves the effective checkout enforcement mode, falling back to requireVerification for backward compat. */
function getEffectiveEnforcement(cfg: AdHocVerifyConfig): 'block' | 'warn' | 'none' {
  const mode = cfg.checkoutEnforcement?.mode;
  if (mode === 'warn') return 'warn';
  if (mode === 'block') return 'block';
  if (mode === 'none') return 'none';
  return cfg.ruleset.requireVerification ? 'block' : 'none';
}

const userConfig = (window as Window & { AdHocVerifyConfig?: Partial<AdHocVerifyConfig> })
  .AdHocVerifyConfig ?? {};

if (!userConfig.integrationKey) {
  console.error('[AD-HOC VERIFY] Missing integrationKey in AdHocVerifyConfig');
  // Stop execution without throwing (IIFE — a throw here would surface as uncaught)
} else {

let config: AdHocVerifyConfig = {
  ...defaults,
  ...userConfig,
  // Deep-merge ruleset so partial overrides still pick up defaults
  ruleset: { ...defaults.ruleset, ...(userConfig.ruleset ?? {}) },
  // Deep-merge manualReview so partial overrides still pick up defaults
  manualReview: { ...defaults.manualReview, ...(userConfig.manualReview ?? {}) },
} as AdHocVerifyConfig;

// Initialise logger as early as possible so all subsequent log() calls are active
setLogging(config.logging === true);
log('Plugin loaded. Merged config:', config);

// ─── 2. Page Guard ───────────────────────────────────────────────────────────

function detectPage(): 'cart' | 'checkout' | 'order-confirmation' | null {
  if ((window as Window & { BCData?: { order_id?: number } }).BCData?.order_id) return 'order-confirmation';
  const p = window.location.pathname;
  if (p.includes('/cart')) return 'cart';
  if (p.includes('/order-confirmation')) return 'order-confirmation';
  if (p.includes('/checkout')) return 'checkout';
  return null;
}

const currentPage = detectPage();
const configPages = Array.isArray(config.pages) ? config.pages : ['cart'];

log(`Page detection: current="${currentPage ?? 'none'}", configured pages=[${configPages.join(', ')}], active=${currentPage !== null && configPages.includes(currentPage)}`);

// ─── 3. Session Keys ─────────────────────────────────────────────────────────

// Pending: set when modal opens, cleared on completion. Reuses the same verification if modal
// is reopened mid-session.
const SESSION_KEY = `adhoc_verify_pending_${config.integrationKey}`;

// Completed: set when verification finishes, survives page navigation within the same session.
// Used to backfill the customer metafield after login/account creation, and to write the order
// metafield on the order confirmation page.
const COMPLETED_KEY = `adhoc_verify_done_${config.integrationKey}`;

// Cart ID persisted here so the order-confirmation page can resolve the order ID via the
// Storefront Checkouts API (cart ID == checkout ID in BigCommerce).
const CART_ID_KEY = `adhoc_verify_cartid_${config.integrationKey}`;

// ─── 4. Order Confirmation Handler ───────────────────────────────────────────

async function handleOrderConfirmationPage(): Promise<void> {
  log('Order confirmation page detected — checking for completed verification to write to order metafield.');

  // storeHash/storeAccessToken may be absent if the merchant uses templateId-based config and
  // the order-confirmation page is not in configPages (so bootstrap() never ran). Fetch the
  // remote config now — we only need credentials, not the full init path.
  if ((!config.storeHash || !config.storeAccessToken) && userConfig.templateId) {
    log('Order confirmation: credentials not set — fetching from remote template config.');
    const remote = await getTemplateIntegrationConfig(config.apiBase, config.integrationKey, userConfig.templateId);
    if (remote?.ok) {
      if (!userConfig.storeHash && remote.data.storeHash) config.storeHash = remote.data.storeHash;
      if (!userConfig.storeAccessToken && remote.data.storeAccessToken) config.storeAccessToken = remote.data.storeAccessToken;
      log('Order confirmation: remote config applied.');
    } else {
      log('Order confirmation: remote config fetch failed — cannot write order metafield.');
    }
  }

  if (!config.storeHash || !config.storeAccessToken) {
    log('Order confirmation: skipping — storeHash or storeAccessToken not configured.');
    return;
  }
  const completedJson = sessionStorage.getItem(COMPLETED_KEY);
  if (!completedJson) {
    log('Order confirmation: no completed verification found in sessionStorage — nothing to write.');
    return;
  }

  // BCData.order_id is empty for guest checkouts and the URL has no order ID in the path.
  // Cart ID == Checkout ID in BigCommerce, so call the Storefront Checkouts API with the
  // cart ID we persisted during the previous checkout steps to get the completed orderId.
  const bcData = (window as Window & { BCData?: { order_id?: number } }).BCData;
  let orderId: string | null =
    bcData?.order_id?.toString() ??
    window.location.pathname.match(/\/order-confirmation\/(\d+)/)?.[1] ??
    null;

  if (!orderId) {
    const cartId = sessionStorage.getItem(CART_ID_KEY);
    if (cartId) {
      log(`Order confirmation: querying /api/storefront/checkouts/${cartId} to resolve orderId.`);
      try {
        const res = await fetch(`/api/storefront/checkouts/${cartId}`, { credentials: 'same-origin' });
        if (res.ok) {
          const checkout = await res.json() as { orderId?: number };
          if (checkout?.orderId) {
            orderId = String(checkout.orderId);
            log(`Order confirmation: resolved orderId="${orderId}" from checkouts API.`);
          }
        }
      } catch (_) {
        log('Order confirmation: checkouts API request failed.');
      }
    } else {
      log('Order confirmation: no cart ID in sessionStorage — cannot resolve order ID.');
    }
  }

  if (!orderId) {
    log('Order confirmation: could not determine order ID — skipping metafield write.');
    return;
  }

  log(`Order confirmation: writing verification to order metafield for orderId="${orderId}".`);
  try {
    const { verificationId, result, status } = JSON.parse(completedJson) as {
      verificationId: string;
      result: VerificationOutcome | null;
      status: VerificationStatus;
    };
    log('Order confirmation: metafield payload —', { verificationId, status, result });
    await saveOrderMetafield(
      config.apiBase,
      config.storeHash,
      config.storeAccessToken,
      orderId,
      verificationId,
      result,
      status,
    );
    log('Order confirmation: order metafield saved successfully.');
  } catch (_) {
    log('Order confirmation: failed to save order metafield (non-fatal).');
  }
}

if (currentPage && configPages.includes(currentPage)) {

const isCheckout = currentPage === 'checkout';

// ─── 5. Container ────────────────────────────────────────────────────────────

const CONTAINER_ID = 'adhoc-verify-container';

function findOrCreateContainer(): HTMLElement {
  const existing = document.getElementById(CONTAINER_ID);
  if (existing) return existing;

  const containerWrapper = document.createElement('div');
  containerWrapper.id = CONTAINER_ID;

  const container = document.createElement('div');
  container.style.cssText =
    'padding:15px;margin:20px 0;border:1px solid #ddd;background:#f9f9f9;text-align:center;';

  containerWrapper.appendChild(container);

  if (isCheckout) {
    // Checkout page: append after the existing content inside .checkout-step--customer
    const step = document.querySelector('li.checkout-step--customer');
    if (step) {
      step.appendChild(containerWrapper);
    } else {
      document.body.appendChild(containerWrapper);
    }
  } else {
    // Cart page: prefer the cart_below_totals Stencil region (theme-agnostic), then fall back
    // to inserting before the cart actions element as before.
    containerWrapper.classList.add('cart-content-padding-right');
    container.classList.add('cart-totals');

    const region = document.querySelector('[data-content-region="cart_below_totals"]');
    if (region) {
      region.appendChild(containerWrapper);
    } else {
      const target =
        document.querySelector(config.selector) ??
        document.querySelector('[data-cart-totals]') ??
        document.querySelector('form[action*="cart"]');
      if (target?.parentNode) {
        target.parentNode.insertBefore(containerWrapper, target);
      } else {
        document.body.appendChild(containerWrapper);
      }
    }
  }

  return container;
}

// ─── 4b. Cart Context (set during init) ──────────────────────────────────────

let _cartId = '';
let _customerId = 0;
let _cartMfId: number | undefined;
let _customerMfId: number | undefined;
let _blockchainName: string | null = null;
let _nameMatchState: boolean | null = null;
let _nameWatcherCleanup: (() => void) | null = null;

// Svelte 4 component instance references
let statusCardInstance: InstanceType<typeof StatusCard> | null = null;
let modalWrapperEl: HTMLElement | null = null;

// ─── 5. Post-Verification Save & Refresh ────────────────────────────────────

async function saveVerificationAndRefreshUI(
  id: string,
  result: VerificationOutcome | null,
): Promise<void> {
  log(`Verification complete — saving result. verificationId="${id}"`, result);
  const saves: Promise<boolean>[] = [
    saveCartMetafield(
      config.apiBase,
      config.storeHash!,
      config.storeAccessToken!,
      _cartId,
      id,
      result,
      _cartMfId,
    ),
  ];
  if (_customerId !== 0) {
    log(`Customer is logged in (customerId=${_customerId}) — also saving customer metafield.`);
    saves.push(
      saveCustomerMetafield(
        config.apiBase,
        config.storeHash!,
        config.storeAccessToken!,
        _customerId,
        id,
        result,
        _customerMfId,
      ),
    );
  } else {
    log('Customer is a guest — skipping customer metafield save.');
  }
  await Promise.all(saves);
  await invalidateMetafieldCache(_cartId, _customerId);
  sessionStorage.setItem(COMPLETED_KEY, JSON.stringify({ verificationId: id, result, status: 'completed' }));
  log('Metafield saves complete, cache invalidated, COMPLETED_KEY set in sessionStorage.');

  // Update Svelte component prop → StatusCard re-renders
  statusCardInstance?.$set({ state: 'verified' as VerificationState });

  if (isCheckout && config.ruleset.requireNameMatch === true) {
    _blockchainName = result?.blockchain_name ?? null;
    await setupNameMatch({
      verificationId: id,
      status: 'completed',
      completedAt: new Date().toISOString(),
      verification: result ?? { success: null, over_18: null, over_21: null, face_match_score: null },
    });
    log('UI updated to "verified" state, name match check started.');
  } else {
    removeCheckoutBlock();
    log('UI updated to "verified" state, checkout block removed.');
  }

  if (typeof config.onComplete === 'function') config.onComplete(id);
  if (typeof config.onResult === 'function') {
    config.onResult({
      verificationId: id,
      success: result?.success ?? null,
      over_18: result?.over_18 ?? null,
      over_21: result?.over_21 ?? null,
      face_match_score: result?.face_match_score ?? null,
    });
  }
}

// ─── 5b. Manual Review Handler ───────────────────────────────────────────────

async function handleManualReviewResult(id: string): Promise<void> {
  log(`Verification submitted for manual review. verificationId="${id}"`);
  const saves: Promise<boolean>[] = [
    saveCartMetafield(
      config.apiBase,
      config.storeHash!,
      config.storeAccessToken!,
      _cartId,
      id,
      null,
      _cartMfId,
      'manual_review',
    ),
  ];
  if (_customerId !== 0) {
    log(`Customer is logged in (customerId=${_customerId}) — saving customer metafield as manual_review.`);
    saves.push(
      saveCustomerMetafield(
        config.apiBase,
        config.storeHash!,
        config.storeAccessToken!,
        _customerId,
        id,
        null,
        _customerMfId,
        'manual_review',
      ),
    );
  } else {
    log('Customer is a guest — skipping customer metafield save for manual_review.');
  }
  await Promise.all(saves);
  await invalidateMetafieldCache(_cartId, _customerId);
  sessionStorage.setItem(COMPLETED_KEY, JSON.stringify({ verificationId: id, result: null, status: 'manual_review' }));
  log('Manual review metafield saves complete, cache invalidated, COMPLETED_KEY set in sessionStorage.');

  const reviewCfg = config.manualReview!;
  const msg = reviewCfg.message !== undefined ? reviewCfg.message : defaults.manualReview!.message;

  statusCardInstance?.$set({
    state: 'pending_review' as VerificationState,
    pendingReviewMessage: msg || null,
  });

  if (reviewCfg.blockCheckout) {
    log('manualReview.blockCheckout=true — rendering checkout block.');
    renderCheckoutBlock();
  } else {
    log('manualReview.blockCheckout=false — checkout allowed during manual review.');
    removeCheckoutBlock();
  }
}

// ─── 6. Block-Reason Helper ──────────────────────────────────────────────────

// Returns a human-readable reason for why checkout is blocked when a *completed*
// verification doesn't satisfy the ruleset, so the user understands what went wrong.
function getBlockReason(mfValue: MetafieldValue | undefined): string | null {
  if (!mfValue || mfValue.status !== 'completed') return null;
  const v = mfValue.verification;
  if (config.ruleset.requireOver21 && !v.over_21) return 'Your verification shows you do not meet the age requirement. You must be 21 or older to complete this purchase.';
  if (config.ruleset.requireOver18 && !v.over_18) return 'Your verification shows you do not meet the age requirement. You must be 18 or older to complete this purchase.';
  return null;
}

// ─── 6b. Name-Match Helpers ──────────────────────────────────────────────────

async function getBlockchainName(verificationId: string): Promise<string | null> {
  if (_blockchainName) return _blockchainName;
  const res = await getVerificationResult(config.apiBase, verificationId);
  _blockchainName = res?.result?.blockchain_name ?? null;
  return _blockchainName;
}

function watchShippingNameInputs(
  verificationId: string,
  onMatchChange: (match: boolean | null) => void,
): () => void {
  let firstInput: HTMLInputElement | null = null;
  let lastInput: HTMLInputElement | null = null;
  let nameObserver: MutationObserver | null = null;

  const handleInput = (): void => { void checkMatch(); };

  async function checkMatch(): Promise<void> {
    const first = firstInput?.value?.trim() ?? '';
    const last = lastInput?.value?.trim() ?? '';
    if ((!first && !last) || !_blockchainName) {
      onMatchChange(null);
      return;
    }
    const computed = await computeNameHash(first, last, verificationId);
    onMatchChange(computed === _blockchainName);
  }

  function attachListeners(): void {
    const newFirst =
      document.querySelector<HTMLInputElement>('input[autocomplete="given-name"]') ??
      document.querySelector<HTMLInputElement>('input[id*="firstName"]');
    const newLast =
      document.querySelector<HTMLInputElement>('input[autocomplete="family-name"]') ??
      document.querySelector<HTMLInputElement>('input[id*="lastName"]');

    if (newFirst === firstInput && newLast === lastInput) return;

    // If inputs have disappeared (BC collapsed the shipping form to read-only after "Continue"),
    // preserve the current match state rather than treating absent inputs as "no name entered".
    // The name the customer typed hasn't changed — the form just moved to display mode.
    if (!newFirst && !newLast && (firstInput !== null || lastInput !== null)) {
      firstInput?.removeEventListener('input', handleInput);
      lastInput?.removeEventListener('input', handleInput);
      firstInput = null;
      lastInput = null;
      log('watchShippingNameInputs: shipping form collapsed to read-only — preserving match state.');
      return;
    }

    firstInput?.removeEventListener('input', handleInput);
    lastInput?.removeEventListener('input', handleInput);

    firstInput = newFirst;
    lastInput = newLast;

    firstInput?.addEventListener('input', handleInput);
    lastInput?.addEventListener('input', handleInput);

    void checkMatch();
    log('watchShippingNameInputs: attached to name input fields.');
  }

  attachListeners();

  nameObserver = new MutationObserver(() => attachListeners());
  nameObserver.observe(document.body, { childList: true, subtree: true });

  return (): void => {
    nameObserver?.disconnect();
    nameObserver = null;
    firstInput?.removeEventListener('input', handleInput);
    lastInput?.removeEventListener('input', handleInput);
    firstInput = null;
    lastInput = null;
    log('watchShippingNameInputs: cleaned up.');
  };
}

async function setupNameMatch(mfValue: MetafieldValue | undefined): Promise<void> {
  const verificationId = mfValue?.verificationId;
  if (!verificationId) {
    log('setupNameMatch: no verificationId available — skipping.');
    return;
  }

  _blockchainName = mfValue?.verification?.blockchain_name ?? null;
  if (!_blockchainName) {
    _blockchainName = await getBlockchainName(verificationId);
  }

  const MSG_ENTER_NAME = 'Please enter your shipping name — it must exactly match the name on your driver\'s license.';
  const MSG_NAME_MISMATCH = 'The name in the shipping address does not exactly match the name on your driver\'s license.';

  log(`setupNameMatch: blockchain_name ${_blockchainName ? 'found' : 'not available'} — blocking checkout until name confirmed.`);
  renderCheckoutBlock(MSG_ENTER_NAME);

  _nameWatcherCleanup?.();
  _nameWatcherCleanup = watchShippingNameInputs(verificationId, (match) => {
    _nameMatchState = match;
    log(`Name match state: ${String(match)}`);
    if (match === true) {
      removeCheckoutBlock();
    } else if (match === false) {
      renderCheckoutBlock(MSG_NAME_MISMATCH);
    } else {
      renderCheckoutBlock(MSG_ENTER_NAME);
    }
  });
}

// ─── 7. Init ─────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  log('Initializing verification widget...');
  const container = findOrCreateContainer();
  container.innerHTML =
    '<p style="margin:0;font-size:14px;color:#888;">Loading verification status...</p>';

  const cart = await loadCart();
  if (!cart) {
    // Degraded mode: no BC integration, just show the verify button
    log('Cart data unavailable — running in degraded mode (no BC integration). Showing unverified state.');
    mountStatusCard(container, 'unverified');
    return;
  }

  _cartId = cart.cartId;
  _customerId = cart.customerId;
  sessionStorage.setItem(CART_ID_KEY, _cartId);
  log(`Cart loaded: cartId="${_cartId}", customerId=${_customerId}, loggedIn=${_customerId !== 0}, productIds=[${(cart.productIds ?? []).join(', ')}]`);

  // Trigger rule: hide the widget entirely if this cart doesn't qualify
  if (!evaluateTriggerRule(cart.productIds ?? [], config.triggerRule)) {
    log(`Trigger rule (mode="${config.triggerRule?.mode}"): cart products do not match — widget hidden.`);
    container.remove();
    return;
  }
  log(`Trigger rule (mode="${config.triggerRule?.mode}"): cart products match — proceeding.`);

  if (!config.storeHash || !config.storeAccessToken) {
    log('storeHash or storeAccessToken not configured — skipping metafield fetch. Will show unverified state.');
  }

  const [cartMetafields, customerMetafields] = await Promise.all([
    config.storeHash && config.storeAccessToken
      ? loadCartMetafields(config.apiBase, config.storeHash, config.storeAccessToken, _cartId)
      : Promise.resolve([]),
    _customerId !== 0 && config.storeHash && config.storeAccessToken
      ? loadCustomerMetafields(
          config.apiBase,
          config.storeHash,
          config.storeAccessToken,
          _customerId,
        )
      : Promise.resolve([]),
    _customerId !== 0 ? loadCustomerJwt(__ADHOC_BC_CLIENT_ID__) : Promise.resolve(null),
  ]);

  log(`Metafields fetched: cart=${cartMetafields.length} record(s), customer=${customerMetafields.length} record(s).`);

  const cartMf = findVerificationMetafield(cartMetafields);
  const customerMf = findVerificationMetafield(customerMetafields);

  log('Cart verification metafield:', cartMf ?? 'none');
  log('Customer verification metafield:', customerMf ?? 'none');

  const resolved = resolveOverallState(cartMf, customerMf, config.ruleset);
  log(`Resolved verification state: state="${resolved.state}", source="${resolved.source}"`, { cartMfId: resolved.cartMfId, customerMfId: resolved.customerMfId });

  _cartMfId = resolved.cartMfId ?? undefined;
  _customerMfId = resolved.customerMfId ?? undefined;

  if (isCheckout && config.ruleset.requireNameMatch === true) {
    insertShippingNameNotice(DEFAULT_NAME_NOTICE);
  }

  // Returning verified customer: their customer metafield carries a verified status from a prior
  // session/device. Write that verification to the cart metafield now so cart and order records
  // are linked. Also seed COMPLETED_KEY so the order confirmation page writes the order metafield.
  if (
    resolved.state === 'verified' &&
    resolved.source === 'customer' &&
    customerMf &&
    config.storeHash &&
    config.storeAccessToken
  ) {
    log('Returning verified customer detected — propagating customer verification to cart metafield.');
    const { verificationId, verification, status } = customerMf.value;
    try {
      await saveCartMetafield(
        config.apiBase,
        config.storeHash,
        config.storeAccessToken,
        _cartId,
        verificationId,
        verification,
        _cartMfId,
        status,
      );
      await invalidateMetafieldCache(_cartId, _customerId);
      log(`Cart metafield updated from customer record. verificationId="${verificationId}", status="${status}"`);
      if (!sessionStorage.getItem(COMPLETED_KEY)) {
        sessionStorage.setItem(
          COMPLETED_KEY,
          JSON.stringify({ verificationId, result: verification, status }),
        );
        log('COMPLETED_KEY seeded in sessionStorage for order confirmation page.');
      }
    } catch (_) {
      log('Failed to propagate customer verification to cart metafield (non-fatal).');
    }
  }

  // Backfill: if now logged in but no customer metafield, check for a completed verification
  // from earlier in this session (e.g. verified as guest, then created an account).
  if (_customerId !== 0 && !customerMf && config.storeHash && config.storeAccessToken) {
    log(`Customer is logged in (customerId=${_customerId}) but has no customer metafield — checking sessionStorage for a prior verification to backfill.`);
    const completedJson = sessionStorage.getItem(COMPLETED_KEY);
    if (completedJson) {
      log('Found completed verification in sessionStorage — backfilling customer metafield.');
      try {
        const { verificationId, result, status } = JSON.parse(completedJson) as {
          verificationId: string;
          result: VerificationOutcome | null;
          status: VerificationStatus;
        };
        log(`Backfill payload: verificationId="${verificationId}", status="${status}"`, result);
        await saveCustomerMetafield(
          config.apiBase,
          config.storeHash,
          config.storeAccessToken,
          _customerId,
          verificationId,
          result,
          undefined,
          status,
        );
        await invalidateMetafieldCache(_cartId, _customerId);
        log('Customer metafield backfilled and cache invalidated.');
        const backfilledMf = {
          id: 0,
          value: {
            verificationId,
            status,
            completedAt: '',
            verification: result ?? { success: null, over_18: null, over_21: null, face_match_score: null },
          },
        };
        const reresolved = resolveOverallState(cartMf, backfilledMf, config.ruleset);
        log(`Re-resolved state after backfill: state="${reresolved.state}", source="${reresolved.source}"`);
        _customerMfId = reresolved.customerMfId ?? undefined;
        mountStatusCard(container, reresolved.state);
        if (reresolved.state === 'pending_review') {
          if (isCheckout && config.manualReview?.blockCheckout) {
            log('Backfill: pending_review + blockCheckout=true — rendering checkout block.');
            renderCheckoutBlock();
          }
        } else if (reresolved.state === 'verified') {
          if (isCheckout && config.ruleset.requireNameMatch === true) {
            await setupNameMatch(backfilledMf.value);
          }
        } else if (isCheckout) {
          const enforcement = getEffectiveEnforcement(config);
          if (enforcement === 'block') {
            log(`Backfill: state="${reresolved.state}" + enforcement=block — rendering checkout block.`);
            renderCheckoutBlock(getBlockReason(backfilledMf.value));
          } else if (enforcement === 'warn') {
            const msg = config.checkoutEnforcement?.warningMessage || DEFAULT_WARN_MESSAGE;
            log(`Backfill: state="${reresolved.state}" + enforcement=warn — showing warning banner.`);
            renderCheckoutWarn(msg);
          }
        }
        return;
      } catch (_) {
        log('Backfill failed (non-fatal) — continuing with unbackfilled state.');
      }
    } else {
      log('No prior verification in sessionStorage — nothing to backfill.');
    }
  }

  mountStatusCard(container, resolved.state);
  log(`StatusCard mounted with state="${resolved.state}".`);

  if (resolved.state === 'pending_review') {
    if (isCheckout && config.manualReview?.blockCheckout) {
      log('State is pending_review + blockCheckout=true — rendering checkout block.');
      renderCheckoutBlock();
    } else {
      log('State is pending_review + blockCheckout=false — checkout allowed.');
    }
  } else if (resolved.state !== 'verified' && isCheckout) {
    const enforcement = getEffectiveEnforcement(config);
    if (enforcement === 'block') {
      log(`State is "${resolved.state}" + enforcement=block — rendering checkout block.`);
      const resolvedMfValue = resolved.source === 'customer' ? customerMf?.value : cartMf?.value;
      renderCheckoutBlock(getBlockReason(resolvedMfValue));
    } else if (enforcement === 'warn') {
      const msg = config.checkoutEnforcement?.warningMessage || DEFAULT_WARN_MESSAGE;
      log(`State is "${resolved.state}" + enforcement=warn — showing warning banner.`);
      renderCheckoutWarn(msg);
    } else {
      log(`State is "${resolved.state}" + enforcement=none — no checkout action.`);
    }
  } else if (resolved.state === 'verified') {
    if (isCheckout && config.ruleset.requireNameMatch === true) {
      const resolvedMfValue = resolved.source === 'customer' ? customerMf?.value : cartMf?.value;
      await setupNameMatch(resolvedMfValue);
    } else {
      log('Customer is verified — checkout block not required.');
    }
  }
}

// ─── 8. Svelte 4 Component Mounting ─────────────────────────────────────────

function mountStatusCard(container: HTMLElement, initialState: VerificationState): void {
  container.innerHTML = '';
  statusCardInstance?.$destroy();

  const reviewMsg = config.manualReview?.message ?? defaults.manualReview!.message;
  statusCardInstance = new StatusCard({
    target: container,
    props: {
      state: initialState,
      buttonText: config.buttonText,
      pendingReviewMessage: reviewMsg || null,
    },
  });

  statusCardInstance.$on('verify', () => void handleVerifyClick());
}

async function handleVerifyClick(): Promise<void> {
  if (modalWrapperEl) {
    log('Verify button clicked but modal is already open — ignoring.');
    return;
  }

  log('Verify button clicked — starting verification flow.');
  try {
    let id = sessionStorage.getItem(SESSION_KEY);

    if (id) {
      log(`Resuming in-progress verification session. verificationId="${id}"`);
    } else {
      log('No in-progress session — creating a new verification.');
      const body: Parameters<typeof createVerification>[2] = {};
      if (config.templateId) body.template_id = config.templateId;
      ({ id } = await createVerification(config.apiBase, config.integrationKey, body));
      sessionStorage.setItem(SESSION_KEY, id);
      log(`New verification created. verificationId="${id}"`);
    }

    const verificationUrl = `${config.verifyBase}/verify/${id}`;
    log(`Opening verification modal. url="${verificationUrl}"`);

    modalWrapperEl = document.createElement('div');
    document.body.appendChild(modalWrapperEl);

    const modal = new VerifyModal({
      target: modalWrapperEl,
      props: { verificationUrl, verificationId: id, apiBase: config.apiBase },
    });

    modal.$on('complete', (e: CustomEvent<{ verificationId: string; result: VerificationOutcome | null }>) => {
      log(`Modal fired "complete" event. verificationId="${e.detail.verificationId}"`, e.detail.result);
      sessionStorage.removeItem(SESSION_KEY);
      destroyModal(modal);
      void saveVerificationAndRefreshUI(e.detail.verificationId, e.detail.result);
    });

    modal.$on('manual_review', (e: CustomEvent<{ verificationId: string }>) => {
      log(`Modal fired "manual_review" event. verificationId="${e.detail.verificationId}"`);
      sessionStorage.removeItem(SESSION_KEY);
      destroyModal(modal);
      void handleManualReviewResult(e.detail.verificationId);
    });

    modal.$on('close', () => {
      log('Modal closed by user without completing verification.');
      destroyModal(modal);
    });
  } catch (err) {
    console.error('[AD-HOC VERIFY] Error starting verification:', (err as Error).message);
    alert('Unable to start verification. Please try again.');
  }
}

function destroyModal(modal: InstanceType<typeof VerifyModal>): void {
  modal.$destroy();
  modalWrapperEl?.remove();
  modalWrapperEl = null;
}

// ─── 8. Cart Trigger Watcher ─────────────────────────────────────────────────

async function recheckTriggerRule(): Promise<void> {
  log('recheckTriggerRule: re-evaluating trigger rule after cart change.');
  const cart = await loadCart();
  const shouldShow = cart ? evaluateTriggerRule(cart.productIds ?? [], config.triggerRule) : false;
  const container = document.getElementById(CONTAINER_ID);
  const isShown = container !== null;

  if (shouldShow === isShown) {
    log(`recheckTriggerRule: visibility unchanged (shouldShow=${shouldShow}) — no action.`);
    return;
  }

  if (shouldShow) {
    log('recheckTriggerRule: trigger now active — initializing widget.');
    await init();
  } else {
    log('recheckTriggerRule: trigger no longer active — hiding widget.');
    container!.remove();
    statusCardInstance?.$destroy();
    statusCardInstance = null;
    removeCheckoutBlock();
  }
}

function watchCartTrigger(): void {
  if (!config.triggerRule || config.triggerRule.mode === 'always') {
    log('watchCartTrigger: trigger mode is "always" — skipping cart change watcher.');
    return;
  }

  log('watchCartTrigger: installing fetch interceptor to watch for cart mutations.');
  const originalFetch = window.fetch.bind(window);
  let recheckPending = false;

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const response = await originalFetch(input, init);

    const url =
      typeof input === 'string' ? input
      : input instanceof URL ? input.href
      : (input as Request).url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

    const isModernCartMutation =
      url.includes('/api/storefront/carts') &&
      (method === 'POST' || method === 'PUT' || method === 'DELETE');
    // Legacy Stencil/Cornerstone endpoints used by older themes via stencil-utils
    const isLegacyCartMutation =
      (url.includes('/remote/v1/cart/add') ||
        url.includes('/remote/v1/cart/update') ||
        url.includes('/remote/v1/cart/remove')) &&
      method === 'POST';

    if (isModernCartMutation || isLegacyCartMutation) {
      if (!recheckPending) {
        recheckPending = true;
        setTimeout(() => {
          recheckPending = false;
          void recheckTriggerRule();
        }, 150);
      }
    }

    return response;
  };

  // Legacy themes may use XMLHttpRequest instead of fetch for /remote/v1/ endpoints
  const OriginalXHR = window.XMLHttpRequest;
  class PatchedXHR extends OriginalXHR {
    private _method = '';
    private _url = '';

    open(method: string, url: string, async = true, user?: string, password?: string): void {
      this._method = method.toUpperCase();
      this._url = url;
      super.open(method, url, async, user, password);
    }

    send(...args: Parameters<XMLHttpRequest['send']>): void {
      this.addEventListener('load', () => {
        const isLegacy =
          (this._url.includes('/remote/v1/cart/add') ||
            this._url.includes('/remote/v1/cart/update') ||
            this._url.includes('/remote/v1/cart/remove')) &&
          this._method === 'POST';
        if (isLegacy && !recheckPending) {
          recheckPending = true;
          setTimeout(() => {
            recheckPending = false;
            void recheckTriggerRule();
          }, 150);
        }
      });
      super.send(...args);
    }
  }
  window.XMLHttpRequest = PatchedXHR as typeof XMLHttpRequest;
}

// ─── 9. Bootstrap ────────────────────────────────────────────────────────────

// If a templateId is provided, fetch integration_config from the API and apply
// remote values for any fields the merchant did not explicitly set in the script tag.
// window.AdHocVerifyConfig always wins; remote config fills in everything else.
//
// NOTE: `pages` is intentionally NOT applied from remote config. The page guard
// (`configPages`) is evaluated synchronously at script load time — before this
// async fetch completes — so any remote value would arrive too late to have effect.
// Pages must be set in window.AdHocVerifyConfig in the script tag, or left as the
// default (['cart', 'checkout']).
async function applyRemoteConfig(remote: IntegrationConfig): Promise<void> {
  log('Applying remote integration_config (local window.AdHocVerifyConfig values take precedence):');
  if (!userConfig.storeHash && remote.storeHash) { config.storeHash = remote.storeHash; log(`  storeHash ← remote ("${remote.storeHash}")`); }
  if (!userConfig.storeAccessToken && remote.storeAccessToken) { config.storeAccessToken = remote.storeAccessToken; log('  storeAccessToken ← remote (value hidden)'); }
  if (!userConfig.ruleset && remote.ruleset) { config.ruleset = { ...defaults.ruleset, ...remote.ruleset }; log('  ruleset ← remote', config.ruleset); }
  if (!userConfig.manualReview && remote.manualReview) { config.manualReview = { ...defaults.manualReview, ...remote.manualReview }; log('  manualReview ← remote', config.manualReview); }
  if (!userConfig.triggerRule && remote.triggerRule) { config.triggerRule = remote.triggerRule; log('  triggerRule ← remote', config.triggerRule); }
  if (!userConfig.checkoutEnforcement && remote.checkoutEnforcement) { config.checkoutEnforcement = remote.checkoutEnforcement; log('  checkoutEnforcement ← remote', config.checkoutEnforcement); }
  if (!userConfig.buttonText && remote.buttonText) { config.buttonText = remote.buttonText; log(`  buttonText ← remote ("${remote.buttonText}")`); }
  if (!userConfig.selector && remote.selector) { config.selector = remote.selector; log(`  selector ← remote ("${remote.selector}")`); }
  log('Remote config applied. Final config:', config);
}

async function bootstrap(): Promise<void> {
  if (userConfig.templateId) {
    log(`templateId="${userConfig.templateId}" found — fetching remote integration_config from API.`);
    const remote = await getTemplateIntegrationConfig(
      config.apiBase,
      config.integrationKey,
      userConfig.templateId,
    );
    if (remote === null) {
      log('Remote integration_config fetch returned null — using local config only.');
    } else if (!remote.ok) {
      log(`Remote integration_config fetch failed (${remote.status}): ${remote.error} — using local config only.`);
    } else {
      log('Remote integration_config received:', remote.data);
      await applyRemoteConfig(remote.data);
    }
  } else {
    log('No templateId configured — skipping remote config fetch, using local config only.');
  }
  await init();
  watchCartTrigger();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void bootstrap());
} else {
  void bootstrap();
}

} // end page guard

// Order confirmation: runs silently regardless of configPages, writes order metafield.
if (currentPage === 'order-confirmation') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void handleOrderConfirmationPage());
  } else {
    void handleOrderConfirmationPage();
  }
}

} // end integrationKey guard
