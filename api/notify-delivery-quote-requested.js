// Supabase la llama automáticamente (desde un trigger en la base de datos)
// cuando un comprador manda sus datos de envío por primera vez (delivery_method
// pasa a tener un valor y todavía no hay delivery_cost). Avisa por mail al
// vendedor que tiene que calcular y cargar el costo del envío para que el
// comprador pueda pagar.
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
      '&select=id,seller_id,product_id,delivery_method,delivery_address,products(id,title)'
    );
    var o = rows[0];
    if (!o || !o.products) {
      res.status(404).json({ error: 'No se encontró el pedido o el producto.' });
      return;
    }

    var profiles = await helpers.supabaseServiceQuery(
      'profiles?id=eq.' + encodeURIComponent(o.seller_id) + '&select=id,email,nombre'
    );
    var seller = profiles[0];
    if (!seller || !seller.email) {
      res.status(404).json({ error: 'No se encontró el email del vendedor.' });
      return;
    }

    var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';
    var link = siteUrl + '/?producto=' + encodeURIComponent(o.product_id);
    var entrega = o.delivery_method === 'domicilio'
      ? 'Envío a domicilio — ' + (o.delivery_address || 'sin dirección cargada')
      : 'Retiro en sucursal — ' + (o.delivery_address || 'sin localidad cargada');

    var sellerHtml =
      '<p>Hola' + (seller.nombre ? ' ' + seller.nombre : '') + ',</p>' +
      '<p>Un comprador quiere avanzar con la compra de <b>' + o.products.title + '</b>, pero antes necesitamos que calcules cuánto sale el envío.</p>' +
      '<p>' + entrega + '</p>' +
      '<p>Entrá a "Mis pedidos" &gt; "Mis ventas" en la web y cargá el costo de envío. En cuanto lo hagas, le avisamos al comprador para que pueda pagar el total.</p>' +
      '<p><a href="' + link + '">Ver la publicación</a></p>' +
      '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';

    var sellerResult = await helpers.sendEmail({ to: seller.email, subject: 'Un comprador necesita que cotices el envío — UsadoGamer', html: sellerHtml });

    res.status(200).json({ seller: sellerResult });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error inesperado' });
  }
};
