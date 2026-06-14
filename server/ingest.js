// One-time ingestion: embed each guideline chunk with Gemini and upsert into Qdrant.
// Run: npm run ingest   (after setting GEMINI_API_KEY + QDRANT_URL in .env)
//
// Chunking note: each guideline here is already a single retrieval-sized chunk
// (~450–520 tokens). For longer source docs you'd split first (recursive/sentence
// strategy) — the embed→upsert loop below stays the same.
import 'dotenv/config'
import { knowledgeBase } from '../shared/knowledge.js'
import { geminiEmbed, config as gconfig } from './gemini.js'
import { recreateCollection, upsert, config as qconfig } from './qdrant.js'

async function main() {
  console.log(`Ingesting ${knowledgeBase.length} chunks → ${qconfig.URL}/${qconfig.COLLECTION}`)
  console.log(`Embeddings: ${gconfig.EMBED_MODEL}`)

  // embed the first chunk to discover the vector dimension, then size the collection
  const first = await geminiEmbed(knowledgeBase[0].excerpt)
  await recreateCollection(first.length)
  console.log(`Collection (re)created with dim=${first.length}`)

  const points = []
  for (let i = 0; i < knowledgeBase.length; i++) {
    const doc = knowledgeBase[i]
    const vector = i === 0 ? first : await geminiEmbed(doc.excerpt)
    points.push({
      id: i + 1, // Qdrant ids must be uint/UUID; keep the original id in payload
      vector,
      payload: { id: doc.id, title: doc.title, source: doc.source, chunk: doc.chunk, excerpt: doc.excerpt },
    })
    console.log(`  embedded ${doc.id} — ${doc.title}`)
  }

  await upsert(points)
  console.log(`✓ Upserted ${points.length} points. Vector store is ready.`)
}

main().catch((e) => {
  console.error('Ingestion failed:', e.message)
  process.exit(1)
})
