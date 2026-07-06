const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini(prompt, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
      }),
    });

    if (response.status === 429 && i < retries - 1) {
      await sleep(2000 * (i + 1));
      continue;
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    return await response.json();
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { brand, name } = req.body || {};
  if (!brand || !name) {
    return res.status(400).json({ error: "brand and name are required" });
  }

  const prompt = `You are a fragrance expert database (Fragrantica-level knowledge). Given a fragrance, return its details in JSON format.

Fragrance: ${brand} ${name}

Many budget/clone houses (Lattafa, Maison Alhambra, Paris Corner, Armaf, Montagne Parfums, Yom & Layl, Oakcha, ALT, Dua, Alexandria Fragrances...) make "inspired by" versions of designer/niche fragrances. If this is a clone, identify the original it's inspired by and use the original's note pyramid when the clone's own pyramid is not published.

Return ONLY a valid JSON object with these fields (use empty string "" if unknown):
{
  "og": "the original fragrance this is inspired by, e.g. 'Parfums de Marly Layton', or '<Brand> original' if it's a house original",
  "topNotes": "comma-separated top notes",
  "middleNotes": "comma-separated middle/heart notes",
  "baseNotes": "comma-separated base notes",
  "gender": "Masculine | Feminine | Unisex | Unisex (masculine-leaning) | Unisex (feminine-leaning)",
  "seasons": "recommended seasons, e.g. 'Fall/Winter' or 'Spring/Summer' or 'All-Season'",
  "occasions": "typical occasions, e.g. 'Office/daytime, casual' or 'Date night, evenings out, clubbing'",
  "sizeMl": "the most common bottle size in mL as a number (e.g. 100), or empty string",
  "confidence": "High | Medium | Low - High if you know this exact fragrance, Medium if inferred from the clone's original, Low if guessing"
}

Return ONLY the JSON, no markdown, no explanation.`;

  try {
    const result = await callGemini(prompt);
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ ok: false, error: "Could not parse AI response" });
    }

    const data = JSON.parse(jsonMatch[0]);
    return res.status(200).json({ ok: true, data });
  } catch (e) {
    console.error("Autofill error:", e);
    return res.status(500).json({ ok: false, error: e.message || "Autofill failed" });
  }
}
