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

    // மொழி விதி: யூசர் கடைசியாக எந்த மொழியில் பேசினாரோ, அதற்கு ஏற்றவாறு மாற வேண்டும்
    const langRule = "Detect the language of the user's LATEST message and respond in THAT language. If the user explicitly asks you to speak in a specific language (e.g., 'speak Tamil'), strictly obey that instruction and switch languages immediately.";

    const thinkPrompt = think ? "Think step by step. " : "";
    const systemPrompt = `You are Zyra, an AI assistant. ${langRule} ${thinkPrompt}Provide helpful, clear answers.`;
    
    const formatPrompt = `Return ONLY a valid JSON object. No markdown.
    ${mode === 'ask' ? '{"answer": "your answer here"}' : '{"summary":"...","themes":["..."],"overdue":["..."],"priorities":["..."],"checklist":["..."]}'}`;

    const contents = [];
    // கடைசி 4 மெசேஜ்களை மட்டும் நினைவில் வைத்துக்கொள்ளும் (வேகத்திற்காக)
    history.slice(-4).forEach(msg => {
      contents.push({ role: msg.role === 'user' ? 'user' : 'model', parts: [{ text: msg.text }] });
    });

    const currentParts = [{ text: `${systemPrompt}\n\nUser: ${notes || 'Image'}\n\n${formatPrompt}` }];
    if (image && mimeType) currentParts.push({ inlineData: { mimeType: mimeType, data: image } });
    contents.push({ role: 'user', parts: currentParts });

    // Gemini 3.8 Flash மாடலை நேரடியாகப் பயன்படுத்துதல் (இது தான் தற்போது மிகவும் நிலையானது)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const r = await fetch(url, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: contents, 
        generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 800 } 
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({ error: `API Error: ${errText}` });
    }
    
    const data = await r.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return res.status(200).json(extractJSON(rawText));

  } catch (e) { 
    return res.status(500).json({ error: e.message || 'SERVER_ERROR' }); 
  }
};