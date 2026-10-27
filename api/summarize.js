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

    const langRule = "Detect the language of the user's LATEST message and respond in THAT language. If the user explicitly asks you to speak in a specific language (e.g., 'speak Tamil'), strictly obey that instruction and switch languages immediately.";
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
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 800 } 
    });

    // தினசரி 500 இலவச கோரிக்கைகள் கொண்ட மாடல்கள் (வரம்பு முடிந்தால் அடுத்ததற்கு மாறும்)
    const models = [
      'gemini-3.5-flash-lite', 
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash-lite'
    ];

    let finalData = null;
    let lastErrorMsg = 'All models failed or quota exceeded.';

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      
      try {
        const r = await fetch(url, {
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' },
          body: requestBody
        });

        if (r && r.ok) {
          finalData = await r.json();
          break;
        } else if (r) {
          lastErrorMsg = await r.text();
        }
      } catch (err) {
        lastErrorMsg = err.message;
      }
    }

    if (!finalData) {
      return res.status(503).json({ error: `இலவச வரம்பு முடிந்துவிட்டது. தயவுசெய்து நாளை மீண்டும் முயற்சிக்கவும்.` });
    }
    
    const rawText = finalData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return res.status(200).json(extractJSON(rawText));

  } catch (e) { 
    return res.status(500).json({ error: e.message || 'SERVER_ERROR' }); 
  }
};