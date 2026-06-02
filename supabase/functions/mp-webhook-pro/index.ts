import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-signature, x-request-id',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const jsonHeaders = {
  ...corsHeaders,
  'Content-Type': 'application/json',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

function addPeriod(plan: string) {
  const d = new Date()
  if (plan === 'anual') d.setFullYear(d.getFullYear() + 1)
  else d.setMonth(d.getMonth() + 1)
  return d.toISOString()
}

function missingColumnName(error: unknown) {
  const msg = String((error as { message?: string })?.message || error || '')
  const match = msg.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+(?:of relation\s+"?[a-zA-Z0-9_]+"?\s+)?does not exist/i)
  return match?.[1] || ''
}

async function safeUpdateCliente(sb: ReturnType<typeof createClient>, clienteId: string, payload: Record<string, unknown>) {
  const body = { ...payload }
  for (let i = 0; i < 20; i++) {
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

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const url = new URL(req.url)
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const paymentId =
      body?.data?.id ||
      body?.resource ||
      url.searchParams.get('data.id') ||
      url.searchParams.get('id')

    if (!paymentId) return json({ ok: true, ignored: 'sin payment id' })

    // El simulador de Mercado Pago envia un payment id ficticio ("123456").
    // Respondemos 200 para validar la URL, pero no activamos PRO ni tocamos datos.
    if (String(paymentId) === '123456' || body?.live_mode === false) {
      return json({ ok: true, simulated: true, payment_id: paymentId })
    }

    const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')
    if (!MP_ACCESS_TOKEN) return json({ error: 'Falta configurar MP_ACCESS_TOKEN en Supabase.' }, 500)

    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    })
    const payment = await mpResponse.json().catch(() => ({}))
    if (!mpResponse.ok) {
      return json({
        ok: true,
        ignored: 'payment_not_found_or_not_ready',
        payment_id: paymentId,
        mp_status: mpResponse.status,
        message: payment.message || 'Mercado Pago no devolvio el pago todavia.'
      })
    }

    const externalReference = payment.external_reference || payment.externalReference || ''
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data: pago, error: pagoError } = await sb
      .from('pagos_pro')
      .select('*')
      .eq('external_reference', externalReference)
      .maybeSingle()

    if (pagoError) return json({ error: pagoError.message }, 500)
    if (!pago) return json({ ok: true, ignored: 'pago no registrado', external_reference: externalReference })

    const approved = payment.status === 'approved'
    const pagoUpdate: Record<string, unknown> = {
      estado: approved ? 'aprobado' : payment.status || 'actualizado',
      mp_payment_id: String(payment.id || paymentId),
      mp_status: payment.status,
      raw: payment,
    }
    if (approved) pagoUpdate.approved_at = new Date().toISOString()

    const { error: updatePagoError } = await sb
      .from('pagos_pro')
      .update(pagoUpdate)
      .eq('id', pago.id)

    if (updatePagoError) return json({ error: updatePagoError.message }, 500)

    if (approved && pago.cliente_id) {
      const vencimiento = addPeriod(pago.plan)
      const clienteError = await safeUpdateCliente(sb, pago.cliente_id, {
        plan: 'Premium',
        plan_pago: 'pro',
        estado_pago: 'activo',
        premium_activo: true,
        acceso_premium: true,
        acceso_agricola: true,
        panel_agricola: true,
        agricultura_nivel: 'PRO',
        agricultura_dashboard: 'PRO',
        acceso_ganaderia: true,
        panel_ganaderia: true,
        ganaderia_nivel: 'PRO',
        ganaderia_dashboard: 'PRO',
        acceso_tambo: true,
        panel_tambo: true,
        tambo_nivel: 'PRO',
        tambo_dashboard: 'PRO',
        pro_periodicidad: pago.plan,
        pro_vencimiento: vencimiento,
        pro_ultimo_pago_at: new Date().toISOString(),
        mp_payment_id: String(payment.id || paymentId),
        mp_external_reference: externalReference,
        payment_url: pago.checkout_url,
        link_pago: pago.checkout_url,
        checkout_url: pago.checkout_url,
      })
      if (clienteError) return json({ error: clienteError.message }, 500)
    }

    return json({ ok: true, payment_id: paymentId, status: payment.status })
  } catch (error) {
    return json({ error: error?.message || String(error) }, 500)
  }
})
