// Manages checkout button disabling and the verification-required warning banner.
// Handles SPA re-renders via MutationObserver so the block persists through
// React/Angular hydration on BC's checkout page.
//
// The BC checkout page is a React SPA. Setting btn.disabled = true from outside
// React is unreliable — React reconciliation resets it on every re-render. The
// reliable approach is a capturing-phase click listener (fires before React's
// synthetic event system) combined with pointer-events:none for visual feedback.
// The MutationObserver detects when React fully replaces the button element and
// re-attaches the listener to the new node.

import { log } from './logger.js';

const CONTAINER_ID = 'adhoc-verify-container';
const WARNING_ID = 'adhoc-checkout-warning';
const BLOCKED_ATTR = 'data-adhoc-blocked';

let observer: MutationObserver | null = null;

// Tracks the currently-blocked button element and its click handler so both can
// be cleaned up reliably even if React re-creates the element.
let blockedButton: HTMLButtonElement | null = null;
let blockClickHandler: ((e: Event) => void) | null = null;

function findCheckoutButton(): HTMLButtonElement | null {
  return (
    document.querySelector<HTMLButtonElement>('.checkout-button') ??
    document.querySelector<HTMLButtonElement>('#checkout-button') ??
    document.querySelector<HTMLButtonElement>('.checkout-step--payment button[type="submit"]')
  );
}

function applyCheckoutButtonBlock(): void {
  const btn = findCheckoutButton();
  if (!btn) {
    log('applyCheckoutButtonBlock: checkout button not found in DOM yet — will retry via MutationObserver.');
    return;
  }

  // If React replaced the button element entirely, detach from the old node first.
  if (blockedButton && blockedButton !== btn) {
    log('applyCheckoutButtonBlock: button element was replaced — detaching from old element and re-applying to new one.');
    if (blockClickHandler) {
      blockedButton.removeEventListener('click', blockClickHandler, true);
    }
    blockedButton = null;
  }

  // Already applied to this specific element — nothing to do.
  if (btn.getAttribute(BLOCKED_ATTR) === 'true') {
    log('applyCheckoutButtonBlock: button already blocked — no action needed.');
    return;
  }

  btn.setAttribute(BLOCKED_ATTR, 'true');
  btn.title = 'Identity verification required';

  // Visual: pointer-events:none prevents hover/click at the CSS level and
  // persists even if React resets the `disabled` property.
  btn.style.pointerEvents = 'none';
  btn.style.opacity = '0.5';
  btn.style.cursor = 'not-allowed';

  // Functional: capturing-phase listener fires before React's synthetic events.
  // This is the authoritative block — it works even if React resets the styles.
  if (!blockClickHandler) {
    blockClickHandler = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      log('applyCheckoutButtonBlock: checkout click intercepted and blocked.');
    };
  }
  btn.addEventListener('click', blockClickHandler, true);
  blockedButton = btn;

  log('applyCheckoutButtonBlock: checkout button blocked (pointer-events:none + click capture).');
}

export function renderCheckoutBlock(): void {
  log('renderCheckoutBlock: installing verification-required warning and blocking checkout button.');
  // Insert warning banner once
  if (!document.getElementById(WARNING_ID)) {
    const banner = document.createElement('div');
    banner.id = WARNING_ID;
    banner.style.cssText =
      'padding:10px 15px;margin:10px 0;background:#fff3cd;border:1px solid #ffc107;' +
      'border-radius:4px;font-size:14px;color:#856404;';
    banner.textContent = 'Identity verification is required to complete your purchase.';
    const container = document.getElementById(CONTAINER_ID);
    if (container?.parentNode) {
      container.parentNode.insertBefore(banner, container.nextSibling);
      log('renderCheckoutBlock: warning banner inserted into DOM.');
    } else {
      log('renderCheckoutBlock: container not found — warning banner could not be inserted.');
    }
  } else {
    log('renderCheckoutBlock: warning banner already present — skipping insert.');
  }

  applyCheckoutButtonBlock();

  // Watch for React fully replacing the checkout button (childList mutation on ancestors)
  if (!observer) {
    observer = new MutationObserver(() => applyCheckoutButtonBlock());
    observer.observe(document.body, { childList: true, subtree: true });
    log('renderCheckoutBlock: MutationObserver started to persist checkout block across SPA re-renders.');
  }
}

/**
 * Shows a soft warning banner near the checkout button without disabling it.
 * Used when checkoutEnforcement.mode = 'warn' — the customer can still proceed
 * but is informed their order may be affected.
 */
export function renderCheckoutWarn(message: string): void {
  log('renderCheckoutWarn: inserting soft warning banner (checkout button remains enabled).');
  if (document.getElementById(WARNING_ID)) {
    log('renderCheckoutWarn: warning banner already present — skipping insert.');
    return;
  }
  const banner = document.createElement('div');
  banner.id = WARNING_ID;
  banner.style.cssText =
    'padding:10px 15px;margin:10px 0;background:#fff3cd;border:1px solid #ffc107;' +
    'border-radius:4px;font-size:14px;color:#856404; position:fixed; top: 0; left: 0; width: 100%; z-index: 1000; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);';
  banner.textContent = message;
  const container = document.getElementById(CONTAINER_ID);
  if (container?.parentNode) {
    container.parentNode.insertBefore(banner, container.nextSibling);
    log('renderCheckoutWarn: warning banner inserted into DOM.');
  } else {
    log('renderCheckoutWarn: container not found — warning banner could not be inserted.');
  }
}

export function removeCheckoutBlock(): void {
  log('removeCheckoutBlock: removing checkout block and re-enabling checkout button.');
  disconnectObserver();

  // Remove warning banner
  const warning = document.getElementById(WARNING_ID);
  if (warning) {
    warning.parentNode?.removeChild(warning);
    log('removeCheckoutBlock: warning banner removed from DOM.');
  }

  // Detach click handler from tracked element
  if (blockedButton && blockClickHandler) {
    blockedButton.removeEventListener('click', blockClickHandler, true);
    log('removeCheckoutBlock: click capture listener removed.');
  }

  // Restore styles and attributes — use tracked ref first, fall back to a fresh lookup
  const btn = blockedButton ?? findCheckoutButton();
  if (btn && btn.getAttribute(BLOCKED_ATTR) === 'true') {
    btn.removeAttribute(BLOCKED_ATTR);
    btn.style.pointerEvents = '';
    btn.style.opacity = '';
    btn.style.cursor = '';
    btn.title = '';
    log('removeCheckoutBlock: checkout button styles restored.');
  } else {
    log('removeCheckoutBlock: checkout button was not blocked — nothing to restore.');
  }

  blockedButton = null;
  blockClickHandler = null;
}

export function disconnectObserver(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
    log('disconnectObserver: MutationObserver stopped.');
  }
}
