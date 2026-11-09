// Supabase la llama automáticamente (desde triggers en la base de datos) en
// los dos momentos de una pregunta sobre un producto. El evento viene en
// req.body.event:
//   - 'asked' (o sin event, por compatibilidad con el trigger viejo): alguien
//     hizo una pregunta nueva. Avisa por mail al vendedor.
//   - 'answered': el vendedor respondió. Avisa por mail a quien preguntó.
//
// Antes esto eran dos archivos separados (notify-question.js y
// notify-question-answered.js). Se unificaron en uno solo para no pasarnos
// del límite de 12 funciones serverless del plan gratuito de Vercel.
var helpers = require('./_resend');

async function handleAsked(questionId, res) {
  var rows = await helpers.supabaseServiceQuery(
    'product_questions?id=eq.' + encodeURIComponent(questionId) +
    '&select=question,products(id,title,user_id)'
  );
  var q = rows[0];
  if (!q || !q.products) { res.status(404).json({ error: 'No se encontró la pregunta o el producto.' }); return; }

  var profiles = await helpers.supabaseServiceQuery(
    'profiles?id=eq.' + encodeURIComponent(q.products.user_id) + '&select=email,nombre'
  );
  var seller = profiles[0];
  if (!seller || !seller.email) { res.status(404).json({ error: 'No se encontró el email del vendedor.' }); return; }

  var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';
  var html =
    '<p>Hola' + (seller.nombre ? ' ' + seller.nombre : '') + ',</p>' +
    '<p>Te hicieron una pregunta nueva en tu publicación <b>' + q.products.title + '</b>:</p>' +
    '<p style="background:#f7f7f8; border-radius:8px; padding:12px">"' + q.question + '"</p>' +
    '<p><a href="' + siteUrl + '/producto/' + encodeURIComponent(q.products.id) + '">Respondela acá</a></p>' +
    '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';

  var result = await helpers.sendEmail({ to: seller.email, subject: 'Te hicieron una pregunta en UsadoGamer', html: html });
  res.status(200).json(result);
}

async function handleAnswered(questionId, res) {
  var rows = await helpers.supabaseServiceQuery(
    'product_questions?id=eq.' + encodeURIComponent(questionId) +
    '&select=question,answer,asker_id,product_id,products(id,title)'
  );
  var q = rows[0];
  if (!q || !q.products) { res.status(404).json({ error: 'No se encontró la pregunta o el producto.' }); return; }

  var profiles = await helpers.supabaseServiceQuery(
    'profiles?id=eq.' + encodeURIComponent(q.asker_id) + '&select=email,nombre'
  );
  var asker = profiles[0];
  if (!asker || !asker.email) { res.status(404).json({ error: 'No se encontró el email de quien preguntó.' }); return; }

  var siteUrl = process.env.SITE_URL || 'https://usadogamer-projecarg.vercel.app';
  var html =
    '<p>Hola' + (asker.nombre ? ' ' + asker.nombre : '') + ',</p>' +
    '<p>Te respondieron la pregunta que hiciste en <b>' + q.products.title + '</b>:</p>' +
    '<p style="background:#f7f7f8; border-radius:8px; padding:12px"><i>"' + q.question + '"</i><br><br><b>Respuesta:</b> ' + q.answer + '</p>' +
    '<p><a href="' + siteUrl + '/producto/' + encodeURIComponent(q.product_id) + '">Ver la publicación</a></p>' +
    '<p style="color:#64666c; font-size:13px">UsadoGamer</p>';

  var result = await helpers.sendEmail({ to: asker.email, subject: 'Te respondieron en UsadoGamer', html: html });
  res.status(200).json(result);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido' }); return; }
  if (!helpers.checkSecret(req)) { res.status(401).json({ error: 'No autorizado' }); return; }

  try {
    var questionId = req.body && req.body.question_id;
    if (!questionId) { res.status(400).json({ error: 'Falta question_id' }); return; }

    var event = req.body && req.body.event;
    if (event === 'answered') {
      await handleAnswered(questionId, res);
    } else {
      await handleAsked(questionId, res);
    }
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error inesperado' });
  }
};
