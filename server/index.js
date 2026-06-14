// Dr. Aria backend — Node/Express.
// One real RAG endpoint: embed the query (Gemini) → vector search (Qdrant) →
// inject the top guideline chunks into the prompt → generate the reply (Gemini).
//
// Env (.env): GEMINI_API_KEY, QDRANT_URL, QDRANT_API_KEY (cloud), PORT
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { geminiChat, geminiEmbed, geminiJSON, config as gconfig } from './gemini.js'
import { search, isReady, config as qconfig } from './qdrant.js'

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', async (req, res) => {
  res.json({
    ok: true,
    chatModel: gconfig.CHAT_MODEL,
    embedModel: gconfig.EMBED_MODEL,
    qdrant: qconfig.URL,
    collection: qconfig.COLLECTION,
    geminiKey: !!process.env.GEMINI_API_KEY,
    vectorStoreReady: await isReady(),
  })
})

// RAG chat: { messages:[{role,content}], system } -> { text, retrieved:[...] }
app.post('/api/chat', async (req, res) => {
  try {
    const { messages = [], system = '' } = req.body || {}
    if (!messages.length) return res.status(400).json({ error: 'messages required' })

    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || ''

    // --- Advanced RAG (each step degrades gracefully to basic retrieval) ---
    let retrieved = []
    const rag = { rewrittenQuery: lastUser, hypothetical: '', candidates: 0, reranked: false }
    try {
      if (lastUser && (await isReady())) {
        // 1) Query rewriting + HyDE — one aux call returns a clean clinical query
        //    plus a hypothetical guideline passage to embed (HyDE retrieves better).
        try {
          const conv = messages.slice(-8).map((m) => `${m.role === 'assistant' ? 'Dr. Aria' : 'Patient'}: ${m.content}`).join('\n')
          const j = await geminiJSON({
            system: 'Rewrite a patient triage conversation into retrieval inputs for a medical-guideline search. Return JSON {"query": string, "hypothetical": string}. "query" = one concise standalone clinical search query capturing the symptoms and any red flags. "hypothetical" = a 2-3 sentence passage written like a clinical triage guideline that would answer it.',
            prompt: `Conversation:\n${conv}`,
          })
          if (j.query) rag.rewrittenQuery = String(j.query)
          if (j.hypothetical) rag.hypothetical = String(j.hypothetical)
        } catch (e) { console.warn('rewrite/HyDE skipped:', e.message) }

        // 2) Embed the HyDE passage (falls back to the rewritten query / raw text)
        const vector = await geminiEmbed(rag.hypothetical || rag.rewrittenQuery)

        // 3) Over-fetch candidates from the vector store
        let hits = await search(vector, 8)
        rag.candidates = hits.length

        // 4) LLM re-ranking (cross-encoder-style) of the candidates
        try {
          if (hits.length > 1) {
            const list = hits.map((h, i) => `[${i}] ${h.payload.title} — ${h.payload.excerpt}`).join('\n')
            const j = await geminiJSON({
              system: 'Re-rank candidate clinical guideline chunks by relevance to the query. Return JSON {"order": number[]} listing candidate indices most-relevant first, using only indices shown.',
              prompt: `Query: ${rag.rewrittenQuery}\n\nCandidates:\n${list}`,
            })
            if (Array.isArray(j.order) && j.order.length) {
              const seen = new Set(); const ordered = []
              for (const i of j.order) { if (Number.isInteger(i) && i >= 0 && i < hits.length && !seen.has(i)) { seen.add(i); ordered.push(hits[i]) } }
              hits.forEach((h, i) => { if (!seen.has(i)) ordered.push(h) })
              hits = ordered; rag.reranked = true
            }
          }
        } catch (e) { console.warn('rerank skipped:', e.message) }

        retrieved = hits.slice(0, 4).map((h) => ({
          id: h.payload.id,
          title: h.payload.title,
          source: h.payload.source,
          chunk: h.payload.chunk,
          excerpt: h.payload.excerpt,
          similarity: Math.max(0, Math.min(1, h.score)),
        }))
      }
    } catch (e) {
      console.warn('retrieval skipped:', e.message)
    }

    // --- Augment the prompt with the top retrieved chunks ---
    const top = retrieved.slice(0, 3)
    const context = top
      .map((d, i) => `[${i + 1}] ${d.title} — ${d.source}\n${d.excerpt}`)
      .join('\n\n')
    const augmentedSystem = context
      ? `${system}\n\n## RETRIEVED CLINICAL GUIDELINES (ground your assessment in these; reference them when relevant):\n${context}`
      : system

    // --- Generate ---
    const text = await geminiChat({ system: augmentedSystem, messages })
    res.json({ text, retrieved, rag })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message || 'server error' })
  }
})

// In production, serve the built frontend so one Render service hosts UI + API.
app.use(express.static(distDir))
app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')))

const PORT = process.env.PORT || 8787
app.listen(PORT, () => {
  console.log(`Dr. Aria backend on http://localhost:${PORT}`)
  console.log(`  chat: ${gconfig.CHAT_MODEL} · embed: ${gconfig.EMBED_MODEL} · qdrant: ${qconfig.URL}/${qconfig.COLLECTION}`)
})
