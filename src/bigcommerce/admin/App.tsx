import React, { useState } from 'react';
import { GlobalStyles, Tabs } from '@bigcommerce/big-design';
import { theme } from '@bigcommerce/big-design-theme';
import { ThemeProvider } from 'styled-components';
import CustomersPage from './pages/CustomersPage.js';
import OrdersPage from './pages/OrdersPage.js';
import IntegrationConfigPage from './pages/IntegrationConfigPage.js';
import type { AdHocAdminConfig } from '../../core/types.js';

// Admin config injected by the BC app backend (or for dev: set directly on window)
const adminConfig = (
  window as Window & { AdHocAdminConfig?: AdHocAdminConfig }
).AdHocAdminConfig ?? {
  apiBase: 'https://verify-api.ad-hoc.app',
  storeHash: '',
  storeAccessToken: '',
};

type TabId = 'customers' | 'orders' | 'integration-config';

const TABS = [
  { id: 'customers' as TabId, title: 'Customers' },
  { id: 'orders' as TabId, title: 'Orders' },
  { id: 'integration-config' as TabId, title: 'Integration Config' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('customers');

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
          {activeTab === 'customers' && <CustomersPage config={adminConfig} />}
          {activeTab === 'orders' && <OrdersPage config={adminConfig} />}
          {activeTab === 'integration-config' && <IntegrationConfigPage config={adminConfig} />}
        </div>
      </div>
    </ThemeProvider>
  );
}
