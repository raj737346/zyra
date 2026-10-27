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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    // history-ஐ இப்போது நாம் பெறுகிறோம்
    const { notes, image = null, mimeType = null, think = false, history = [] } = req.body || {};
    if (!notes && !image) return res.status(400).json({ error: 'INVALID_INPUT' });

    const langRule = `MANDATORY LANGUAGE RULE: 
    1. If the user explicitly asks to switch languages (e.g., "Please talk with me Tamil" or "Speak English"), you MUST obey immediately and switch to that language for the rest of the conversation.
    2. Otherwise, respond in the SAME language as the user's LATEST message.
    3. NEVER mix languages. Do not output Tamil letters in an English sentence.`;

    const memoryRule = `CRITICAL MEMORY RULE: 
    1. You have access to the ENTIRE chat history provided below.
    2. Use this history to understand the context. The user might refer to something they said earlier.`;

    const thinkPrompt = think ? "Think step by step. " : "";
    const systemPrompt = `You are Zyra, a highly intelligent AI. ${langRule} ${memoryRule} ${thinkPrompt}`;
    
    const formatPrompt = `Return ONLY a valid JSON object: {"answer": "your full answer here"}`;

    const contents = [];
    
    // UNLIMITED MEMORY: முழு History-யும் அனுப்பப்படுகிறது (வரம்பு இல்லை)
    history.forEach(msg => {
      contents.push({ role: msg.role === 'user' ? 'user' : 'model', parts: [{ text: msg.text }] });
    });

    const currentParts = [{ text: `${systemPrompt}\n\nUser: ${notes || 'Analyze this image.'}\n\n${formatPrompt}` }];
    if (image && mimeType) currentParts.push({ inlineData: { mimeType: mimeType, data: image } });
    contents.push({ role: 'user', parts: currentParts });

    const models = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
    let finalData = null, lastErrorMsg = 'All models failed.';

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      try {
        const r = await fetch(url, {
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            contents: contents, 
            generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 1500 }
          })
        });

        if (r && r.ok) { finalData = await r.json(); break; } 
        else if (r) { lastErrorMsg = await r.text(); }
      } catch (err) { lastErrorMsg = err.message; }
    }

    if (!finalData) return res.status(500).json({ error: `API Error: ${lastErrorMsg}` });
    
    const rawText = finalData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return res.status(200).json(extractJSON(rawText));

  } catch (e) { 
    return res.status(500).json({ error: e.message || 'SERVER_ERROR' }); 
  }
};
