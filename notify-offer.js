// Supabase la llama automáticamente (desde un trigger en la base de datos)
// cada vez que un comprador hace una oferta nueva. Le avisa al vendedor
// por mail para que entre a aceptarla o rechazarla.
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
      '&select=offered_price,products(id,title,user_id)'
    );
    var o = rows[0];
    if (!o || !o.products){
      res.status(404).json({ error: 'No se encontró la oferta o el producto.' });
      return;
    }

    var profiles = await helpers.supabaseServiceQuery(
      'profiles?id=eq.' + encodeURIComponent(o.products.user_id) + '&select=email,nombre'
    );
    var seller = profiles[0];
    if (!seller || !seller.email){
      res.status(404).json({ error: 'No se encontró el email del vendedor.' });
      return;
    }

    var money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
    var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';
    var html =
      '<p>Hola' + (seller.nombre ? ' ' + seller.nombre : '') + ',</p>' +
      '<p>Te hicieron una oferta nueva en tu publicación <b>' + o.products.title + '</b>:</p>' +
      '<p style="background:#f7f7f8; border-radius:8px; padding:12px; font-size:1.1rem"><b>' + money.format(o.offered_price) + '</b></p>' +
      '<p><a href="' + siteUrl + '/?producto=' + encodeURIComponent(o.products.id) + '">Entrá a aceptarla o rechazarla</a></p>' +
      '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';

    var result = await helpers.sendEmail({ to: seller.email, subject: 'Te hicieron una oferta en UsadoGamer', html: html });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error inesperado' });
  }
};
