// Supabase la llama automáticamente (desde un trigger en la base de datos)
// apenas alguien pide el costo de envío de un producto (shipping_quotes,
// fila nueva). Le avisa por mail a Mateo (toda cuenta con is_admin = true)
// para que entre al panel y lo calcule — además de la notificación dentro
// del sitio, que ya se inserta directo desde el trigger en SQL.
var helpers = require('./_resend');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido' }); return; }
  if (!helpers.checkSecret(req)) { res.status(401).json({ error: 'No autorizado' }); return; }

  try {
    var quoteId = req.body && req.body.quote_id;
    if (!quoteId) { res.status(400).json({ error: 'Falta quote_id' }); return; }

    var rows = await helpers.supabaseServiceQuery(
      'shipping_quotes?id=eq.' + encodeURIComponent(quoteId) +
      '&select=id,delivery_method,delivery_address,buyer_id,seller_id,product_id,products(id,title)'
    );
    var q = rows[0];
    if (!q || !q.products) { res.status(404).json({ error: 'No se encontró la consulta o el producto.' }); return; }

    var admins = await helpers.supabaseServiceQuery('profiles?is_admin=eq.true&select=id,email,nombre');
    if (!admins.length) { res.status(200).json({ ok: true, skipped: 'sin administradores cargados' }); return; }

    var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';
    var link = siteUrl + '/dashboard.html';
    var entrega = q.delivery_method === 'domicilio'
      ? 'Envío a domicilio — ' + (q.delivery_address || '')
      : 'Retiro en sucursal — ' + (q.delivery_address || '');

    var html =
      '<p>Pidieron cotizar el envío de <b>' + q.products.title + '</b>.</p>' +
      '<p>' + entrega + '</p>' +
      '<p>Entrá al panel de administración para cargar el costo: <a href="' + link + '">' + link + '</a></p>';

    var sent = 0;
    for (var i = 0; i < admins.length; i++) {
      if (!admins[i].email) continue;
      var result = await helpers.sendEmail({ to: admins[i].email, subject: 'Piden cotizar un envío — UsadoGamer', html: html });
      if (result.ok) sent++;
    }
    res.status(200).json({ sent: sent });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error inesperado' });
  }
};
