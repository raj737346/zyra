function extractJSON(text) {
  try {
    let clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) clean = clean.substring(start, end + 1);
    return JSON.parse(clean);
  } catch (e) {
    return { summary: text, answer: text };
  }
}

async function callGemini(prompt, useSearch = false) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const models = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const requestBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 1500 }
      };
      if (useSearch) {
        requestBody.tools = [{ googleSearch: {} }];
      }

      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (r.ok) {
        const data = await r.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return JSON.parse(text);
      }
    } catch (e) {}
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { notes, image = null, mimeType = null, think = false, isSearching = false } = req.body || {};
    if (!notes && !image) return res.status(400).json({ error: 'INVALID_INPUT' });

    const langRule = `MANDATORY LANGUAGE RULE: 
    1. You MUST detect the language of the user's LATEST message.
    2. You MUST reply in the EXACT SAME language the user used. 
    3. If the user asks in Tamil, reply in Tamil. If English, reply in English.
    4. If the user says "Please talk with me Tamil" or "Please tell me Tamil", you MUST switch to Tamil IMMEDIATELY and reply in 100% Tamil.
    5. NEVER mix languages.
    6. ACCURACY RULE: You must check your spelling and grammar carefully in ALL languages. Do NOT make spelling mistakes. Use proper words and sentence structure.`;

    const thinkPrompt = think ? "Think step by step. " : "";
    const systemPrompt = `You are Zyra, a highly intelligent AI. ${langRule} ${thinkPrompt}`;
    
    const formatPrompt = `Return ONLY a valid JSON object: {"answer": "your full answer here"}`;

    let prompt = `${systemPrompt}\n\nUser: ${notes || 'Analyze this image.'}\n\n${formatPrompt}`;
    let finalData = null;

    if (isSearching) {
      finalData = await callGemini(prompt, true);
    }

    if (!finalData) {
      const contents = [{ parts: [{ text: prompt }] }];
      if (image && mimeType) {
        contents[0].parts.push({ inlineData: { mimeType: mimeType, data: image } });
      }
      
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        const models = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
        for (const model of models) {
          try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const r = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: contents,
                generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 1500 }
              })
            });
            if (r.ok) {
              const data = await r.json();
              const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) { finalData = JSON.parse(text); break; }
            }
          } catch (e) {}
        }
      }
    }

    if (!finalData) {
      return res.status(500).json({ error: 'API Error: All models failed.' });
    }
    
    return res.status(200).json(finalData);

  } catch (e) { 
    return res.status(500).json({ error: e.message || 'SERVER_ERROR' }); 
  }
};