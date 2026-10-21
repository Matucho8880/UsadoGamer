// Supabase la llama automáticamente (desde un trigger en la base de datos)
// cuando se carga el costo de envío de un pedido que YA se pagó (Camino A:
// delivery_cost pasa de null a un valor, con delivery_included_in_payment en
// false; lo carga Mateo desde el panel de administración). Avisa por mail al
// comprador que ya puede pagar el envío, por separado, en "Mis pedidos".
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
    var orderId = req.body && req.body.order_id;
    if (!orderId) {
      res.status(400).json({ error: 'Falta order_id' });
      return;
    }

    var rows = await helpers.supabaseServiceQuery(
      'orders?id=eq.' + encodeURIComponent(orderId) +
      '&select=id,delivery_cost,delivery_origin_address,buyer_id,product_id,products(id,title)'
    );
    var o = rows[0];
    if (!o || !o.products) {
      res.status(404).json({ error: 'No se encontró el pedido o el producto.' });
      return;
    }

    var profiles = await helpers.supabaseServiceQuery(
      'profiles?id=eq.' + encodeURIComponent(o.buyer_id) + '&select=id,email,nombre'
    );
    var buyer = profiles[0];
    if (!buyer || !buyer.email) {
      res.status(404).json({ error: 'No se encontró el email del comprador.' });
      return;
    }

    var money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
    var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';
    var link = siteUrl + '/producto/' + encodeURIComponent(o.product_id);

    var origen = o.delivery_origin_address ? '<p>Se despacha desde: ' + o.delivery_origin_address + '</p>' : '';

    var buyerHtml =
      '<p>Hola' + (buyer.nombre ? ' ' + buyer.nombre : '') + ',</p>' +
      '<p>Ya calculamos el costo de envío de <b>' + o.products.title + '</b>: <b>' + money.format(o.delivery_cost) + '</b>.</p>' +
      origen +
      '<p>El producto ya está pagado — esto es solo el envío, que se paga aparte. Entrá a "Mis pedidos" en la web para pagarlo.</p>' +
      '<p><a href="' + link + '">Ver la publicación</a></p>' +
      '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';

    var buyerResult = await helpers.sendEmail({ to: buyer.email, subject: 'Ya podés pagar el envío — UsadoGamer', html: buyerHtml });

    res.status(200).json({ buyer: buyerResult });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error inesperado' });
  }
};
