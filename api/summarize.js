function extractJSON(text) {
  try {
    // மார்க்டவுன் கோட் பிளாக்குகளை நீக்குதல்
    let clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    
    // முதல் { மற்றும் கடைசி } குறியீட்டிற்கு இடையே உள்ளதை மட்டும் எடுத்தல்
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    
    if (start !== -1 && end !== -1 && end > start) {
      clean = clean.substring(start, end + 1);
    }
    
    return JSON.parse(clean);
  } catch (e) {
    return { summary: text, themes: [], overdue: [], priorities: [], checklist: [], answer: text };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { notes, mode = 'weekly', lang = 'ta', image = null, mimeType = null, think = false } = req.body || {};
    if (!notes && !image) return res.status(400).json({ error: 'INVALID_INPUT' });

    const langName = { ta: 'Tamil', en: 'English', hi: 'Hindi' }[lang] || 'English';
    
    // Think ON செய்திருந்தால், AI-க்கு ஆழமாக யோசிக்கச் சொல்லும் ப்ராம்ப்ட்
    const thinkPrompt = think ? "Think step by step and provide a detailed answer. " : "";

    // AI-க்கு கண்டிப்பாக JSON மட்டுமே வேண்டும் என்று கட்டளையிடுதல்
    const prompt = `You are Zyra, an AI assistant. ${thinkPrompt}Respond in ${langName}. Based on the notes/image, return ONLY a valid JSON object. Do not include any markdown formatting like \`\`\`json. Return STRICT JSON:
    ${mode === 'ask' ? '{"answer": "your answer here"}' : '{"summary":"3-4 sentences","themes":["theme1","theme2"],"overdue":["item1"],"priorities":["priority1","priority2"],"checklist":["task1","task2"]}'}
    
    Notes: ${notes || 'No text notes provided.'}`;

    const parts = [{ text: prompt }];
    if (image && mimeType) {
      parts.push({ inlineData: { mimeType: mimeType, data: image } });
    }

    const models = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
    let data = null, lastError = null;

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          contents: [{ parts: parts }], 
          generationConfig: { 
            responseMimeType: 'application/json',
            temperature: 0.2,
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