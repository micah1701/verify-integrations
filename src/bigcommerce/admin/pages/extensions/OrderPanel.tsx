import React from 'react';
import { Flex, Small, Text } from '@bigcommerce/big-design';
import { fetchExtOrder } from '../../api/ext-client.js';
import type { AdHocExtensionConfig } from '../../../../core/types.js';
import { ErrorMessage, Loading, MetafieldTable, PanelShell, useExtData, VerificationBadge } from './shared.js';

const SOURCE_NOTE = {
  cart: 'Record found on the order’s originating cart.',
  customer: 'Record found on the customer account, not on this order.',
} as const;

export default function OrderPanel({ config }: { config: AdHocExtensionConfig }) {
  const [result] = useExtData(() => fetchExtOrder(config));

  return (
    <PanelShell title={`Order #${config.id} — Verification`}>
      {!result && <Loading />}
      {result && !result.ok && <ErrorMessage message={result.error} />}
      {result?.ok && (
        <>
          <Flex flexDirection="row" alignItems="center" marginBottom="small">
            <VerificationBadge state={result.data.verificationState} />
          </Flex>
          {result.data.metafield ? (
            <>
              <MetafieldTable mf={result.data.metafield} />
              {(result.data.metafieldSource === 'cart' || result.data.metafieldSource === 'customer') && (
                <Small>{SOURCE_NOTE[result.data.metafieldSource]}</Small>
              )}
            </>
          ) : (
            <Text>
              No Ad-Hoc Verify record found for this order
              {result.data.order.customer_id === 0 ? ' (guest checkout).' : '.'}
            </Text>
          )}
        </>
      )}
    </PanelShell>
  );
}
