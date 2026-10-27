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
    const { notes, image = null, mimeType = null, think = false } = req.body || {};
    if (!notes && !image) return res.status(400).json({ error: 'INVALID_INPUT' });

    // மிக முக்கியமான மொழி விதி
    const langRule = `MANDATORY LANGUAGE RULE: 
    1. You MUST respond in the EXACT SAME language as the user's message.
    2. If the user's message is in English, you MUST reply in 100% English ONLY.
    3. If the user's message is in Tamil, you MUST reply in 100% Tamil ONLY.
    4. NEVER mix languages. NEVER use Tamil letters in an English sentence.`;

    const thinkPrompt = think ? "Think step by step. " : "";
    const systemPrompt = `You are Zyra, a highly intelligent AI. ${langRule} ${thinkPrompt}`;
    
    const formatPrompt = `Return ONLY a valid JSON object: {"answer": "your full answer here"}`;

    const contents = [];
    
    // நினைவாற்றலை நீக்கிவிட்டு, கடைசி மெசேஜை மட்டும் அனுப்புகிறோம் (குழப்பம் வராமல் இருக்க)
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
