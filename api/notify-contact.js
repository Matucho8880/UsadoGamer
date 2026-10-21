// Supabase la llama automáticamente (desde un trigger en la base de datos)
// cuando alguien manda un mensaje desde "¿Tenés un problema? Contactanos"
// (tabla contact_messages). Avisa por mail a toda cuenta con is_admin = true
// para que lo vea rápido, además de la campanita dentro del sitio.
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
    var messageId = req.body && req.body.message_id;
    if (!messageId) {
      res.status(400).json({ error: 'Falta message_id' });
      return;
    }

    var rows = await helpers.supabaseServiceQuery(
      'contact_messages?id=eq.' + encodeURIComponent(messageId) +
      '&select=id,nombre,email,motivo,referencia,mensaje,created_at'
    );
    var m = rows[0];
    if (!m) {
      res.status(404).json({ error: 'No se encontró el mensaje.' });
      return;
    }

    var admins = await helpers.supabaseServiceQuery('profiles?is_admin=eq.true&select=id,email,nombre');
    if (!admins.length) {
      res.status(200).json({ ok: true, skipped: 'sin administradores cargados' });
      return;
    }

    var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';
    var link = siteUrl + '/dashboard.html';
    var motivoLabel = {
      pedido: 'Problema con un pedido',
      publicacion: 'Problema con una publicación',
      pago: 'Problema con un pago o envío',
      otro: 'Otra consulta'
    }[m.motivo] || m.motivo;

    var html =
      '<p>Nuevo mensaje de contacto en UsadoGamer.</p>' +
      '<p><b>De:</b> ' + (m.nombre || '(sin nombre)') + ' — ' + m.email + '</p>' +
      '<p><b>Motivo:</b> ' + motivoLabel + '</p>' +
      (m.referencia ? '<p><b>Referencia:</b> ' + m.referencia + '</p>' : '') +
      '<p><b>Mensaje:</b><br>' + String(m.mensaje).replace(/\n/g, '<br>') + '</p>' +
      '<p>Entrá al panel de administración, sección "Mensajes", para responder: <a href="' + link + '">' + link + '</a></p>';

    var sent = 0;
    for (var i = 0; i < admins.length; i++) {
      if (!admins[i].email) continue;
      var result = await helpers.sendEmail({ to: admins[i].email, subject: 'Nuevo mensaje de contacto — UsadoGamer', html: html });
      if (result.ok) sent++;
    }
    res.status(200).json({ sent: sent });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error inesperado' });
  }
};
