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

async function fetchWithRetry(url, options, maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    const r = await fetch(url, options);
    if (r.status !== 503) return r;
    if (i < maxRetries) {
      const delay = Math.pow(2, i) * 1000; // 1s, 2s
      await new Promise(res => setTimeout(res, delay));
    }
  }
  return null; // அனைத்து முயற்சிகளும் தோல்வி
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

    const requestBody = JSON.stringify({ 
      contents: contents, 
      generationConfig: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 800 } 
    });

    // நிலையான மாடல்களின் பட்டியல் (புதிய API விசைகளுக்கு)
    const models = [
      'gemini-3.8-flash', 
      'gemini-3.7-flash', 
      'gemini-3.6-flash', 
      'gemini-3.5-flash', 
      'gemini-3.5-flash-lite', 
      'gemini-3.1-flash-lite'
    ];

    let finalData = null;
    let lastErrorMsg = 'All models failed.';

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      
      const r = await fetchWithRetry(url, {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: requestBody
      });

      if (r && r.ok) {
        finalData = await r.json();
        break; // வெற்றி! லூப்பை விட்டு வெளியேறு
      } else if (r) {
        lastErrorMsg = await r.text();
      }
    }

    if (!finalData) {
      return res.status(503).json({ error: `சர்வர் தற்காலிகமாக வேலை செய்யவில்லை. மீண்டும் முயற்சிக்கவும். (${lastErrorMsg})` });
    }
    
    const rawText = finalData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return res.status(200).json(extractJSON(rawText));

  } catch (e) { 
    return res.status(500).json({ error: e.message || 'SERVER_ERROR' }); 
  }
};