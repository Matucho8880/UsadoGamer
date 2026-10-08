// Vercel la llama Supabase automáticamente (desde un trigger en la base de
// datos) cada vez que alguien hace una pregunta nueva sobre un producto.
// Le manda un mail al vendedor avisándole.
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
    var questionId = req.body && req.body.question_id;
    if (!questionId) {
      res.status(400).json({ error: 'Falta question_id' });
      return;
    }

    var rows = await helpers.supabaseServiceQuery(
      'product_questions?id=eq.' + encodeURIComponent(questionId) +
      '&select=question,products(id,title,user_id)'
    );
    var q = rows[0];
    if (!q || !q.products){
      res.status(404).json({ error: 'No se encontró la pregunta o el producto.' });
      return;
    }

    var profiles = await helpers.supabaseServiceQuery(
      'profiles?id=eq.' + encodeURIComponent(q.products.user_id) + '&select=email,nombre'
    );
    var seller = profiles[0];
    if (!seller || !seller.email){
      res.status(404).json({ error: 'No se encontró el email del vendedor.' });
      return;
    }

    var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';
    var html =
      '<p>Hola' + (seller.nombre ? ' ' + seller.nombre : '') + ',</p>' +
      '<p>Te hicieron una pregunta nueva en tu publicación <b>' + q.products.title + '</b>:</p>' +
      '<p style="background:#f7f7f8; border-radius:8px; padding:12px">"' + q.question + '"</p>' +
      '<p><a href="' + siteUrl + '/?producto=' + encodeURIComponent(q.products.id) + '">Respondela acá</a></p>' +
      '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';

    var result = await helpers.sendEmail({ to: seller.email, subject: 'Te hicieron una pregunta en UsadoGamer', html: html });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error inesperado' });
  }
};
