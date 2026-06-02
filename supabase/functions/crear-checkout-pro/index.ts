import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const jsonHeaders = {
  ...corsHeaders,
  'Content-Type': 'application/json',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

function cleanSecret(value: string | undefined | null) {
  return String(value || '').trim().replace(/[\r\n\t]/g, '')
}

function readAmount(envName: string, fallback: number) {
  const raw = cleanSecret(Deno.env.get(envName))
  if (!raw) return fallback
  const value = Number(raw.replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${envName} debe ser un numero. Ejemplo: ${fallback}. Valor actual: ${raw}`)
  }
  return value
}

function missingColumnName(error: unknown) {
  const msg = String((error as { message?: string })?.message || error || '')
  const match = msg.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+(?:of relation\s+"?[a-zA-Z0-9_]+"?\s+)?does not exist/i)
  return match?.[1] || ''
}

async function safeUpdateCliente(sb: ReturnType<typeof createClient>, clienteId: string, payload: Record<string, unknown>) {
  const body = { ...payload }
  for (let i = 0; i < 12; i++) {
    const { error } = await sb.from('clientes').update(body).eq('id', clienteId)
    if (!error) return null
    const missing = missingColumnName(error)
    if (!missing || !(missing in body)) return error
    delete body[missing]
  }
  return new Error('No se pudo actualizar clientes despues de quitar columnas opcionales.')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Metodo no permitido' }, 405)

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const MP_ACCESS_TOKEN = cleanSecret(Deno.env.get('MP_ACCESS_TOKEN'))
    const APP_URL = cleanSecret(Deno.env.get('APP_URL')) || 'https://ctxasesores.github.io/agro-reporte/'
    const MP_CURRENCY_ID = cleanSecret(Deno.env.get('MP_CURRENCY_ID')) || 'USD'

    if (!MP_ACCESS_TOKEN) return json({ error: 'Falta configurar MP_ACCESS_TOKEN en Supabase.' }, 500)
    if (!/^APP_USR-|^TEST-/i.test(MP_ACCESS_TOKEN)) {
      return json({
        error: 'MP_ACCESS_TOKEN parece incorrecto. Debe ser el Access Token de credenciales de produccion o prueba de Mercado Pago, no la clave secreta del webhook.'
      }, 500)
    }

    const authHeader = cleanSecret(req.headers.get('Authorization'))
    const userToken = authHeader.replace(/^Bearer\s+/i, '')
    if (!userToken) return json({ error: 'Sesion no valida.' }, 401)

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data: userData, error: userError } = await sb.auth.getUser(userToken)
    if (userError || !userData?.user) return json({ error: 'Sesion no valida.' }, 401)

    const { plan, panel, cliente_id } = await req.json().catch(() => ({}))
    const normalizedPlan = String(plan || 'mensual').toLowerCase() === 'anual' ? 'anual' : 'mensual'
    const amountUsd = normalizedPlan === 'anual' ? 100 : 10
    const amountCheckout = readAmount(
      normalizedPlan === 'anual' ? 'PRO_ANNUAL_CHECKOUT_AMOUNT' : 'PRO_MONTHLY_CHECKOUT_AMOUNT',
      amountUsd
    )

    const { data: cliente, error: clienteError } = await sb
      .from('clientes')
      .select('id,email,nombre_empresa,codigo')
      .eq('id', userData.user.id)
      .maybeSingle()

    if (clienteError) return json({ error: clienteError.message }, 500)
    if (!cliente) return json({ error: 'No encontramos el cliente asociado a esta cuenta.' }, 404)
    if (cliente_id && String(cliente_id) !== String(cliente.id)) return json({ error: 'Cliente no coincide con la sesion.' }, 403)

    const paymentId = crypto.randomUUID()
    const externalReference = `ctx-pro:${paymentId}:${cliente.id}:${normalizedPlan}`
    const webhookUrl = Deno.env.get('MP_WEBHOOK_URL') || `${SUPABASE_URL}/functions/v1/mp-webhook-pro`
    const successUrl = `${APP_URL}?payment=success&plan=${normalizedPlan}`
    const pendingUrl = `${APP_URL}?payment=pending&plan=${normalizedPlan}`
    const failureUrl = `${APP_URL}?payment=failure&plan=${normalizedPlan}`

    const preference = {
      items: [
        {
          id: `ctx-pro-${normalizedPlan}`,
          title: `CTX Paneles PRO - Plan ${normalizedPlan}`,
          description: normalizedPlan === 'anual' ? 'Acceso PRO anual' : 'Acceso PRO mensual',
          quantity: 1,
          unit_price: amountCheckout,
          currency_id: MP_CURRENCY_ID,
        },
      ],
      payer: {
        email: cliente.email || userData.user.email,
        name: cliente.nombre_empresa || cliente.codigo || 'Cliente CTX',
      },
      external_reference: externalReference,
      notification_url: webhookUrl,
      back_urls: {
        success: successUrl,
        pending: pendingUrl,
        failure: failureUrl,
      },
      auto_return: 'approved',
      metadata: {
        cliente_id: cliente.id,
        user_id: userData.user.id,
        plan: normalizedPlan,
        panel: panel || 'Paneles PRO',
      },
    }

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preference),
    })
    const mpPayload = await mpResponse.json().catch(() => ({}))
    if (!mpResponse.ok) {
      return json({ error: mpPayload.message || 'Mercado Pago no pudo crear el checkout.', details: mpPayload }, 502)
    }

    const checkoutUrl = mpPayload.init_point || mpPayload.sandbox_init_point
    const { error: insertError } = await sb.from('pagos_pro').insert({
      id: paymentId,
      user_id: userData.user.id,
      cliente_id: cliente.id,
      plan: normalizedPlan,
      panel: panel || 'Paneles PRO',
      amount_usd: amountUsd,
      amount_checkout: amountCheckout,
      currency_id: MP_CURRENCY_ID,
      estado: 'checkout_creado',
      checkout_url: checkoutUrl,
      mp_preference_id: mpPayload.id,
      external_reference: externalReference,
      raw: mpPayload,
    })

    if (insertError) return json({ error: insertError.message }, 500)

    const linkUpdateError = await safeUpdateCliente(sb, cliente.id, {
      payment_url: checkoutUrl,
      link_pago: checkoutUrl,
      checkout_url: checkoutUrl,
      estado_pago: 'checkout_creado',
      plan_pago: 'pro_pendiente',
      mp_external_reference: externalReference,
    })

    if (linkUpdateError) {
      console.warn('No se pudo copiar link de pago a clientes:', linkUpdateError.message)
    }

    return json({
      ok: true,
      plan: normalizedPlan,
      preference_id: mpPayload.id,
      init_point: checkoutUrl,
      checkout_url: checkoutUrl,
    })
  } catch (error) {
    return json({ error: error?.message || String(error) }, 500)
  }
})
