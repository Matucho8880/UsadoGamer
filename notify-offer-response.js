// Supabase la llama automáticamente (desde un trigger en la base de datos)
// cuando el vendedor acepta o rechaza una oferta. Le avisa al comprador
// por mail. Si fue aceptada, le recuerda que tiene 24hs para pagar.
var helpers = require('./_resend');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }
  if (!helpers.checkSecret(req)) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  try {
    var offerId = req.body && req.body.offer_id;
    if (!offerId) {
      res.status(400).json({ error: 'Falta offer_id' });
      return;
    }

    var rows = await helpers.supabaseServiceQuery(
      'offers?id=eq.' + encodeURIComponent(offerId) +
      '&select=offered_price,status,buyer_id,product_id,products(id,title)'
    );
    var o = rows[0];
    if (!o || !o.products){
      res.status(404).json({ error: 'No se encontró la oferta o el producto.' });
      return;
    }

    var profiles = await helpers.supabaseServiceQuery(
      'profiles?id=eq.' + encodeURIComponent(o.buyer_id) + '&select=email,nombre'
    );
    var buyer = profiles[0];
    if (!buyer || !buyer.email){
      res.status(404).json({ error: 'No se encontró el email del comprador.' });
      return;
    }

    var money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
    var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';
    var link = siteUrl + '/?producto=' + encodeURIComponent(o.product_id);
    var html;

    if (o.status === 'aceptada') {
      // Buscamos el pedido recién creado para esa combinación producto/comprador
      // (en lugar de depender de offers.order_id, que puede no estar seteado
      // todavía en el mismo instante en que se dispara este mail).
      var orders = await helpers.supabaseServiceQuery(
        'orders?product_id=eq.' + encodeURIComponent(o.product_id) +
        '&buyer_id=eq.' + encodeURIComponent(o.buyer_id) +
        '&status=eq.pendiente_pago&order=created_at.desc&limit=1&select=payment_deadline'
      );
      var deadline = orders[0] && orders[0].payment_deadline
        ? new Date(orders[0].payment_deadline).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' })
        : null;
      html =
        '<p>Hola' + (buyer.nombre ? ' ' + buyer.nombre : '') + ',</p>' +
        '<p>¡Buenas noticias! El vendedor aceptó tu oferta de <b>' + money.format(o.offered_price) + '</b> en <b>' + o.products.title + '</b>.</p>' +
        '<p>Tenés <b>24 horas' + (deadline ? ' (hasta el ' + deadline + ')' : '') + '</b> para transferir el pago, o el producto vuelve a estar disponible para otros compradores.</p>' +
        '<p><a href="' + link + '">Pagar ahora</a></p>' +
        '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';
    } else {
      html =
        '<p>Hola' + (buyer.nombre ? ' ' + buyer.nombre : '') + ',</p>' +
        '<p>Tu oferta de <b>' + money.format(o.offered_price) + '</b> en <b>' + o.products.title + '</b> no fue aceptada por el vendedor.</p>' +
        '<p>Todavía podés comprarlo al precio de lista si te interesa.</p>' +
        '<p><a href="' + link + '">Ver la publicación</a></p>' +
        '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';
    }

    var subject = o.status === 'aceptada' ? '¡Tu oferta fue aceptada en UsadoGamer!' : 'Tu oferta en UsadoGamer';
    var result = await helpers.sendEmail({ to: buyer.email, subject: subject, html: html });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error inesperado' });
  }
};
