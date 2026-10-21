// Supabase la llama automáticamente (desde un trigger en la base de datos)
// cuando Mateo libera el pago al vendedor (status pasa a 'liberado'), es
// decir, después de que el comprador confirmó que recibió el producto.
// Avisa por mail al vendedor que su dinero ya está depositado.
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
      '&select=id,amount,seller_id,product_id,products(id,title)'
    );
    var o = rows[0];
    if (!o || !o.products) {
      res.status(404).json({ error: 'No se encontró el pedido o el producto.' });
      return;
    }

    var profiles = await helpers.supabaseServiceQuery(
      'profiles?id=eq.' + encodeURIComponent(o.seller_id) + '&select=email,nombre'
    );
    var seller = profiles[0];
    if (!seller || !seller.email) {
      res.status(404).json({ error: 'No se encontró el email del vendedor.' });
      return;
    }

    var COMMISSION_RATE = 0.08;
    var net = Math.round(o.amount * (1 - COMMISSION_RATE));
    var money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
    var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';
    var link = siteUrl + '/producto/' + encodeURIComponent(o.product_id);

    var html =
      '<p>Hola' + (seller.nombre ? ' ' + seller.nombre : '') + ',</p>' +
      '<p>¡Buenas noticias! El comprador confirmó que recibió <b>' + o.products.title + '</b> en buen estado.</p>' +
      '<p>Liberamos el pago de tu venta por <b>' + money.format(net) + '</b> (ya con la comisión de UsadoGamer descontada). El dinero ya está depositado en tu cuenta.</p>' +
      '<p><a href="' + link + '">Ver la publicación</a></p>' +
      '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';

    var result = await helpers.sendEmail({ to: seller.email, subject: '¡Tu dinero ya está depositado! — UsadoGamer', html: html });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error inesperado' });
  }
};
