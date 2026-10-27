import React, { useEffect, useState } from 'react';
import { Badge, H4, InlineMessage, ProgressCircle, Small, Table, Text } from '@bigcommerce/big-design';
import type { MetafieldValue, VerificationState } from '../../../../core/types.js';
import type { ExtResult } from '../../api/ext-client.js';

type BadgeVariant = 'success' | 'danger' | 'warning' | 'secondary';

const STATE_BADGE: Record<VerificationState, { label: string; variant: BadgeVariant }> = {
  verified:       { label: 'Verified',       variant: 'success' },
  invalid:        { label: 'Invalid',        variant: 'danger' },
  incomplete:     { label: 'Incomplete',     variant: 'warning' },
  unverified:     { label: 'Unverified',     variant: 'secondary' },
  pending_review: { label: 'Pending Review', variant: 'warning' },
};

export function VerificationBadge({ state }: { state: VerificationState }) {
  const { label, variant } = STATE_BADGE[state] ?? STATE_BADGE.unverified;
  return <Badge label={label} variant={variant} />;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function MetafieldTable({ mf }: { mf: MetafieldValue }) {
  const rows = [
    { field: 'Verification ID',  value: mf.verificationId },
    { field: 'Status',           value: mf.status },
    { field: 'Completed',        value: mf.completedAt ? formatDate(mf.completedAt) : '—' },
    { field: 'Face match',       value: mf.verification.face_match_score ?? '—' },
    { field: 'Over 18',          value: String(mf.verification.over_18 ?? '—') },
    { field: 'Over 21',          value: String(mf.verification.over_21 ?? '—') },
  ];
  return (
    <Table
      columns={[
        { header: 'Field', hash: 'field', render: (row) => <Small>{row.field}</Small> },
        { header: 'Value', hash: 'value', render: (row) => <Text>{row.value}</Text> },
      ]}
      items={rows}
      keyField="field"
    />
  );
}

/** Loads once on mount and renders spinner / error / content. */
export function useExtData<T>(load: () => Promise<ExtResult<T>>) {
  const [result, setResult] = useState<ExtResult<T> | null>(null);
  useEffect(() => {
    let cancelled = false;
    load().then((r) => { if (!cancelled) setResult(r); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [result, setResult] as const;
}

export function PanelShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '16px' }}>
      <H4>{title}</H4>
      {children}
    </div>
  );
}

export function Loading() {
  return <ProgressCircle size="small" />;
}

export function ErrorMessage({ message }: { message: string }) {
  return <InlineMessage type="error" messages={[{ text: message }]} />;
}
