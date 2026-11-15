// Supabase la llama automáticamente (desde triggers en la base de datos) en
// distintos momentos del pago de un pedido. Antes eran dos archivos
// separados (notify-payment-confirmed.js y notify-payment-released.js); se
// combinaron en uno solo para no pasarnos del límite de funciones
// serverless del plan gratuito de Vercel (12). El evento viene en
// req.body.event:
//   - 'confirmed': Mateo confirmó que recibió el pago del producto (status
//     pasa a 'pago_confirmado'). Avisa al comprador (compra confirmada) y
//     al vendedor (ya puede despachar).
//   - 'released': Mateo liberó el pago al vendedor (status pasa a
//     'liberado'), después de que el comprador confirmó la entrega. Avisa
//     solo al vendedor, que su dinero ya está depositado.
//   - 'delivery_confirmed': Mateo confirmó el pago del ENVÍO, cuando se
//     paga aparte del producto (delivery_payment_status pasa a
//     'confirmado'). Avisa a comprador y vendedor, igual que 'confirmed'
//     pero aclarando que es el envío.
//   - 'buyer_cancelled': el comprador pidió la devolución de un pedido ya
//     pagado, antes de que el vendedor despache. Avisa a Mateo (admin) para
//     que gestione la devolución real de la plata a mano, y al vendedor
//     para que sepa que ese pedido ya no sigue en pie.
//   - 'shipped': el vendedor marcó el pedido como despachado y cargó el
//     número de seguimiento. Avisa al comprador con ese número, para que no
//     tenga que entrar a la web a buscarlo.
var helpers = require('./_resend');

var COMMISSION_RATE = 0.08;

async function handleConfirmed(orderId, res) {
  var rows = await helpers.supabaseServiceQuery(
    'orders?id=eq.' + encodeURIComponent(orderId) +
    '&select=id,amount,buyer_id,seller_id,product_id,delivery_method,delivery_address,delivery_cost,delivery_included_in_payment,delivery_origin_address,products(id,title)'
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
  var guideLink = siteUrl + '/como-funciona';

  // Si todavía no se sabe la dirección (puede pasar: el comprador a veces
  // pide el envío después de pagar), no inventamos nada — le decimos al
  // vendedor que todavía no está lista y que la va a ver en la web apenas
  // esté. Si ya está, se la mostramos completa acá mismo para que no tenga
  // que ir a buscarla a ningún lado antes de despachar.
  var deliveryBlock;
  if (o.delivery_method) {
    var direccion = o.delivery_method === 'domicilio'
      ? 'A domicilio — ' + (o.delivery_address || 'sin dirección cargada')
      : 'Retiro en sucursal — ' + (o.delivery_address || 'sin localidad cargada');
    var costoTxt = o.delivery_cost != null
      ? ' El envío cuesta ' + money.format(o.delivery_cost) + (o.delivery_included_in_payment ? ', ya incluido en lo que pagó el comprador — no le cobres nada aparte.' : ', y se paga por separado.')
      : '';
    deliveryBlock =
      '<p><b>Dirección de envío:</b> ' + direccion + '.' + costoTxt + '</p>' +
      (o.delivery_origin_address ? '<p>Despachalo desde: ' + o.delivery_origin_address + '</p>' : '');
  } else {
    deliveryBlock = '<p>Todavía no tenemos la dirección de envío — en cuanto el comprador la confirme, la vas a ver en "Mis publicaciones".</p>';
  }

  var buyerHtml =
    '<p>Hola' + (buyer.nombre ? ' ' + buyer.nombre : '') + ',</p>' +
    '<p>Tu compra de <b>' + o.products.title + '</b> por ' + money.format(o.amount) + ' fue confirmada correctamente. ✅</p>' +
    '<p>El vendedor ya fue avisado y va a despachar tu producto. El dinero queda retenido de forma segura hasta que confirmes que lo recibiste. Apenas lo despache, te vamos a avisar con el número de seguimiento.</p>' +
    '<p><a href="' + link + '">Ver la publicación</a></p>' +
    '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';

  var sellerHtml =
    '<p>Hola' + (seller.nombre ? ' ' + seller.nombre : '') + ',</p>' +
    '<p>Confirmamos el pago de <b>' + o.products.title + '</b> por ' + money.format(o.amount) + '. Ya podés despachar el producto.</p>' +
    deliveryBlock +
    '<p>Pasos: 1) despachalo por Correo Argentino (por ahora el único medio activo) dentro de las próximas 72 horas hábiles, 2) cuando el correo te dé el código de seguimiento, entrá a "Mis publicaciones" y cargalo ahí, 3) tocá "Marcar como despachado" — recién ahí le avisamos al comprador automáticamente con ese número.</p>' +
    '<p>El dinero queda retenido de forma segura: se deposita en tu cuenta 10 días después de que el comprador confirme que recibió el producto, como resguardo extra. Más detalle en la <a href="' + guideLink + '">guía paso a paso</a>.</p>' +
    '<p><a href="' + link + '">Ver la publicación</a></p>' +
    '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';

  var buyerResult = await helpers.sendEmail({ to: buyer.email, subject: 'Tu compra fue confirmada — UsadoGamer', html: buyerHtml });
  var sellerResult = await helpers.sendEmail({ to: seller.email, subject: 'Pago confirmado, ya podés despachar — UsadoGamer', html: sellerHtml });
  res.status(200).json({ buyer: buyerResult, seller: sellerResult });
}

async function handleShipped(orderId, res) {
  var rows = await helpers.supabaseServiceQuery(
    'orders?id=eq.' + encodeURIComponent(orderId) +
    '&select=id,buyer_id,product_id,tracking_info,products(id,title)'
  );
  var o = rows[0];
  if (!o || !o.products) { res.status(404).json({ error: 'No se encontró el pedido o el producto.' }); return; }

  var profiles = await helpers.supabaseServiceQuery(
    'profiles?id=eq.' + encodeURIComponent(o.buyer_id) + '&select=email,nombre'
  );
  var buyer = profiles[0];
  if (!buyer || !buyer.email) { res.status(404).json({ error: 'No se encontró el email del comprador.' }); return; }

  var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';
  var link = siteUrl + '/producto/' + encodeURIComponent(o.product_id);

  var html =
    '<p>Hola' + (buyer.nombre ? ' ' + buyer.nombre : '') + ',</p>' +
    '<p>El vendedor despachó <b>' + o.products.title + '</b>. Número de seguimiento: <b>' + (o.tracking_info || 'sin cargar') + '</b>.</p>' +
    '<p>Cuando te llegue, entrá a "Mis pedidos" y confirmá la recepción si está todo bien. Si no llega, llega dañado o distinto a lo publicado, usá el botón "Reportar un problema" ahí mismo — no hace falta esperar a tenerlo en la mano para avisarnos si algo no cierra.</p>' +
    '<p><a href="' + link + '">Ver la publicación</a></p>' +
    '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';

  var result = await helpers.sendEmail({ to: buyer.email, subject: 'Tu pedido fue despachado — UsadoGamer', html: html });
  res.status(200).json(result);
}

async function handleDeliveryConfirmed(orderId, res) {
  var rows = await helpers.supabaseServiceQuery(
    'orders?id=eq.' + encodeURIComponent(orderId) +
    '&select=id,delivery_cost,buyer_id,seller_id,product_id,products(id,title)'
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
    '<p>Confirmamos tu pago del envío de <b>' + o.products.title + '</b> por ' + money.format(o.delivery_cost) + '. El vendedor ya fue avisado y va a despachar el producto.</p>' +
    '<p><a href="' + link + '">Ver la publicación</a></p>' +
    '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';

  var sellerHtml =
    '<p>Hola' + (seller.nombre ? ' ' + seller.nombre : '') + ',</p>' +
    '<p>Ya se confirmó el pago del envío de <b>' + o.products.title + '</b> por ' + money.format(o.delivery_cost) + '. Ya podés despachar el producto.</p>' +
    '<p><a href="' + link + '">Ver la publicación</a></p>' +
    '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';

  var buyerResult = await helpers.sendEmail({ to: buyer.email, subject: 'Confirmamos el pago de tu envío — UsadoGamer', html: buyerHtml });
  var sellerResult = await helpers.sendEmail({ to: seller.email, subject: 'Pago del envío confirmado — UsadoGamer', html: sellerHtml });
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

async function handleBuyerCancelled(orderId, res) {
  var rows = await helpers.supabaseServiceQuery(
    'orders?id=eq.' + encodeURIComponent(orderId) +
    '&select=id,amount,seller_id,product_id,products(id,title)'
  );
  var o = rows[0];
  if (!o || !o.products) { res.status(404).json({ error: 'No se encontró el pedido o el producto.' }); return; }

  var admins = await helpers.supabaseServiceQuery('profiles?is_admin=eq.true&select=id,email,nombre');
  var profiles = await helpers.supabaseServiceQuery(
    'profiles?id=eq.' + encodeURIComponent(o.seller_id) + '&select=email,nombre'
  );
  var seller = profiles[0];

  var money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';
  var link = siteUrl + '/dashboard.html';

  var adminHtml =
    '<p>Un comprador pidió la devolución de un pedido ya pagado, antes de que el vendedor despache.</p>' +
    '<p><b>Producto:</b> ' + o.products.title + ' — <b>Monto:</b> ' + money.format(o.amount) + '</p>' +
    '<p>Hay que devolverle la plata a mano. Entrá al panel de administración para ver el detalle: <a href="' + link + '">' + link + '</a></p>';

  var sent = 0;
  for (var i = 0; i < admins.length; i++) {
    if (!admins[i].email) continue;
    var result = await helpers.sendEmail({ to: admins[i].email, subject: 'Reembolso pendiente — UsadoGamer', html: adminHtml });
    if (result.ok) sent++;
  }

  if (seller && seller.email) {
    var sellerHtml =
      '<p>Hola' + (seller.nombre ? ' ' + seller.nombre : '') + ',</p>' +
      '<p>El comprador de <b>' + o.products.title + '</b> canceló la compra y pidió la devolución, antes de que despaches el producto. No hace falta que hagas nada — el producto vuelve a estar disponible para la venta.</p>' +
      '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';
    await helpers.sendEmail({ to: seller.email, subject: 'Se canceló una venta — UsadoGamer', html: sellerHtml });
  }

  res.status(200).json({ adminsSent: sent });
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
    } else if (event === 'delivery_confirmed') {
      await handleDeliveryConfirmed(orderId, res);
    } else if (event === 'buyer_cancelled') {
      await handleBuyerCancelled(orderId, res);
    } else if (event === 'shipped') {
      await handleShipped(orderId, res);
    } else {
      await handleConfirmed(orderId, res);
    }
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error inesperado' });
  }
};
