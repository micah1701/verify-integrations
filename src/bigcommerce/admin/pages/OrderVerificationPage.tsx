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
  Small,
} from '@bigcommerce/big-design';
import { bcMetafieldsProxy } from '../../../core/verify-api.js';
import { evaluateVerificationState } from '../../../core/verification-state.js';
import type { AdHocAdminConfig, BCRawMetafield, MetafieldValue } from '../../../core/types.js';

interface Props {
  config: AdHocAdminConfig;
}

interface VerificationResult {
  orderId: string;
  customerId: number;
  metafield: MetafieldValue | null;
  state: string;
  source: 'order' | 'customer' | null;
}

// Proxy returns cart metafields resolved via the order's cart_id, plus order context.
interface OrderProxyResponse {
  data: BCRawMetafield[];
  resolvedCustomerId: number;
  cartId: string;
}

interface CustomerProxyResponse {
  data: BCRawMetafield[];
}

function findVerifyMetafield(metafields: BCRawMetafield[]): MetafieldValue | null {
  const mf = metafields.find(
    (m) => m.namespace === 'Ad-Hoc Verify' && m.key === 'verification',
  );
  if (!mf) return null;
  try { return JSON.parse(mf.value) as MetafieldValue; } catch (_) { return null; }
}

export default function OrderVerificationPage({ config }: Props) {
  const [orderId, setOrderId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    const id = orderId.trim();
    if (!id) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Step 1: Read order metafields directly. The proxy also returns resolvedCustomerId
      // (the BC customer linked to this order, 0 for guests).
      const orderData = await bcMetafieldsProxy<OrderProxyResponse>(config.apiBase, {
        action: 'read',
        storeHash: config.storeHash,
        storeAccessToken: config.storeAccessToken,
        resource: 'order',
        resourceId: id,
      });

      if (!orderData) {
        setError('No response from server. Check your store credentials.');
        return;
      }

      const resolvedCustomerId = orderData.resolvedCustomerId ?? 0;
      let mfValue = findVerifyMetafield(orderData.data);
      let source: 'order' | 'customer' | null = mfValue ? 'order' : null;

      // Step 2: If no order metafield and the order has a linked customer, check
      // customer metafields as a fallback (covers orders placed before order-metafield
      // writing was added, and logged-in customers who verified before checking out).
      if (!mfValue && resolvedCustomerId > 0) {
        const customerData = await bcMetafieldsProxy<CustomerProxyResponse>(config.apiBase, {
          action: 'read',
          storeHash: config.storeHash,
          storeAccessToken: config.storeAccessToken,
          resource: 'customer',
          resourceId: String(resolvedCustomerId),
        });
        if (customerData) {
          mfValue = findVerifyMetafield(customerData.data);
          if (mfValue) source = 'customer';
        }
      }

      const state = evaluateVerificationState(mfValue, {
        requireVerification: false,
        minFaceMatchScore: null,
        requireOver18: false,
        requireOver21: false,
      });

      setResult({ orderId: id, customerId: resolvedCustomerId, metafield: mfValue, state, source });
    } catch (err) {
      setError((err as Error).message ?? 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Panel header="Look Up Order Verification">
        <Form onSubmit={handleLookup}>
          <FormGroup>
            <FormControlLabel htmlFor="order-id">Order ID</FormControlLabel>
            <Input
              id="order-id"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              placeholder="e.g. 100"
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
        <Panel
          header={`Order ${result.orderId}${result.customerId > 0 ? ` — Customer ${result.customerId}` : ' — Guest'}`}
        >
          {result.metafield === null ? (
            <Text>No verification record found for this order.</Text>
          ) : (
            <>
              <H2>
                <Badge
                  label={result.state.toUpperCase()}
                  variant={result.state === 'verified' ? 'success' : 'danger'}
                />
              </H2>
              {result.source === 'customer' && (
                <Small>
                  Verification found on customer record (Customer {result.customerId}). No separate order-level record exists.
                </Small>
              )}
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
