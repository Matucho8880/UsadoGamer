// Supabase la llama automáticamente (desde triggers en la base de datos) en
// dos momentos de una consulta de envío (shipping_quotes). Antes eran dos
// archivos separados (notify-shipping-quote-requested.js y
// notify-shipping-quote-ready.js); se combinaron en uno solo para no
// pasarnos del límite de funciones serverless del plan gratuito de Vercel
// (12). El evento viene en req.body.event:
//   - 'requested': alguien pidió el costo de envío (fila nueva). Avisa por
//     mail a Mateo (toda cuenta con is_admin = true) para que entre al
//     panel y lo calcule.
//   - 'ready': Mateo cargó el costo (cost pasa de null a un valor). Esto es
//     ANTES de cualquier pago: el comprador todavía no reservó nada, solo
//     quería saber cuánto sale. Le avisamos por mail el precio.
var helpers = require('./_resend');

async function handleRequested(quoteId, res) {
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
}

async function handleReady(quoteId, res) {
  var rows = await helpers.supabaseServiceQuery(
    'shipping_quotes?id=eq.' + encodeURIComponent(quoteId) +
    '&select=id,cost,buyer_id,product_id,delivery_method,delivery_address,products(id,title)'
  );
  var q = rows[0];
  if (!q || !q.products) { res.status(404).json({ error: 'No se encontró la consulta o el producto.' }); return; }

  var profiles = await helpers.supabaseServiceQuery(
    'profiles?id=eq.' + encodeURIComponent(q.buyer_id) + '&select=id,email,nombre'
  );
  var buyer = profiles[0];
  if (!buyer || !buyer.email) { res.status(404).json({ error: 'No se encontró el email del comprador.' }); return; }

  var money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';
  var link = siteUrl + '/?producto=' + encodeURIComponent(q.product_id);
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
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido' }); return; }
  if (!helpers.checkSecret(req)) { res.status(401).json({ error: 'No autorizado' }); return; }

  try {
    var quoteId = req.body && req.body.quote_id;
    var event = req.body && req.body.event;
    if (!quoteId) { res.status(400).json({ error: 'Falta quote_id' }); return; }

    if (event === 'requested') {
      await handleRequested(quoteId, res);
    } else {
      await handleReady(quoteId, res);
    }
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error inesperado' });
  }
};
