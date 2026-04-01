import React, { useState } from 'react';
import {
  Panel,
  Form,
  FormGroup,
  FormControlLabel,
  Input,
  Button,
  Table,
  Badge,
  Text,
  H2,
  InlineMessage,
} from '@bigcommerce/big-design';
import { bcMetafieldsProxy } from '../../../core/verify-api.js';
import { evaluateVerificationState } from '../../../core/verification-state.js';
import type { AdHocAdminConfig, BCRawMetafield, MetafieldValue } from '../../../core/types.js';

interface Props {
  config: AdHocAdminConfig;
}

interface VerificationResult {
  customerId: string;
  metafield: MetafieldValue | null;
  state: string;
}

interface BCMetafieldsListResponse {
  data: BCRawMetafield[];
}

export default function CustomerVerificationPage({ config }: Props) {
  const [customerId, setCustomerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    const id = customerId.trim();
    if (!id) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await bcMetafieldsProxy<BCMetafieldsListResponse>(config.apiBase, {
        action: 'read',
        storeHash: config.storeHash,
        storeAccessToken: config.storeAccessToken,
        resource: 'customer',
        resourceId: id,
      });

      const metafields: BCRawMetafield[] = data?.data ?? [];
      const verifyMf = metafields.find(
        (mf) => mf.namespace === 'Ad-Hoc Verify' && mf.key === 'verification',
      );

      let mfValue: MetafieldValue | null = null;
      if (verifyMf) {
        try { mfValue = JSON.parse(verifyMf.value) as MetafieldValue; } catch (_) {}
      }

      const state = evaluateVerificationState(mfValue, {
        requireVerification: false,
        minFaceMatchScore: null,
        requireOver18: false,
        requireOver21: false,
      });

      setResult({ customerId: id, metafield: mfValue, state });
    } catch (err) {
      setError((err as Error).message ?? 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Panel header="Look Up Customer Verification">
        <Form onSubmit={handleLookup}>
          <FormGroup>
            <FormControlLabel htmlFor="customer-id">Customer ID</FormControlLabel>
            <Input
              id="customer-id"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              placeholder="e.g. 12345"
              required
            />
          </FormGroup>
          <Button type="submit" isLoading={loading}>
            Look Up
          </Button>
        </Form>
      </Panel>

      {error && (
        <InlineMessage
          type="error"
          messages={[{ text: error }]}
          marginVertical="medium"
        />
      )}

      {result && (
        <Panel header={`Customer ${result.customerId} — Verification Status`}>
          {result.metafield === null ? (
            <Text>No verification record found for this customer.</Text>
          ) : (
            <>
              <H2>
                <Badge
                  label={result.state.toUpperCase()}
                  variant={result.state === 'verified' ? 'success' : 'danger'}
                />
              </H2>
              <Table
                columns={[
                  { header: 'Field', hash: 'field', render: (row) => row.field },
                  { header: 'Value', hash: 'value', render: (row) => String(row.value ?? '—') },
                ]}
                items={[
                  { field: 'Verification ID', value: result.metafield.verificationId },
                  { field: 'Status', value: result.metafield.status },
                  { field: 'Completed At', value: result.metafield.completedAt },
                  { field: 'Face Match Score', value: result.metafield.verification.face_match_score },
                  { field: 'Over 18', value: String(result.metafield.verification.over_18) },
                  { field: 'Over 21', value: String(result.metafield.verification.over_21) },
                  { field: 'Success', value: String(result.metafield.verification.success) },
                ]}
              />
            </>
          )}
        </Panel>
      )}
    </>
  );
}
