import React, { useState, useEffect } from 'react';
import {
  Panel,
  Table,
  Badge,
  Button,
  Text,
  H3,
  H4,
  InlineMessage,
  OffsetPagination,
  ProgressCircle,
  Form,
  FormGroup,
  FormControlLabel,
  Input,
  Flex,
  Box,
  Small,
} from '@bigcommerce/big-design';
import { fetchCustomersList, fetchCustomerDetail } from '../api/bc-proxy.js';
import { computeNameHash, getVerificationResult } from '../../../core/verify-api.js';
import type {
  AdHocAdminConfig,
  EnrichedCustomer,
  EnrichedCustomersResponse,
  CustomerDetailResponse,
  VerificationState,
  MetafieldValue,
} from '../../../core/types.js';

interface Props {
  config: AdHocAdminConfig;
}

type BadgeVariant = 'success' | 'danger' | 'warning' | 'secondary';

const STATE_BADGE: Record<VerificationState, { label: string; variant: BadgeVariant }> = {
  verified:       { label: 'Verified',       variant: 'success' },
  invalid:        { label: 'Invalid',        variant: 'danger' },
  incomplete:     { label: 'Incomplete',     variant: 'warning' },
  unverified:     { label: 'Unverified',     variant: 'secondary' },
  pending_review: { label: 'Pending Review', variant: 'warning' },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function VerificationBadge({ state }: { state: VerificationState }) {
  const { label, variant } = STATE_BADGE[state] ?? STATE_BADGE.unverified;
  return <Badge label={label} variant={variant} />;
}

function MetafieldTable({ mf, nameMatch }: { mf: MetafieldValue; nameMatch?: boolean | null }) {
  const rows = [
    { field: 'Verification ID', value: mf.verificationId },
    { field: 'Status',          value: mf.status },
    { field: 'Completed At',    value: mf.completedAt ? formatDate(mf.completedAt) : '—' },
    { field: 'Face Match Score', value: mf.verification.face_match_score ?? '—' },
    { field: 'Over 18',         value: String(mf.verification.over_18 ?? '—') },
    { field: 'Over 21',         value: String(mf.verification.over_21 ?? '—') },
    { field: 'Success',         value: String(mf.verification.success ?? '—') },
    { field: 'Name Match',      value: nameMatch === true ? '✓ Match' : nameMatch === false ? '✗ Mismatch' : '—' },
  ];
  return (
    <Table
      columns={[
        { header: 'Field', hash: 'field', render: (row) => <Text>{row.field}</Text> },
        { header: 'Value', hash: 'value', render: (row) => <Text>{row.value}</Text> },
      ]}
      items={rows}
      keyField="field"
    />
  );
}

export default function CustomersPage({ config }: Props) {
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [listData, setListData] = useState<EnrichedCustomersResponse | null>(null);
  const [detailData, setDetailData] = useState<CustomerDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchId, setSearchId] = useState('');
  const [nameMatch, setNameMatch] = useState<boolean | null>(null);

  // Load list whenever page/limit changes while in list view
  useEffect(() => {
    if (view !== 'list') return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCustomersList(config.storeHash, page, limit).then((data) => {
      if (cancelled) return;
      if (!data) setError('Failed to load customers. Check server connection and store credentials.');
      else setListData(data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [view, page, limit, config.storeHash]);

  async function openDetail(customerId: number) {
    setDetailLoading(true);
    setError(null);
    setNameMatch(null);
    const data = await fetchCustomerDetail(config.storeHash, customerId);
    setDetailLoading(false);
    if (!data) {
      setError(`Customer ${customerId} not found or could not be loaded.`);
      return;
    }
    setDetailData(data);
    setView('detail');

    const mf = data.metafield;
    if (mf?.verificationId) {
      let blockchainName = mf.verification.blockchain_name ?? null;
      if (!blockchainName) {
        const fresh = await getVerificationResult(config.apiBase, mf.verificationId);
        blockchainName = fresh?.result?.blockchain_name ?? null;
      }
      if (blockchainName) {
        const computed = await computeNameHash(
          data.customer.first_name,
          data.customer.last_name,
          mf.verificationId,
        );
        setNameMatch(computed === blockchainName);
      }
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const id = parseInt(searchId.trim(), 10);
    if (!id) return;
    await openDetail(id);
  }

  function backToList() {
    setView('list');
    setDetailData(null);
    setError(null);
    setNameMatch(null);
  }

  // ── Detail View ──────────────────────────────────────────────────────────────

  if (view === 'detail' && detailData) {
    const { customer: c, metafield, verificationState } = detailData;
    return (
      <>
        <Button variant="subtle" onClick={backToList} marginBottom="medium">
          ← Back to Customers
        </Button>

        <Panel
          header={`Customer ${c.id} — ${c.first_name} ${c.last_name}`}
          marginBottom="medium"
        >
          <H4>Customer Info</H4>
          <Table
            columns={[
              { header: 'Field', hash: 'field', render: (row) => <Text bold>{row.field}</Text> },
              { header: 'Value', hash: 'value', render: (row) => <Text>{row.value}</Text> },
            ]}
            items={[
              { field: 'ID',           value: String(c.id) },
              { field: 'Name',         value: `${c.first_name} ${c.last_name}` },
              { field: 'Email',        value: c.email },
              { field: 'Company',      value: c.company || '—' },
              { field: 'Phone',        value: c.phone || '—' },
              { field: 'Member Since', value: formatDate(c.date_created) },
              { field: 'Last Updated', value: formatDate(c.date_modified) },
              { field: 'Orders',       value: String(c.order_count) },
              { field: 'Addresses',    value: String(c.address_count) },
            ]}
            keyField="field"
          />
        </Panel>

        <Panel header="Verification Status">
          <Flex alignItems="center" marginBottom="medium">
            <Box marginRight="medium">
              <H3>
                <VerificationBadge state={verificationState} />
              </H3>
            </Box>
          </Flex>
          {metafield ? (
            <MetafieldTable mf={metafield} nameMatch={nameMatch} />
          ) : (
            <Text>No Ad-Hoc Verify record found for this customer.</Text>
          )}
        </Panel>
      </>
    );
  }

  // ── List View ────────────────────────────────────────────────────────────────

  const columns = [
    {
      header: 'ID',
      hash: 'id',
      render: (row: EnrichedCustomer) => (
        <Button variant="subtle" onClick={() => openDetail(row.customer.id)}>
          {row.customer.id}
        </Button>
      ),
    },
    {
      header: 'Name',
      hash: 'name',
      render: (row: EnrichedCustomer) => (
        <Button variant="subtle" onClick={() => openDetail(row.customer.id)}>
          {row.customer.first_name} {row.customer.last_name}
        </Button>
      ),
    },
    {
      header: 'Email',
      hash: 'email',
      render: (row: EnrichedCustomer) => <Text>{row.customer.email}</Text>,
    },
    {
      header: 'Orders',
      hash: 'orders',
      render: (row: EnrichedCustomer) => <Text>{row.customer.order_count}</Text>,
    },
    {
      header: 'Member Since',
      hash: 'date',
      render: (row: EnrichedCustomer) => <Text>{formatDate(row.customer.date_created)}</Text>,
    },
    {
      header: 'Verification',
      hash: 'verification',
      render: (row: EnrichedCustomer) => <VerificationBadge state={row.verificationState} />,
    },
  ];

  return (
    <>
      {/* Quick search by ID */}
      <Panel header="Find Customer by ID" marginBottom="medium">
        <Form onSubmit={handleSearch}>
          <Flex alignItems="flex-end">
            <Box marginRight="small" style={{ flex: '0 0 200px' }}>
              <FormGroup>
                <FormControlLabel htmlFor="customer-search-id">Customer ID</FormControlLabel>
                <Input
                  id="customer-search-id"
                  value={searchId}
                  onChange={(e) => setSearchId(e.target.value)}
                  placeholder="e.g. 12345"
                />
              </FormGroup>
            </Box>
            <Box marginBottom="medium">
              <Button type="submit" isLoading={detailLoading}>
                Go to Customer
              </Button>
            </Box>
          </Flex>
        </Form>
      </Panel>

      {error && (
        <InlineMessage
          type="error"
          messages={[{ text: error }]}
          marginBottom="medium"
        />
      )}

      <Panel header="Customers">
        {loading ? (
          <Flex justifyContent="center" paddingVertical="xxLarge">
            <ProgressCircle size="medium" />
          </Flex>
        ) : (
          <>
            <Table
              columns={columns}
              items={listData?.data ?? []}
              keyField="customer.id"
              emptyComponent={
                <Text marginVertical="medium" align="center">
                  {listData ? 'No customers found.' : 'Loading...'}
                </Text>
              }
            />
            {listData && listData.meta.pagination.total_pages > 1 && (
              <Flex justifyContent="center" marginTop="medium">
                <OffsetPagination
                  currentPage={page}
                  itemsPerPage={limit}
                  itemsPerPageOptions={[10, 25, 50]}
                  totalItems={listData.meta.pagination.total}
                  onPageChange={(p) => setPage(p)}
                  onItemsPerPageChange={(n) => { setLimit(n); setPage(1); }}
                />
              </Flex>
            )}
            {listData && (
              <Small>
                Showing {listData.data.length} of {listData.meta.pagination.total} customers
              </Small>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
