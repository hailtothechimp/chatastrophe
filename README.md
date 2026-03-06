# Chatastrophe

A multi-tab LLM playground for experimenting with language models, sampling parameters, and personas.

## Features

- **Chat** — Conversational interface with full history
- **Arena** — Side-by-side model comparison
- **Reasoning** — Explore chain-of-thought models
- **Roundtable** — Multi-persona AI conversations
- **Throwdown** — Persona battle with a judge
- Persona management (create, edit, delete)
- Parameter panel with temperature, top-p, top-k, max tokens, and more
- PDF and JSON conversation export
- User authentication

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/hailtothechimp/chatastrophe.git
cd chatastrophe
```

### 2. Create a `.env` file

Create a file called `.env` in the `backend/` folder with your API keys:

```
OPENAI_API_KEY=your-openai-key
ANTHROPIC_API_KEY=your-anthropic-key
GROQ_API_KEY=your-groq-key
JWT_SECRET=some-random-secret-string
```

You only need keys for the providers you plan to use. Get keys from:
- OpenAI: https://platform.openai.com/api-keys
- Anthropic: https://console.anthropic.com/settings/keys
- Groq: https://console.groq.com/keys

### 3. Install backend dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 4. Create a user

```bash
python create_user.py
```

Follow the prompts to set a username and password.

### 5. Start the backend

```bash
uvicorn main:app --reload
```

### 6. Install and start the frontend

In a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

### 7. Open the app

Go to http://localhost:5173 in your browser.
