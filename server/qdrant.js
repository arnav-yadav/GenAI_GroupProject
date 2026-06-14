// Qdrant vector store helpers via REST (works with local Docker or Qdrant Cloud).
// Env: QDRANT_URL (default http://localhost:6333), QDRANT_API_KEY (cloud only).

const URL = (process.env.QDRANT_URL || 'http://localhost:6333').replace(/\/$/, '')
const COLLECTION = process.env.QDRANT_COLLECTION || 'aria_guidelines'

function headers() {
  const h = { 'Content-Type': 'application/json' }
  if (process.env.QDRANT_API_KEY) h['api-key'] = process.env.QDRANT_API_KEY
  return h
}

async function qfetch(path, opts = {}) {
  const res = await fetch(`${URL}${path}`, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.status?.error || `Qdrant ${path} failed (${res.status})`)
  return data
}

// (Re)create the collection with the given vector size + cosine distance.
export async function recreateCollection(dim) {
  await fetch(`${URL}/collections/${COLLECTION}`, { method: 'DELETE', headers: headers() }).catch(() => {})
  await qfetch(`/collections/${COLLECTION}`, {
    method: 'PUT',
    body: JSON.stringify({ vectors: { size: dim, distance: 'Cosine' } }),
  })
}

// Upsert points: [{ id:int, vector:number[], payload:{...} }]
export async function upsert(points) {
  return qfetch(`/collections/${COLLECTION}/points?wait=true`, {
    method: 'PUT',
    body: JSON.stringify({ points }),
  })
}

// Vector similarity search → [{ score, payload }]
export async function search(vector, limit = 4) {
  const data = await qfetch(`/collections/${COLLECTION}/points/search`, {
    method: 'POST',
    body: JSON.stringify({ vector, limit, with_payload: true }),
  })
  return (data.result || []).map((r) => ({ score: r.score, payload: r.payload }))
}

// Is the collection present and populated? (used for graceful fallback)
export async function isReady() {
  try {
    const data = await qfetch(`/collections/${COLLECTION}`)
    return (data?.result?.points_count ?? 0) > 0
  } catch {
    return false
  }
}

export const config = { URL, COLLECTION }
