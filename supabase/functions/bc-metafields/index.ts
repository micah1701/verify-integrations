/**
 * bc-metafields — BigCommerce Metafields Proxy
 *
 * Proxies cart, customer, and order metafield reads/writes to the BigCommerce
 * Management API server-to-server, bypassing browser CORS restrictions.
 *
 * The browser sends storeHash + storeAccessToken in the request body.
 * This function relays them to api.bigcommerce.com and returns the result.
 *
 * Request body:
 *   action:           'read' | 'write'
 *   storeHash:        string    — BigCommerce store hash
 *   storeAccessToken: string    — X-Auth-Token (store-level API account)
 *   resource:         'cart' | 'customer' | 'order'
 *   resourceId:       string    — cart UUID, customer integer ID, or order integer ID
 *   metafieldId?:     number    — present on write → PUT, absent → POST
 *   payload?:         object    — metafield body for write operations
 *
 * When resource === 'order':
 *   - Fetches GET /v2/orders/{id} to resolve cart_id and customer_id
 *   - Then reads/writes metafields on /v3/carts/{cart_id}/metafields
 *   - Response includes extra `resolvedCustomerId` and `cartId` fields
 *   - Works for both guest and logged-in orders (cart persists post-checkout)
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BC_API = 'https://api.bigcommerce.com'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { action, storeHash, storeAccessToken, resource, resourceId, metafieldId, payload } = body

  // Validate required fields
  if (!storeHash || typeof storeHash !== 'string' || !/^[a-z0-9]+$/i.test(storeHash)) {
    return new Response(JSON.stringify({ error: 'Invalid storeHash' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!storeAccessToken || typeof storeAccessToken !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing storeAccessToken' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (resource !== 'cart' && resource !== 'customer' && resource !== 'order') {
    return new Response(JSON.stringify({ error: 'resource must be "cart", "customer", or "order"' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!resourceId) {
    return new Response(JSON.stringify({ error: 'Missing resourceId' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (action !== 'read' && action !== 'write') {
    return new Response(JSON.stringify({ error: 'action must be "read" or "write"' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (action === 'write' && !payload) {
    return new Response(JSON.stringify({ error: 'payload required for write action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const bcHeaders: Record<string, string> = {
    'X-Auth-Token': storeAccessToken,
    'Accept': 'application/json',
  }
  if (action === 'write') {
    bcHeaders['Content-Type'] = 'application/json'
  }

  try {
    // For order resource: resolve cart_id (and customer_id for context) via GET /v2/orders/{id}
    let resolvedCustomerId: number | undefined
    let resolvedCartId: string | undefined
    let effectiveResourceId = resourceId

    if (resource === 'order') {
      const orderRes = await fetch(
        `${BC_API}/stores/${storeHash}/v2/orders/${resourceId}`,
        { headers: bcHeaders }
      )
      if (!orderRes.ok) {
        const errText = await orderRes.text()
        let errData: any
        try { errData = JSON.parse(errText) } catch { errData = { raw: errText } }
        return new Response(JSON.stringify({ error: 'Failed to fetch order', detail: errData }), {
          status: orderRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const orderData = await orderRes.json()
      resolvedCustomerId = orderData.customer_id ?? 0
      resolvedCartId = orderData.cart_id
      if (!resolvedCartId) {
        return new Response(JSON.stringify({ error: 'Order has no associated cart_id — cannot locate metafields' }), {
          status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      // Use the cart UUID as the effective resource — cart metafields persist post-checkout
      // and are where the storefront plugin writes the verification for both guests and logged-in customers.
      effectiveResourceId = resolvedCartId
    }

    // Build BC Management API URL (orders resolve to cart metafields via cart_id)
    const resourcePath = (resource === 'cart' || resource === 'order') ? 'carts' : 'customers'
    const baseUrl = `${BC_API}/stores/${storeHash}/v3/${resourcePath}/${effectiveResourceId}/metafields`
    const url = (action === 'write' && metafieldId) ? `${baseUrl}/${metafieldId}` : baseUrl
    const bcMethod = action === 'read' ? 'GET' : (metafieldId ? 'PUT' : 'POST')

    const bcRes = await fetch(url, {
      method: bcMethod,
      headers: bcHeaders,
      body: action === 'write' ? JSON.stringify(payload) : undefined,
    })

    const responseText = await bcRes.text()
    let responseData: any
    try {
      responseData = JSON.parse(responseText)
    } catch {
      responseData = { raw: responseText }
    }

    if (resolvedCustomerId !== undefined) {
      responseData = { ...responseData, resolvedCustomerId, cartId: resolvedCartId }
    }

    // Pass BC's status through (400/401/404 etc. are meaningful to the caller)
    return new Response(JSON.stringify(responseData), {
      status: bcRes.ok ? 200 : bcRes.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Upstream request failed', detail: err.message }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
