// Supabase la llama automáticamente (desde un trigger en la base de datos)
// justo cuando un usuario confirma su email por primera vez. Le manda un
// mail de bienvenida.
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
    var userId = req.body && req.body.user_id;
    if (!userId) {
      res.status(400).json({ error: 'Falta user_id' });
      return;
    }

    var profiles = await helpers.supabaseServiceQuery(
      'profiles?id=eq.' + encodeURIComponent(userId) + '&select=email,nombre,username'
    );
    var user = profiles[0];
    if (!user || !user.email){
      res.status(404).json({ error: 'No se encontró el perfil del usuario.' });
      return;
    }

    var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';
    var html =
      '<p>Hola ' + (user.nombre || user.username) + ',</p>' +
      '<p>¡Bienvenido a <b>UsadoGamer</b>! Ya confirmaste tu cuenta y podés empezar a comprar y publicar productos de gaming usados.</p>' +
      '<p><a href="' + siteUrl + '">Entrar al sitio</a></p>' +
      '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';

    var result = await helpers.sendEmail({ to: user.email, subject: '¡Bienvenido a UsadoGamer!', html: html });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error inesperado' });
  }
};
