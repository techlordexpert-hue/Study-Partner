// Research Assistant — Vercel serverless function.
// Uses Google's Gemini API with Google Search grounding. The API key stays on the
// server and never reaches the browser. Set GEMINI_API_KEY in Vercel -> Settings ->
// Environment Variables (get one at https://aistudio.google.com/apikey).
// Google now issues keys in two formats — legacy "AIzaSy..." and the newer "AQ...."
// auth-key format — both are sent the same way, via the x-goog-api-key header.
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const hits = new Map(); // best-effort per-instance rate limit

const send = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return send(res, 503, { error: 'not_configured' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x', now = Date.now();
  const h = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (h.length >= 25) return send(res, 429, { error: 'Too many questions. Please wait a few minutes.' });
  h.push(now); hits.set(ip, h);
  if (hits.size > 5000) hits.clear();

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  let msgs = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-10).map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return send(res, 400, { error: 'Ask a question first.' });

  const context = String(body.context || '').slice(0, 900);
  const system =
    "You are the Research assistant inside 'Study Partner', a study app for students in Ghana (senior high, college and university). " +
    "Be warm, clear and concise (under about 250 words unless asked for more). Teach, don't just give answers: explain the idea, then the answer. " +
    "Use Google Search whenever the question needs current, specific or factual information (news, deadlines, definitions you are unsure of, syllabus or exam info). " +
    "If asked for practice questions, give them with answers. If you are unsure, say so honestly. Use simple formatting: short paragraphs, '-' bullets, **bold** for key terms." +
    (context ? '\n\nWhat the student is looking at right now: ' + context : '');

  const contents = msgs.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: 1024 },
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      console.error('gemini error', r.status, JSON.stringify(j).slice(0, 500));
      const reason = j && j.error && (j.error.status || j.error.message) || '';
      if (r.status === 401 && /ACCESS_TOKEN_TYPE_UNSUPPORTED|invalid authentication/i.test(String(reason))) {
        return send(res, 502, { error: "Google's AI key service is rejecting this key right now (a known issue on Google's side with some newly-issued keys). Try regenerating the key at aistudio.google.com/apikey and updating GEMINI_API_KEY in Vercel." });
      }
      if (r.status === 429) return send(res, 429, { error: "This key has hit Google's free-tier rate limit. Please wait a minute and try again." });
      return send(res, 502, { error: 'The AI service had a problem. Please try again.' });
    }
    const cand = (j.candidates || [])[0] || {};
    const reply = ((cand.content && cand.content.parts) || []).map((p) => p.text || '').join('').trim();
    const chunks = (cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
    const seen = new Set(), sources = [];
    for (const c of chunks) {
      const w = c.web;
      if (w && w.uri && !seen.has(w.uri)) { seen.add(w.uri); sources.push({ title: String(w.title || w.uri).slice(0, 100), url: w.uri }); }
    }
    return send(res, 200, { reply: reply || 'Sorry, I could not find an answer to that. Try rephrasing your question.', sources: sources.slice(0, 4) });
  } catch (e) {
    console.error(e);
    return send(res, 502, { error: 'Could not reach the AI service. Please try again.' });
  }
};
