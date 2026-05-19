# Connectors guide

Data sources are integrated through **`BaseSource`** subclasses registered in **`REGISTRY`** and exposed via **`SourceConnector`**.

## Architecture

```
HTTP route → SourceConnector → REGISTRY[source_type] → BaseSource
```

- Credentials are **Fernet-encrypted** before storage in the Flask session.
- At runtime, `SourceConnector` decrypts creds and instantiates the registered class.

## Currently registered sources

| `source_type` | Class | Module |
|---------------|-------|--------|
| `postgresql` | `PostgreSQLSource` | `spore/_connectors/db/postgresql.py` |
| `bigquery` | `BigQuerySource` | `spore/_connectors/warehouse/bigquery.py` (if deps installed) |
| `snowflake` | `SnowflakeSource` | `spore/_connectors/warehouse/snowflake.py` (if deps installed) |

Other modules (`mysql.py`, `mssql.py`, `mongodb.py`, file/API connectors) exist but must be wired into `registry.py` before use.

## Adding a new connector

### 1. Implement `BaseSource`

Create a module under the appropriate package:

- `spore/_connectors/db/` — databases
- `spore/_connectors/warehouse/` — warehouses
- `spore/_connectors/files/` — file ingestion
- `spore/_connectors/api/` — HTTP APIs

```python
from spore._connectors.base import BaseSource, SourceKind, SourceCapabilities

class MyDatabaseSource(BaseSource):
    kind = SourceKind.DATABASE
    capabilities = SourceCapabilities(
        can_preview=True,
        can_ingest=True,
        can_stream=True,
        needs_ssh=True,
        needs_credentials=True,
    )

    def _create_connection(self):
        # Return a driver-specific connection inside connection_context()
        ...

    def test_connection(self) -> tuple[bool, str]:
        ...

    def fetch_metadata(self) -> tuple[bool, dict]:
        # Schema, tables, columns for LLM context
        ...

    def preview(self, query: str, limit: int = 500):
        # Generator yielding SSE-friendly chunks: {"type": "...", ...}
        ...

    def ingest(self, stream_name: str, query: str, destination_path: str, **kwargs):
        # Return ("success", result_dict) or ("error", message)
        ...
```

Use `connection_context()` from the base class for SSH tunnels — do not open tunnels manually in every method.

### 2. Register in `registry.py`

```python
from .db.mydb import MyDatabaseSource

REGISTRY = {
    "postgresql": PostgreSQLSource,
    "mydb": MyDatabaseSource,
}
```

### 3. Add vendor UI config

In [`spore/_config/settings.py`](../spore/_config/settings.py), add an entry to `VENDOR_CONFIG` with:

- `metadata.id`, `label`, `kind`, `image` (under `icons/`)
- `fields` for the connection form
- `features.supports_ssh` / `supports_ssl` if applicable

### 4. Add vendor icon

Place `icons/mydb.png` in:

`frontend/src/templates/pages/static/icons/`

### 5. Test manually

1. Start the app with Redis and `ENCRYPTION_KEY` set.
2. Open `/connections/new`, select your vendor, fill the form.
3. Use **Test connection** (`POST /test-connection`).
4. Save via **registry** (`POST /registry`).
5. Open `/chat`, ask a question, preview generated SQL.

## Capabilities

| Flag | Meaning |
|------|---------|
| `can_preview` | Supports live `preview()` streaming |
| `can_ingest` | Supports `ingest()` to Parquet |
| `can_stream` | Large result sets can stream |
| `needs_ssh` | SSH tunnel fields shown in UI |
| `needs_credentials` | Requires encrypted creds in session |

If `can_preview` is false, the UI should direct users to materialize first.

## Metadata format

`fetch_metadata()` should return a structure the LLM can use in prompts — typically tables, columns, types, and optional sample stats. See `PostgreSQLSource.fetch_metadata()` for the reference implementation.

## Security

- Never log decrypted credentials.
- Uploaded cert/key files in the connection wizard are written to temp files during test/registry; clean up in `finally` blocks (see `connections.py`).
- Prefer parameterized queries in `preview` / `ingest`; document limitations if the driver cannot bind parameters.

## PostgreSQL reference

`PostgreSQLSource` demonstrates:

- ADBC for preview
- DuckDB-assisted ingest for large exports
- SSH and SSL via `BaseSource.connection_context()`

Read [`spore/_connectors/db/postgresql.py`](../spore/_connectors/db/postgresql.py) before implementing a new SQL database.

## Checklist

- [ ] `BaseSource` subclass with `test_connection`, `fetch_metadata`
- [ ] `preview` and/or `ingest` as appropriate
- [ ] Entry in `REGISTRY`
- [ ] `VENDOR_CONFIG` form fields
- [ ] Icon in `frontend/.../static/icons/`
- [ ] Dependencies added to `requirements.txt` if needed
- [ ] Manual test: test → registry → chat → preview
