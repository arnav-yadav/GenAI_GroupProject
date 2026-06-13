# 🩺 Dr. Aria — AI Healthcare Triage Assistant

A conversational medical triage chatbot built as a university **Generative AI** project.
Dr. Aria interviews a patient about their symptoms, classifies urgency into one of five
triage tiers, and produces a structured, provider-ready clinical summary.

> ⚠️ **Educational project only. Not a medical device and not a substitute for professional
> medical care.** In a real emergency, call 999 / 112.

---

## ✨ Features (4 tabs)

| Tab | What it does |
|-----|--------------|
| **Triage Chat** | Conversational symptom intake with Dr. Aria. Live emergency banner. |
| **Patient Summary** | Structured clinical summary card with urgency badge, severity bar, red flags, and "Copy for Provider". |
| **AI Internals** | Dev panel: model config, LangGraph-style state machine, multi-agent view, memory/context window, syllabus-concept grid, full system prompt, reasoning trace, deployment notes. |
| **Knowledge Base** | Simulated **RAG** retrieval — query rewriting, HyDE, re-ranking, and NHS/NICE guideline chunks with similarity scores. |

## 🎓 GenAI concepts demonstrated

System Prompt · ChatML message format · Persona Prompting · Few-shot Learning ·
Chain-of-Thought · Structured JSON Output · Memory / Context Window ·
Multi-phase AI Agent · Safety Guardrails · RAG (simulated, + query rewriting / HyDE / re-ranking) ·
LangGraph-style state machine · Multi-agent (MCP) orchestration · Deployment.

---

## 🚀 Running it

### Option A — Claude.ai artifact (zero setup)
The chat `fetch` targets the Anthropic Messages endpoint directly. Inside the Claude.ai
artifact sandbox this is proxied automatically, so it just works.

### Option B — Local dev / deployment (real API key)
A browser **cannot** call `api.anthropic.com` directly when deployed (no key + CORS).
A tiny serverless proxy in [`api/chat.js`](api/chat.js) holds the key and forwards requests.

```bash
npm install
npm run dev          # local dev server
```

Set these environment variables in your host (Vercel / AWS / Netlify):

```
ANTHROPIC_API_KEY = sk-ant-...        # server-side secret (never commit)
VITE_CHAT_ENDPOINT = /api/chat        # routes the browser through the proxy
```

```bash
npm run build        # production build → dist/
```

Deploy `dist/` as static assets and `api/chat.js` as a serverless function
(Vercel does both automatically via `vercel.json`).

---

## 🗂️ Project structure

```
src/App.jsx        # entire app: 4 tabs, state, parsing, RAG, guardrails
src/styles.css     # medical UI theme (navy header, urgency colours)
api/chat.js        # serverless Anthropic proxy (deployment only)
```

---

## 👥 Team & version roadmap

Built incrementally across 10 versions (2 per team member). See the commit history —
each commit maps to one roadmap milestone (V1 → V10).

| Person | Versions | Focus |
|--------|----------|-------|
| P1 | V1–V2 | Foundations, prompt engineering (system prompt, few-shot, CoT, JSON) |
| P2 | V3–V4 | Agent architecture & RAG basics |
| P3 | V5–V6 | Advanced RAG & LangGraph state machine |
| P4 | V7–V8 | Memory systems & safety / patient summary |
| P5 | V9–V10 | Multi-agent / MCP & deployment |

### Version log
- **V1 — Basic Chatbot:** Claude Messages API, system prompt, ChatML, memory, temperature/top-p.
- **V2 — Prompt Engineering:** persona, few-shot, chain-of-thought, JSON output + AI Internals.
- **V3 — Agent Logic:** adaptive multi-phase questioning (intake → profiling → history → assessment).
- **V4 — RAG Basics:** medical knowledge base + keyword retrieval with similarity scores.
- **V5 — Advanced RAG:** query rewriting, HyDE, cross-encoder re-ranking pipeline.
- **V6 — LangGraph:** node/edge state machine with a conditional emergency branch.
- **V7 — Memory:** short-term context window + long-term session records (localStorage).
- **V8 — Safety + Summary:** emergency guardrails, red alert banner, clinical summary card.
- **V9 — Multi-Agent / MCP:** orchestrator + symptom/urgency/summary sub-agents.
- **V10 — Deployment:** serverless proxy, rate-limiting/caching notes, CI/CD, final polish.
