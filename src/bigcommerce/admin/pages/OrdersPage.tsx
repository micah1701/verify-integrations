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
import { fetchOrdersList, fetchOrderDetail } from '../api/bc-proxy.js';
import type {
  AdHocAdminConfig,
  EnrichedOrder,
  EnrichedOrdersResponse,
  OrderDetailResponse,
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

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function VerificationBadge({ state }: { state: VerificationState }) {
  const { label, variant } = STATE_BADGE[state] ?? STATE_BADGE.unverified;
  return <Badge label={label} variant={variant} />;
}

function MetafieldTable({ mf }: { mf: MetafieldValue }) {
  const rows = [
    { field: 'Verification ID',  value: mf.verificationId },
    { field: 'Status',           value: mf.status },
    { field: 'Completed At',     value: mf.completedAt ? formatDate(mf.completedAt) : '—' },
    { field: 'Face Match Score', value: mf.verification.face_match_score ?? '—' },
    { field: 'Over 18',          value: String(mf.verification.over_18 ?? '—') },
    { field: 'Over 21',          value: String(mf.verification.over_21 ?? '—') },
    { field: 'Success',          value: String(mf.verification.success ?? '—') },
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

export default function OrdersPage({ config }: Props) {
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [listData, setListData] = useState<EnrichedOrdersResponse | null>(null);
  const [detailData, setDetailData] = useState<OrderDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchId, setSearchId] = useState('');

  // Load list whenever page/limit changes while in list view
  useEffect(() => {
    if (view !== 'list') return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchOrdersList(config.storeHash, page, limit).then((data) => {
      if (cancelled) return;
      if (!data) setError('Failed to load orders. Check server connection and store credentials.');
      else setListData(data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [view, page, limit, config.storeHash]);

  async function openDetail(orderId: number) {
    setDetailLoading(true);
    setError(null);
    const data = await fetchOrderDetail(config.storeHash, orderId);
    setDetailLoading(false);
    if (!data) {
      setError(`Order ${orderId} not found or could not be loaded.`);
      return;
    }
    setDetailData(data);
    setView('detail');
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
  }

  // ── Detail View ──────────────────────────────────────────────────────────────

  if (view === 'detail' && detailData) {
    const { order: o, metafield, verificationState, metafieldSource, linkedCustomer } = detailData;
    const customerName = o.customer_id > 0
      ? `${o.billing_address.first_name} ${o.billing_address.last_name}`
      : 'Guest';

    return (
      <>
        <Button variant="subtle" onClick={backToList} marginBottom="medium">
          ← Back to Orders
        </Button>

        <Panel header={`Order #${o.id}`} marginBottom="medium">
          <H4>Order Info</H4>
          <Table
            columns={[
              { header: 'Field', hash: 'field', render: (row) => <Text bold>{row.field}</Text> },
              { header: 'Value', hash: 'value', render: (row) => <Text>{row.value}</Text> },
            ]}
            items={[
              { field: 'Order #',     value: String(o.id) },
              { field: 'Status',      value: o.status },
              { field: 'Date',        value: formatDate(o.date_created) },
              { field: 'Total',       value: `${o.currency_code} ${o.total_inc_tax}` },
              { field: 'Items',       value: String(o.items_total) },
              { field: 'Customer ID', value: o.customer_id > 0 ? String(o.customer_id) : 'Guest' },
            ]}
            keyField="field"
          />
        </Panel>

        {o.customer_id > 0 && (
          <Panel header="Customer" marginBottom="medium">
            {linkedCustomer ? (
              <Table
                columns={[
                  { header: 'Field', hash: 'field', render: (row) => <Text bold>{row.field}</Text> },
                  { header: 'Value', hash: 'value', render: (row) => <Text>{row.value}</Text> },
                ]}
                items={[
                  { field: 'Customer ID', value: String(linkedCustomer.id) },
                  { field: 'Name',        value: `${linkedCustomer.first_name} ${linkedCustomer.last_name}` },
                  { field: 'Email',       value: linkedCustomer.email },
                  { field: 'Phone',       value: linkedCustomer.phone || '—' },
                  { field: 'Orders',      value: String(linkedCustomer.order_count) },
                  { field: 'Member Since', value: formatDate(linkedCustomer.date_created) },
                ]}
                keyField="field"
              />
            ) : (
              <Table
                columns={[
                  { header: 'Field', hash: 'field', render: (row) => <Text bold>{row.field}</Text> },
                  { header: 'Value', hash: 'value', render: (row) => <Text>{row.value}</Text> },
                ]}
                items={[
                  { field: 'Billing Name',  value: customerName },
                  { field: 'Billing Email', value: o.billing_address.email || '—' },
                  { field: 'Company',       value: o.billing_address.company || '—' },
                ]}
                keyField="field"
              />
            )}
          </Panel>
        )}

        <Panel header="Verification Status">
          <Flex alignItems="center" marginBottom="medium">
            <Box marginRight="medium">
              <H3>
                <VerificationBadge state={verificationState} />
              </H3>
            </Box>
            {metafieldSource === 'customer' && (
              <Small>Record found on customer account (Customer {o.customer_id}), not on the order itself.</Small>
            )}
          </Flex>
          {metafield ? (
            <MetafieldTable mf={metafield} />
          ) : (
            <Text>No Ad-Hoc Verify record found for this order.</Text>
          )}
        </Panel>
      </>
    );
  }

  // ── List View ────────────────────────────────────────────────────────────────

  const columns = [
    {
      header: 'Order #',
      hash: 'id',
      render: (row: EnrichedOrder) => (
        <Button variant="subtle" onClick={() => openDetail(row.order.id)}>
          {row.order.id}
        </Button>
      ),
    },
    {
      header: 'Customer',
      hash: 'customer',
      render: (row: EnrichedOrder) => (
        <Text>
          {row.order.customer_id > 0
            ? `${row.order.billing_address.first_name} ${row.order.billing_address.last_name}`
            : 'Guest'}
        </Text>
      ),
    },
    {
      header: 'Status',
      hash: 'status',
      render: (row: EnrichedOrder) => <Text>{row.order.status}</Text>,
    },
    {
      header: 'Total',
      hash: 'total',
      render: (row: EnrichedOrder) => (
        <Text>{row.order.currency_code} {row.order.total_inc_tax}</Text>
      ),
    },
    {
      header: 'Date',
      hash: 'date',
      render: (row: EnrichedOrder) => <Text>{formatDate(row.order.date_created)}</Text>,
    },
    {
      header: 'Verification',
      hash: 'verification',
      render: (row: EnrichedOrder) => (
        <>
          <VerificationBadge state={row.verificationState} />
          {row.metafieldSource === 'customer' && (
            <Small style={{ display: 'block', marginTop: '4px' }}>via customer</Small>
          )}
        </>
      ),
    },
  ];

  return (
    <>
      {/* Quick search by order ID */}
      <Panel header="Find Order by ID" marginBottom="medium">
        <Form onSubmit={handleSearch}>
          <Flex alignItems="flex-end">
            <Box marginRight="small" style={{ flex: '0 0 200px' }}>
              <FormGroup>
                <FormControlLabel htmlFor="order-search-id">Order ID</FormControlLabel>
                <Input
                  id="order-search-id"
                  value={searchId}
                  onChange={(e) => setSearchId(e.target.value)}
                  placeholder="e.g. 100"
                />
              </FormGroup>
            </Box>
            <Box marginBottom="medium">
              <Button type="submit" isLoading={detailLoading}>
                Go to Order
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

      <Panel header="Orders">
        {loading ? (
          <Flex justifyContent="center" paddingVertical="xxLarge">
            <ProgressCircle size="medium" />
          </Flex>
        ) : (
          <>
            <Table
              columns={columns}
              items={listData?.data ?? []}
              keyField="order.id"
              emptyComponent={
                <Text marginVertical="medium" align="center">
                  {listData ? 'No orders found.' : 'Loading...'}
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
                Showing {listData.data.length} of {listData.meta.pagination.total} orders
              </Small>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
