// Helper compartido para mandar emails con Resend desde las funciones del servidor.
// No es una función de Vercel en sí (no está pensada para llamarse por HTTP directo),
// solo código reutilizado por notify-question.js y send-welcome.js.

async function sendEmail({ to, subject, html }) {
  var apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'Falta configurar RESEND_API_KEY en Vercel.' };
  }
  // Mientras no haya un dominio propio verificado en Resend, los emails de prueba
  // ("onboarding@resend.dev") solo se pueden mandar a la casilla con la que te
  // registraste en Resend. Con un dominio verificado, se puede cambiar este "from"
  // y mandarle a cualquier usuario real.
  var fromAddress = process.env.RESEND_FROM || 'UsadoGamer <onboarding@resend.dev>';

  var resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: fromAddress, to: [to], subject: subject, html: html })
  });

  if (!resp.ok) {
    var errText = await resp.text();
    return { ok: false, error: errText };
  }
  return { ok: true };
}

// Hace una consulta de lectura a Supabase usando la service role key, que se
// salta la seguridad por fila (RLS). Solo se usa server-side, nunca llega al navegador.
async function supabaseServiceQuery(path) {
  var url = process.env.SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Falta configurar SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel.');
  }
  var resp = await fetch(url + '/rest/v1/' + path, {
    headers: { apikey: key, Authorization: 'Bearer ' + key }
  });
  if (!resp.ok) {
    var errText = await resp.text();
    throw new Error('Error consultando Supabase: ' + errText);
  }
  return resp.json();
}

function checkSecret(req) {
  var secret = (req.body && req.body.secret) || req.headers['x-webhook-secret'];
  return secret && process.env.INTERNAL_WEBHOOK_SECRET && secret === process.env.INTERNAL_WEBHOOK_SECRET;
}

module.exports = { sendEmail: sendEmail, supabaseServiceQuery: supabaseServiceQuery, checkSecret: checkSecret };
