# BigCommerce — Checkout Enforcement (`checkout-block.ts`)

BC's checkout is a **React SPA**. DOM nodes are replaced on every step, and React resets `button.disabled`. The implementation therefore:

1. Adds a **capturing-phase click listener** on the Place Order button (runs before React's synthetic events) that calls `preventDefault()` + `stopImmediatePropagation()`. This is the authoritative block.
2. Adds `pointer-events:none; opacity:.5; cursor:not-allowed` + `title` and a `data-adhoc-blocked="true"` marker for visual feedback and idempotency.
3. Runs a **`MutationObserver`** on `document.body` (`childList, subtree`) that re-runs `applyCheckoutButtonBlock()` so a replaced button is re-blocked and the old node's listener is detached.

## Public API

| Function | Behaviour |
|---|---|
| `renderCheckoutBlock(message?)` | Sets/keeps `currentBlockMessage`; inserts or updates the yellow banner `#adhoc-checkout-warning` after `#adhoc-verify-container`; blocks the button; starts the observer. Default text: "Identity verification is required to complete your purchase." |
| `renderCheckoutWarn(message)` | Soft warning only (`enforcement: 'warn'`): fixed full-width banner at top of the page; **button stays enabled**; no observer. |
| `removeCheckoutBlock()` | Clears message, disconnects observer, removes banners (`#adhoc-checkout-warning`, `#adhoc-place-order-warning`), detaches the click handler, restores button styles/attrs. |
| `disconnectObserver()` | Stops the blocking observer. |
| `insertShippingNameNotice(message)` / `removeShippingNameNotice()` | Blue notice above the shipping name fields (`#adhoc-name-notice`); its own observer re-inserts after re-render. (`remove…` is currently never called.) |

## Selectors used for the button
`.checkout-button`, then `#checkout-button`, then `.checkout-step--payment button[type="submit"]`. If BC changes its markup, update `findCheckoutButton()`.

## Messages
- Generic block: banner "Identity verification is required…"; Place Order warning "Identity verification required — [Complete verification] to place your order." (the link scrolls to the widget).
- Specific block reason (completed but failed rules, name mismatch, etc.): `currentBlockMessage` replaces both texts and drops the "Complete verification" link, since re-verifying won't help.
- Warn default: *"Your order may incur shipping delays or be cancelled until your identity can be verified."* (`checkoutEnforcement.warningMessage` overrides).

## Rules for changes
- Any new checkout-DOM manipulation must tolerate React re-renders (re-apply via observer or insert idempotently by element ID).
- Never rely on `disabled` alone.
- Keep inline styles (no stylesheet; the bundle can't ship CSS files).
- This is **client-side UX enforcement only**; document it as such to merchants.
