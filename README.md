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

## V1 — Basic Chatbot
Working triage chat UI calling the Claude Messages API with a system prompt. Demonstrates
the ChatML message format (system / user / assistant), conversational memory, and the core
inference parameters (temperature, top-p, max tokens).
