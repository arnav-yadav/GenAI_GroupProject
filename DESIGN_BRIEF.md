# Design Brief — Dr. Aria (refinement pass for Claude Design)

## ▶ Paste this as your first message (with `src/App.jsx` + `src/styles.css` attached)
> Keep the existing design language **exactly** as in the attached `App.jsx` and `styles.css` —
> same warm-paper palette, the **Fraunces / Inter / JetBrains Mono** fonts, the green accent, the
> frosted dynamic-island header, and the ECG-pulse logo. Don't reinvent it. Your job: bring the
> **Patient Summary, AI Internals, and Knowledge Base** tabs up to the same polish as the Triage Chat.
> Produce **multiple versions** — at least one keeping the calm background as-is, and one with a
> tasteful, subtle animated background — so I can compare. Preserve all app logic (the fetch + request
> body, `SYSTEM_PROMPT`, `<PATIENT_SUMMARY>` parsing, the emergency regex + banner, `knowledgeBase`,
> and the 112 / 108 / 14416 numbers).

---

There is **already an established design language** I'm happy with (an editorial
"marginalia" look). Your job is to **match and extend it**, NOT reinvent it. The
Triage Chat tab is the reference for the language; bring the other tabs up to the
same level of polish. Do **not** introduce a generic gradient/SaaS look.

Paste this brief **together with `src/App.jsx` and `src/styles.css`** so you can see
exactly what exists.

---

## What the app is
**Dr. Aria** — a conversational AI medical **triage** assistant for patients in
**Bengaluru, Karnataka, India**. Interviews a patient, classifies urgency into five
tiers, produces a structured clinical summary. University GenAI project; healthcare
educators grade it. Educational only — not a medical device.

## 🎨 The established design language — MATCH THIS EXACTLY
Editorial, calm, "typeset document" feel. Warm paper, ink text, one clinical-green
accent, serif display + mono labels. Glass "dynamic-island" header. Subtle, restrained.

**Design tokens (already in `styles.css` — reuse verbatim):**
```
--paper:#f7f4ec  --paper-2:#efe9dd  --card:#fffdf8
--ink:#211d17    --ink-soft:#5a5247 --ink-mute:#938a79
--rule:rgba(33,29,23,.12)  --rule-strong:rgba(33,29,23,.22)
--accent:#1f6f5c  --accent-2:#2f8a76  --accent-soft:rgba(31,111,92,.10)
urgency: emergency #e0492f · hospital #d97a2b · doctor #c79a1e · routine #3f9a5f · self #3b7fd1
fonts: Fraunces (serif, display + Dr. Aria's messages) · Inter (UI/body) · JetBrains Mono (labels/metadata)
radius: 14px cards / 10px small · hairline borders not heavy boxes · generous whitespace
```

**Signature elements to keep:**
- Custom **ECG-pulse logo** in a green disc (do not replace).
- **Frosted "dynamic-island" header** — rounded, detached, glassy, floats over the page.
- Tabs grouped patient-facing (Triage Chat, Patient Summary) then a faint **"Behind the
  scenes"** divider before the dev tabs (AI Internals, Knowledge Base). Active tab = soft pill.
- Chat as a **typeset transcript** (Dr. Aria in serif prose, patient in quiet sans blocks),
  with a **margin rail** showing live triage status (phase), urgency, and retrieved guidelines
  as numbered margin citations.
- Calm background: warm paper + faint grain + a small green cursor-follow glow + one faint
  corner **stethoscope** line-art watermark.

## 🎯 Your main job (in priority order)
1. **Polish the three secondary tabs to match the chat's quality:**
   - **Patient Summary** — the clinical summary card (urgency badge, complaint, duration,
     severity bar, symptom pills, history, recommended-action box, red-flag list, confidence,
     "Copy for Provider"). Make it feel like a beautifully typeset clinical document.
   - **AI Internals** — model config, the LangGraph state-machine diagram, multi-agent cards,
     memory/context bars, syllabus-concept grid, verbatim system-prompt viewer, reasoning trace,
     deployment notes. Make the diagrams/cards elegant and legible.
   - **Knowledge Base** — the RAG pipeline (query-rewrite / HyDE / re-rank) + guideline cards
     (title, source, similarity bar, chunk pill, excerpt).
2. Light refinement of the chat is welcome, but don't regress the language above.

## 🌗 Background — deliver BOTH variants for comparison
- **Variant A — calm (current):** warm paper + faint grain + a small green cursor-follow glow +
  one faint corner stethoscope watermark. This is the safe default.
- **Variant B — subtle animated background:** add tasteful, restrained motion that stays on-palette.
  **Keep it subtle** — NOT a busy full-screen wave/blob field (we tried that; it added noise and hurt
  readability behind the transcript). Think gentle, contained, low-opacity, behind content only.

## 🚫 Do NOT
- Do **not** switch to a dark/gradient/glassy-SaaS theme, neon, or playful styling.
- Do **not** change the logo, the emergency numbers, or any app logic (see below).

## 🔒 Do NOT change (logic — restyle around it, never edit it)
1. The chat `fetch` + request body shape (`model, max_tokens, temperature, top_p, system, messages`).
2. `SYSTEM_PROMPT` — verbatim (also shown in AI Internals).
3. `<PATIENT_SUMMARY>` JSON extraction/parsing.
4. `emergencyPatterns` regex + the pre-API emergency check; the persistent red banner.
5. `knowledgeBase` array + keyword→similarity RAG matching.
6. `REGION` + emergency numbers **112 / 108 / 14416** (hard-coded, India/Bengaluru). Tiers map to
   India terms (hospital casualty / clinic OPD). These are safety-critical — never make them dynamic.
7. State shape: `conversationHistory, patientSummary, urgencyCode, phase, isLoading, activeTab,
   ragDocs, tokenEstimate, reasoningTrace, emergencyAlert, pastSessions`.

## ♿ Accessibility
WCAG AA contrast; keyboard-navigable; **never rely on colour alone** for urgency (pair tier colour
with its emoji + text label); respect `prefers-reduced-motion`; the red emergency banner stays
unmissable; chat usable + thumb-friendly on mobile (≤900px drops the margin rail, composer stays pinned).

## ✅ Acceptance check
- "chest pain spreading to my arm" still triggers the red banner **before** any API call.
- Numbers 112 / 108 / 14416 appear exactly; no UK/US numbers.
- AI Internals still shows the verbatim system prompt + all concept badges.
- A completed triage renders the Summary card; "Copy for Provider" works.
- The three tabs now visually match the Triage Chat's editorial quality.
- Both background variants delivered: calm (A) preserved, and any animated (B) stays subtle/on-palette.
