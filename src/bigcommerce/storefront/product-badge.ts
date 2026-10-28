import type { ProductBadgeConfig, ProductBadgePosition } from '../../core/types.js';
import { log } from './logger.js';

export const DEFAULT_BADGE_TEXT = 'This product requires photo ID verification at checkout.';

const BADGE_ID = 'adhoc-verify-product-badge';

// Static markup (no user data) — a checkmark in a circle. Colours via currentColor so the badge
// follows the store's text colour unless the theme overrides it.
const CHECK_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
  '<circle cx="12" cy="12" r="10"></circle><path d="M8 12.5l2.5 2.5L16 9.5"></path></svg>';

interface Target {
  selectors: string[];
  position: ProductBadgePosition;
  /** Resolve to the enclosing block (e.g. the .form-action wrapper) rather than the matched element. */
  closest?: string;
}

// Selectors target Stencil/Cornerstone-based themes; each list is tried in order.
const PRESETS: Record<string, Target> = {
  above_description: {
    selectors: ['.productView-description', '[data-product-description]', '#tab-description', '.productView-tabs'],
    position: 'before',
  },
  below_price: {
    selectors: ['.productView-price', '[data-product-price-wrapper]'],
    position: 'after',
  },
  above_add_to_cart: {
    selectors: ['#form-action-addToCart', '[data-button-type="add-cart"]', 'form[data-cart-item-add] .form-action'],
    position: 'before',
    closest: '.form-action',
  },
  below_add_to_cart: {
    selectors: ['#form-action-addToCart', '[data-button-type="add-cart"]', 'form[data-cart-item-add] .form-action'],
    position: 'after',
    closest: '.form-action',
  },
};

// Last resort when the chosen spot isn't found on this theme.
const FALLBACK: Target = { selectors: ['.productView-title', 'h1'], position: 'after' };

function findFirst(selectors: string[]): Element | null {
  for (const s of selectors) {
    try {
      const el = document.querySelector(s);
      if (el) return el;
    } catch {
      // invalid merchant-supplied selector — try the next one
    }
  }
  return null;
}

function resolveTarget(cfg: ProductBadgeConfig): { el: Element; position: ProductBadgePosition } | null {
  const placement = cfg.placement ?? 'below_add_to_cart';

  let target: Target | null = null;
  if (placement === 'custom') {
    const sel = cfg.selector?.trim();
    if (sel) target = { selectors: [sel], position: cfg.position ?? 'after' };
  } else {
    target = PRESETS[placement] ?? null;
  }

  if (target) {
    const found = findFirst(target.selectors);
    if (found) {
      const el = (target.closest && found.closest(target.closest)) || found;
      return { el, position: target.position };
    }
    log(`Product badge: placement "${placement}" not found on this page — using fallback.`);
  }

  const fb = findFirst(FALLBACK.selectors);
  return fb ? { el: fb, position: FALLBACK.position } : null;
}

export function removeProductBadge(): void {
  document.getElementById(BADGE_ID)?.remove();
}

/** Injects (or re-injects) the badge. Returns false if no suitable spot was found. */
export function renderProductBadge(cfg: ProductBadgeConfig): boolean {
  removeProductBadge();
  const spot = resolveTarget(cfg);
  if (!spot) {
    log('Product badge: no insertion point found — not rendered.');
    return false;
  }

  const badge = document.createElement('div');
  badge.id = BADGE_ID;
  badge.setAttribute('role', 'note');
  badge.style.cssText =
    'display:flex;align-items:center;gap:8px;margin:12px 0;font-size:14px;line-height:1.4;';

  const icon = document.createElement('span');
  icon.style.cssText = 'display:inline-flex;flex:none;';
  icon.innerHTML = CHECK_ICON;

  const text = document.createElement('span');
  text.textContent = cfg.text?.trim() || DEFAULT_BADGE_TEXT; // textContent: merchant text is never parsed as HTML

  badge.append(icon, text);
  spot.el.insertAdjacentElement(
    { before: 'beforebegin', after: 'afterend', prepend: 'afterbegin', append: 'beforeend' }[spot.position] as InsertPosition,
    badge,
  );
  log(`Product badge: rendered (${cfg.placement ?? 'below_add_to_cart'}, ${spot.position}).`);
  return true;
}
