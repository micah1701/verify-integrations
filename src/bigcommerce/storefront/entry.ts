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
import { renderCheckoutBlock, removeCheckoutBlock } from './checkout-block.js';
import { resolveOverallState } from '../../core/verification-state.js';
import { createVerification, getTemplateIntegrationConfig } from '../../core/verify-api.js';
import type { AdHocVerifyConfig, IntegrationConfig, VerificationOutcome, VerificationState, VerificationStatus } from '../../core/types.js';

// Injected at build time via Vite define
declare const __ADHOC_BC_CLIENT_ID__: string;

// ─── 1. Defaults & Config ────────────────────────────────────────────────────

const defaults: Omit<AdHocVerifyConfig, 'integrationKey'> = {
  apiBase: 'https://verify-api.ad-hoc.app',
  verifyBase: 'https://verify.ad-hoc.app',
  buttonText: 'Verify ID',
  selector: '.cart-actions',
  pages: ['cart'],
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
};

const userConfig = (window as Window & { AdHocVerifyConfig?: Partial<AdHocVerifyConfig> })
  .AdHocVerifyConfig ?? {};

if (!userConfig.integrationKey) {
  console.error('[Ad-Hoc Verify] Missing integrationKey in AdHocVerifyConfig');
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

// ─── 2. Page Guard ───────────────────────────────────────────────────────────

function detectPage(): 'cart' | 'checkout' | 'order-confirmation' | null {
  if ((window as Window & { BCData?: { order_id?: number } }).BCData?.order_id) return 'order-confirmation';
  const p = window.location.pathname;
  if (p.includes('/cart')) return 'cart';
  if (p.includes('/checkout')) return 'checkout';
  if (p.includes('/order-confirmation')) return 'order-confirmation';
  return null;
}

const currentPage = detectPage();
const configPages = Array.isArray(config.pages) ? config.pages : ['cart'];

// ─── 3. Session Keys ─────────────────────────────────────────────────────────

// Pending: set when modal opens, cleared on completion. Reuses the same verification if modal
// is reopened mid-session.
const SESSION_KEY = `adhoc_verify_pending_${config.integrationKey}`;

// Completed: set when verification finishes, survives page navigation within the same session.
// Used to backfill the customer metafield after login/account creation, and to write the order
// metafield on the order confirmation page.
const COMPLETED_KEY = `adhoc_verify_done_${config.integrationKey}`;

// ─── 4. Order Confirmation Handler ───────────────────────────────────────────

async function handleOrderConfirmationPage(): Promise<void> {
  if (!config.storeHash || !config.storeAccessToken) return;
  const completedJson = sessionStorage.getItem(COMPLETED_KEY);
  if (!completedJson) return;

  const bcData = (window as Window & { BCData?: { order_id?: number } }).BCData;
  const orderId =
    bcData?.order_id?.toString() ??
    window.location.pathname.match(/\/order-confirmation\/(\d+)/)?.[1] ??
    null;
  if (!orderId) return;

  try {
    const { verificationId, result, status } = JSON.parse(completedJson) as {
      verificationId: string;
      result: VerificationOutcome | null;
      status: VerificationStatus;
    };
    await saveOrderMetafield(
      config.apiBase,
      config.storeHash,
      config.storeAccessToken,
      orderId,
      verificationId,
      result,
      status,
    );
  } catch (_) {}
}

if (currentPage && configPages.includes(currentPage)) {

const isCheckout = currentPage === 'checkout';

// ─── 5. Container ────────────────────────────────────────────────────────────

const CONTAINER_ID = 'adhoc-verify-container';

function findOrCreateContainer(): HTMLElement {
  const existing = document.getElementById(CONTAINER_ID);
  if (existing) return existing;

  const container = document.createElement('div');
  container.id = CONTAINER_ID;
  container.style.cssText =
    'padding:15px;margin:20px 0;border:1px solid #ddd;background:#f9f9f9;text-align:center;';

  const target =
    document.querySelector(config.selector) ??
    document.querySelector('[data-cart-totals]') ??
    document.querySelector('form[action*="cart"]');

  if (target?.parentNode) {
    target.parentNode.insertBefore(container, target);
  } else {
    document.body.appendChild(container);
  }
  return container;
}

// ─── 4b. Cart Context (set during init) ──────────────────────────────────────

let _cartId = '';
let _customerId = 0;
let _cartMfId: number | undefined;
let _customerMfId: number | undefined;

// Svelte 4 component instance references
let statusCardInstance: InstanceType<typeof StatusCard> | null = null;
let modalWrapperEl: HTMLElement | null = null;

// ─── 5. Post-Verification Save & Refresh ────────────────────────────────────

async function saveVerificationAndRefreshUI(
  id: string,
  result: VerificationOutcome | null,
): Promise<void> {
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
  }
  await Promise.all(saves);
  await invalidateMetafieldCache(_cartId, _customerId);
  sessionStorage.setItem(COMPLETED_KEY, JSON.stringify({ verificationId: id, result, status: 'completed' }));

  // Update Svelte component prop → StatusCard re-renders
  statusCardInstance?.$set({ state: 'verified' as VerificationState });
  removeCheckoutBlock();

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
  }
  await Promise.all(saves);
  await invalidateMetafieldCache(_cartId, _customerId);
  sessionStorage.setItem(COMPLETED_KEY, JSON.stringify({ verificationId: id, result: null, status: 'manual_review' }));

  const reviewCfg = config.manualReview!;
  const msg = reviewCfg.message !== undefined ? reviewCfg.message : defaults.manualReview!.message;

  statusCardInstance?.$set({
    state: 'pending_review' as VerificationState,
    pendingReviewMessage: msg || null,
  });

  if (reviewCfg.blockCheckout) {
    renderCheckoutBlock();
  } else {
    removeCheckoutBlock();
  }
}

// ─── 6. Init ─────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const container = findOrCreateContainer();
  container.innerHTML =
    '<p style="margin:0;font-size:14px;color:#888;">Loading verification status...</p>';

  const cart = await loadCart();
  if (!cart) {
    // Degraded mode: no BC integration, just show the verify button
    mountStatusCard(container, 'unverified');
    return;
  }

  _cartId = cart.cartId;
  _customerId = cart.customerId;

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

  const cartMf = findVerificationMetafield(cartMetafields);
  const customerMf = findVerificationMetafield(customerMetafields);
  const resolved = resolveOverallState(cartMf, customerMf, config.ruleset);

  _cartMfId = resolved.cartMfId ?? undefined;
  _customerMfId = resolved.customerMfId ?? undefined;

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
      if (!sessionStorage.getItem(COMPLETED_KEY)) {
        sessionStorage.setItem(
          COMPLETED_KEY,
          JSON.stringify({ verificationId, result: verification, status }),
        );
      }
    } catch (_) {}
  }

  // Backfill: if now logged in but no customer metafield, check for a completed verification
  // from earlier in this session (e.g. verified as guest, then created an account).
  if (_customerId !== 0 && !customerMf && config.storeHash && config.storeAccessToken) {
    const completedJson = sessionStorage.getItem(COMPLETED_KEY);
    if (completedJson) {
      try {
        const { verificationId, result, status } = JSON.parse(completedJson) as {
          verificationId: string;
          result: VerificationOutcome | null;
          status: VerificationStatus;
        };
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
        _customerMfId = reresolved.customerMfId ?? undefined;
        mountStatusCard(container, reresolved.state);
        if (reresolved.state === 'pending_review') {
          if (isCheckout && config.manualReview?.blockCheckout) renderCheckoutBlock();
        } else if (reresolved.state !== 'verified' && isCheckout && config.ruleset.requireVerification) {
          renderCheckoutBlock();
        }
        return;
      } catch (_) {}
    }
  }

  mountStatusCard(container, resolved.state);

  if (resolved.state === 'pending_review') {
    if (isCheckout && config.manualReview?.blockCheckout) {
      renderCheckoutBlock();
    }
  } else if (resolved.state !== 'verified' && isCheckout && config.ruleset.requireVerification) {
    renderCheckoutBlock();
  }
}

// ─── 7. Svelte 4 Component Mounting ─────────────────────────────────────────

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
  if (modalWrapperEl) return; // Modal already open

  try {
    let id = sessionStorage.getItem(SESSION_KEY);

    if (!id) {
      const body: Parameters<typeof createVerification>[2] = {};
      if (config.templateId) body.template_id = config.templateId;
      ({ id } = await createVerification(config.apiBase, config.integrationKey, body));
      sessionStorage.setItem(SESSION_KEY, id);
    }

    const verificationUrl = `${config.verifyBase}/verify/${id}`;

    modalWrapperEl = document.createElement('div');
    document.body.appendChild(modalWrapperEl);

    const modal = new VerifyModal({
      target: modalWrapperEl,
      props: { verificationUrl, verificationId: id, apiBase: config.apiBase },
    });

    modal.$on('complete', (e: CustomEvent<{ verificationId: string; result: VerificationOutcome | null }>) => {
      sessionStorage.removeItem(SESSION_KEY);
      destroyModal(modal);
      void saveVerificationAndRefreshUI(e.detail.verificationId, e.detail.result);
    });

    modal.$on('manual_review', (e: CustomEvent<{ verificationId: string }>) => {
      sessionStorage.removeItem(SESSION_KEY);
      destroyModal(modal);
      void handleManualReviewResult(e.detail.verificationId);
    });

    modal.$on('close', () => destroyModal(modal));
  } catch (err) {
    console.error('[Ad-Hoc Verify] Error:', (err as Error).message);
    alert('Unable to start verification. Please try again.');
  }
}

function destroyModal(modal: InstanceType<typeof VerifyModal>): void {
  modal.$destroy();
  modalWrapperEl?.remove();
  modalWrapperEl = null;
}

// ─── 8. Bootstrap ────────────────────────────────────────────────────────────

// If a templateId is provided, fetch integration_config from the API and apply
// remote values for any fields the merchant did not explicitly set in the script tag.
// window.AdHocVerifyConfig always wins; remote config fills in everything else.
async function applyRemoteConfig(remote: IntegrationConfig): Promise<void> {
  if (!userConfig.storeHash && remote.storeHash) config.storeHash = remote.storeHash;
  if (!userConfig.storeAccessToken && remote.storeAccessToken) config.storeAccessToken = remote.storeAccessToken;
  if (!userConfig.pages && remote.pages) config.pages = remote.pages;
  if (!userConfig.ruleset && remote.ruleset) config.ruleset = { ...defaults.ruleset, ...remote.ruleset };
  if (!userConfig.manualReview && remote.manualReview) config.manualReview = { ...defaults.manualReview, ...remote.manualReview };
  if (!userConfig.buttonText && remote.buttonText) config.buttonText = remote.buttonText;
  if (!userConfig.selector && remote.selector) config.selector = remote.selector;
}

async function bootstrap(): Promise<void> {
  if (userConfig.templateId) {
    const remote = await getTemplateIntegrationConfig(
      config.apiBase,
      config.integrationKey,
      userConfig.templateId,
    );
    if (remote) await applyRemoteConfig(remote);
  }
  await init();
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
