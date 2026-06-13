# 🩺 Dr. Aria — AI Healthcare Triage Assistant

A conversational medical triage chatbot built as a university **Generative AI** project.

> ⚠️ Educational project only. Not a medical device and not a substitute for professional
> medical care. In a real emergency, call 999 / 112.

## Running

```bash
npm install
npm run dev
```

The chat works inside the Claude.ai artifact sandbox as-is. For standalone use, a server
proxy holding the API key is added in a later version.

## Versions
- **V1 — Basic Chatbot:** triage chat UI calling the Claude Messages API. ChatML format,
  system prompt, conversational memory, temperature/top-p/max tokens.
- **V2 — Prompt Engineering:** full Dr. Aria persona, few-shot clinical examples,
  chain-of-thought reasoning protocol, and structured JSON output (`PATIENT_SUMMARY`)
  parsing. Adds the AI Internals panel (model config, system prompt viewer, reasoning trace).
- **V3 — Agent Logic:** adaptive multi-phase questioning. The agent tracks state and
  advances through intake → profiling → history → assessment based on turn count.
- **V4 — RAG Basics:** simulated medical knowledge base (NHS/NICE guideline chunks).
  Symptom keywords retrieve and rank relevant documents by similarity score (Knowledge Base tab).
- **V5 — Advanced RAG:** retrieval pipeline visualisation — query rewriting, HyDE
  (hypothetical document embeddings), and cross-encoder re-ranking.
- **V6 — LangGraph:** the triage flow as an explicit state machine (nodes/edges) with a
  conditional branch to the EMERGENCY override; LCEL chains + tool calling per node.
- **V7 — Memory:** short-term context-window tracking and long-term cross-session patient
  records persisted to `localStorage`.
- **V8 — Safety + Summary:** hard-coded client-side emergency overrides (regex pre-check),
  the persistent red 999 alert banner, and the structured provider-ready Patient Summary tab
  with "Copy for Provider".
- **V9 — Multi-Agent / MCP:** orchestrator + 3 specialist sub-agents (symptom, urgency,
  summary) with A2A-style handoffs, shown in the AI Internals panel.
