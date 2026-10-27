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

// 1. DeepSeek API-ஐ அழைக்கும் ஃபங்ஷன்
async function callDeepSeek(prompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-flash',
        messages: [
          { role: 'system', content: 'You are a helpful assistant. Return ONLY a valid JSON object.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        stream: false
      })
    });

    if (!r.ok) return null;
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) return null;
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

// 2. Gemini API-ஐ அழைக்கும் ஃபங்ஷன்
async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const models = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 1500 }
        })
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
    const { notes, image = null, mimeType = null, think = false } = req.body || {};
    if (!notes && !image) return res.status(400).json({ error: 'INVALID_INPUT' });

    // மிக முக்கியமான விதி: "Please talk with me Tamil" என்று சொன்னால், அதன் பிறகு எப்போதும் தமிழில் மட்டுமே பதில் சொல்ல வேண்டும்.
    const langRule = `MANDATORY LANGUAGE RULE: 
    1. If the user says "Please talk with me Tamil" or "Speak Tamil", you MUST switch to Tamil and STAY in Tamil for the rest of the conversation. 
    2. Even if the user asks in English afterwards, you MUST reply in Tamil ONLY.
    3. If the user says "Speak English", switch to English and stay in English.
    4. Otherwise, reply in the SAME language as the user's LATEST message.
    5. NEVER mix languages.`;

    const thinkPrompt = think ? "Think step by step. " : "";
    const systemPrompt = `You are Zyra, a highly intelligent AI. ${langRule} ${thinkPrompt}`;
    
    const formatPrompt = `Return ONLY a valid JSON object: {"answer": "your full answer here"}`;

    let prompt = `${systemPrompt}\n\nUser: ${notes || 'Analyze this image.'}\n\n${formatPrompt}`;

    let finalData = null;

    // 1. முதலில் DeepSeek-ஐ முயற்சி செய் (படம் இல்லை என்றால் மட்டும்)
    if (!image) {
      finalData = await callDeepSeek(prompt);
    }

    // 2. DeepSeek வேலை செய்யவில்லை என்றால், Gemini-ஐ முயற்சி செய்
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
      return res.status(500).json({ error: 'API Error: Both DeepSeek and Gemini failed.' });
    }
    
    return res.status(200).json(finalData);

  } catch (e) { 
    return res.status(500).json({ error: e.message || 'SERVER_ERROR' }); 
  }
};
