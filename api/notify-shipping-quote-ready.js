// Supabase la llama automáticamente (desde un trigger en la base de datos)
// cuando Mateo carga el costo en una CONSULTA de envío (shipping_quotes,
// cost pasa de null a un valor). Esto es ANTES de cualquier pago: el
// comprador todavía no reservó nada, solo quería saber cuánto sale. Le
// avisamos por mail el precio para que decida si quiere comprar.
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
    var quoteId = req.body && req.body.quote_id;
    if (!quoteId) {
      res.status(400).json({ error: 'Falta quote_id' });
      return;
    }

    var rows = await helpers.supabaseServiceQuery(
      'shipping_quotes?id=eq.' + encodeURIComponent(quoteId) +
      '&select=id,cost,buyer_id,product_id,delivery_method,delivery_address,products(id,title)'
    );
    var q = rows[0];
    if (!q || !q.products) {
      res.status(404).json({ error: 'No se encontró la consulta o el producto.' });
      return;
    }

    var profiles = await helpers.supabaseServiceQuery(
      'profiles?id=eq.' + encodeURIComponent(q.buyer_id) + '&select=id,email,nombre'
    );
    var buyer = profiles[0];
    if (!buyer || !buyer.email) {
      res.status(404).json({ error: 'No se encontró el email del comprador.' });
      return;
    }

    var money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
    var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';
    var link = siteUrl + '/producto/' + encodeURIComponent(q.product_id);
    var entrega = q.delivery_method === 'domicilio'
      ? 'Envío a domicilio — ' + (q.delivery_address || '')
      : 'Retiro en sucursal — ' + (q.delivery_address || '');

    var buyerHtml =
      '<p>Hola' + (buyer.nombre ? ' ' + buyer.nombre : '') + ',</p>' +
      '<p>Ya calculamos cuánto sale el envío de <b>' + q.products.title + '</b>: <b>' + money.format(q.cost) + '</b>.</p>' +
      '<p>' + entrega + '</p>' +
      '<p>Esto no reservó el producto ni te compromete a nada. Si querés comprarlo, entrá a la publicación y al pagar ya te vamos a sumar este costo de envío automáticamente.</p>' +
      '<p><a href="' + link + '">Ver la publicación</a></p>' +
      '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';

    var buyerResult = await helpers.sendEmail({ to: buyer.email, subject: 'Ya sabemos cuánto sale el envío — UsadoGamer', html: buyerHtml });

    res.status(200).json({ buyer: buyerResult });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error inesperado' });
  }
};
