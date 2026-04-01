/**
 * Ad-Hoc Verify — BigCommerce Storefront Plugin
 *
 * Include via Script Manager (all pages, footer):
 *
 *   <script>
 *     window.AdHocVerifyConfig = {
 *       apiKey:           'ahv_pub_...',
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
  invalidateMetafieldCache,
} from './bc-adapter.js';
import { renderCheckoutBlock, removeCheckoutBlock } from './checkout-block.js';
import { resolveOverallState } from '../../core/verification-state.js';
import { createVerification } from '../../core/verify-api.js';
import type { AdHocVerifyConfig, VerificationOutcome, VerificationState } from '../../core/types.js';

// Injected at build time via Vite define
declare const __ADHOC_BC_CLIENT_ID__: string;

// ─── 1. Defaults & Config ────────────────────────────────────────────────────

const defaults: Omit<AdHocVerifyConfig, 'apiKey'> = {
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
};

const userConfig = (window as Window & { AdHocVerifyConfig?: Partial<AdHocVerifyConfig> })
  .AdHocVerifyConfig ?? {};

if (!userConfig.apiKey) {
  console.error('[Ad-Hoc Verify] Missing apiKey in AdHocVerifyConfig');
  // Stop execution without throwing (IIFE — a throw here would surface as uncaught)
} else {

const config: AdHocVerifyConfig = {
  ...defaults,
  ...userConfig,
  // Deep-merge ruleset so partial overrides still pick up defaults
  ruleset: { ...defaults.ruleset, ...(userConfig.ruleset ?? {}) },
} as AdHocVerifyConfig;

// ─── 2. Page Guard ───────────────────────────────────────────────────────────

function detectPage(): 'cart' | 'checkout' | null {
  const p = window.location.pathname;
  if (p.includes('/cart')) return 'cart';
  if (p.includes('/checkout')) return 'checkout';
  return null;
}

const currentPage = detectPage();
const configPages = Array.isArray(config.pages) ? config.pages : ['cart'];

if (currentPage && configPages.includes(currentPage)) {

const isCheckout = currentPage === 'checkout';

// ─── 3. Container ────────────────────────────────────────────────────────────

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

// ─── 4. Cart Context (set during init) ──────────────────────────────────────

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

  mountStatusCard(container, resolved.state);

  if (resolved.state !== 'verified' && isCheckout && config.ruleset.requireVerification) {
    renderCheckoutBlock();
  }
}

// ─── 7. Svelte 4 Component Mounting ─────────────────────────────────────────

function mountStatusCard(container: HTMLElement, initialState: VerificationState): void {
  container.innerHTML = '';
  statusCardInstance?.$destroy();

  statusCardInstance = new StatusCard({
    target: container,
    props: { state: initialState, buttonText: config.buttonText },
  });

  statusCardInstance.$on('verify', () => void handleVerifyClick());
}

async function handleVerifyClick(): Promise<void> {
  if (modalWrapperEl) return; // Modal already open

  try {
    const body: Parameters<typeof createVerification>[2] = {};
    if (config.templateId) body.template_id = config.templateId;

    const { id, url } = await createVerification(config.apiBase, config.apiKey, body);

    modalWrapperEl = document.createElement('div');
    document.body.appendChild(modalWrapperEl);

    const modal = new VerifyModal({
      target: modalWrapperEl,
      props: { verificationUrl: url, verificationId: id, apiBase: config.apiBase },
    });

    modal.$on('complete', (e: CustomEvent<{ verificationId: string; result: VerificationOutcome | null }>) => {
      destroyModal(modal);
      void saveVerificationAndRefreshUI(e.detail.verificationId, e.detail.result);
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init());
} else {
  void init();
}

} // end page guard
} // end apiKey guard
