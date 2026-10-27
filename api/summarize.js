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

// Timeout உடன் Fetch செய்யும் ஃபங்ஷன்
async function fetchWithTimeout(url, options, timeout = 7000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
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

    const requestBody = JSON.stringify({ 
      contents: contents, 
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 800 } 
    });

    // வேகமான மாடல்களின் வரிசை (Lite -> Flash -> Pro)
    const models = [
      'gemini-3.5-flash-lite', 
      'gemini-3.5-flash', 
      'gemini-3.8-flash'
    ];

    let finalData = null;
    let lastErrorMsg = 'All models failed or timed out.';

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      
      try {
        // ஒரு மாடலுக்கு 7 வினாடிகள் மட்டும் காத்திரு. பதில் வரவில்லை என்றால் அடுத்ததற்கு மாறு.
        const r = await fetchWithTimeout(url, {
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' },
          body: requestBody
        }, 7000);

        if (r && r.ok) {
          finalData = await r.json();
          break; // வெற்றி! லூப்பை விட்டு வெளியேறு
        } else if (r) {
          lastErrorMsg = await r.text();
        }
      } catch (err) {
        lastErrorMsg = err.message;
        // Timeout ஆனால் அடுத்த மாடலுக்கு மாறும்
      }
    }

    if (!finalData) {
      return res.status(503).json({ error: `சர்வர் மிக மெதுவாக உள்ளது. மீண்டும் முயற்சிக்கவும்.` });
    }
    
    const rawText = finalData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return res.status(200).json(extractJSON(rawText));

  } catch (e) { 
    return res.status(500).json({ error: e.message || 'SERVER_ERROR' }); 
  }
};