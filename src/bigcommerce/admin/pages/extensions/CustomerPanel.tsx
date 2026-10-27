import React from 'react';
import { Flex, Small, Text } from '@bigcommerce/big-design';
import { fetchExtCustomer } from '../../api/ext-client.js';
import type { AdHocExtensionConfig } from '../../../../core/types.js';
import { ErrorMessage, Loading, MetafieldTable, PanelShell, useExtData, VerificationBadge } from './shared.js';

export default function CustomerPanel({ config }: { config: AdHocExtensionConfig }) {
  const [result] = useExtData(() => fetchExtCustomer(config));

  return (
    <PanelShell title="Customer verification">
      {!result && <Loading />}
      {result && !result.ok && <ErrorMessage message={result.error} />}
      {result?.ok && (
        <>
          <Text bold marginBottom="none">
            {result.data.customer.first_name} {result.data.customer.last_name}
          </Text>
          <Small>{result.data.customer.email}</Small>
          <Flex flexDirection="row" alignItems="center" marginVertical="small">
            <VerificationBadge state={result.data.verificationState} />
          </Flex>
          {result.data.metafield ? (
            <MetafieldTable mf={result.data.metafield} />
          ) : (
            <Text>No Ad-Hoc Verify record found for this customer.</Text>
          )}
        </>
      )}
    </PanelShell>
  );
}
