import { useState, useRef, useEffect } from 'react'

/* ============================================================================
 * Dr. Aria — AI Healthcare Triage Assistant
 * V3 — Agent Logic: adaptive multi-phase questioning. The agent advances through
 * intake → profiling → history → assessment, tracking state across turns.
 * ==========================================================================*/

const CHAT_ENDPOINT =
  import.meta.env.VITE_CHAT_ENDPOINT || 'https://api.anthropic.com/v1/messages'

const MODEL = 'claude-sonnet-4-20250514'

const SYSTEM_PROMPT = `
You are Dr. Aria, an AI medical triage assistant. You are NOT a substitute for medical care.

## TRIAGE TIERS — always classify into exactly one:
🔴 EMERGENCY: Call 999/112 — life-threatening
🟠 A&E TODAY: Go to A&E within hours
🟡 GP URGENT: See GP within 24 hours
🟢 GP ROUTINE: Book GP this week
🔵 SELF-CARE: Manage at home with monitoring

## HARD-CODED SAFETY RULES — NEVER override, always → EMERGENCY:
- Chest pain + arm/jaw/shoulder pain → cardiac event
- Sudden worst-ever headache → subarachnoid haemorrhage
- FAST symptoms: Face drooping, Arm weakness, Speech difficulty → stroke
- Difficulty breathing + blue lips/fingertips
- Severe allergic reaction + throat swelling
- Uncontrolled bleeding, loss of consciousness, active seizure

## QUESTIONING PROTOCOL — ask 4–7 questions total, one or two at a time:
Phase 1 — Intake: primary complaint, when started
Phase 2 — Profiling: severity 1–10, associated symptoms, what makes it better/worse
Phase 3 — History (only if clinically relevant): medical history, medications, allergies
Phase 4 — Assessment: give urgency tier, specific action, red flags to watch

## FEW-SHOT EXAMPLES:
Patient: "I have chest pain"
Dr. Aria: "This needs careful assessment. Is the pain spreading to your arm, jaw, or shoulder? Are you sweating or nauseous?"
→ If yes to spreading pain: 🔴 EMERGENCY immediately

Patient: "I have a headache"
Dr. Aria: "I'll help assess this. On a scale of 1–10, how severe is it? Did it start suddenly or gradually? Is this the worst headache of your life?"
→ sudden + worst ever: 🔴 EMERGENCY (subarachnoid haemorrhage risk)
→ gradual, 4/10, no fever, no red flags: 🔵 SELF-CARE

Patient: "I have a high fever and rash spreading across my body"
Dr. Aria: "A spreading rash with fever can be serious. Does the rash look like small purple or red spots that don't fade when pressed? Do you have neck stiffness or sensitivity to light?"
→ non-blanching rash: 🔴 EMERGENCY (meningococcal)

## CHAIN-OF-THOUGHT — reason through this before every response:
1. What symptoms have been reported?
2. Do any SAFETY RULES apply? → If yes: EMERGENCY immediately, stop questioning
3. Most likely differential diagnoses?
4. What information is still needed?
5. Current urgency estimate?

## FINAL ASSESSMENT FORMAT — when you have enough info, end response with:
<PATIENT_SUMMARY>
{"presenting_complaint":"","duration":"","severity_score":0,"associated_symptoms":[],"relevant_history":"","urgency_tier":"🔴 EMERGENCY | 🟠 A&E TODAY | 🟡 GP URGENT | 🟢 GP ROUTINE | 🔵 SELF-CARE","urgency_code":"EMERGENCY|AE_TODAY|GP_URGENT|GP_ROUTINE|SELF_CARE","recommended_action":"","red_flags_to_watch":[],"ai_confidence":"HIGH|MEDIUM|LOW","reasoning_trace":"brief internal reasoning used to reach this assessment"}
</PATIENT_SUMMARY>

Be empathetic, concise, never alarmist unless warranted. Never diagnose. Always triage.
`

// Adaptive agent: the 4 phases of the triage interview
const PHASES = [
  { key: 'intake', label: 'Intake', desc: 'Primary complaint + onset' },
  { key: 'profiling', label: 'Profiling', desc: 'Severity, associated symptoms' },
  { key: 'history', label: 'History', desc: 'Medical history, meds, allergies' },
  { key: 'assessment', label: 'Assessment', desc: 'Urgency tier + action' },
]

const SYLLABUS_CONCEPTS = [
  { name: 'System Prompt', feature: 'Dr. Aria identity & rules' },
  { name: 'ChatML Format', feature: 'system / user / assistant message structure' },
  { name: 'Persona Prompting', feature: 'Dr. Aria character' },
  { name: 'Few-shot Learning', feature: '3 clinical examples in system prompt' },
  { name: 'Chain-of-Thought', feature: '5-step internal reasoning protocol' },
  { name: 'Structured Output (JSON)', feature: 'PATIENT_SUMMARY block' },
  { name: 'AI Agent Pattern', feature: 'multi-phase adaptive questioning' },
]

export default function App() {
  const [conversationHistory, setConversationHistory] = useState([])
  const [patientSummary, setPatientSummary] = useState(null)
  const [urgencyCode, setUrgencyCode] = useState(null)
  const [phase, setPhase] = useState('intake') // intake|profiling|history|assessment
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('chat')
  const [tokenEstimate, setTokenEstimate] = useState(0)
  const [reasoningTrace, setReasoningTrace] = useState('')
  const [input, setInput] = useState('')
  const [errorMsg, setErrorMsg] = useState(null)
  const scrollRef = useRef(null)

  const turnCount = conversationHistory.filter((m) => m.role === 'user').length

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [conversationHistory, isLoading])

  // Adaptive agent: derive the current phase from turn count + summary presence
  function detectPhase(history, hasSummary) {
    if (hasSummary) return 'assessment'
    const turns = history.filter((m) => m.role === 'user').length
    if (turns <= 2) return 'intake'
    if (turns <= 4) return 'profiling'
    if (turns <= 6) return 'history'
    return 'assessment'
  }

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
          messages: newHistory,
        }),
      })
      const data = await response.json()
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))
      let replyText = data.content[0].text

      // STRUCTURED OUTPUT — extract & parse the <PATIENT_SUMMARY> JSON block
      let hasSummary = false
      const m = replyText.match(/<PATIENT_SUMMARY>([\s\S]*?)<\/PATIENT_SUMMARY>/)
      if (m) {
        try {
          const parsed = JSON.parse(m[1].trim())
          setPatientSummary(parsed)
          if (parsed.urgency_code) setUrgencyCode(parsed.urgency_code)
          if (parsed.reasoning_trace) setReasoningTrace(parsed.reasoning_trace)
          hasSummary = true
        } catch (e) { /* malformed JSON — keep chatting */ }
        replyText = replyText.replace(/<PATIENT_SUMMARY>[\s\S]*?<\/PATIENT_SUMMARY>/, '').trim()
      }

      const updated = [...newHistory, { role: 'assistant', content: replyText }]
      setConversationHistory(updated)
      setTokenEstimate(Math.round((SYSTEM_PROMPT.length + JSON.stringify(updated).length) / 4))
      setPhase(detectPhase(updated, hasSummary)) // advance the agent state machine
    } catch (err) {
      setErrorMsg(`Could not reach Dr. Aria: ${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  function newPatient() {
    setConversationHistory([])
    setPatientSummary(null)
    setUrgencyCode(null)
    setPhase('intake')
    setTokenEstimate(0)
    setReasoningTrace('')
    setErrorMsg(null)
    setInput('')
  }

  const tabs = [
    { id: 'chat', label: 'Triage Chat' },
    { id: 'internals', label: 'AI Internals' },
  ]

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
        <nav className="tabs">
          {tabs.map((t) => (
            <button key={t.id} className={`tab ${activeTab === t.id ? 'tab-active' : ''}`} onClick={() => setActiveTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="main">
        {activeTab === 'chat' && (
          <ChatTab {...{ scrollRef, conversationHistory, isLoading, input, setInput, sendMessage, newPatient, errorMsg }} />
        )}
        {activeTab === 'internals' && (
          <InternalsTab {...{ turnCount, tokenEstimate, reasoningTrace, phase }} />
        )}
      </main>
    </div>
  )
}

function ChatTab({ scrollRef, conversationHistory, isLoading, input, setInput, sendMessage, newPatient, errorMsg }) {
  return (
    <div className="chat-tab">
      <div className="messages" ref={scrollRef}>
        {conversationHistory.length === 0 && !isLoading && (
          <div className="welcome">
            <div className="avatar avatar-lg">DA</div>
            <h2>Hello, I'm Dr. Aria</h2>
            <p>Tell me what's bothering you and I'll ask a few questions to help assess the right level of care.</p>
          </div>
        )}
        {conversationHistory.map((msg, i) => (
          <div key={i} className={`row ${msg.role === 'user' ? 'row-user' : 'row-ai'}`}>
            {msg.role === 'assistant' && <div className="avatar avatar-sm">DA</div>}
            <div className={`bubble ${msg.role === 'user' ? 'bubble-user' : 'bubble-ai'}`}>{msg.content}</div>
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
        <input className="composer-input" value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()} placeholder="Describe your symptoms…" disabled={isLoading} />
        <button className="btn btn-send" onClick={sendMessage} disabled={isLoading || !input.trim()}>Send</button>
        <button className="btn btn-ghost" onClick={newPatient}>New Patient</button>
      </div>
      <p className="disclaimer">For triage guidance only — not a medical diagnosis. In an emergency call 999.</p>
    </div>
  )
}

function InternalsTab({ turnCount, tokenEstimate, reasoningTrace, phase }) {
  const [copied, setCopied] = useState(false)
  function copyPrompt() {
    navigator.clipboard?.writeText(SYSTEM_PROMPT).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }
  return (
    <div className="panel internals">
      <section className="card">
        <h3>Model Configuration</h3>
        <div className="config-grid">
          <ConfigItem k="Model" v={MODEL} />
          <ConfigItem k="Temperature" v="0.3" note="lower = more deterministic, critical for medical safety" />
          <ConfigItem k="Max tokens" v="1000" />
          <ConfigItem k="Top-p" v="0.95" />
          <ConfigItem k="Conversation turns" v={String(turnCount)} />
          <ConfigItem k="Estimated tokens used" v={tokenEstimate.toLocaleString()} />
          <ConfigItem k="Current phase" v={phase} />
        </div>
      </section>

      <section className="card">
        <h3>Adaptive Agent Phase</h3>
        <p className="card-sub">The agent advances through four phases as it gathers information.</p>
        <div className="phase-track">
          {PHASES.map((p, i) => (
            <div key={p.key} className="phase-step">
              <div className={`phase-pill ${phase === p.key ? 'phase-active' : ''}`}>
                <span className="phase-num">{i + 1}</span>
                <div>
                  <div className="phase-label">{p.label}</div>
                  <div className="phase-desc">{p.desc}</div>
                </div>
              </div>
              {i < PHASES.length - 1 && <div className="phase-arrow">→</div>}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Syllabus Concepts Demonstrated</h3>
        <div className="concepts-grid">
          {SYLLABUS_CONCEPTS.map((c) => (
            <div key={c.name} className="concept-badge">
              <div className="concept-name">{c.name}</div>
              <div className="concept-feature">{c.feature}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head-row">
          <h3>System Prompt</h3>
          <button className="btn btn-ghost btn-sm" onClick={copyPrompt}>{copied ? 'Copied ✓' : 'Copy'}</button>
        </div>
        <pre className="code-box">{SYSTEM_PROMPT.trim()}</pre>
      </section>

      <section className="card">
        <h3>Last Reasoning Trace</h3>
        {reasoningTrace ? <div className="reasoning-box">{reasoningTrace}</div> : <p className="muted">No assessment yet.</p>}
      </section>
    </div>
  )
}

function ConfigItem({ k, v, note }) {
  return (
    <div className="config-item">
      <div className="config-k">{k}</div>
      <div className="config-v">{v}</div>
      {note && <div className="config-note">({note})</div>}
    </div>
  )
}
