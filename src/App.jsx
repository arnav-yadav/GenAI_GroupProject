import { useState, useRef, useEffect } from 'react'
import { knowledgeBase } from '../shared/knowledge.js'

/* ============================================================================
 * Dr. Aria — AI Healthcare Triage Assistant
 * V10 — Deployment & final polish: serverless proxy support, rate-limit/cache
 * notes, and UI polish. End-to-end demonstration of all syllabus concepts:
 * System Prompt · ChatML · Persona · Few-shot · Chain-of-Thought · Structured
 * JSON output · Memory/context window · Multi-phase AI agent · Safety guardrails
 * · RAG (simulated) · LangGraph state machine · Multi-agent (MCP).
 * ==========================================================================*/

const CONTEXT_WINDOW = 200000 // model context window (tokens) for the usage bar
const SESSIONS_KEY = 'aria_past_sessions' // long-term memory / chat history (closed sessions)
const CURRENT_KEY = 'aria_current_session' // the live session — persists across reload
const newId = () => globalThis.crypto?.randomUUID?.() || `sess-${Date.now()}-${Math.round(Math.random() * 1e6)}`

// The frontend calls our Node/Express backend, which does the RAG (Gemini
// embeddings → Qdrant search) and generation (Gemini), keeping keys server-side.
// In dev, Vite proxies /api → http://localhost:8787 (see vite.config.js).
const CHAT_ENDPOINT = import.meta.env.VITE_CHAT_ENDPOINT || '/api/chat'

const MODEL = 'gemini-2.5-flash'

const SYSTEM_PROMPT = `
You are Dr. Aria, an AI medical triage assistant for patients in Bengaluru, Karnataka, India.
You are NOT a substitute for medical care. You triage; you never diagnose.

## LOCAL EMERGENCY CONTACTS (India / Bengaluru) — use these exact numbers:
- 112 — unified national emergency number
- 108 — free emergency ambulance (Arogya Kavacha, Karnataka)
- 14416 — Tele-MANAS national mental-health helpline
Never invent or guess other numbers. "Hospital" means a hospital casualty / emergency department; "clinic/OPD" means a doctor's outpatient clinic.

## TRIAGE TIERS — always classify into exactly one:
🔴 EMERGENCY: Call 108/112 now — life-threatening
🟠 HOSPITAL NOW: Go to a hospital casualty within hours
🟡 DOCTOR URGENT: See a doctor within 24 hours
🟢 CLINIC ROUTINE: Visit a clinic (OPD) this week
🔵 SELF-CARE: Manage at home with monitoring

## HARD-CODED SAFETY RULES — NEVER override, always → EMERGENCY:
- Chest pain + arm/jaw/shoulder pain → cardiac event
- Sudden worst-ever headache → subarachnoid haemorrhage
- FAST symptoms: Face drooping, Arm weakness, Speech difficulty → stroke
- Difficulty breathing + blue lips/fingertips
- Severe allergic reaction + throat swelling
- Uncontrolled bleeding, loss of consciousness, active seizure
- Snakebite (common in/around Karnataka) → keep limb still, no tourniquet, reach casualty
- Dengue warning signs: high fever + severe abdominal pain, persistent vomiting, or bleeding gums

## QUESTIONING PROTOCOL — ask 4–7 questions total, one or two at a time:
Phase 1 — Intake: primary complaint, when started
Phase 2 — Profiling: severity 1–10, associated symptoms, what makes it better/worse
Phase 3 — History (only if clinically relevant): medical history, medications, allergies
Phase 4 — Assessment: give urgency tier, specific action, red flags to watch

## FEW-SHOT EXAMPLES:
Patient: "I have chest pain"
Dr. Aria: "This needs careful assessment. Is the pain spreading to your arm, jaw, or shoulder? Are you sweating or nauseous?"
→ If yes to spreading pain: 🔴 EMERGENCY immediately — call 108

Patient: "I have a headache"
Dr. Aria: "I'll help assess this. On a scale of 1–10, how severe is it? Did it start suddenly or gradually? Is this the worst headache of your life?"
→ sudden + worst ever: 🔴 EMERGENCY (subarachnoid haemorrhage risk)
→ gradual, 4/10, no fever, no red flags: 🔵 SELF-CARE

Patient: "I've had a high fever for 3 days with body ache and a rash"
Dr. Aria: "In Bengaluru this time of year, dengue is worth ruling out. Do you have severe tummy pain, persistent vomiting, or any bleeding from the gums or nose? Does the rash fade when you press it?"
→ dengue warning signs or non-blanching rash: 🔴 EMERGENCY / 🟠 HOSPITAL NOW

## CHAIN-OF-THOUGHT — reason through this before every response:
1. What symptoms have been reported?
2. Do any SAFETY RULES apply? → If yes: EMERGENCY immediately, stop questioning
3. Most likely differential diagnoses?
4. What information is still needed?
5. Current urgency estimate?

## FINAL ASSESSMENT FORMAT — when you have enough info, end response with:
<PATIENT_SUMMARY>
{"presenting_complaint":"","duration":"","severity_score":0,"associated_symptoms":[],"relevant_history":"","urgency_tier":"🔴 EMERGENCY | 🟠 HOSPITAL NOW | 🟡 DOCTOR URGENT | 🟢 CLINIC ROUTINE | 🔵 SELF-CARE","urgency_code":"EMERGENCY|AE_TODAY|GP_URGENT|GP_ROUTINE|SELF_CARE","recommended_action":"","red_flags_to_watch":[],"ai_confidence":"HIGH|MEDIUM|LOW","reasoning_trace":"brief internal reasoning used to reach this assessment"}
</PATIENT_SUMMARY>

Be empathetic, concise, never alarmist unless warranted. Never diagnose. Always triage.
`

// REGION CONFIG — centralised so the app can be re-pointed to another region by
// hand-curating one object. NOTE: emergency numbers are deliberately hard-coded
// (never auto-looked-up by the LLM) — a hallucinated emergency number is unsafe.
const REGION = {
  name: 'Bengaluru, Karnataka, India',
  emergency: '112', // unified national emergency (ERSS)
  ambulance: '108', // free emergency ambulance — "Arogya Kavacha" in Karnataka
  teleManas: '14416', // national mental-health helpline (Tele-MANAS)
  emergencyDept: 'hospital casualty / emergency department',
  primaryCare: 'a doctor or clinic (OPD)',
}

// Urgency tier metadata (India / Bengaluru)
const URGENCY = {
  EMERGENCY: { label: '🔴 EMERGENCY', short: 'Emergency', color: '#ef4444', action: `Call 108 (ambulance) or 112 now — get to ${REGION.emergencyDept}` },
  AE_TODAY: { label: '🟠 HOSPITAL NOW', short: 'Hospital', color: '#f97316', action: `Go to ${REGION.emergencyDept} within hours` },
  GP_URGENT: { label: '🟡 DOCTOR URGENT', short: 'Urgent', color: '#eab308', action: 'See a doctor within 24 hours' },
  GP_ROUTINE: { label: '🟢 CLINIC ROUTINE', short: 'Routine', color: '#22c55e', action: `Visit ${REGION.primaryCare} this week` },
  SELF_CARE: { label: '🔵 SELF-CARE', short: 'Self-care', color: '#3b82f6', action: 'Manage at home with monitoring' },
}

// SAFETY GUARDRAILS — client-side emergency patterns checked BEFORE the API call
const emergencyPatterns = [
  { test: /chest.{0,30}(arm|jaw|shoulder)|( arm|jaw|shoulder).{0,30}chest/i, reason: 'Chest pain spreading to arm/jaw/shoulder — possible cardiac emergency. Call 108/112 now.' },
  { test: /(can'?t breathe|not breathing|struggling to breathe|difficulty breathing)/i, reason: 'Breathing difficulty — possible respiratory emergency. Call 108/112 now.' },
  { test: /(worst headache|thunderclap|sudden.*severe.*head)/i, reason: 'Sudden severe headache — possible brain bleed. Call 108/112 now.' },
  { test: /(face.{0,10}drop|arm.{0,10}weak|slurred.{0,10}speech)/i, reason: 'Possible stroke symptoms (FAST) — call 108/112 immediately.' },
  { test: /(unconscious|unresponsive|collapsed|not responding)/i, reason: 'Loss of consciousness — call 108 ambulance immediately.' },
  { test: /(non.?blanching|meningitis|purple.{0,15}rash)/i, reason: 'Non-blanching rash with fever — possible meningococcal/severe infection. Call 108/112 now.' },
  { test: /(snake.{0,10}bite|snakebite)/i, reason: 'Snakebite — call 108 and reach hospital casualty fast. Keep the limb still; do NOT apply a tourniquet or cut the wound.' },
  { test: /(bleeding gums|blood.{0,10}vomit|vomiting blood|black stool)/i, reason: 'Bleeding signs with fever can be dengue warning signs — go to hospital casualty now (call 108).' },
]

// Multi-agent / MCP orchestration: specialist sub-agents the orchestrator delegates to
const SUBAGENTS = [
  { name: 'Symptom Agent', role: 'Extracts & normalises presenting symptoms from dialogue', phase: 'profiling' },
  { name: 'Urgency Agent', role: 'Maps symptoms → triage tier using safety rules + guidelines', phase: 'assessment' },
  { name: 'Summary Agent', role: 'Compiles the structured provider-ready PATIENT_SUMMARY', phase: 'assessment' },
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

// Sample triage case for the "Load sample" button — lets reviewers see every
// feature (summary, RAG, reasoning, memory) without a live API round-trip.
// Dengue is seasonally relevant to Bengaluru.
const DEMO = {
  conversation: [
    { role: 'user', content: "I've had a high fever for 3 days with bad body ache and a rash." },
    { role: 'assistant', content: "I'm sorry you're feeling so rough. In Bengaluru at this time of year, dengue is worth ruling out. On a scale of 1–10, how bad is the fever and body ache — and do you have any severe abdominal pain, persistent vomiting, or bleeding from the gums or nose?" },
    { role: 'user', content: "The body ache is about 7/10. I've had some abdominal pain, and my gums bled a little when I brushed today." },
    { role: 'assistant', content: "Thank you. A high fever with bleeding gums and abdominal pain can be dengue warning signs, so this needs same-day assessment rather than waiting it out. Please go to a hospital casualty today for a dengue test (NS1/serology) and a platelet count. Keep sipping fluids, and avoid ibuprofen or aspirin in the meantime." },
  ],
  summary: {
    presenting_complaint: 'High fever with body ache and a spreading rash',
    duration: '3 days',
    severity_score: 7,
    associated_symptoms: ['Body ache', 'Mild abdominal pain', 'Bleeding gums', 'Skin rash'],
    relevant_history: 'No known chronic illness. Lives in Bengaluru (seasonal dengue / chikungunya).',
    urgency_tier: '🟠 HOSPITAL NOW',
    urgency_code: 'AE_TODAY',
    recommended_action: 'Attend a hospital casualty today for dengue assessment — NS1 / dengue serology and a platelet count. Maintain oral fluids; avoid NSAIDs / aspirin.',
    red_flags_to_watch: ['Severe or worsening abdominal pain', 'Persistent vomiting', 'Bleeding from gums, nose, or skin', 'Lethargy or restlessness', 'Cold, clammy skin'],
    ai_confidence: 'MEDIUM',
    reasoning_trace: 'Fever >2 days with body ache and rash in a dengue-endemic area (Bengaluru) raises dengue suspicion. Bleeding gums and abdominal pain are recognised dengue warning signs (NVBDCP), which warrant same-day hospital assessment rather than routine primary care. No features of shock or respiratory distress yet, so HOSPITAL NOW (A&E today) rather than EMERGENCY.',
  },
  sessions: [
    { id: 'demo-1', title: 'Chest pain radiating to left arm', complaint: 'Chest pain radiating to left arm', tier: '🔴 EMERGENCY', urgencyCode: 'EMERGENCY', at: '13 Jun 2026, 21:40' },
    { id: 'demo-2', title: 'Persistent headache, 2 days', complaint: 'Persistent headache, 2 days', tier: '🟢 CLINIC ROUTINE', urgencyCode: 'GP_ROUTINE', at: '12 Jun 2026, 18:05' },
    { id: 'demo-3', title: 'Ankle sprain after a fall', complaint: 'Ankle sprain after a fall', tier: '🟡 DOCTOR URGENT', urgencyCode: 'GP_URGENT', at: '11 Jun 2026, 09:15' },
  ],
}

export default function App() {
  const [conversationHistory, setConversationHistory] = useState([])
  const [patientSummary, setPatientSummary] = useState(null)
  const [urgencyCode, setUrgencyCode] = useState(null)
  const [phase, setPhase] = useState('intake') // intake|profiling|history|assessment
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('chat')
  const [ragDocs, setRagDocs] = useState([])
  const [ragInfo, setRagInfo] = useState(null) // real advanced-RAG metadata from the backend
  const [tokenEstimate, setTokenEstimate] = useState(0)
  const [reasoningTrace, setReasoningTrace] = useState('')
  const [emergencyAlert, setEmergencyAlert] = useState(null)
  const [summaryTimestamp, setSummaryTimestamp] = useState(null)
  const [pastSessions, setPastSessions] = useState([]) // long-term memory / history
  const [sessionId, setSessionId] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth > 900 : true))
  const [input, setInput] = useState('')
  const [errorMsg, setErrorMsg] = useState(null)
  const scrollRef = useRef(null)

  const turnCount = conversationHistory.filter((m) => m.role === 'user').length

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [conversationHistory, isLoading])

  // Cursor-reactive UI: page glow follows the pointer; cards catch a soft sheen
  useEffect(() => {
    function onMove(e) {
      const root = document.documentElement
      root.style.setProperty('--mx', e.clientX + 'px')
      root.style.setProperty('--my', e.clientY + 'px')
      const card = e.target.closest && e.target.closest('.card, .kb-card, .summary-card')
      if (card) {
        const r = card.getBoundingClientRect()
        card.style.setProperty('--gx', e.clientX - r.left + 'px')
        card.style.setProperty('--gy', e.clientY - r.top + 'px')
      }
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  // On mount: load history (long-term memory) + restore the live session (reload persistence)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]')
      if (Array.isArray(saved)) setPastSessions(saved)
    } catch (e) { /* ignore */ }
    try {
      const cur = JSON.parse(localStorage.getItem(CURRENT_KEY) || 'null')
      if (cur && Array.isArray(cur.conversationHistory) && cur.conversationHistory.length) {
        setConversationHistory(cur.conversationHistory)
        setPatientSummary(cur.patientSummary || null)
        setUrgencyCode(cur.urgencyCode || null)
        setPhase(cur.phase || 'intake')
        setReasoningTrace(cur.reasoningTrace || '')
        setRagDocs(cur.ragDocs || [])
        setTokenEstimate(cur.tokenEstimate || 0)
        setSummaryTimestamp(cur.summaryTimestamp || null)
        setSessionId(cur.sessionId || null)
      }
    } catch (e) { /* ignore */ }
  }, [])

  // Persist the live session on every change so a reload restores it
  useEffect(() => {
    if (!conversationHistory.length) { try { localStorage.removeItem(CURRENT_KEY) } catch (e) {} ; return }
    const snap = { sessionId, conversationHistory, patientSummary, urgencyCode, phase, reasoningTrace, ragDocs, tokenEstimate, summaryTimestamp }
    try { localStorage.setItem(CURRENT_KEY, JSON.stringify(snap)) } catch (e) { /* ignore */ }
  }, [sessionId, conversationHistory, patientSummary, urgencyCode, phase, reasoningTrace, ragDocs, tokenEstimate, summaryTimestamp])

  function persistHistory(list) {
    try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(list)) } catch (e) { /* ignore */ }
  }

  const closeSidebarOnMobile = () => { if (typeof window !== 'undefined' && window.innerWidth <= 900) setSidebarOpen(false) }

  // Snapshot the current (open) session into a history entry (newest first, cap 30)
  function archiveCurrent(list) {
    if (!conversationHistory.length) return list
    const firstUser = conversationHistory.find((m) => m.role === 'user')?.content || ''
    const title = patientSummary?.presenting_complaint || firstUser.slice(0, 70) || 'Triage session'
    const entry = {
      id: sessionId || newId(),
      at: summaryTimestamp || new Date().toLocaleString(),
      title,
      complaint: title,
      tier: urgencyCode ? URGENCY[urgencyCode].label : '—',
      urgencyCode,
      conversation: conversationHistory,
      patientSummary,
      reasoningTrace,
      summaryTimestamp,
    }
    const deduped = (list || []).filter((s) => s.id !== entry.id)
    return [entry, ...deduped].slice(0, 30)
  }

  // Reopen a past session (archives the current one first, then pulls the target out)
  function loadSession(id) {
    const archived = archiveCurrent(pastSessions)
    const target = archived.find((s) => s.id === id)
    const remaining = archived.filter((s) => s.id !== id)
    setPastSessions(remaining); persistHistory(remaining)
    setActiveTab('chat'); closeSidebarOnMobile()
    if (!target || !(target.conversation || []).length) return // demo/summary-only entry
    setConversationHistory(target.conversation)
    setPatientSummary(target.patientSummary || null)
    setUrgencyCode(target.urgencyCode || null)
    setReasoningTrace(target.reasoningTrace || '')
    setSummaryTimestamp(target.summaryTimestamp || null)
    setPhase(target.patientSummary ? 'assessment' : 'intake')
    setRagDocs(retrieve(target.conversation))
    setRagInfo(null)
    setTokenEstimate(Math.round((SYSTEM_PROMPT.length + JSON.stringify(target.conversation).length) / 4))
    setEmergencyAlert(null)
    setSessionId(target.id)
  }

  // RAG retrieval: match guideline keywords against the full conversation.
  // Pure function so the same result can both update the UI and ground the prompt.
  function retrieve(history) {
    const text = history.map((m) => m.content).join(' ').toLowerCase()
    if (!text.trim()) return []
    return knowledgeBase
      .filter((doc) => doc.keywords.some((k) => text.includes(k.toLowerCase())))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5)
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

  async function sendMessage(presetText) {
    const text = (typeof presetText === 'string' ? presetText : input).trim()
    if (!text || isLoading) return
    setErrorMsg(null)

    // SAFETY GUARDRAIL — client-side emergency pre-check (before the API call)
    const match = emergencyPatterns.find((p) => p.test.test(text))
    if (match) setEmergencyAlert(match.reason)

    if (!sessionId) setSessionId(newId()) // start a session id for history/persistence

    const newHistory = [...conversationHistory, { role: 'user', content: text }]
    setConversationHistory(newHistory)
    setInput('')
    setIsLoading(true)

    // Optimistic: show keyword-matched guidelines instantly; the backend's real
    // vector-search results replace these when the reply returns.
    setRagDocs(retrieve(newHistory))

    try {
      const response = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newHistory, system: SYSTEM_PROMPT }),
      })
      const data = await response.json()
      if (data.error) throw new Error(data.error)
      let replyText = data.text || ''
      const retrieved = Array.isArray(data.retrieved) ? data.retrieved : []
      setRagInfo(data.rag || null)

      // STRUCTURED OUTPUT — parse the <PATIENT_SUMMARY> JSON block if present.
      let hasSummary = false
      const tagIdx = replyText.indexOf('<PATIENT_SUMMARY>')
      if (tagIdx !== -1) {
        const block = replyText.match(/<PATIENT_SUMMARY>([\s\S]*?)<\/PATIENT_SUMMARY>/)
        if (block) {
          try {
            const parsed = JSON.parse(block[1].trim())
            setPatientSummary(parsed)
            if (parsed.urgency_code) setUrgencyCode(parsed.urgency_code)
            if (parsed.reasoning_trace) setReasoningTrace(parsed.reasoning_trace)
            setSummaryTimestamp(new Date().toLocaleString())
            hasSummary = true
          } catch (e) { /* malformed/truncated JSON — keep chatting */ }
        }
        // Always strip from the tag onward so raw JSON never shows, even if truncated.
        replyText = replyText.slice(0, tagIdx).trim()
      }
      if (!replyText) {
        replyText = hasSummary
          ? "I've completed your assessment — please see the recommendation above and the Patient Summary tab for the full provider handoff."
          : 'Thank you. Could you tell me a little more about your symptoms?'
      }

      const updated = [...newHistory, { role: 'assistant', content: replyText }]
      setConversationHistory(updated)
      setTokenEstimate(Math.round((SYSTEM_PROMPT.length + JSON.stringify(updated).length) / 4))
      setPhase(detectPhase(updated, hasSummary)) // advance the agent state machine
      // show the backend's real vector-search results (fallback to keyword match)
      setRagDocs(retrieved.length ? retrieved : retrieve(updated))
    } catch (err) {
      setErrorMsg(`Could not reach Dr. Aria: ${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  function newPatient() {
    // archive the current chat into history before clearing
    const next = archiveCurrent(pastSessions)
    setPastSessions(next); persistHistory(next)
    setConversationHistory([])
    setPatientSummary(null)
    setUrgencyCode(null)
    setPhase('intake')
    setRagDocs([])
    setRagInfo(null)
    setTokenEstimate(0)
    setReasoningTrace('')
    setEmergencyAlert(null)
    setSummaryTimestamp(null)
    setErrorMsg(null)
    setInput('')
    setSessionId(null)
    try { localStorage.removeItem(CURRENT_KEY) } catch (e) { /* ignore */ }
    setActiveTab('chat') // always land on the Triage Chat tab, even if New chat was clicked from Summary/Internals/KB
    closeSidebarOnMobile()
  }

  // Load a fully-populated sample case so reviewers can see every feature
  // (Patient Summary, RAG retrieval, reasoning trace, memory) without a live call.
  function loadDemo() {
    const convo = DEMO.conversation
    setConversationHistory(convo)
    setPatientSummary(DEMO.summary)
    setUrgencyCode(DEMO.summary.urgency_code)
    setReasoningTrace(DEMO.summary.reasoning_trace)
    setPhase('assessment')
    setRagDocs(retrieve(convo))
    setRagInfo(null)
    setTokenEstimate(Math.round((SYSTEM_PROMPT.length + JSON.stringify(convo).length) / 4))
    setSummaryTimestamp(new Date().toLocaleString())
    setEmergencyAlert(null)
    setErrorMsg(null)
    setInput('')
    setSessionId(newId())
    setPastSessions((prev) => (prev.length ? prev : DEMO.sessions))
    setActiveTab('chat')
  }

  const showEmergency = urgencyCode === 'EMERGENCY' || !!emergencyAlert
  const emergencyReason =
    emergencyAlert ||
    (patientSummary && urgencyCode === 'EMERGENCY' ? patientSummary.recommended_action : '') ||
    'Potential life-threatening symptoms detected'

  const tabs = [
    { id: 'chat', label: 'Triage Chat', group: 'patient' },
    { id: 'summary', label: 'Patient Summary', group: 'patient' },
    { id: 'internals', label: 'AI Internals', group: 'dev' },
    { id: 'kb', label: 'Knowledge Base', group: 'dev' },
  ]

  // sidebar history: reopenable past chats + the current (open) one pinned at top
  const reopenable = pastSessions.filter((s) => (s.conversation || []).length)
  const currentTitle = conversationHistory.length
    ? (patientSummary?.presenting_complaint || conversationHistory.find((m) => m.role === 'user')?.content || 'Current triage').slice(0, 60)
    : null

  return (
    <div className="shell">
      <aside className={`sidebar ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
        <div className="sidebar-top">
          <div className="sidebar-brand"><Logo size={26} /><span>Dr. Aria</span></div>
          <button className="icon-btn" onClick={() => setSidebarOpen(false)} title="Collapse sidebar" aria-label="Collapse sidebar">‹‹</button>
        </div>
        <button className="new-chat-btn" onClick={newPatient}>＋&nbsp; New chat</button>
        <div className="sidebar-label">Recent</div>
        <div className="sidebar-list">
          {currentTitle && (
            <div className="sidebar-item sidebar-item-active" onClick={closeSidebarOnMobile} title="Current chat">
              <span className="hi-dot" style={{ background: urgencyCode ? URGENCY[urgencyCode].color : 'var(--accent)' }} />
              <span className="hi-title">{currentTitle}</span>
              <span className="sidebar-now">now</span>
            </div>
          )}
          {!currentTitle && reopenable.length === 0 && <div className="sidebar-empty">No chats yet. Start describing symptoms.</div>}
          {reopenable.map((s) => (
            <button key={s.id} className="sidebar-item" onClick={() => loadSession(s.id)}>
              <span className="hi-dot" style={{ background: s.urgencyCode ? URGENCY[s.urgencyCode].color : 'var(--ink-mute)' }} />
              <span className="hi-title">{s.title || s.complaint}</span>
              <span className="hi-at">{s.at}</span>
            </button>
          ))}
        </div>
      </aside>

      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}

      <div className="app">
        <div className="grain" aria-hidden="true" />
      <div className="bg-motifs" aria-hidden="true">
        {/* faint line-art stethoscope watermark (Lucide, MIT) */}
        <svg className="motif motif-stetho" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.05" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" />
          <path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4" />
          <circle cx="20" cy="10" r="2" />
        </svg>
      </div>
      <header className="header">
        <div className="header-brand">
          <button className="icon-btn sidebar-toggle" onClick={() => setSidebarOpen((v) => !v)} title="Toggle sidebar" aria-label="Toggle sidebar">☰</button>
          <Logo />
          <div className="brand-text">
            <div className="brand-title">Dr. Aria</div>
            <div className="brand-sub">AI Healthcare Triage · Bengaluru, India</div>
          </div>
          {urgencyCode && (
            <span className="header-pill" style={{ '--pill': URGENCY[urgencyCode].color }}>
              <span className="header-pill-dot" />
              {URGENCY[urgencyCode].short}
            </span>
          )}
        </div>
        <nav className="tabs">
          {tabs.map((t, i) => (
            <span key={t.id} className="tab-wrap">
              {t.group === 'dev' && tabs[i - 1]?.group !== 'dev' && (
                <span className="tab-divider" title="Developer / educational view — not shown to patients">
                  Behind the scenes
                </span>
              )}
              <button className={`tab ${activeTab === t.id ? 'tab-active' : ''} ${t.group === 'dev' ? 'tab-dev' : ''}`} onClick={() => setActiveTab(t.id)}>
                {t.label}
              </button>
            </span>
          ))}
        </nav>
      </header>

      <main className="main">
        {activeTab === 'chat' && (
          <ChatTab {...{ scrollRef, conversationHistory, isLoading, input, setInput, sendMessage, errorMsg, urgencyCode, showEmergency, emergencyReason, phase, ragDocs, setActiveTab, loadDemo }} />
        )}
        {activeTab === 'summary' && (
          <SummaryTab patientSummary={patientSummary} urgencyCode={urgencyCode} timestamp={summaryTimestamp} />
        )}
        {activeTab === 'internals' && (
          <InternalsTab {...{ turnCount, tokenEstimate, reasoningTrace, phase, pastSessions }} />
        )}
        {activeTab === 'kb' && (
          <KnowledgeTab ragDocs={ragDocs} conversationHistory={conversationHistory} ragInfo={ragInfo} />
        )}
      </main>
      </div>
    </div>
  )
}

// Editorial mark — ECG pulse in a soft warm-clinical disc (matches favicon)
function Logo({ size = 40 }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Dr. Aria">
      <defs>
        <linearGradient id="ariaLogo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f8a76" />
          <stop offset="1" stopColor="#1f6f5c" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="url(#ariaLogo)" />
      <polyline points="12,34 24,34 27,34 29,28 31,34 33,18 35,46 37,30 39,34 52,34"
        fill="none" stroke="#fdfbf6" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const SUGGESTIONS = [
  'I have chest pain',
  "I've had a headache for 2 days",
  'My child has a high fever',
  'High fever with body ache and a rash',
]

function ChatTab({ scrollRef, conversationHistory, isLoading, input, setInput, sendMessage, errorMsg, urgencyCode, showEmergency, emergencyReason, phase, ragDocs, setActiveTab, loadDemo }) {
  const empty = conversationHistory.length === 0 && !isLoading
  const taRef = useRef(null)
  // auto-grow the textarea (and reset when input clears after send)
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'
  }, [input])
  return (
    <div className="chat-tab">
      {showEmergency && (
        <div className="emergency-box" role="alert">
          <div className="emergency-mark">!</div>
          <div>
            <div className="emergency-title">Call 108 / 112 now</div>
            <div className="emergency-reason">{emergencyReason}</div>
          </div>
        </div>
      )}

      <div className="chat-layout">
        <div className="chat-main">
          <div className="transcript" ref={scrollRef}>
            {empty && (
              <div className="welcome">
                <Logo size={68} />
                <h2 className="welcome-title">Hello, I'm Dr. Aria.</h2>
                <p className="welcome-lede">
                  Tell me what's bothering you and I'll ask a few questions to help assess the
                  right level of care. I'm <em>not</em> a substitute for professional medical advice.
                </p>
                <div className="suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="suggestion" onClick={() => sendMessage(s)}>{s}</button>
                  ))}
                </div>
                <button className="demo-link" onClick={loadDemo}>▸ Load a sample case (no API needed)</button>
              </div>
            )}

            {conversationHistory.map((msg, i) => (
              <div key={i} className={`turn ${msg.role === 'user' ? 'turn-user' : 'turn-ai'}`}>
                <div className="turn-label">{msg.role === 'user' ? 'You' : 'Dr. Aria'}</div>
                <div className="turn-body">{msg.content}</div>
              </div>
            ))}

            {isLoading && (
              <div className="turn turn-ai">
                <div className="turn-label">Dr. Aria</div>
                <div className="turn-body typing"><span></span><span></span><span></span></div>
              </div>
            )}
          </div>

          {errorMsg && <div className="error-bar">{errorMsg}</div>}

          <div className="composer">
            <textarea
              ref={taRef}
              className="composer-input"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                if (e.shiftKey || e.metaKey || e.ctrlKey) {
                  // newline on Shift+Enter, ⌘+Enter (Mac), Ctrl+Enter (Windows) — inserted
                  // explicitly so it's reliable across browsers/platforms
                  e.preventDefault()
                  const ta = e.target
                  const s = ta.selectionStart, en = ta.selectionEnd
                  const next = input.slice(0, s) + '\n' + input.slice(en)
                  setInput(next)
                  requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 1 })
                } else {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              placeholder="Describe your symptoms…"
              disabled={isLoading}
            />
            <button className="btn btn-send" onClick={sendMessage} disabled={isLoading || !input.trim()}>Send</button>
          </div>
          <p className="disclaimer">For triage guidance only — not a diagnosis. In an emergency call 108 / 112.</p>
        </div>

        {/* Marginalia: the AI's live working notes alongside the conversation */}
        <aside className="chat-margin" aria-label="Triage notes">
          <div className="margin-block">
            <div className="margin-head">Triage status</div>
            <ol className="margin-phases">
              {PHASES.map((p) => (
                <li key={p.key} className={phase === p.key ? 'mp-active' : ''}>
                  <span className="mp-dot" />{p.label}
                </li>
              ))}
            </ol>
            {urgencyCode && (
              <div className="margin-urgency" style={{ '--u': URGENCY[urgencyCode].color }}>
                <span className="mu-dot" />{URGENCY[urgencyCode].label}
                <div className="mu-action">{URGENCY[urgencyCode].action}</div>
              </div>
            )}
          </div>

          <div className="margin-block">
            <div className="margin-head">Retrieved guidelines</div>
            {ragDocs.length === 0 ? (
              <p className="margin-empty">Sources appear here as you describe symptoms.</p>
            ) : (
              <ol className="margin-cites">
                {ragDocs.map((d, i) => (
                  <li key={d.id}>
                    <button className="cite" onClick={() => setActiveTab('kb')}>
                      <span className="cite-n">{i + 1}</span>
                      <span className="cite-body">
                        <span className="cite-title">{d.title}</span>
                        <span className="cite-meta">{d.source.split('·')[0].trim()} · {d.similarity.toFixed(2)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>
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
      <div className="panel-intro">
        <div className="intro-eyebrow">Behind the scenes</div>
        <h2 className="intro-title">AI Internals</h2>
        <p className="intro-sub">The GenAI techniques powering Dr. Aria — model configuration, the agent graph, memory, retrieval, and the live system prompt.</p>
      </div>

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
                <span className="sm-num">{i + 1}</span>
                <div>
                  <div className="sm-label">{p.label}</div>
                  <div className="sm-desc">{p.desc}</div>
                </div>
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
        <h3>Multi-Agent Orchestration <span className="tag-concept">MCP concept</span></h3>
        <p className="card-sub">An orchestrator delegates to specialist sub-agents with A2A handoffs. Active agents are highlighted.</p>
        <div className="agents-grid">
          {SUBAGENTS.map((a) => (
            <div key={a.name} className={`agent-card ${phase === a.phase ? 'agent-active' : ''}`}>
              <div className="agent-name">{a.name}</div>
              <div className="agent-role">{a.role}</div>
            </div>
          ))}
        </div>
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

      <section className="card">
        <h3>Deployment <span className="tag-concept">AWS / CI-CD</span></h3>
        <p className="card-sub">Production-readiness notes for the deployed build.</p>
        <div className="config-grid">
          <ConfigItem k="API key" v="server-side" note="held in /api/chat proxy, never in the browser" />
          <ConfigItem k="Rate limiting" v="per-IP" note="throttle requests at the edge / API gateway" />
          <ConfigItem k="Caching" v="prompt cache" note="reuse system-prompt tokens across turns" />
          <ConfigItem k="CI/CD" v="build → deploy" note="vite build → static assets + serverless fn" />
        </div>
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
      <div className="summary-card" style={{ '--u': u.color }}>
        <div className="summary-head">
          <div>
            <div className="summary-eyebrow">Clinical Triage Summary</div>
            <h2>Provider Handoff</h2>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={copyForProvider}>{copied ? 'Copied ✓' : 'Copy for Provider'}</button>
        </div>

        {/* headline verdict — the key output */}
        <div className="verdict">
          <div className="verdict-top">
            <span className="badge" style={{ background: u.color }}>{u.label}</span>
            {s.ai_confidence && <span className="verdict-conf">AI confidence&nbsp;<b>{s.ai_confidence}</b></span>}
          </div>
          <div className="verdict-action">{s.recommended_action || u.action}</div>
        </div>

        <div className="summary-grid">
          <Field label="Presenting complaint" value={s.presenting_complaint} />
          <Field label="Duration" value={s.duration} />
        </div>

        <div className="field">
          <div className="field-label">Severity</div>
          {s.severity_score ? (
            <div className="sev-row">
              <span className="sev-num">{s.severity_score}<span className="sev-den">/10</span></span>
              <div className="sev-bar"><div className="sev-fill" style={{ width: `${s.severity_score * 10}%`, background: u.color }} /></div>
            </div>
          ) : (
            <span className="muted">Not assessed (emergency reached before severity was scored)</span>
          )}
        </div>

        <div className="field">
          <div className="field-label">Associated symptoms</div>
          {(s.associated_symptoms || []).length
            ? <div className="tags">{s.associated_symptoms.map((t, i) => <span key={i} className="tag">{t}</span>)}</div>
            : <span className="muted">None reported</span>}
        </div>

        <Field label="Relevant history" value={s.relevant_history} />

        <div className="field">
          <div className="field-label">Red flags to watch</div>
          {(s.red_flags_to_watch || []).length
            ? <ul className="redflags">{s.red_flags_to_watch.map((f, i) => <li key={i}><span className="rf-icon">⚠</span>{f}</li>)}</ul>
            : <span className="muted">None specified</span>}
        </div>

        <div className="summary-footer">
          Generated by Dr. Aria AI · {timestamp || '—'} · For provider reference only — not a diagnosis.
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

function KnowledgeTab({ ragDocs, conversationHistory, ragInfo }) {
  const hasConversation = conversationHistory.length > 0
  function simColor(s) {
    if (s >= 0.9) return '#22c55e'
    if (s >= 0.8) return '#eab308'
    return '#94a3b8'
  }

  // Prefer the backend's REAL advanced-RAG values; fall back to a simulated
  // illustration when running offline / from the demo.
  const lastUser = [...conversationHistory].reverse().find((m) => m.role === 'user')
  const rawQuery = lastUser ? lastUser.content : ''
  const convText = conversationHistory.map((m) => m.content).join(' ').toLowerCase()
  const matchedTerms = [...new Set(
    knowledgeBase.flatMap((d) => d.keywords).filter((k) => convText.includes(k.toLowerCase()))
  )].slice(0, 8)
  const isReal = !!ragInfo
  const rewrittenQuery = ragInfo?.rewrittenQuery
    || (matchedTerms.length ? `clinical triage guidelines for: ${matchedTerms.join(', ')}` : '')
  const hydeDoc = ragInfo?.hypothetical
    || (ragDocs.length ? `A patient presenting with ${matchedTerms.slice(0, 3).join(', ') || 'these symptoms'} should be assessed for ${ragDocs[0].title.toLowerCase()} and triaged accordingly.` : '')
  const rerankNote = isReal
    ? `${ragInfo.candidates || ragDocs.length} candidates re-ranked by ${ragInfo.reranked ? 'an LLM cross-encoder' : 'vector score'}; top 3 injected into the prompt ↓`
    : `${ragDocs.length} candidate chunk${ragDocs.length === 1 ? '' : 's'} re-scored by relevance; top 3 injected into the prompt ↓`

  return (
    <div className="panel">
      <div className="panel-intro">
        <div className="intro-eyebrow">Behind the scenes · RAG</div>
        <h2 className="intro-title">Retrieval-Augmented Generation</h2>
        <p className="intro-sub">
          The conversation is embedded with Gemini and matched against a <b>Qdrant vector database</b>;
          the <b>top 3 chunks are injected into Dr. Aria's prompt</b> to ground her triage. (If the
          backend is offline, it falls back to lexical keyword matching.)
        </p>
      </div>

      {hasConversation && (
        <>
          <div className="pipe-banner">
            Retrieval pipeline
            <span className={`pipe-mode ${isReal ? 'pipe-live' : ''}`}>{isReal ? '● live' : 'illustrative (offline)'}</span>
          </div>
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
              <div className="pipe-tag">3 · Re-ranking</div>
              <div className="pipe-note">{rerankNote}</div>
            </div>
          </div>
        </>
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
          {ragDocs.map((doc, i) => (
            <div key={doc.id} className={`kb-card ${i < 3 ? 'kb-card-used' : ''}`}>
              <div className="kb-card-head">
                <div className="kb-titlewrap">
                  <span className="kb-rank">{i + 1}</span>
                  <div>
                    <div className="kb-title">{doc.title}</div>
                    <div className="kb-source">{doc.source}</div>
                  </div>
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
              {i < 3 && <div className="kb-used"><span className="kb-used-dot" />Injected into Dr. Aria's context</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
