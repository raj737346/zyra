function extractJSON(text) {
  try {
    let clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      clean = clean.substring(start, end + 1);
    }
    return JSON.parse(clean);
  } catch (e) {
    return { summary: text, answer: text };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { notes, mode = 'ask', lang = 'auto', image = null, mimeType = null, think = false, history = [] } = req.body || {};
    if (!notes && !image) return res.status(400).json({ error: 'INVALID_INPUT' });

    const langRule = lang === 'auto' 
      ? "Always respond in the SAME LANGUAGE the user used in their latest message." 
      : `Respond in ${lang}.`;

    const thinkPrompt = think ? "Think step by step. " : "";
    const systemPrompt = `You are Zyra, an AI assistant. ${langRule} ${thinkPrompt}Provide helpful, clear answers.`;
    
    const formatPrompt = `Return ONLY a valid JSON object. No markdown.
    ${mode === 'ask' ? '{"answer": "your answer here"}' : '{"summary":"...","themes":["..."],"overdue":["..."],"priorities":["..."],"checklist":["..."]}'}`;

    const contents = [];
    history.slice(-4).forEach(msg => {
      contents.push({ role: msg.role === 'user' ? 'user' : 'model', parts: [{ text: msg.text }] });
    });

    const currentParts = [{ text: `${systemPrompt}\n\nUser: ${notes || 'Image'}\n\n${formatPrompt}` }];
    if (image && mimeType) currentParts.push({ inlineData: { mimeType: mimeType, data: image } });
    contents.push({ role: 'user', parts: currentParts });

    // நேரடியாக வேகமான மாடல்
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    // சர்வர் பக்கம் 15 வினாடி Timeout (Frontend 20s-க்குள் முடிந்துவிடும்)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const r = await fetch(url, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: contents, 
        generationConfig: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 800 } 
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({ error: `API Error: ${errText}` });
    }
    
    const data = await r.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return res.status(200).json(extractJSON(rawText));

  } catch (e) { 
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Google API-ல் இருந்து பதில் வர அதிக நேரம் எடுக்கிறது. மீண்டும் முயற்சிக்கவும்.' });
    }
    return res.status(500).json({ error: e.message || 'SERVER_ERROR' }); 
  }
};