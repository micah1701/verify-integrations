import React, { useState } from 'react';
import { Checkbox, Small, Text } from '@bigcommerce/big-design';
import { fetchExtProduct, setExtProductFlag } from '../../api/ext-client.js';
import type { AdHocExtensionConfig, ExtProductResponse } from '../../../../core/types.js';
import { ErrorMessage, Loading, PanelShell, useExtData } from './shared.js';

export default function ProductPanel({ config }: { config: AdHocExtensionConfig }) {
  const [result, setResult] = useExtData(() => fetchExtProduct(config));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setSaving(true);
    setSaveError(null);
    const r = await setExtProductFlag(config, next);
    setSaving(false);
    if (!r.ok) {
      setSaveError(r.error);
      return;
    }
    setResult((prev) =>
      prev?.ok
        ? { ok: true, data: { ...prev.data, requiresVerification: r.data.requiresVerification } as ExtProductResponse }
        : prev,
    );
  }

  return (
    <PanelShell title="Verification rule">
      {!result && <Loading />}
      {result && !result.ok && <ErrorMessage message={result.error} />}
      {result?.ok && (
        <>
          <Text bold marginBottom="none">{result.data.product.name}</Text>
          {result.data.product.sku && <Small>SKU {result.data.product.sku}</Small>}
          <div style={{ marginTop: '16px' }}>
            <Checkbox
              label="Require ID verification when this product is in the cart"
              checked={result.data.requiresVerification}
              disabled={saving}
              onChange={(e) => toggle(e.target.checked)}
            />
          </div>
          <Small>
            Applies on stores using the “Product flag” trigger mode. Changes take effect on the storefront immediately.
          </Small>
          {saveError && <ErrorMessage message={saveError} />}
        </>
      )}
    </PanelShell>
  );
}
