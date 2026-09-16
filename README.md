# Weather Trip Planner — Frontend & n8n Integration

This project is an AI-powered Weather Trip Planner that integrates a **modern UI frontend**, an **Express Node.js backend server**, and an **n8n AI Workflow**.

---

## 🏗 Architecture

```
┌────────────────────────────────┐
│  Frontend (HTML/CSS/JavaScript)│
└───────────────┬────────────────┘
                │  POST /api/plan-trip
                ▼
┌────────────────────────────────┐
│   Express Backend (server.js)  │
└───────────────┬────────────────┘
                │  POST Webhook
                ▼
┌────────────────────────────────┐
│      n8n AI Workflow           │
│  - Open-Meteo Weather API      │
│  - Groq AI (Llama 3.3 70B)     │
└────────────────────────────────┘
```

---

## 🚀 Quick Start Guide

### 1. Install Dependencies & Start Server
```bash
npm install
npm start
```
The server will run at: `http://localhost:3000`

---

### 2. Import n8n Workflow
1. Open your **n8n Instance**.
2. Click **Workflows** → **Import from File** and select `n8n_workflow.json`.
3. Configure your **Groq API Key** in the `Groq AI LLM Request` node:
   - Header: `Authorization: Bearer gsk_your_groq_api_key`
4. Toggle the workflow to **Active**.

---

### 3. Environment Configuration (`.env`)
You can specify your custom n8n webhook URL in `.env`:

```env
PORT=3000
N8N_WEBHOOK_URL=http://localhost:5678/webhook/weather-trip-planner
```

---

## 🧪 Testing the Endpoint

You can test the backend proxy endpoint using `curl`:

```bash
curl -X POST http://localhost:3000/api/plan-trip \
  -H "Content-Type: application/json" \
  -d '{
    "city": "Paris",
    "country": "France",
    "latitude": 48.8566,
    "longitude": 2.3522,
    "startDate": "2026-08-10",
    "endDate": "2026-08-15",
    "days": 6
  }'
```
