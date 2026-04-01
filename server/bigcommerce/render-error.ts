export function renderError(title: string, detail: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 40px; color: #333; }
    h1   { font-size: 1.25rem; color: #c0392b; }
    p    { color: #555; }
  </style>
</head>
<body>
  <h1>${escHtml(title)}</h1>
  <p>${escHtml(detail)}</p>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
