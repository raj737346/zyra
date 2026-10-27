module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { notes, mode = 'weekly', lang = 'ta' } = req.body || {};
    if (!notes) return res.status(400).json({ error: 'INVALID_INPUT' });

    const langName = { ta: 'Tamil', en: 'English', hi: 'Hindi' }[lang] || 'English';
    const prompt = `You are Zyra. Respond in ${langName}. Based on notes, return STRICT JSON:
    ${mode === 'ask' ? '{"answer": "your answer"}' : '{"summary":"3-4 sentences","themes":["..."],"overdue":["..."],"priorities":["..."],"checklist":["..."]}'}
    Notes: ${notes}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }),
    });
    
    if (!r.ok) return res.status(500).json({ error: 'AI_ERROR' });
    const data = await r.json();
    return res.status(200).json(JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'));
  } catch (e) { return res.status(500).json({ error: 'SERVER_ERROR' }); }
};
