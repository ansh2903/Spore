# ScalAble — Natural Language to SQL/NoSQL

**ScalAble** is a lightweight, extensible web application for interacting with SQL and NoSQL databases using **natural language**. Describe what you need in plain English; the app generates optimized queries via LLMs while keeping your data under your control (including local models via Ollama).

---

## Features

- **Multi-database support** — PostgreSQL (fully wired); MySQL, BigQuery, Snowflake, and more in progress
- **Natural language querying** — English in, SQL/MongoDB out; review and edit before execution
- **Local LLMs** — Ollama, LM Studio, plus OpenAI, Anthropic, and Gemini
- **Smart metadata** — Schema inspection, keys, types, and sample stats for better prompts
- **Session-based connections** — Encrypted credentials in Redis-backed sessions
- **Visual results** — Tabular preview, Plotly charts, Jupyter notebook kernels over WebSockets
- **Modular connectors** — Plug-and-play `BaseSource` architecture

---

## Quick start

### Prerequisites

- Python 3.12
- Redis or KeyDB
- Optional: [Ollama](https://ollama.com/) for local LLMs

### Install and run

```bash
git clone https://github.com/ansh2903/scalable.git
cd scalable

python -m venv .venv
source .venv/bin/activate

pip install -e .
cp .env.example .env
# Edit .env: set ENCRYPTION_KEY (see docs/CONFIGURATION.md)

docker run -d --name keydb -p 6379:6379 eqalpha/keydb:latest

python -m spore._app
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000).

### Docker

From the repository root:

```bash
docker compose -f docker/docker-compose.yml up --build
```

The app listens on port **5000**. KeyDB runs as a dependency. Point `OLLAMA_BASE` at your host if using Ollama in Docker.

---

## Documentation

| Document | Description |
|----------|-------------|
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local setup and project layout |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Environment variables and LLM settings |
| [DESIGN.md](DESIGN.md) | Product vision and design decisions |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Technical architecture |
| [docs/API.md](docs/API.md) | HTTP and WebSocket API |
| [docs/CONNECTORS.md](docs/CONNECTORS.md) | Adding data source connectors |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Planned features |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common issues |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
| [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md) | AI agent conventions |

---

## UI preview

Screenshots will be added in a future release. For now, run the app locally and visit:

- `/` — Home
- `/connections` — Manage data sources
- `/chat` — Natural language workspace

---

## Project structure

```
scalable/
├── spore/              # Flask backend
├── frontend/           # Jinja templates and static assets
├── docker/             # Container deployment
├── docs/               # Documentation
├── data/               # Materialized query results
└── test/               # Ad-hoc tests
```

---

## Roadmap highlights

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full list. Upcoming work includes:

- Wire MySQL, MongoDB, MSSQL, and file connectors into the registry
- User authentication and persistent connection storage
- Multi-database queries from a single prompt
- Richer visualization defaults

---

## Acknowledgments

See [THANK_YOU.md](THANK_YOU.md).

---

## License

License file not yet added. Contact the maintainer for usage terms.
