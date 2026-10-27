module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { notes, mode = 'weekly', lang = 'ta', image = null, mimeType = null, think = false } = req.body || {};
    if (!notes && !image) return res.status(400).json({ error: 'INVALID_INPUT' });

    const langName = { ta: 'Tamil', en: 'English', hi: 'Hindi' }[lang] || 'English';
    const thinkPrompt = think ? "Think step by step. " : "";

    const prompt = `You are Zyra. ${thinkPrompt}Respond in ${langName}. Based on the provided notes and/or image, return STRICT JSON:
    ${mode === 'ask' ? '{"answer": "your answer"}' : '{"summary":"3-4 sentences","themes":["..."],"overdue":["..."],"priorities":["..."],"checklist":["..."]}'}
    Notes: ${notes || 'No text notes provided.'}`;

    const parts = [{ text: prompt }];
    if (image && mimeType) {
      parts.push({ inlineData: { mimeType: mimeType, data: image } });
    }

    // Loop இல்லாமல், நேரடியாக வேகமான மாடல் (gemini-2.5-flash)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ parts: parts }], 
        generationConfig: { 
          responseMimeType: 'application/json',
          temperature: 0.2, // குறைவான வெப்பநிலை = வேகமான மற்றும் துல்லியமான பதில்
          maxOutputTokens: 800 // வார்த்தைகளைக் குறைத்து வேகத்தை அதிகரிக்கிறது
        } 
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({ error: `API Error: ${errText}` });
    }
    
    const data = await r.json();
    return res.status(200).json(JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'));
  } catch (e) { 
    return res.status(500).json({ error: e.message || 'SERVER_ERROR' }); 
  }
};