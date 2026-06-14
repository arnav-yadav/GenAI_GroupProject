# 🩺 Dr. Aria — AI Healthcare Triage Assistant

A conversational medical triage chatbot built as a university **Generative AI** project.
Dr. Aria interviews a patient about their symptoms, classifies urgency into one of five
triage tiers, and produces a structured, provider-ready clinical summary — grounded in a
**real RAG** pipeline over Indian clinical guidelines.

Localised for **Bengaluru, Karnataka, India** (emergency numbers 112 / 108, Tele-MANAS 14416).

> ⚠️ **Educational project only. Not a medical device and not a substitute for professional
> medical care.** In a real emergency, call 108 / 112.

---

## ✨ Features (4 tabs)

| Tab | What it does |
|-----|--------------|
| **Triage Chat** | Conversational symptom intake. Persistent red 999/108-112 emergency banner, urgency banner, suggestion chips, and a **margin rail** with live triage status + retrieved-guideline citations. |
| **Patient Summary** | Structured clinical handoff card: verdict banner, severity, symptom pills, red flags, "Copy for Provider". |
| **AI Internals** | Model config, LangGraph state machine, multi-agent view, memory/context bars, syllabus-concept grid, the live system prompt, reasoning trace. |
| **Knowledge Base** | The RAG layer — pipeline view + retrieved guideline chunks (similarity from the vector store), with the top‑3 marked as injected into the prompt. |

## 🧠 Architecture

```
React + Vite (frontend)
        │  POST /api/chat  { messages, system }
        ▼
Node + Express (server/)
        │  1. embed last user message   ── Gemini gemini-embedding-001
        │  2. vector search top-k       ── Qdrant
        │  3. inject top chunks into prompt   (Retrieval-Augmented Generation)
        │  4. generate reply            ── Gemini 2.5 Flash
        ▼
        { text, retrieved[] }  →  rendered in Chat + Knowledge Base
```

- **LLM:** Google **Gemini** (free AI Studio tier) for both chat and embeddings.
- **Vector DB:** **Qdrant** (local Docker or Qdrant Cloud free tier).
- Keys stay **server-side**; the browser only talks to our `/api`.

## 🎓 GenAI concepts demonstrated

System prompt · ChatML · persona · few-shot · chain-of-thought · structured JSON output ·
multi-phase AI agent · safety guardrails · **real RAG (embeddings + Qdrant + retrieval +
prompt injection)** · query-rewrite / HyDE / re-rank framing · LangGraph state machine ·
multi-agent (MCP) orchestration · short/long-term memory · deployment.

---

## 🚀 Setup & running

```bash
npm install
cp .env.example .env        # then fill in the values below
```

**1. Gemini key** — free at <https://aistudio.google.com/app/apikey> → put it in `.env` as `GEMINI_API_KEY`.

**2. Qdrant** — either:
- **Local:** `docker run -p 6333:6333 qdrant/qdrant` (keep `QDRANT_URL=http://localhost:6333`), or
- **Cloud:** create a free cluster at <https://cloud.qdrant.io> and set `QDRANT_URL` + `QDRANT_API_KEY`.

**3. Ingest the guidelines into the vector store (one-time):**
```bash
npm run ingest      # embeds each guideline chunk with Gemini → upserts to Qdrant
```

**4. Run frontend + backend together:**
```bash
npm run dev:all     # web on http://localhost:5173, api on http://localhost:8787
```
(or run `npm run dev` and `npm run server` in two terminals.)

Check the backend any time: <http://localhost:8787/api/health>

### Works without any setup
Even with no key / no Qdrant, the app stays demoable: **"Load a sample case"** on the welcome
screen populates every tab, and typing an emergency phrase (e.g. *"chest pain spreading to my
arm"*) still fires the red banner — both are fully client-side.

```bash
npm run build       # production build → dist/
```

---

## 🗂️ Project structure

```
src/App.jsx          # entire frontend: 4 tabs, state, parsing, UI
src/styles.css       # editorial "marginalia" theme
shared/knowledge.js  # guideline corpus (used by the frontend demo + backend ingestion)
server/index.js      # Express API — /api/chat (RAG) + /api/health
server/gemini.js     # Gemini chat + embeddings
server/qdrant.js     # Qdrant vector store (REST)
server/ingest.js     # one-time embed + upsert
```

---

## ☁️ Deployment (Render)
One Node web service hosts both the built frontend and the API — the Express server serves
`dist/` (see [render.yaml](render.yaml)). On Render: connect the repo, then set
`GEMINI_API_KEY`, `QDRANT_URL`, `QDRANT_API_KEY` as environment variables, and run
`npm run ingest` once against the production Qdrant. Build `npm install && npm run build`,
start `node server/index.js`.

## 👥 Team & version roadmap
Built across 10 versions (2 per member, V1→V10) — see commit history. P1 foundations/prompting ·
P2 agent + RAG · P3 advanced RAG + LangGraph · P4 memory + safety/summary · P5 multi-agent/MCP + deployment.
