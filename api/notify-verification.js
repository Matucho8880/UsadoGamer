// Supabase la llama automáticamente (desde triggers en la base de datos) en
// los distintos momentos de la verificación de identidad de un vendedor. El
// evento viene en req.body.event:
//   - 'requested': alguien mandó sus datos (DNI, foto, etc.) para que Mateo
//     los revise. Avisa por mail a toda cuenta con is_admin = true.
//   - 'verified': Mateo aprobó la verificación. Avisa al usuario que ya
//     puede publicar.
//   - 'rejected': Mateo rechazó la verificación. Avisa al usuario, con el
//     motivo si se cargó uno, para que revise y vuelva a mandar sus datos.
var helpers = require('./_resend');

async function handleRequested(userId, res) {
  var rows = await helpers.supabaseServiceQuery(
    'profiles?id=eq.' + encodeURIComponent(userId) + '&select=id,nombre,apellido,email'
  );
  var u = rows[0];
  if (!u) { res.status(404).json({ error: 'No se encontró el usuario.' }); return; }

  var admins = await helpers.supabaseServiceQuery('profiles?is_admin=eq.true&select=id,email,nombre');
  if (!admins.length) { res.status(200).json({ ok: true, skipped: 'sin administradores cargados' }); return; }

  var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';
  var link = siteUrl + '/dashboard.html';
  var nombreCompleto = [u.nombre, u.apellido].filter(Boolean).join(' ') || u.email;

  var html =
    '<p>Hay una verificación de identidad nueva para revisar en UsadoGamer.</p>' +
    '<p><b>De:</b> ' + nombreCompleto + ' — ' + u.email + '</p>' +
    '<p>Entrá al panel de administración, sección "Verificaciones de vendedores", para revisarla: <a href="' + link + '">' + link + '</a></p>';

  var sent = 0;
  for (var i = 0; i < admins.length; i++) {
    if (!admins[i].email) continue;
    var result = await helpers.sendEmail({ to: admins[i].email, subject: 'Verificación de identidad pendiente — UsadoGamer', html: html });
    if (result.ok) sent++;
  }
  res.status(200).json({ sent: sent });
}

async function handleReviewed(userId, event, reason, res) {
  var rows = await helpers.supabaseServiceQuery(
    'profiles?id=eq.' + encodeURIComponent(userId) + '&select=id,nombre,email'
  );
  var u = rows[0];
  if (!u || !u.email) { res.status(404).json({ error: 'No se encontró el email del usuario.' }); return; }

  var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';
  var link = siteUrl + '/';

  var html, subject;
  if (event === 'verified') {
    subject = 'Tu cuenta fue verificada — UsadoGamer';
    html =
      '<p>Hola' + (u.nombre ? ' ' + u.nombre : '') + ',</p>' +
      '<p>Revisamos tus datos y ya está todo en orden. Tu cuenta quedó verificada y ya podés publicar y vender en UsadoGamer. ✅</p>' +
      '<p><a href="' + link + '">Ir a UsadoGamer</a></p>' +
      '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';
  } else {
    subject = 'Revisá tus datos — UsadoGamer';
    html =
      '<p>Hola' + (u.nombre ? ' ' + u.nombre : '') + ',</p>' +
      '<p>Revisamos los datos que mandaste para verificar tu cuenta y todavía no los pudimos confirmar.</p>' +
      (reason ? '<p><b>Motivo:</b> ' + String(reason).replace(/\n/g, '<br>') + '</p>' : '') +
      '<p>Entrá a "Mi cuenta" para revisar y volver a mandar tus datos.</p>' +
      '<p><a href="' + link + '">Ir a UsadoGamer</a></p>' +
      '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';
  }

  var result = await helpers.sendEmail({ to: u.email, subject: subject, html: html });
  res.status(200).json(result);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido' }); return; }
  if (!helpers.checkSecret(req)) { res.status(401).json({ error: 'No autorizado' }); return; }

  try {
    var userId = req.body && req.body.user_id;
    var event = req.body && req.body.event;
    if (!userId) { res.status(400).json({ error: 'Falta user_id' }); return; }

    if (event === 'verified' || event === 'rejected') {
      await handleReviewed(userId, event, req.body && req.body.reason, res);
    } else {
      await handleRequested(userId, res);
    }
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error inesperado' });
  }
};
