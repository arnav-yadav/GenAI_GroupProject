// Serverless proxy (Vercel / AWS Lambda style) for the Anthropic Messages API.
//
// WHY THIS EXISTS:
// The browser cannot call https://api.anthropic.com directly when the app is
// DEPLOYED — there is no API key in the browser and CORS would block it. Inside
// the Claude.ai artifact sandbox the request is proxied automatically, but a real
// deployment (V10 — AWS) needs a tiny server that holds the key. This is that server.
//
// The browser posts { model, max_tokens, system, messages, temperature, top_p } to
// /api/chat; we forward it to Anthropic with the secret key + version header and
// return the JSON unchanged, so the client parsing logic stays identical.
//
// Set ANTHROPIC_API_KEY in your deployment environment (never commit it).

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on the server.' })
    return
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model || 'claude-sonnet-4-20250514',
        max_tokens: body.max_tokens || 1000,
        temperature: body.temperature ?? 0.3,
        top_p: body.top_p ?? 0.95,
        system: body.system,
        messages: body.messages,
      }),
    })

    const data = await upstream.json()
    res.status(upstream.status).json(data)
  } catch (err) {
    res.status(500).json({ error: 'Proxy error', detail: String(err) })
  }
}
