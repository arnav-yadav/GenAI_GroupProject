# 🩺 Dr. Aria — AI-Powered Healthcare Triage Assistant

> *Help patients reach the right care — before they reach the waiting room.*

A conversational medical-triage assistant that interviews a patient about their symptoms,
asks adaptive clarifying questions, classifies urgency into **five care tiers**, and produces a
structured, provider-ready clinical summary — grounded in a **real Retrieval-Augmented
Generation (RAG)** pipeline over an Indian clinical-guideline corpus.

**🔗 Live demo:** https://dr-aria-glx5.onrender.com
&nbsp;·&nbsp; *(free-tier host — the first load after idle may take ~30–60s to wake)*


> ⚠️ **Educational project only. Not a medical device and not a substitute for professional
> medical care.** In a real emergency in India, call **108** (ambulance) or **112**.

---

## 📋 The brief 

> **Problem.** Patients cannot self-triage accurately. A well-designed assistant can direct
> patients to the right care level — *emergency now · A&E today · GP urgent · GP routine ·
> self-care* — reducing inappropriate utilisation and improving outcomes.

**What we had to build:** a conversational triage assistant — symptom intake → adaptive
clarifying questions → urgency assessment → care-pathway recommendation → a structured
patient summary for the provider.

### ✅ Core features required — and where we implemented them

| # | Required feature | How Dr. Aria delivers it | Lives in |
|:--|:--|:--|:--|
| 1 | **Symptom Intake** | Conversational collection of complaint, onset, duration, severity, associated symptoms & history — with a structured data model (`PATIENT_SUMMARY` JSON) underneath the chat | `SYSTEM_PROMPT`, `ChatTab` |
| 2 | **Adaptive Questioning** | A four-phase interview — **Intake → Profiling → History → Assessment** — that picks the next-most-informative question from the current symptom profile | `PHASES`, phase logic |
| 3 | **Urgency Stratification** | Exactly the five required tiers: 🔴 EMERGENCY · 🟠 HOSPITAL NOW (A&E today) · 🟡 DOCTOR URGENT · 🟢 CLINIC ROUTINE · 🔵 SELF-CARE | `URGENCY` map |
| 4 | **Care Pathway Guidance** | Every tier carries a specific action; each summary lists the recommended action, what to tell the provider, and red-flag symptoms to watch for | `URGENCY.action`, summary fields |
| 5 | **Patient Summary** | A structured, provider-ready card: presenting complaint, timeline, severity, associated symptoms, history, urgency, action, red flags, confidence & a reasoning trace — with one-click **Copy for Provider** | `SummaryTab` |
| 6 | **Safety Guardrails** | Hard-coded emergency patterns (chest+arm/jaw pain, stroke FAST, thunderclap headache, breathing failure …) that override the assessment — and fire **client-side, before the LLM is even called** | `emergencyPatterns` |

### 🎯 Success metrics 

| Success metric (from the brief) | How we meet it |
|:--|:--|
| All emergency cases classified as emergency | **Two independent layers** — deterministic client-side patterns **and** an EMERGENCY tier in the model's own assessment |
| Adaptive questioning narrows to the most relevant questions | Phase-aware prompting drives clinically-targeted follow-ups instead of a fixed script |
| Guardrails override the assessment for all emergency patterns | Guardrails run **before** the API call and force the emergency banner regardless of model output — they can't be "talked out of it" |
| Patient summary has all fields & is clinically coherent | An enforced `PATIENT_SUMMARY` JSON schema with every required field + a reasoning trace |
| Differentiates similar complaints, different urgency | e.g. *chest pain radiating to the arm* → 🔴 EMERGENCY vs *musculoskeletal shoulder/arm pain* → routine; *thunderclap headache* → emergency vs *typical migraine* → primary care |

---

## 🌶️ Beyond the brief — what we added

The brief defined the baseline. These are the things we built **on top** of it.

### 1. Hyperlocalised to Bengaluru, India 🇮🇳
The brief was region-neutral; we localised the entire experience for **Bengaluru, Karnataka**:
- **Indian emergency routing** — **108** (free ambulance; *Arogya Kavacha* in Karnataka) and
  **112** (national ERSS), never 999/911. Mental-health distress routes to **Tele-MANAS 14416**.
- **Indian care-pathway language** — *hospital casualty*, *OPD* — instead of *A&E / GP*.
- **An Indian guideline corpus.** All nine retrievable chunks are sourced from Indian bodies —
  **AIIMS** (NELS, Neurology), **ICMR**, **MoHFW / NVBDCP** (dengue), the **Indian Stroke
  Association**, **RGUHS**, **NMHP** — and referenced to real Bengaluru institutions:
  **Sri Jayadeva Institute of Cardiovascular Sciences**, **NIMHANS**, and the **Indira Gandhi
  Institute of Child Health**.
- **Locally-salient conditions** a generic assistant would miss: **dengue / chikungunya**
  warning signs (Bengaluru's post-monsoon peaks) and **snakebite** envenomation — added both as
  knowledge-base entries *and* as hard guardrails.

### 2. A real, full-stack RAG pipeline — not a simulation
A vector database wasn't required; we built one. A **Node/Express** backend embeds the query with
**Gemini embeddings**, runs a **vector search in Qdrant**, and injects the top guideline chunks
into the prompt. If it runs with no backend or keys, it **degrades gracefully** to in-browser
keyword retrieval over the same corpus, so the demo never breaks.

### 3. Advanced RAG — query rewriting · HyDE · re-ranking
Before retrieval we rewrite the conversation into a clean clinical query and generate a **HyDE**
(hypothetical document) to embed; after over-fetching 8 candidates we **LLM-re-rank** them and
inject the top 3. Every step degrades safely to basic retrieval if a call fails.

### 4. LangGraph-style state machine
The triage flow is modelled as an explicit **node/edge state machine** with a conditional
emergency branch.

### 5. Multi-agent / MCP orchestration
An orchestrator delegates to specialist sub-agents — a **Symptom** agent, an **Urgency** agent,
and a **Summary** agent — each owning one stage of the pipeline.

### 6. Short- and long-term memory
**Short-term:** the live context window (with a token estimate shown in *AI Internals*).
**Long-term:** every session is saved to `localStorage` and reopenable from a chat-history sidebar.

### 7. Production engineering
- Deployed as a **single Render web service** that serves the built frontend *and* the API.
- A **GitHub Actions keep-alive** workflow + health-check logging keep the free-tier service warm.
- An **offline "Load sample case"** failsafe plus the client-side guardrails work with **zero API
  calls** — a network or quota blip never leaves a reviewer staring at a blank screen.


---

## 🧠 Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  React + Vite SPA  —  4 tabs: Chat · Summary · AI Internals · KB    │
│   • client-side safety guardrails fire BEFORE any API call          │
│   • localStorage memory + reopenable chat-history sidebar           │
└──────────────────────┬─────────────────────────────────────────────┘
                       │  POST /api/chat  { messages, system }
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  Node + Express backend  (server/)                                 │
│    1. rewrite query + HyDE          ── Gemini (auxiliary model)     │
│    2. embed                          ── Gemini  gemini-embedding-001 │
│    3. vector search (over-fetch 8)   ── Qdrant  (cosine)            │
│    4. LLM re-rank  → top 3                                          │
│    5. inject guidelines + generate   ── Gemini  gemini-2.5-flash    │
└──────────────────────┬─────────────────────────────────────────────┘
                       ▼
          { text, retrieved[], rag{} }  → Chat + Knowledge Base tabs
```

Keys stay **server-side**; the browser only ever talks to our `/api`.

---

## 🎓 GenAI syllabus concepts → where they live

| Concept | Implementation |
|:--|:--|
| System prompt · persona | `SYSTEM_PROMPT` — the Dr. Aria identity, rules & tiers |
| ChatML message format | system / user / assistant roles sent to Gemini |
| Few-shot learning | worked clinical examples embedded in the system prompt |
| Chain-of-thought | a 5-step internal reasoning protocol → `reasoning_trace` |
| Structured JSON output | the enforced `PATIENT_SUMMARY` schema |
| Adaptive AI agent | four-phase questioning state machine |
| Safety guardrails | client-side `emergencyPatterns`, independent of the LLM |
| RAG | Gemini embeddings + Qdrant retrieval + prompt injection |
| Advanced RAG | query-rewrite · HyDE · LLM re-ranking |
| LangGraph | node/edge triage state machine + emergency branch |
| Multi-agent / MCP | Symptom · Urgency · Summary sub-agents |
| Memory | live context window + `localStorage` session history |
| Deployment | single Render service (UI + API) + keep-alive workflow |

---

## 🛠️ Tech stack

| Layer | Choice |
|:--|:--|
| Frontend | React 18 · Vite |
| Backend | Node.js · Express |
| LLM & embeddings | Google **Gemini** (`gemini-2.5-flash`, `gemini-embedding-001`) — free AI Studio tier |
| Vector DB | **Qdrant** (Cloud free tier or local Docker) |
| Hosting | **Render** (one web service) |
| CI | GitHub Actions (keep-alive ping) |

---

## 🚀 Setup & running

```bash
npm install
cp .env.example .env        # then fill in the values below
```

**1. Gemini key** — free at <https://aistudio.google.com/app/apikey> → set `GEMINI_API_KEY` in `.env`.

**2. Qdrant** — either:
- **Local:** `docker run -p 6333:6333 qdrant/qdrant` (keep `QDRANT_URL=http://localhost:6333`), or
- **Cloud:** create a free cluster at <https://cloud.qdrant.io> and set `QDRANT_URL` + `QDRANT_API_KEY`.

**3. Ingest the guidelines into the vector store (one-time):**
```bash
npm run ingest      # embeds each guideline chunk with Gemini → upserts to Qdrant
```

**4. Run frontend + backend together:**
```bash
npm run dev:all     # web on http://localhost:5173 · api on http://localhost:8787
```
(or run `npm run dev` and `npm run server` in two terminals). Health check: <http://localhost:8787/api/health>

### Works with zero setup
Even with no key and no Qdrant, the app stays demoable: **"Load a sample case"** on the welcome
screen populates every tab, and typing an emergency phrase (e.g. *"chest pain spreading to my
arm"*) still fires the red banner — both are fully client-side.

```bash
npm run build       # production build → dist/
```

---

## 🗂️ Project structure

```
src/App.jsx                       # entire frontend: 4 tabs, state, parsing, UI
src/styles.css                    # editorial "marginalia" theme
shared/knowledge.js               # Indian guideline corpus (frontend demo + backend ingest)
server/index.js                   # Express API — /api/chat (RAG) + /api/health (logged)
server/gemini.js                  # Gemini chat + embeddings + auxiliary JSON calls
server/qdrant.js                  # Qdrant vector store (REST)
server/ingest.js                  # one-time embed + upsert of the corpus
.github/workflows/keep-alive.yml  # pings /api/health to beat Render cold starts
render.yaml                       # one-service deploy (UI + API)
```

---

## ☁️ Deployment (Render)

One Node web service hosts both the built frontend and the API — Express serves `dist/`
(see [render.yaml](render.yaml)). On Render: connect the repo, set `GEMINI_API_KEY`,
`QDRANT_URL`, `QDRANT_API_KEY` as environment variables, and run `npm run ingest` once against
the production Qdrant. Build `npm install && npm run build`, start `node server/index.js`.

A [keep-alive workflow](.github/workflows/keep-alive.yml) pings `/api/health` every ~10 min so the
free-tier service doesn't cold-start during a demo (the `[health]` log line confirms each ping in
the Render logs).

---

## 👥 Team & version roadmap

Built collaboratively by **five of us** — Manav, Lavanya, Deepesh, Arnav & Himanshu — across
**16 incremental versions** (~3 each; see the commit history for authorship).

| Version | What shipped |
|:--|:--|
| V1 | Basic triage chatbot — system prompt + chat UI |
| V2 | Prompt engineering — persona, few-shot, chain-of-thought, JSON output, AI Internals tab |
| V3 | Adaptive agent — multi-phase clarifying questions |
| V4 | RAG basics — guideline knowledge base + keyword retrieval |
| V5 | Advanced RAG — query rewriting, HyDE, re-ranking |
| V6 | LangGraph — node/edge state machine with an emergency branch |
| V7 | Memory — short-term context window + long-term session history |
| V8 | Safety guardrails + the Patient Summary card |
| V9 | Multi-agent / MCP — orchestrator + Symptom/Urgency/Summary sub-agents |
| V10 | Deployment groundwork — proxy, rate-limit/cache notes, CI |
| V11 | Real RAG — Gemini chat/embeddings + Qdrant vector store |
| V12 | Chat sidebar, history & reload persistence |
| V13 | Editorial UI — marginalia theme, custom logo, typography |
| V14 | Render deployment — single service serves UI + API |
| V15 | "New chat" always returns to the Triage tab |
| V16 | Render keep-alive workflow + health-check logging |

---

## ⚠️ Disclaimer

Dr. Aria is a **student project for educational purposes only**. It is **not a medical device**,
has not been clinically validated, and must not be used for real medical decisions. In a medical
emergency in India, call **108** (ambulance) or **112**, or go to the nearest hospital casualty.
