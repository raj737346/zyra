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
    const { notes, mode = 'weekly', lang = 'auto', image = null, mimeType = null, think = false, history = [] } = req.body || {};
    if (!notes && !image) return res.status(400).json({ error: 'INVALID_INPUT' });

    // மொழி விதி: 'auto' என்றால், யூசர் எழுதும் மொழியிலேயே பதில் தர வேண்டும்
    const langRule = lang === 'auto' 
      ? "Always respond in the SAME LANGUAGE the user used in their latest message." 
      : `Respond in ${lang}.`;

    const thinkPrompt = think ? "Think step by step. " : "";

    // System Instruction (AI-ன் நடத்தை)
    const systemPrompt = `You are Zyra, an intelligent and friendly AI assistant. ${langRule} ${thinkPrompt}Provide helpful, clear, and natural answers.`;
    
    // JSON Output format
    const formatPrompt = `Based on the user's message, return ONLY a valid JSON object. Do not include markdown formatting like \`\`\`json.
    ${mode === 'ask' ? '{"answer": "your answer here"}' : '{"summary":"3-4 sentences","themes":["..."],"overdue":["..."],"priorities":["..."],"checklist":["..."]}'}`;

    // Chat History-ஐ Gemini Format-க்கு மாற்றுதல்
    const contents = [];
    
    // History சேர்ப்பு (கடைசி 6 மெசேஜ்கள் மட்டும் வேகத்திற்காக)
    history.slice(-6).forEach(msg => {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      });
    });

    // தற்போதைய யூசர் மெசேஜ்
    const currentParts = [{ text: `${systemPrompt}\n\nUser Message: ${notes || 'Image provided.'}\n\n${formatPrompt}` }];
    if (image && mimeType) {
      currentParts.push({ inlineData: { mimeType: mimeType, data: image } });
    }
    contents.push({ role: 'user', parts: currentParts });

    const models = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
    let data = null, lastError = null;

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contents: contents, 
          generationConfig: { 
            responseMimeType: 'application/json',
            temperature: 0.4,
            maxOutputTokens: 1000
          } 
        }),
      });

      if (r.ok) { data = await r.json(); break; } 
      else { lastError = await r.text(); }
    }

    if (!data) return res.status(500).json({ error: `API Error: ${lastError}` });
    
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsedData = extractJSON(rawText);
    
    return res.status(200).json(parsedData);
  } catch (e) { 
    return res.status(500).json({ error: e.message || 'SERVER_ERROR' }); 
  }
};