import React, { useState } from 'react';
import { GlobalStyles, Tabs } from '@bigcommerce/big-design';
import { theme } from '@bigcommerce/big-design-theme';
import { ThemeProvider } from 'styled-components';
import CustomerVerificationPage from './pages/CustomerVerificationPage.js';
import OrderVerificationPage from './pages/OrderVerificationPage.js';
import type { AdHocAdminConfig } from '../../core/types.js';

// Admin config injected by the BC app backend (or for dev: set directly on window)
const adminConfig = (
  window as Window & { AdHocAdminConfig?: AdHocAdminConfig }
).AdHocAdminConfig ?? {
  apiBase: 'https://verify-api.ad-hoc.app',
  storeHash: '',
  storeAccessToken: '',
};

type TabId = 'customer' | 'order';

const TABS = [
  { id: 'customer' as TabId, title: 'Customer Verification' },
  { id: 'order' as TabId, title: 'Order Verification' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('customer');

  return (
    <ThemeProvider theme={theme}>
      <GlobalStyles />
      <div style={{ padding: '24px' }}>
        <Tabs
          activeTab={activeTab}
          items={TABS}
          onTabClick={(tabId) => setActiveTab(tabId as TabId)}
        />
        <div style={{ marginTop: '24px' }}>
          {activeTab === 'customer' && <CustomerVerificationPage config={adminConfig} />}
          {activeTab === 'order' && <OrderVerificationPage config={adminConfig} />}
        </div>
      </div>
    </ThemeProvider>
  );
}
