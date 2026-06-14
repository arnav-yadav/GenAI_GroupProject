// Gemini (Google Generative Language API) helpers — chat + embeddings.
// Uses the free AI Studio key (GEMINI_API_KEY). Plain fetch, no SDK.

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const CHAT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001'
// lighter/faster model for the auxiliary RAG steps (rewrite, HyDE, re-rank)
const AUX_MODEL = process.env.GEMINI_AUX_MODEL || 'gemini-2.5-flash-lite'

function key() {
  const k = process.env.GEMINI_API_KEY
  if (!k) throw new Error('GEMINI_API_KEY is not set on the server.')
  return k
}

// Generate a chat reply. `messages` is ChatML-style [{role:'user'|'assistant', content}].
export async function geminiChat({ system, messages, temperature = 0.3, topP = 0.95, maxTokens = 2048 }) {
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const body = {
    contents,
    generationConfig: { temperature, topP, maxOutputTokens: maxTokens },
  }
  // Disable "thinking" on 2.5/3.x flash so it doesn't spend the output budget
  // mid-reply (which was truncating the PATIENT_SUMMARY JSON).
  if (/2\.5|flash-latest|gemini-3/.test(CHAT_MODEL)) {
    body.generationConfig.thinkingConfig = { thinkingBudget: 0 }
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] }

  const res = await fetch(`${BASE}/models/${CHAT_MODEL}:generateContent?key=${key()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Gemini chat failed (${res.status})`)

  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || ''
  return text
}

// Structured JSON call (used by the advanced-RAG steps). Returns a parsed object.
export async function geminiJSON({ system, prompt, model = AUX_MODEL, temperature = 0.2, maxTokens = 700 }) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
  }
  if (/2\.5|flash-latest|gemini-3/.test(model)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 }
  if (system) body.systemInstruction = { parts: [{ text: system }] }

  const res = await fetch(`${BASE}/models/${model}:generateContent?key=${key()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Gemini JSON failed (${res.status})`)
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || ''
  return JSON.parse(text)
}

// Embed a single piece of text → number[].
export async function geminiEmbed(text) {
  const res = await fetch(`${BASE}/models/${EMBED_MODEL}:embedContent?key=${key()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text }] } }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Gemini embed failed (${res.status})`)
  return data?.embedding?.values || []
}

export const config = { CHAT_MODEL, EMBED_MODEL, AUX_MODEL }
