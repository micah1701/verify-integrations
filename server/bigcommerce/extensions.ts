/**
 * BigCommerce App Extensions registration (GraphQL Admin API).
 * Adds Action-menu items on Orders / Customers / Products that open a PANEL iframe.
 * Requires the app scope `store_app_extensions_manage`. Uninstalling the app removes them.
 */

interface ExtensionDef {
  model: 'ORDERS' | 'CUSTOMERS' | 'PRODUCTS' | 'PRODUCT_DESCRIPTION';
  label: string; // English, <= 25 chars recommended
  path: string; // relative app path; `${id}` is substituted by BC
}

export const EXTENSIONS: ExtensionDef[] = [
  { model: 'ORDERS', label: 'Verification', path: '/bigcommerce/ext/orders/${id}' },
  { model: 'CUSTOMERS', label: 'Verification', path: '/bigcommerce/ext/customers/${id}' },
  { model: 'PRODUCTS', label: 'Verification rule', path: '/bigcommerce/ext/products/${id}' },
  { model: 'PRODUCT_DESCRIPTION', label: 'Verification rule', path: '/bigcommerce/ext/products/${id}' },
];

interface ExistingExtension {
  id: string;
  context: string;
  model: string;
  url: string;
  label: { defaultValue: string };
}

async function gql<T>(storeHash: string, accessToken: string, query: string, variables?: unknown): Promise<T> {
  const res = await fetch(`https://api.bigcommerce.com/stores/${storeHash}/graphql`, {
    method: 'POST',
    headers: {
      'X-Auth-Token': accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
  if (!res.ok || !body || body.errors?.length || !body.data) {
    throw new Error(`BC GraphQL failed (${res.status}): ${JSON.stringify(body?.errors ?? body)}`);
  }
  return body.data;
}

const LIST_QUERY = `
  query {
    store {
      appExtensions {
        edges { node { id context model url label { defaultValue } } }
      }
    }
  }`;

const CREATE_MUTATION = `
  mutation ($input: CreateAppExtensionInput!) {
    appExtension { createAppExtension(input: $input) { appExtension { id } } }
  }`;

const UPDATE_MUTATION = `
  mutation ($input: UpdateAppExtensionInput!) {
    appExtension { updateAppExtension(input: $input) { appExtension { id } } }
  }`;

/**
 * Idempotently registers the extensions in EXTENSIONS: creates missing ones and
 * updates url/label on existing ones (context and model are immutable).
 * Never throws — a failure here must not break app installation. Returns whether it succeeded.
 */
export async function ensureExtensions(storeHash: string, accessToken: string): Promise<boolean> {
  try {
    const data = await gql<{
      store: { appExtensions: { edges: { node: ExistingExtension }[] } };
    }>(storeHash, accessToken, LIST_QUERY);
    const existing = data.store.appExtensions.edges.map((e) => e.node);

    for (const def of EXTENSIONS) {
      const label = { defaultValue: def.label, locales: [{ value: def.label, localeCode: 'en-US' }] };
      const match = existing.find((e) => e.model === def.model && e.context === 'PANEL');

      if (!match) {
        await gql(storeHash, accessToken, CREATE_MUTATION, {
          input: { context: 'PANEL', model: def.model, url: def.path, label },
        });
        console.log(`[extensions] created ${def.model} store=${storeHash}`);
      } else if (match.url !== def.path || match.label.defaultValue !== def.label) {
        await gql(storeHash, accessToken, UPDATE_MUTATION, {
          input: { id: match.id, data: { url: def.path, label } },
        });
        console.log(`[extensions] updated ${def.model} store=${storeHash}`);
      }
    }
    return true;
  } catch (err) {
    console.error(`[extensions] registration failed store=${storeHash}:`, err);
    return false;
  }
}
