// Mercado Pago llama a esta URL solo, del lado del servidor, cada vez que
// cambia el estado de un pago (la configuramos como "notification_url" al
// crear la preferencia en mp-create-preference.js). Esta es la ÚNICA fuente
// confiable de que un pago se aprobó: nunca hay que confiar en los parámetros
// con los que Mercado Pago redirige al navegador del comprador, porque esos
// se pueden manipular fácilmente.
//
// Cuando confirmamos acá que un pago está aprobado, marcamos el pedido como
// "pago_confirmado" directamente en la base de datos. Eso solo, sin hacer
// nada más, ya dispara el mismo trigger y los mismos mails que cuando Mateo
// confirma un pago a mano desde el panel de administración.
var helpers = require('./_resend');

module.exports = async function handler(req, res) {
  try {
    // Mercado Pago manda la notificación a veces por GET (con query params),
    // a veces por POST (con body JSON), según cómo esté configurada la cuenta.
    var query = req.query || {};
    var body = req.body || {};
    var paymentId = query['data.id'] || query.id || (body.data && body.data.id);
    var type = query.type || query.topic || body.type;

    if (!paymentId || (type && type !== 'payment')) {
      // No es una notificación de pago (puede ser de otro tipo de evento, o
      // un ping de prueba). Respondemos 200 para que Mercado Pago no reintente.
      res.status(200).json({ ok: true, skipped: true });
      return;
    }

    var accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
      res.status(200).json({ ok: false, error: 'MP_ACCESS_TOKEN no configurado' });
      return;
    }

    var payRes = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(paymentId), {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    var payment = await payRes.json();
    if (!payRes.ok) {
      res.status(200).json({ ok: false, error: (payment && payment.message) || 'No se pudo consultar el pago en Mercado Pago' });
      return;
    }

    var orderId = payment.external_reference;
    if (!orderId) {
      res.status(200).json({ ok: true, skipped: true });
      return;
    }

    if (payment.status !== 'approved') {
      // pending, rejected, in_process, etc. No hacemos nada; si más adelante
      // se aprueba, Mercado Pago manda una notificación nueva.
      res.status(200).json({ ok: true, status: payment.status });
      return;
    }

    var orders = await helpers.supabaseServiceQuery(
      'orders?id=eq.' + encodeURIComponent(orderId) + '&select=id,status,amount,delivery_cost'
    );
    var order = orders[0];
    if (!order) {
      res.status(200).json({ ok: false, error: 'Pedido no encontrado: ' + orderId });
      return;
    }
    if (order.status !== 'pendiente_pago') {
      // Ya estaba confirmado (notificación repetida) o en otro estado. No tocar.
      res.status(200).json({ ok: true, already: order.status });
      return;
    }

    // El monto pagado tiene que coincidir con el del pedido (con un margen
    // chico por redondeo), para que nadie pueda pagar de menos y que igual
    // se confirme el pedido completo.
    var paidAmount = Number(payment.transaction_amount);
    var expectedAmount = Number(order.amount) + Number(order.delivery_cost || 0);
    if (!paidAmount || Math.abs(paidAmount - expectedAmount) > 1) {
      res.status(200).json({ ok: false, error: 'El monto pagado (' + paidAmount + ') no coincide con el del pedido (' + expectedAmount + ')' });
      return;
    }

    await helpers.supabaseServiceUpdate(
      'orders?id=eq.' + encodeURIComponent(orderId),
      { status: 'pago_confirmado', mp_payment_id: String(payment.id) }
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    // Siempre devolvemos 200 (aunque haya un error nuestro) para que Mercado
    // Pago no reintente infinitamente; el error queda igual en los logs de Vercel.
    res.status(200).json({ ok: false, error: err.message || 'Error inesperado' });
  }
};
