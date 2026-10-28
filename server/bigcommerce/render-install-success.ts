/**
 * Confirmation page shown at the end of the OAuth install (/auth). BC displays it inside the
 * control-panel iframe. It has no store data and needs no signed payload — the real app UI is
 * opened from Apps → My Apps, which goes through /load.
 */
export function renderInstallSuccess(opts: { extensionsRegistered: boolean }): string {
  const extensionTip = opts.extensionsRegistered
    ? `<li>Check a customer’s verification from <strong>Orders</strong>, <strong>Customers</strong> or <strong>Products</strong>: open the row’s <strong>Action</strong> menu and choose <strong>Verification</strong>.</li>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ad-Hoc Verify installed</title>
  <style>
    body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; margin: 0; padding: 48px 24px; color: #1f2937; background: #f9fafb; }
    .card { max-width: 560px; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 32px; }
    .check { width: 44px; height: 44px; border-radius: 50%; background: #d1fae5; color: #047857; display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 16px; }
    h1 { font-size: 1.4rem; margin: 0 0 8px; }
    p  { color: #4b5563; line-height: 1.5; margin: 0 0 16px; }
    ol { color: #4b5563; line-height: 1.6; padding-left: 20px; margin: 0; }
    li { margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check" aria-hidden="true">&#10003;</div>
    <h1>Ad-Hoc Verify is installed</h1>
    <p>Your store is connected. Here’s how to get started:</p>
    <ol>
      <li>In your BigCommerce control panel, go to <strong>Apps &rarr; My Apps</strong> and open <strong>Ad-Hoc Verify</strong>.</li>
      <li>Use the <strong>Integration Config</strong> tab to choose when customers are asked to verify their ID.</li>
      ${extensionTip}
    </ol>
  </div>
</body>
</html>`;
}
