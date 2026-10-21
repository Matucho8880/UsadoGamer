// Supabase la llama automáticamente (desde un trigger en la base de datos)
// cuando Mateo confirma, desde el panel de administración, que recibió el
// pago de un pedido (status pasa a 'pago_confirmado'). Avisa por mail al
// comprador (que su compra quedó confirmada) y al vendedor (que ya puede
// despachar, y que va a cobrar cuando el comprador confirme la entrega).
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
      '&select=id,amount,buyer_id,seller_id,product_id,products(id,title)'
    );
    var o = rows[0];
    if (!o || !o.products) {
      res.status(404).json({ error: 'No se encontró el pedido o el producto.' });
      return;
    }

    var profiles = await helpers.supabaseServiceQuery(
      'profiles?id=in.(' + encodeURIComponent(o.buyer_id) + ',' + encodeURIComponent(o.seller_id) + ')&select=id,email,nombre'
    );
    var buyer = profiles.filter(function(p){ return p.id === o.buyer_id; })[0];
    var seller = profiles.filter(function(p){ return p.id === o.seller_id; })[0];
    if (!buyer || !buyer.email) {
      res.status(404).json({ error: 'No se encontró el email del comprador.' });
      return;
    }
    if (!seller || !seller.email) {
      res.status(404).json({ error: 'No se encontró el email del vendedor.' });
      return;
    }

    var money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
    var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';
    var link = siteUrl + '/producto/' + encodeURIComponent(o.product_id);

    var buyerHtml =
      '<p>Hola' + (buyer.nombre ? ' ' + buyer.nombre : '') + ',</p>' +
      '<p>Tu compra de <b>' + o.products.title + '</b> por ' + money.format(o.amount) + ' fue confirmada correctamente. ✅</p>' +
      '<p>El vendedor ya fue avisado y va a despachar tu producto. El dinero queda retenido de forma segura hasta que confirmes que lo recibiste.</p>' +
      '<p><a href="' + link + '">Ver la publicación</a></p>' +
      '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';

    var sellerHtml =
      '<p>Hola' + (seller.nombre ? ' ' + seller.nombre : '') + ',</p>' +
      '<p>Confirmamos el pago de <b>' + o.products.title + '</b> por ' + money.format(o.amount) + '. Ya podés despachar el producto.</p>' +
      '<p>El dinero queda retenido de forma segura y vas a verlo depositado en tu cuenta en cuanto el comprador confirme que recibió el producto.</p>' +
      '<p><a href="' + link + '">Ver la publicación</a></p>' +
      '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';

    var buyerResult = await helpers.sendEmail({ to: buyer.email, subject: 'Tu compra fue confirmada — UsadoGamer', html: buyerHtml });
    var sellerResult = await helpers.sendEmail({ to: seller.email, subject: 'Pago confirmado, ya podés despachar — UsadoGamer', html: sellerHtml });

    res.status(200).json({ buyer: buyerResult, seller: sellerResult });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error inesperado' });
  }
};
