// Manages checkout button disabling and the verification-required warning banner.
// Handles SPA re-renders via MutationObserver so the block persists through
// React/Angular hydration on BC's checkout page.

import { log } from './logger.js';

const CONTAINER_ID = 'adhoc-verify-container';
const WARNING_ID = 'adhoc-checkout-warning';
const BLOCKED_ATTR = 'data-adhoc-blocked';
const ORIGINAL_DISABLED_ATTR = 'data-adhoc-original-disabled';

let observer: MutationObserver | null = null;

function findCheckoutButton(): HTMLButtonElement | null {
  return (
    document.querySelector<HTMLButtonElement>('.checkout-button') ??
    document.querySelector<HTMLButtonElement>('#checkout-button') ??
    document.querySelector<HTMLButtonElement>('[data-button-type="submit"]')
  );
}

function applyCheckoutButtonBlock(): void {
  const btn = findCheckoutButton();
  if (!btn) {
    log('applyCheckoutButtonBlock: checkout button not found in DOM yet — will retry via MutationObserver.');
    return;
  }
  if (btn.getAttribute(BLOCKED_ATTR) === 'true') {
    log('applyCheckoutButtonBlock: button already blocked — no action needed.');
    return;
  }
  btn.setAttribute(ORIGINAL_DISABLED_ATTR, btn.disabled ? 'true' : 'false');
  btn.setAttribute(BLOCKED_ATTR, 'true');
  btn.disabled = true;
  btn.title = 'Identity verification required';
  log('applyCheckoutButtonBlock: checkout button disabled.');
}

export function renderCheckoutBlock(): void {
  log('renderCheckoutBlock: installing verification-required warning and disabling checkout button.');
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

  // Watch for SPA re-renders that might re-create the checkout button
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
    'border-radius:4px;font-size:14px;color:#856404;';
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

  const warning = document.getElementById(WARNING_ID);
  if (warning) {
    warning.parentNode?.removeChild(warning);
    log('removeCheckoutBlock: warning banner removed from DOM.');
  }

  const btn = findCheckoutButton();
  if (btn && btn.getAttribute(BLOCKED_ATTR) === 'true') {
    btn.disabled = btn.getAttribute(ORIGINAL_DISABLED_ATTR) === 'true';
    btn.removeAttribute(ORIGINAL_DISABLED_ATTR);
    btn.removeAttribute(BLOCKED_ATTR);
    btn.title = '';
    log('removeCheckoutBlock: checkout button re-enabled.');
  } else {
    log('removeCheckoutBlock: checkout button was not blocked — nothing to re-enable.');
  }
}

export function disconnectObserver(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
    log('disconnectObserver: MutationObserver stopped.');
  }
}
