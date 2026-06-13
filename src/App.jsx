import { useState, useRef, useEffect } from 'react'

/* ============================================================================
 * Dr. Aria — AI Healthcare Triage Assistant
 * V8 — Safety + Summary: hard-coded client-side emergency guardrails, the red
 * alert banner, and the structured provider-ready Patient Summary tab.
 * ==========================================================================*/

const CONTEXT_WINDOW = 200000 // model context window (tokens) for the usage bar
const SESSIONS_KEY = 'aria_past_sessions'

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

// Urgency tier metadata
const URGENCY = {
  EMERGENCY: { label: '🔴 EMERGENCY', short: 'Emergency', color: '#ef4444', action: 'Call 999 / 112 immediately' },
  AE_TODAY: { label: '🟠 A&E TODAY', short: 'A&E Today', color: '#f97316', action: 'Attend A&E within hours' },
  GP_URGENT: { label: '🟡 GP URGENT', short: 'GP Urgent', color: '#eab308', action: 'See a GP within 24 hours' },
  GP_ROUTINE: { label: '🟢 GP ROUTINE', short: 'GP Routine', color: '#22c55e', action: 'Book a GP appointment this week' },
  SELF_CARE: { label: '🔵 SELF-CARE', short: 'Self-care', color: '#3b82f6', action: 'Manage at home with monitoring' },
}

// SAFETY GUARDRAILS — client-side emergency patterns checked BEFORE the API call
const emergencyPatterns = [
  { test: /chest.{0,30}(arm|jaw|shoulder)|( arm|jaw|shoulder).{0,30}chest/i, reason: 'Chest pain spreading to arm/jaw/shoulder — possible cardiac emergency' },
  { test: /(can'?t breathe|not breathing|struggling to breathe|difficulty breathing)/i, reason: 'Breathing difficulty — possible respiratory emergency' },
  { test: /(worst headache|thunderclap|sudden.*severe.*head)/i, reason: 'Sudden severe headache — possible brain bleed' },
  { test: /(face.{0,10}drop|arm.{0,10}weak|slurred.{0,10}speech)/i, reason: 'Possible stroke symptoms — act immediately' },
  { test: /(unconscious|unresponsive|collapsed|not responding)/i, reason: 'Loss of consciousness — call emergency services' },
  { test: /(non.?blanching|meningitis|purple.{0,15}rash)/i, reason: 'Possible meningococcal infection — call 999 now' },
]

// Simulated RAG knowledge base — keyword → guideline chunk mapping
const knowledgeBase = [
  { id: 'kb1', title: 'Cardiac Emergency Triage Protocol', source: 'NHS England Clinical Guidelines 2023', keywords: ['chest', 'heart', 'cardiac', 'arm pain', 'jaw', 'palpitation'], similarity: 0.94, chunk: 'Chunk 4 of 11 | 487 tokens', excerpt: 'Chest pain with radiation to the arm, jaw, or shoulder, combined with diaphoresis or nausea, should be treated as a STEMI until proven otherwise. Immediate 999 activation is required. Do not delay for further assessment.' },
  { id: 'kb2', title: 'Stroke Recognition — FAST & Beyond', source: 'NICE Guideline NG128 2023', keywords: ['face', 'arm weak', 'speech', 'slurred', 'headache', 'sudden'], similarity: 0.91, chunk: 'Chunk 2 of 9 | 512 tokens', excerpt: 'Use the FAST assessment: Facial drooping, Arm weakness, Speech difficulty, Time to call 999. Patients presenting with sudden severe headache ("thunderclap") without trauma should be urgently assessed for subarachnoid haemorrhage.' },
  { id: 'kb3', title: 'Headache Red Flags & Neurological Triage', source: 'NICE Guideline CG150 2022', keywords: ['headache', 'head pain', 'migraine', 'worst', 'sudden'], similarity: 0.88, chunk: 'Chunk 1 of 7 | 431 tokens', excerpt: 'Red flag headaches requiring emergency referral include: thunderclap onset, worst ever headache, associated with fever and neck stiffness, headache with focal neurology. Gradual onset with typical migraine features and no red flags may be managed in primary care.' },
  { id: 'kb4', title: 'Respiratory Distress Triage Guidelines', source: 'BTS Emergency Oxygen Guidelines 2023', keywords: ['breathing', 'breath', 'breathe', 'chest tight', 'wheeze', 'oxygen'], similarity: 0.96, chunk: 'Chunk 3 of 8 | 502 tokens', excerpt: 'Patients unable to complete sentences due to breathlessness, SpO2 below 92%, or with cyanosis require immediate emergency response. Triage to emergency services immediately. Assess for anaphylaxis, PE, and acute severe asthma.' },
  { id: 'kb5', title: 'Acute Abdominal Pain Assessment', source: 'RCGP Clinical Guidelines 2022', keywords: ['stomach', 'abdominal', 'belly', 'abdomen', 'nausea', 'vomiting'], similarity: 0.82, chunk: 'Chunk 6 of 14 | 498 tokens', excerpt: 'Peritonitis signs (board-like rigidity, rebound tenderness) and pulsatile abdominal mass require emergency referral. Fever with right iliac fossa tenderness warrants urgent surgical assessment. Mild, non-specific abdominal discomfort with normal vitals may be managed with watchful waiting.' },
  { id: 'kb6', title: 'Paediatric Fever and Sepsis Protocol', source: 'NICE Guideline NG51 2023', keywords: ['fever', 'child', 'temperature', 'baby', 'infant', 'hot'], similarity: 0.85, chunk: 'Chunk 2 of 10 | 476 tokens', excerpt: 'Children under 3 months with fever above 38°C require emergency assessment. Non-blanching petechial or purpuric rash with fever in any age group is a medical emergency. Apply the NICE traffic light system for febrile illness stratification.' },
  { id: 'kb7', title: 'Mental Health Crisis Assessment', source: 'NHS Mental Health Crisis Care Standards 2023', keywords: ['mental', 'anxiety', 'panic', 'self harm', 'self-harm', 'suicidal', 'depressed'], similarity: 0.79, chunk: 'Chunk 5 of 12 | 521 tokens', excerpt: 'Active suicidal ideation with plan and intent requires emergency psychiatric assessment. Panic disorder with first presentation should be evaluated to exclude cardiac and respiratory causes. Crisis line referral is appropriate for patients expressing passive suicidal ideation without immediate risk.' },
  { id: 'kb8', title: 'Musculoskeletal Pain Stratification', source: 'RCGP MSK Clinical Pathway 2022', keywords: ['back', 'joint', 'muscle', 'arm pain', 'leg', 'knee', 'shoulder'], similarity: 0.74, chunk: 'Chunk 8 of 15 | 463 tokens', excerpt: 'Red flags for back pain (cauda equina syndrome) include saddle anaesthesia, bilateral leg weakness, and loss of bladder/bowel control — refer immediately. Non-specific low back pain without red flags is appropriate for self-management with physiotherapy referral if persistent.' },
]

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
  { name: 'Memory / Context Window', feature: 'full conversation history array' },
  { name: 'Safety Guardrails', feature: 'hardcoded emergency overrides' },
  { name: 'RAG (simulated)', feature: 'knowledge base retrieval in Tab 4' },
]

export default function App() {
  const [conversationHistory, setConversationHistory] = useState([])
  const [patientSummary, setPatientSummary] = useState(null)
  const [urgencyCode, setUrgencyCode] = useState(null)
  const [phase, setPhase] = useState('intake') // intake|profiling|history|assessment
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('chat')
  const [ragDocs, setRagDocs] = useState([])
  const [tokenEstimate, setTokenEstimate] = useState(0)
  const [reasoningTrace, setReasoningTrace] = useState('')
  const [emergencyAlert, setEmergencyAlert] = useState(null)
  const [summaryTimestamp, setSummaryTimestamp] = useState(null)
  const [pastSessions, setPastSessions] = useState([]) // long-term memory
  const [input, setInput] = useState('')
  const [errorMsg, setErrorMsg] = useState(null)
  const scrollRef = useRef(null)

  const turnCount = conversationHistory.filter((m) => m.role === 'user').length

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [conversationHistory, isLoading])

  // Long-term memory: load past triage sessions on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]')
      if (Array.isArray(saved)) setPastSessions(saved)
    } catch (e) { /* ignore */ }
  }, [])

  function persistSession(summary) {
    const record = {
      complaint: summary.presenting_complaint || 'Unspecified',
      tier: summary.urgency_tier || summary.urgency_code || '',
      at: new Date().toLocaleString(),
    }
    setPastSessions((prev) => {
      const next = [record, ...prev].slice(0, 20)
      try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(next)) } catch (e) { /* ignore */ }
      return next
    })
  }

  // RAG retrieval: match guideline keywords against the full conversation
  function updateRag(history) {
    const text = history.map((m) => m.content).join(' ').toLowerCase()
    if (!text.trim()) return setRagDocs([])
    const matched = knowledgeBase
      .filter((doc) => doc.keywords.some((k) => text.includes(k.toLowerCase())))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5)
    setRagDocs(matched)
  }

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

    // SAFETY GUARDRAIL — client-side emergency pre-check (before the API call)
    const match = emergencyPatterns.find((p) => p.test.test(text))
    if (match) setEmergencyAlert(match.reason)

    const newHistory = [...conversationHistory, { role: 'user', content: text }]
    setConversationHistory(newHistory)
    setInput('')
    setIsLoading(true)
    updateRag(newHistory) // retrieve relevant guidelines as the patient describes symptoms

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
          setSummaryTimestamp(new Date().toLocaleString())
          persistSession(parsed) // commit to long-term memory
          hasSummary = true
        } catch (e) { /* malformed JSON — keep chatting */ }
        replyText = replyText.replace(/<PATIENT_SUMMARY>[\s\S]*?<\/PATIENT_SUMMARY>/, '').trim()
      }

      const updated = [...newHistory, { role: 'assistant', content: replyText }]
      setConversationHistory(updated)
      setTokenEstimate(Math.round((SYSTEM_PROMPT.length + JSON.stringify(updated).length) / 4))
      setPhase(detectPhase(updated, hasSummary)) // advance the agent state machine
      updateRag(updated) // re-retrieve over the full conversation incl. Dr. Aria's reply
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
    setRagDocs([])
    setTokenEstimate(0)
    setReasoningTrace('')
    setEmergencyAlert(null)
    setSummaryTimestamp(null)
    setErrorMsg(null)
    setInput('')
  }

  const showEmergency = urgencyCode === 'EMERGENCY' || !!emergencyAlert
  const emergencyReason =
    emergencyAlert ||
    (patientSummary && urgencyCode === 'EMERGENCY' ? patientSummary.recommended_action : '') ||
    'Potential life-threatening symptoms detected'

  const tabs = [
    { id: 'chat', label: 'Triage Chat' },
    { id: 'summary', label: 'Patient Summary' },
    { id: 'internals', label: 'AI Internals' },
    { id: 'kb', label: 'Knowledge Base' },
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
          {urgencyCode && (
            <span className="header-pill" style={{ background: URGENCY[urgencyCode].color }}>
              {URGENCY[urgencyCode].short}
            </span>
          )}
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
          <ChatTab {...{ scrollRef, conversationHistory, isLoading, input, setInput, sendMessage, newPatient, errorMsg, urgencyCode, showEmergency, emergencyReason }} />
        )}
        {activeTab === 'summary' && (
          <SummaryTab patientSummary={patientSummary} urgencyCode={urgencyCode} timestamp={summaryTimestamp} />
        )}
        {activeTab === 'internals' && (
          <InternalsTab {...{ turnCount, tokenEstimate, reasoningTrace, phase, pastSessions }} />
        )}
        {activeTab === 'kb' && (
          <KnowledgeTab ragDocs={ragDocs} conversationHistory={conversationHistory} />
        )}
      </main>
    </div>
  )
}

function ChatTab({ scrollRef, conversationHistory, isLoading, input, setInput, sendMessage, newPatient, errorMsg, urgencyCode, showEmergency, emergencyReason }) {
  return (
    <div className="chat-tab">
      {showEmergency && (
        <div className="emergency-box">
          <div className="emergency-title">🚨 CALL 999 NOW</div>
          <div className="emergency-reason">{emergencyReason}</div>
        </div>
      )}
      {urgencyCode && urgencyCode !== 'EMERGENCY' && (
        <div className="urgency-banner" style={{ background: URGENCY[urgencyCode].color }}>
          <strong>{URGENCY[urgencyCode].label}</strong> — {URGENCY[urgencyCode].action}
        </div>
      )}
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

function InternalsTab({ turnCount, tokenEstimate, reasoningTrace, phase, pastSessions = [] }) {
  const [copied, setCopied] = useState(false)
  function copyPrompt() {
    navigator.clipboard?.writeText(SYSTEM_PROMPT).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }
  const ctxPct = Math.min(100, (tokenEstimate / CONTEXT_WINDOW) * 100)
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
        <h3>Agent State Machine <span className="tag-concept">LangGraph concept</span></h3>
        <p className="card-sub">
          Triage modelled as a graph of nodes and edges. The active node is highlighted; a
          conditional edge can branch to the EMERGENCY override at any point.
        </p>
        <div className="statemachine">
          {PHASES.map((p, i) => (
            <div key={p.key} className="sm-step">
              <div className={`sm-node ${phase === p.key ? 'sm-node-active' : ''}`}>
                <div className="sm-label">{p.label}</div>
                <div className="sm-desc">{p.desc}</div>
              </div>
              {i < PHASES.length - 1 && <div className="sm-edge">→</div>}
            </div>
          ))}
        </div>
        <div className="sm-branch">
          <span className="sm-cond">conditional edge · safety rule match →</span>
          <span className="sm-emergency">🔴 EMERGENCY (interrupt)</span>
        </div>
        <p className="card-sub" style={{ marginTop: 12, marginBottom: 0 }}>
          Built with LangGraph-style nodes/edges + LCEL chains; each node may invoke tools
          (RAG retrieval, structured-summary emitter) before transitioning.
        </p>
      </section>

      <section className="card">
        <h3>Memory <span className="tag-concept">Memory systems</span></h3>
        <p className="card-sub">Short-term memory is the live conversation; long-term memory persists past triage sessions.</p>
        <div className="mem-grid">
          <div className="mem-block">
            <div className="mem-head">Short-term · context window</div>
            <div className="ctx-bar"><div className="ctx-fill" style={{ width: `${ctxPct}%` }} /></div>
            <div className="mem-foot">{tokenEstimate.toLocaleString()} / {CONTEXT_WINDOW.toLocaleString()} tokens · {turnCount} turns held in context</div>
          </div>
          <div className="mem-block">
            <div className="mem-head">Long-term · past sessions ({pastSessions.length})</div>
            {pastSessions.length === 0 ? (
              <div className="mem-foot">No saved sessions yet. Completed triages persist across reloads.</div>
            ) : (
              <ul className="mem-list">
                {pastSessions.slice(0, 4).map((s, i) => (
                  <li key={i}><span className="mem-tier">{s.tier}</span> {s.complaint} <span className="mem-at">· {s.at}</span></li>
                ))}
              </ul>
            )}
          </div>
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

function SummaryTab({ patientSummary, urgencyCode, timestamp }) {
  const [copied, setCopied] = useState(false)
  if (!patientSummary) {
    return (
      <div className="panel">
        <div className="empty-card">
          <div className="empty-icon">🩺</div>
          <p>Complete the triage interview to generate the clinical summary.</p>
        </div>
      </div>
    )
  }
  const u = URGENCY[urgencyCode] || URGENCY[patientSummary.urgency_code] || URGENCY.GP_ROUTINE
  const s = patientSummary

  function copyForProvider() {
    const txt = [
      'CLINICAL TRIAGE SUMMARY — Generated by Dr. Aria AI',
      timestamp ? `Generated: ${timestamp}` : '',
      'For provider reference only — not a diagnosis.',
      '',
      `Urgency tier: ${s.urgency_tier || u.label}`,
      `Presenting complaint: ${s.presenting_complaint || '—'}`,
      `Duration: ${s.duration || '—'}`,
      `Severity (0–10): ${s.severity_score ?? '—'}`,
      `Associated symptoms: ${(s.associated_symptoms || []).join(', ') || '—'}`,
      `Relevant history: ${s.relevant_history || '—'}`,
      `Recommended action: ${s.recommended_action || u.action}`,
      `Red flags to watch: ${(s.red_flags_to_watch || []).join('; ') || '—'}`,
      `AI confidence: ${s.ai_confidence || '—'}`,
    ].filter(Boolean).join('\n')
    navigator.clipboard?.writeText(txt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <div className="panel">
      <div className="summary-card">
        <div className="summary-head">
          <span className="badge" style={{ background: u.color }}>{u.label}</span>
          <h2>Clinical Triage Summary</h2>
          <button className="btn btn-ghost btn-sm" onClick={copyForProvider}>{copied ? 'Copied ✓' : 'Copy for Provider'}</button>
        </div>

        <Field label="Presenting complaint" value={s.presenting_complaint} />
        <Field label="Duration" value={s.duration} />

        <div className="field">
          <div className="field-label">Severity</div>
          <div className="field-value">
            <div className="sev-row">
              <span className="sev-num">{s.severity_score ?? 0}/10</span>
              <div className="sev-bar"><div className="sev-fill" style={{ width: `${(s.severity_score || 0) * 10}%`, background: u.color }} /></div>
            </div>
          </div>
        </div>

        <div className="field">
          <div className="field-label">Associated symptoms</div>
          <div className="field-value">
            {(s.associated_symptoms || []).length
              ? <div className="tags">{s.associated_symptoms.map((t, i) => <span key={i} className="tag">{t}</span>)}</div>
              : <span className="muted">None reported</span>}
          </div>
        </div>

        <Field label="Relevant history" value={s.relevant_history} />

        <div className="action-box" style={{ borderColor: u.color, background: `${u.color}14` }}>
          <div className="action-label" style={{ color: u.color }}>Recommended action</div>
          <div className="action-text">{s.recommended_action || u.action}</div>
        </div>

        <div className="field">
          <div className="field-label">Red flags to watch</div>
          <div className="field-value">
            {(s.red_flags_to_watch || []).length
              ? <ul className="redflags">{s.red_flags_to_watch.map((f, i) => <li key={i}><span>⚠️</span>{f}</li>)}</ul>
              : <span className="muted">None specified</span>}
          </div>
        </div>

        <Field label="AI confidence level" value={s.ai_confidence} />

        <div className="summary-footer">
          Generated by Dr. Aria AI • {timestamp || '—'} • For provider reference only — not a diagnosis.
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="field-value">{value ? value : <span className="muted">—</span>}</div>
    </div>
  )
}

function KnowledgeTab({ ragDocs, conversationHistory }) {
  const hasConversation = conversationHistory.length > 0
  function simColor(s) {
    if (s >= 0.9) return '#22c55e'
    if (s >= 0.8) return '#eab308'
    return '#94a3b8'
  }

  // Advanced RAG pipeline (simulated): rewrite the raw query, build a HyDE
  // hypothetical answer, then re-rank candidate chunks by similarity.
  const lastUser = [...conversationHistory].reverse().find((m) => m.role === 'user')
  const rawQuery = lastUser ? lastUser.content : ''
  const convText = conversationHistory.map((m) => m.content).join(' ').toLowerCase()
  const matchedTerms = [...new Set(
    knowledgeBase.flatMap((d) => d.keywords).filter((k) => convText.includes(k.toLowerCase()))
  )].slice(0, 8)
  const rewrittenQuery = matchedTerms.length
    ? `clinical triage guidelines for: ${matchedTerms.join(', ')}`
    : ''
  const hydeDoc = ragDocs.length
    ? `A patient presenting with ${matchedTerms.slice(0, 3).join(', ') || 'these symptoms'} should be assessed for ${ragDocs[0].title.toLowerCase()} and triaged accordingly.`
    : ''

  return (
    <div className="panel">
      <div className="kb-header">
        <h2>RAG: Retrieval-Augmented Generation</h2>
        <p className="card-sub">
          In production, symptom keywords would be embedded and matched against a vector database
          (ChromaDB / Pinecone). Showing simulated retrieval for demonstration.
        </p>
      </div>

      {hasConversation && (
        <div className="rag-pipeline">
          <div className="pipe-step">
            <div className="pipe-tag">1 · Query Rewriting</div>
            <div className="pipe-from">“{rawQuery || '—'}”</div>
            <div className="pipe-arrow-v">↓</div>
            <div className="pipe-to">{rewrittenQuery || '—'}</div>
          </div>
          <div className="pipe-step">
            <div className="pipe-tag">2 · HyDE — Hypothetical Document</div>
            <div className="pipe-hyde">{hydeDoc || 'Awaiting symptoms…'}</div>
          </div>
          <div className="pipe-step">
            <div className="pipe-tag">3 · Cross-Encoder Re-ranking</div>
            <div className="pipe-note">{ragDocs.length} candidate chunk{ragDocs.length === 1 ? '' : 's'} re-scored and ordered by relevance ↓</div>
          </div>
        </div>
      )}

      {!hasConversation ? (
        <div className="empty-card">
          <div className="empty-icon">📚</div>
          <p>Start a triage conversation to see relevant guidelines retrieved.</p>
        </div>
      ) : ragDocs.length === 0 ? (
        <div className="empty-card"><p>No matching guidelines yet — keep describing symptoms.</p></div>
      ) : (
        <div className="kb-list">
          {ragDocs.map((doc) => (
            <div key={doc.id} className="kb-card">
              <div className="kb-card-head">
                <div>
                  <div className="kb-title">{doc.title}</div>
                  <div className="kb-source">{doc.source}</div>
                </div>
                <span className="kb-chunk">{doc.chunk}</span>
              </div>
              <div className="sim-row">
                <div className="sim-bar">
                  <div className="sim-fill" style={{ width: `${doc.similarity * 100}%`, background: simColor(doc.similarity) }} />
                </div>
                <span className="sim-score" style={{ color: simColor(doc.similarity) }}>{doc.similarity.toFixed(2)}</span>
              </div>
              <p className="kb-excerpt">“{doc.excerpt}”</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
