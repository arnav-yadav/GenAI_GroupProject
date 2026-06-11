import { useState, useRef, useEffect } from 'react'

/* ============================================================================
 * Dr. Aria — AI Healthcare Triage Assistant
 * V1 — Basic Chatbot: Claude API + System Prompt + working triage chat UI.
 * Introduces: ChatML message format, system prompt, tokens, temperature, top-p.
 * ==========================================================================*/

// Default endpoint works inside the Claude.ai artifact sandbox (request proxied).
const CHAT_ENDPOINT =
  import.meta.env.VITE_CHAT_ENDPOINT || 'https://api.anthropic.com/v1/messages'

const MODEL = 'claude-sonnet-4-20250514'

const SYSTEM_PROMPT = `You are Dr. Aria, an AI medical triage assistant. You are NOT a substitute for medical care.
Ask the patient about their symptoms one or two questions at a time. Be empathetic and concise.
Help them understand how urgently they should seek care.`

export default function App() {
  const [conversationHistory, setConversationHistory] = useState([]) // ChatML: {role, content}
  const [isLoading, setIsLoading] = useState(false)
  const [input, setInput] = useState('')
  const [errorMsg, setErrorMsg] = useState(null)
  const scrollRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [conversationHistory, isLoading])

  async function sendMessage() {
    const text = input.trim()
    if (!text || isLoading) return
    setErrorMsg(null)

    const newHistory = [...conversationHistory, { role: 'user', content: text }]
    setConversationHistory(newHistory)
    setInput('')
    setIsLoading(true)

    try {
      const response = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1000,
          temperature: 0.3,
          top_p: 0.95,
          system: SYSTEM_PROMPT,
          messages: newHistory, // full history = conversational memory
        }),
      })
      const data = await response.json()
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))
      const replyText = data.content[0].text
      setConversationHistory([...newHistory, { role: 'assistant', content: replyText }])
    } catch (err) {
      setErrorMsg(`Could not reach Dr. Aria: ${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  function newPatient() {
    setConversationHistory([])
    setErrorMsg(null)
    setInput('')
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <div className="avatar">DA</div>
          <div>
            <div className="brand-title">Dr. Aria</div>
            <div className="brand-sub">AI Healthcare Triage Assistant</div>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="chat-tab">
          <div className="messages" ref={scrollRef}>
            {conversationHistory.length === 0 && !isLoading && (
              <div className="welcome">
                <div className="avatar avatar-lg">DA</div>
                <h2>Hello, I'm Dr. Aria</h2>
                <p>Tell me what's bothering you and I'll ask a few questions to help.</p>
              </div>
            )}

            {conversationHistory.map((msg, i) => (
              <div key={i} className={`row ${msg.role === 'user' ? 'row-user' : 'row-ai'}`}>
                {msg.role === 'assistant' && <div className="avatar avatar-sm">DA</div>}
                <div className={`bubble ${msg.role === 'user' ? 'bubble-user' : 'bubble-ai'}`}>
                  {msg.content}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="row row-ai">
                <div className="avatar avatar-sm">DA</div>
                <div className="bubble bubble-ai typing"><span></span><span></span><span></span></div>
              </div>
            )}
          </div>

          {errorMsg && <div className="error-bar">{errorMsg}</div>}

          <div className="composer">
            <input
              className="composer-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Describe your symptoms…"
              disabled={isLoading}
            />
            <button className="btn btn-send" onClick={sendMessage} disabled={isLoading || !input.trim()}>Send</button>
            <button className="btn btn-ghost" onClick={newPatient}>New Patient</button>
          </div>
          <p className="disclaimer">For triage guidance only — not a medical diagnosis. In an emergency call 999.</p>
        </div>
      </main>
    </div>
  )
}
