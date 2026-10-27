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

// 1. DeepSeek API-ஐ அழைக்கும் ஃபங்ஷன் (மொழி கட்டுப்பாட்டுடன்)
async function callDeepSeek(prompt, langRule) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  try {
    // DeepSeek-க்கு நேரடியாக மொழி விதியை வலியுறுத்துகிறோம்
    const strictPrompt = `${prompt}\n\n(IMPORTANT: You must reply ONLY in the language specified above. Do not use English if the user asked in Tamil.)`;

    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-flash',
        messages: [
          { role: 'system', content: `You are a helpful assistant. ${langRule} Return ONLY a valid JSON object.` },
          { role: 'user', content: strictPrompt }
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

    // மிக முக்கியமான விதி
    const langRule = `MANDATORY LANGUAGE RULE: 
    1. You MUST detect the language of the user's LATEST message.
    2. You MUST reply in the EXACT SAME language the user used. 
    3. If the user asks in Tamil, reply in Tamil. If English, reply in English.
    4. NEVER mix languages.`;

    const thinkPrompt = think ? "Think step by step. " : "";
    const systemPrompt = `You are Zyra, a highly intelligent AI. ${langRule} ${thinkPrompt}`;
    
    const formatPrompt = `Return ONLY a valid JSON object: {"answer": "your full answer here"}`;

    let prompt = `${systemPrompt}\n\nUser: ${notes || 'Analyze this image.'}\n\n${formatPrompt}`;
    let finalData = null;

    // 1. முதலில் DeepSeek-ஐ முயற்சி செய் (படம் இல்லை என்றால் மட்டும்)
    if (!image) {
      finalData = await callDeepSeek(prompt, langRule);
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