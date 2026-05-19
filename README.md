# Prescription Intelligence & Access Agent

AI Engineering Intern portfolio project tailored to PHIL's prescription access workflow.

This project simulates a B2B2C prescription intelligence layer that connects patient questions, coverage policies, pharmacy benefit data, and an LLM-backed answer workflow. It includes a polished Streamlit executive command center with theme switching, case intake, RAG evidence review, guardrail traceability, benefit ETL sync, and downloadable case summaries. It is designed to run locally without paid APIs, while supporting Anthropic, PostgreSQL, Docker, AWS Lambda style deployment, and Streamlit Community Cloud.

## Tech Stack

Python, FastAPI, LangGraph, RAG, FAISS-compatible vector search, Anthropic API, PostgreSQL, AWS Lambda, Docker, Streamlit, pytest, ruff, mypy, GitHub Actions CI.

## Project Structure

```text
.
├── app/
│   └── streamlit_app.py
├── data/
│   ├── docs/
│   │   ├── asthma_rx_label.md
│   │   ├── diabetes_pa_policy.md
│   │   └── specialty_copay_policy.md
│   └── pharmacy_benefits.json
├── src/prescription_agent/
│   ├── api/main.py
│   ├── etl/pharmacy_benefits.py
│   ├── rag/vector_store.py
│   ├── agent.py
│   ├── audit.py
│   ├── config.py
│   ├── db.py
│   ├── guardrails.py
│   └── lambda_handler.py
├── tests/
├── Dockerfile
├── docker-compose.yml
├── pyproject.toml
└── requirements.txt
```

## Quick Start

### Run the Vercel React version locally

This repository now includes the combined `RxIntelligence.jsx` React workbench plus a
Vercel serverless route at `api/ask.js`. It is the easiest path for Vercel Hobby/free
deployment because it builds as a Vite static app and uses a lightweight Node function.

```bash
npm install
npm run build
npm run dev
```

Open:

```
http://127.0.0.1:5173
```

The app works without paid API keys. If `ANTHROPIC_API_KEY` is configured on Vercel,
`api/ask.js` will use it server-side. If not, it falls back to the bundled pharmacy
benefit and policy intelligence logic.

### Deploy on Vercel Free

1. Push this folder to GitHub.
2. In Vercel, choose **Add New > Project** and import the GitHub repository.
3. If this folder is inside a larger repository, set **Root Directory** to:

```text
Prescription-Intelligence-Access-Agent
```

4. Keep the framework preset as **Vite**. The included `vercel.json` pins:

```text
Build Command: npm run build
Output Directory: dist
```

5. Optional: add these in **Project Settings > Environment Variables**:

```text
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-sonnet-latest
```

6. Click **Deploy**.
7. After deployment, open the Vercel URL and run the suggested StepOne or GLP Access
   query. You should see guardrail status, confidence, evidence cards, and an audit ID.

If you add or change environment variables later, redeploy the project so Vercel applies
the new values to the serverless function.

Create and activate a virtual environment:

```bash
python -m venv .venv
.venv\Scripts\activate
```

Install dependencies:

```bash
python -m pip install -e .[dev]
```

Run the Streamlit app:

```bash
streamlit run app/streamlit_app.py
```

Open the local URL printed by Streamlit, usually:

```text
http://localhost:8501
```

Run the FastAPI service:

```bash
uvicorn prescription_agent.api.main:app --reload
```

Open:

```text
http://localhost:8000/docs
```

Try an API request:

```bash
curl -X POST http://localhost:8000/ask ^
  -H "Content-Type: application/json" ^
  -d "{\"question\":\"Is StepOne inhaler covered and are there copay options?\",\"patient_id\":\"demo-patient\"}"
```

## Optional Environment Variables

The app works without external credentials. Add these only when you want production-like behavior.

```bash
set ANTHROPIC_API_KEY=your_key_here
set DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/prescription_agent
set AUDIT_LOG_PATH=artifacts/audit.log
```

If `ANTHROPIC_API_KEY` is not set, the agent uses a deterministic local answer generator so the project remains demoable on free deployment platforms.

## Run Tests and Quality Checks

```bash
python -m pytest
python -m ruff check .
python -m mypy src/prescription_agent --ignore-missing-imports
```

## Docker

Build and run the FastAPI container:

```bash
docker build -t prescription-agent .
docker run -p 8000:8000 prescription-agent
```

Run API plus PostgreSQL:

```bash
docker compose up --build
```

## Deploy on Streamlit Community Cloud

Streamlit Community Cloud is the recommended deployment path for the full portfolio demo.
It runs the Streamlit app and imports the backend agent code directly from `src`.
It does not run the FastAPI service as a separate web server; use the Docker path below
when you want the API deployed separately.

1. Push this repository to GitHub.
2. In Streamlit Community Cloud, select **New app** and choose the GitHub repository.
3. Set the branch to your deployment branch, usually `main`.
4. Set the main file path to:

```text
app/streamlit_app.py
```

5. Confirm that `requirements.txt` is at the repository root. Streamlit Cloud will use it
   to install dependencies.
6. Add optional secrets only when you want production-like behavior:

```toml
ANTHROPIC_API_KEY = "your_key_here"
DATABASE_URL = "sqlite:///./data/pharmacy.db"
AUDIT_LOG_PATH = "artifacts/audit.log"
```

7. Deploy the app.
8. After deployment, verify the executive demo:
   - The app loads at the public Streamlit URL.
   - Both `Platinum` and `Midnight` themes switch correctly.
   - **Sync benefit data** returns a synced record count.
   - A sample prompt returns an answer, confidence score, evidence cards, and audit ID.
   - **Download case summary** produces a Markdown case report.

The app still runs when no secrets are configured because it includes deterministic local
fallback inference and SQLite fallback storage. Add `ANTHROPIC_API_KEY` only if you want
hosted LLM responses instead of the local demo generator.

## Deploy FastAPI on a Free Service

Use the included `Dockerfile` on any container-based free tier such as Render, Railway, or Fly.io.

Recommended service settings:

```text
Build command: docker build -t prescription-agent .
Start command: uvicorn prescription_agent.api.main:app --host 0.0.0.0 --port $PORT
Health check: /health
```

If the platform does not inject `PORT`, use `8000`.

## AWS Lambda Path

The project includes `src/prescription_agent/lambda_handler.py`, which wraps the FastAPI app with Mangum:

```python
from prescription_agent.lambda_handler import handler
```

For AWS deployment, package the app as a Lambda container image or use a SAM/CDK project that points to this handler. The same FastAPI routes are reused.

