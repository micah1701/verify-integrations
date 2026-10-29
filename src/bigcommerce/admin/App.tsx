import React, { useState } from 'react';
import { GlobalStyles, Tabs } from '@bigcommerce/big-design';
import { theme } from '@bigcommerce/big-design-theme';
import { ThemeProvider } from 'styled-components';
import CustomersPage from './pages/CustomersPage.js';
import OrdersPage from './pages/OrdersPage.js';
import IntegrationConfigPage from './pages/IntegrationConfigPage.js';
import OrderPanel from './pages/extensions/OrderPanel.js';
import CustomerPanel from './pages/extensions/CustomerPanel.js';
import ProductPanel from './pages/extensions/ProductPanel.js';
import type { AdHocAdminConfig, AdHocExtensionConfig } from '../../core/types.js';

// Admin config injected by the BC app backend (or for dev: set directly on window)
const adminConfig = (
  window as Window & { AdHocAdminConfig?: AdHocAdminConfig }
).AdHocAdminConfig ?? {
  apiBase: 'https://edge.adhocverify.com/functions/v1',
  storeHash: '',
  storeAccessToken: '',
};

// Present only when served from /bigcommerce/ext/:entity/:id (BC App Extension panel)
const extensionConfig = (
  window as Window & { AdHocExtensionConfig?: AdHocExtensionConfig }
).AdHocExtensionConfig;

function ExtensionPanel({ config }: { config: AdHocExtensionConfig }) {
  return (
    <ThemeProvider theme={theme}>
      <GlobalStyles />
      {config.entity === 'orders' && <OrderPanel config={config} />}
      {config.entity === 'customers' && <CustomerPanel config={config} />}
      {config.entity === 'products' && <ProductPanel config={config} />}
    </ThemeProvider>
  );
}

type TabId ='customers' | 'orders' | 'integration-config';

const TABS = [
  { id: 'customers' as TabId, title: 'Customers' },
  { id: 'orders' as TabId, title: 'Orders' },
  { id: 'integration-config' as TabId, title: 'Integration Config' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('customers');

  if (extensionConfig) return <ExtensionPanel config={extensionConfig} />;

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
