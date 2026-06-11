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
