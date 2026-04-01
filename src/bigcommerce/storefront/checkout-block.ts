// Manages checkout button disabling and the verification-required warning banner.
// Handles SPA re-renders via MutationObserver so the block persists through
// React/Angular hydration on BC's checkout page.

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
  if (!btn) return;
  if (btn.getAttribute(BLOCKED_ATTR) === 'true') return;
  btn.setAttribute(ORIGINAL_DISABLED_ATTR, btn.disabled ? 'true' : 'false');
  btn.setAttribute(BLOCKED_ATTR, 'true');
  btn.disabled = true;
  btn.title = 'Identity verification required';
}

export function renderCheckoutBlock(): void {
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
    }
  }

  applyCheckoutButtonBlock();

  // Watch for SPA re-renders that might re-create the checkout button
  if (!observer) {
    observer = new MutationObserver(() => applyCheckoutButtonBlock());
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

export function removeCheckoutBlock(): void {
  disconnectObserver();

  const warning = document.getElementById(WARNING_ID);
  warning?.parentNode?.removeChild(warning);

  const btn = findCheckoutButton();
  if (btn && btn.getAttribute(BLOCKED_ATTR) === 'true') {
    btn.disabled = btn.getAttribute(ORIGINAL_DISABLED_ATTR) === 'true';
    btn.removeAttribute(ORIGINAL_DISABLED_ATTR);
    btn.removeAttribute(BLOCKED_ATTR);
    btn.title = '';
  }
}

export function disconnectObserver(): void {
  observer?.disconnect();
  observer = null;
}
