// Supabase la llama automáticamente (desde triggers en la base de datos) en
// dos momentos del pago de un pedido. Antes eran dos archivos separados
// (notify-payment-confirmed.js y notify-payment-released.js); se
// combinaron en uno solo para no pasarnos del límite de funciones
// serverless del plan gratuito de Vercel (12). El evento viene en
// req.body.event:
//   - 'confirmed': Mateo confirmó que recibió el pago (status pasa a
//     'pago_confirmado'). Avisa al comprador (compra confirmada) y al
//     vendedor (ya puede despachar).
//   - 'released': Mateo liberó el pago al vendedor (status pasa a
//     'liberado'), después de que el comprador confirmó la entrega. Avisa
//     solo al vendedor, que su dinero ya está depositado.
var helpers = require('./_resend');

var COMMISSION_RATE = 0.08;

async function handleConfirmed(orderId, res) {
  var rows = await helpers.supabaseServiceQuery(
    'orders?id=eq.' + encodeURIComponent(orderId) +
    '&select=id,amount,buyer_id,seller_id,product_id,products(id,title)'
  );
  var o = rows[0];
  if (!o || !o.products) { res.status(404).json({ error: 'No se encontró el pedido o el producto.' }); return; }

  var profiles = await helpers.supabaseServiceQuery(
    'profiles?id=in.(' + encodeURIComponent(o.buyer_id) + ',' + encodeURIComponent(o.seller_id) + ')&select=id,email,nombre'
  );
  var buyer = profiles.filter(function(p){ return p.id === o.buyer_id; })[0];
  var seller = profiles.filter(function(p){ return p.id === o.seller_id; })[0];
  if (!buyer || !buyer.email) { res.status(404).json({ error: 'No se encontró el email del comprador.' }); return; }
  if (!seller || !seller.email) { res.status(404).json({ error: 'No se encontró el email del vendedor.' }); return; }

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
}

async function handleReleased(orderId, res) {
  var rows = await helpers.supabaseServiceQuery(
    'orders?id=eq.' + encodeURIComponent(orderId) +
    '&select=id,amount,seller_id,product_id,products(id,title)'
  );
  var o = rows[0];
  if (!o || !o.products) { res.status(404).json({ error: 'No se encontró el pedido o el producto.' }); return; }

  var profiles = await helpers.supabaseServiceQuery(
    'profiles?id=eq.' + encodeURIComponent(o.seller_id) + '&select=email,nombre'
  );
  var seller = profiles[0];
  if (!seller || !seller.email) { res.status(404).json({ error: 'No se encontró el email del vendedor.' }); return; }

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
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido' }); return; }
  if (!helpers.checkSecret(req)) { res.status(401).json({ error: 'No autorizado' }); return; }

  try {
    var orderId = req.body && req.body.order_id;
    var event = req.body && req.body.event;
    if (!orderId) { res.status(400).json({ error: 'Falta order_id' }); return; }

    if (event === 'released') {
      await handleReleased(orderId, res);
    } else {
      await handleConfirmed(orderId, res);
    }
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error inesperado' });
  }
};
