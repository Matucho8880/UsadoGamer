// Lo llama el navegador cuando el comprador elige pagar con tarjeta (Mercado
// Pago). Crea una "preferencia" de pago en Mercado Pago para el monto exacto
// del pedido (lo busca en la base, nunca confía en un monto que mande el
// navegador) y devuelve el link al que hay que mandar al comprador para que
// pague. La confirmación real del pago llega después, aparte, por el webhook
// (api/mp-webhook.js) — nunca por esta respuesta ni por la vuelta del navegador.
var helpers = require('./_resend');

// Mercado Pago cobra esta comisión sobre el total cuando se paga con
// tarjeta (no aplica a la transferencia). Se suma acá, del lado del
// servidor, para que el comprador pague el precio + envío + comisión, y el
// vendedor reciba el precio + envío completo sin que la comisión se la
// coma a él.
var MP_FEE_RATE = 0.046;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  try {
    var orderId = req.body && req.body.order_id;
    if (!orderId) {
      res.status(400).json({ error: 'Falta order_id' });
      return;
    }

    var rows = await helpers.supabaseServiceQuery(
      'orders?id=eq.' + encodeURIComponent(orderId) +
      '&select=id,amount,delivery_cost,status,product_id,products(title)'
    );
    var order = rows[0];
    if (!order || !order.products) {
      res.status(404).json({ error: 'No se encontró el pedido.' });
      return;
    }
    if (order.status !== 'pendiente_pago') {
      res.status(400).json({ error: 'Este pedido ya no está pendiente de pago.' });
      return;
    }
    if (order.delivery_cost === null || order.delivery_cost === undefined) {
      res.status(400).json({ error: 'Todavía falta que el vendedor cargue el costo de envío.' });
      return;
    }

    var subtotal = Number(order.amount) + Number(order.delivery_cost);
    var totalAmount = Math.round(subtotal * (1 + MP_FEE_RATE));

    var accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
      res.status(500).json({ error: 'Mercado Pago no está configurado todavía (falta MP_ACCESS_TOKEN).' });
      return;
    }

    var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';

    var preference = {
      items: [{
        title: order.products.title || 'Producto UsadoGamer',
        quantity: 1,
        currency_id: 'ARS',
        unit_price: totalAmount
      }],
      external_reference: order.id,
      notification_url: siteUrl + '/api/mp-webhook',
      back_urls: {
        success: siteUrl + '/?mp_return=1&order=' + order.id,
        pending: siteUrl + '/?mp_return=1&order=' + order.id,
        failure: siteUrl + '/?mp_return=0&order=' + order.id
      },
      auto_return: 'approved',
      statement_descriptor: 'USADOGAMER'
    };

    var mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accessToken
      },
      body: JSON.stringify(preference)
    });
    var mpData = await mpRes.json();
    if (!mpRes.ok) {
      res.status(502).json({ error: (mpData && mpData.message) || 'Mercado Pago rechazó la preferencia de pago.' });
      return;
    }

    // IMPORTANTE: con las credenciales de prueba actuales de Mercado Pago (las
    // que empiezan con APP_USR, no con el prefijo viejo TEST-), el link de
    // "sandbox_init_point" ya no funciona y da la pantalla "Oh, no, algo
    // anduvo mal". El modo prueba ahora se maneja por otro lado: usando una
    // cuenta de prueba (comprador) para pagar, con el link normal init_point.
    var initPoint = mpData.init_point || mpData.sandbox_init_point;
    if (!initPoint) {
      res.status(502).json({ error: 'Mercado Pago no devolvió un link de pago.' });
      return;
    }

    res.status(200).json({ init_point: initPoint });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error inesperado' });
  }
};
