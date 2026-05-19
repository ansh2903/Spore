# Roadmap

This roadmap consolidates the original [Workflow.txt](../Workflow.txt) plan with feature ideas from the README.

## Vision

Build a **text-to-SQL interface** that:

1. Converts natural language to database queries via an LLM
2. Shows queries for review and editing before execution
3. Executes against the user's database and displays results
4. Offers visualizations and notebook-style analysis

## Completed (MVP foundation)

- [x] Python package layout (`spore/`, `setup.py`, `requirements.txt`)
- [x] Flask backend with blueprints (`interface`, `connections`, `workspace`)
- [x] Jinja frontend (connections wizard, chat/notebook UI)
- [x] LangChain multi-provider inference (Ollama, OpenAI, Anthropic, Gemini, LM Studio)
- [x] PostgreSQL connector with preview and materialize
- [x] Redis-backed sessions with encrypted credentials
- [x] Jupyter kernel execution over Socket.IO
- [x] Docker Compose (app + KeyDB)

## Phase 1 — Connector coverage

Align UI vendors with `REGISTRY` implementations:

- [ ] MySQL (`spore/_connectors/db/mysql.py`)
- [ ] Microsoft SQL Server (`mssql.py`)
- [ ] MongoDB (`mongodb.py`)
- [ ] SQLite
- [ ] BigQuery / Snowflake (verify optional deps and forms)
- [ ] File sources: CSV, Excel, JSON, Parquet
- [ ] REST / GraphQL API sources

## Phase 2 — Product polish

- [ ] Settings UI for LLM provider (replace manual `settings.json` edits)
- [ ] Re-enable or replace legacy settings/upload flows cleanly
- [ ] Consistent static asset and icon paths
- [ ] Screenshots and updated README demos
- [ ] Pytest suite for connectors and routes
- [ ] CI pipeline (lint + test)

## Phase 3 — Auth and persistence

- [ ] User authentication (guest vs logged-in modes from original README)
- [ ] Persistent saved connections and chat history (PostgreSQL app DB via `SQLALCHEMY_URI`)
- [ ] Connection pooling and warm SSH tunnels (noted in `connections.py` comments)

## Phase 4 — Advanced features

Ideas captured from early planning:

- [ ] **Multi-database queries** — one prompt spanning multiple connections
- [ ] **Database intercommunication** — federated or cross-DB operations
- [ ] **Centralized query runner** — execute SQL on a chosen DB without LLM
- [ ] **Enhanced visualization** — smarter chart type selection from result shape
- [ ] **Desktop client** — original PyQt/Tkinter idea (deprioritized vs web)

## Technical debt

| Item | Notes |
|------|-------|
| Legacy `endpoints.py` | Remove or migrate upload/download routes |
| `query_executor.py` | Consolidate with `SourceConnector` |
| `frontend/web_page/` | Remove or document as archive |
| MathJax vendored bundle | Consider CDN to reduce repo size |
| Docker Linux `host.docker.internal` | Add `extra_hosts` for Ollama on Linux |

## How to contribute

Pick an unchecked item, open an issue to discuss approach, and follow [CONTRIBUTING.md](../CONTRIBUTING.md).

## Historical reference

The original phased notes live in [Workflow.txt](../Workflow.txt) (deprecated; this file supersedes it).
