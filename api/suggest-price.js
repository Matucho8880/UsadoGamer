// Función del servidor (Vercel) que calcula un precio sugerido.
// La API key de Gemini vive solo acá, en una variable de entorno del servidor:
// nunca llega al navegador del usuario.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Falta configurar GEMINI_API_KEY en Vercel.' });
    return;
  }

  try {
    const { category, title, condition, description, repairDetail } = req.body || {};
    if (!title || !category || !condition) {
      res.status(400).json({ error: 'Faltan datos del producto (categoría, título o estado).' });
      return;
    }

    var detalles = 'Categoría: ' + category + '. Título: "' + title + '". Estado declarado por el vendedor: ' + condition + '.';
    if (description) detalles += ' Descripción del vendedor: ' + description;
    if (repairDetail) detalles += ' Detalle de reparación: ' + repairDetail;

    var prompt =
      'Sos un tasador experto en gaming usado para el mercado argentino. ' +
      'Buscá en Mercado Libre Argentina, Compra Gamer y otros sitios/clasificados argentinos el precio de este producto nuevo y el de publicaciones de productos usados similares. ' +
      'Datos del producto a tasar: ' + detalles + ' ' +
      'Con esa información, calculá un precio de venta justo en pesos argentinos (ARS) para ESTE producto usado puntual, considerando su estado real. ' +
      'Respondé ÚNICAMENTE con un JSON válido, sin texto antes ni después, con exactamente este formato: ' +
      '{"precio_sugerido": <número entero en ARS>, "precio_nuevo_referencia": <número entero en ARS o null si no lo encontraste>, "justificacion": "<2 o 3 oraciones en español explicando el cálculo>"}';

    var apiRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }]
      })
    });

    if (!apiRes.ok) {
      var errText = await apiRes.text();
      res.status(502).json({ error: 'La IA no pudo responder.', detail: errText });
      return;
    }

    var data = await apiRes.json();
    var candidate = (data.candidates || [])[0] || {};
    var parts = (candidate.content && candidate.content.parts) || [];
    var text = parts.map(function (p) { return p.text || ''; }).join('');
    var chunks = (candidate.groundingMetadata && candidate.groundingMetadata.groundingChunks) || [];
    var fuentes = chunks
      .filter(function (c) { return c.web; })
      .map(function (c) { return { url: c.web.uri, titulo: c.web.title }; });

    var parsed;
    try {
      var match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : text);
    } catch (e) {
      res.status(502).json({ error: 'No se pudo interpretar la respuesta de la IA.', raw: text });
      return;
    }

    res.status(200).json({
      precio_sugerido: parsed.precio_sugerido,
      precio_nuevo_referencia: parsed.precio_nuevo_referencia || null,
      justificacion: parsed.justificacion || '',
      fuentes: fuentes
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error inesperado.' });
  }
};
