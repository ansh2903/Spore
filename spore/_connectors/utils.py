"""Shared helpers for source connectors."""

from __future__ import annotations

import os
import re
import shutil
from enum import Enum

from spore._config.settings import settings


# ── connection secrets (volume-backed cert/key storage) ─────────────────────

SECRETS_SUBDIR = "secrets"
SECRET_FIELDS = frozenset({
    "sslrootcert",
    "sslcert",
    "sslkey",
    "ssh_private_key",
    "service_account_json",
    "private_key_file",
    "client_cert",
    "client_key",
    "ca_bundle",
    "file_path",
})


def is_secret_field(name: str) -> bool:
    """Return True if ``name`` is a file-backed credential field."""
    return name in SECRET_FIELDS


def connection_secrets_dir(conn_id: str) -> str:
    """Return (and create) the secrets directory for a connection."""
    path = os.path.join(settings.SPORE_DATA_DIR, SECRETS_SUBDIR, str(conn_id))
    os.makedirs(path, mode=0o700, exist_ok=True)
    return path


def persist_upload(conn_id: str, field: str, file_storage) -> str:
    """Save an uploaded file to the connection secrets dir; return its path."""
    if not file_storage or not getattr(file_storage, "filename", None):
        raise ValueError(f"No file provided for field {field!r}")

    ext = os.path.splitext(file_storage.filename)[1] or ".pem"
    dest_dir = connection_secrets_dir(conn_id)
    dest_path = os.path.join(dest_dir, f"{field}{ext}")

    file_storage.save(dest_path)
    os.chmod(dest_path, 0o600)
    return dest_path


def purge_connection_secrets(conn_id: str) -> None:
    """Remove all persisted secret files for a connection."""
    path = os.path.join(settings.SPORE_DATA_DIR, SECRETS_SUBDIR, str(conn_id))
    if os.path.isdir(path):
        shutil.rmtree(path, ignore_errors=True)


# ── preview limits ─────────────────────────────────────────────────────────


def normalize_preview_limit(limit: int | str | None, default: int = 100) -> int:
    """Return a positive integer preview limit, falling back to ``default``."""
    try:
        value = int(limit) if limit is not None else int(default)
    except (TypeError, ValueError):
        value = int(default)

    return value if value > 0 else int(default)


def strip_query_terminator(query: str) -> str:
    """Trim whitespace and trailing semicolons before embedding a query."""
    return query.strip().rstrip(";").strip()


def wrap_preview_query(query: str, limit: int | str | None, default_limit: int = 100) -> str:
    """Wrap a result-set query so connectors can fetch a bounded preview."""
    preview_limit = normalize_preview_limit(limit, default=default_limit)
    return f"SELECT * FROM ({strip_query_terminator(query)}) AS _q LIMIT {preview_limit}"


def wrap_count_query(query: str) -> str:
    """Wrap a result-set query so connectors can count the rows it would return."""
    return f"SELECT COUNT(*) FROM ({strip_query_terminator(query)}) AS _c"


# ── statement classification ────────────────────────────────────────────────
#
# Drives whether a preview can be wrapped in `SELECT * FROM (...) LIMIT n`,
# whether it must be executed directly and read as a result set (DML with
# RETURNING), or whether it has no result set at all and just needs a
# summary row (UPDATE/DELETE without RETURNING, DDL, utility statements).


class QueryKind(str, Enum):
    """How a single statement should be executed for a preview."""

    SELECT = "select"                # SELECT / WITH / TABLE / VALUES / SHOW / EXPLAIN
    DML_RETURNING = "dml_returning"  # INSERT/UPDATE/DELETE/MERGE … RETURNING …
    MUTATION = "mutation"            # INSERT/UPDATE/DELETE/MERGE without RETURNING
    DDL = "ddl"                      # CREATE / DROP / ALTER / TRUNCATE / GRANT / REVOKE / …
    UTILITY = "utility"              # SET / RESET / BEGIN / COMMIT / VACUUM / ANALYZE / …


_RESULT_SET_LEADING = {"SELECT", "WITH", "TABLE", "VALUES", "SHOW", "EXPLAIN"}
_MUTATION_LEADING = {"INSERT", "UPDATE", "DELETE", "MERGE"}
_DDL_LEADING = {
    "CREATE", "DROP", "ALTER", "TRUNCATE",
    "COMMENT", "GRANT", "REVOKE", "RENAME", "REINDEX",
}
_RETURNING_RE = re.compile(r"\bRETURNING\b", re.IGNORECASE)


def _strip_sql_comments(text: str) -> str:
    """Drop leading SQL comments so we can read the first real keyword."""
    s = text.lstrip()
    while True:
        if s.startswith("--"):
            newline = s.find("\n")
            s = "" if newline == -1 else s[newline + 1:].lstrip()
        elif s.startswith("/*"):
            end = s.find("*/")
            s = "" if end == -1 else s[end + 2:].lstrip()
        else:
            return s


def classify_query(query: str) -> QueryKind:
    """Best-effort classification of the *first* statement in ``query``.

    The classifier is heuristic — it inspects only the leading keyword
    (after comments) plus a substring check for ``RETURNING`` — so pathological
    inputs (e.g. ``RETURNING`` appearing inside a string literal) may be
    misclassified.  Callers should treat the result as a routing hint and
    still handle execution errors gracefully.
    """
    body = _strip_sql_comments(strip_query_terminator(query))
    if not body:
        return QueryKind.UTILITY

    head = body.split(None, 1)[0].upper()
    if head in _RESULT_SET_LEADING:
        return QueryKind.SELECT
    if head in _MUTATION_LEADING:
        return QueryKind.DML_RETURNING if _RETURNING_RE.search(body) else QueryKind.MUTATION
    if head in _DDL_LEADING:
        return QueryKind.DDL
    return QueryKind.UTILITY


def status_row(query: str, kind: QueryKind, rows_affected: int | None) -> dict:
    """Build a single-row summary for statements that have no result set."""
    body = strip_query_terminator(query)
    operation = body.split(None, 1)[0].upper() if body else kind.value.upper()
    if isinstance(rows_affected, int) and rows_affected >= 0:
        affected: int | str = rows_affected
    else:
        affected = "—"
    return {"operation": operation, "rows_affected": affected, "status": "OK"}


# ── HTTP TLS helpers (REST / GraphQL) ───────────────────────────────────────


def requests_tls_kwargs(config: dict) -> dict:
    """Build ``verify`` and ``cert`` kwargs for ``requests`` from connection config."""
    verify: bool | str = config.get("verify_ssl", "true")
    if isinstance(verify, str):
        verify = verify.lower() not in ("false", "0", "no")

    ca = config.get("ca_bundle")
    if ca and os.path.isfile(ca):
        verify = ca

    kwargs: dict = {"verify": verify}

    client_cert = config.get("client_cert")
    client_key = config.get("client_key")
    if (
        client_cert and os.path.isfile(client_cert)
        and client_key and os.path.isfile(client_key)
    ):
        kwargs["cert"] = (client_cert, client_key)

    return kwargs
