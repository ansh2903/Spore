"""Session-scoped compute context for pushdown SQL and materialized relations."""

import os
from uuid_extensions import uuid7

from spore._config.settings import settings
from spore._connectors import SourceConnector


def connector_from_session(conn: dict) -> SourceConnector:
    creds = conn.get("credentials") or conn.get("creds") or {}
    use_ssh = conn.get("use_ssh", False)
    if not use_ssh and isinstance(creds, dict):
        use_ssh = bool(creds.get("ssh_host"))
    use_ssl = conn.get("use_ssl", False)
    if not use_ssl and isinstance(creds, dict):
        sslmode = creds.get("sslmode") or creds.get("ssl_mode")
        use_ssl = bool(sslmode and sslmode != "disable")

    return SourceConnector(
        kind=conn.get("kind", "database"),
        source_type=conn.get("source_type") or conn.get("db_type", "postgresql"),
        creds=creds,
        use_ssh=use_ssh,
        use_ssl=use_ssl,
    )


def find_connection(session, conn_id: str) -> dict | None:
    return next(
        (c for c in session.get("connections", []) if str(c.get("id")) == str(conn_id)),
        None,
    )


def get_relations(session) -> dict:
    return session.setdefault("relations", {})


def save_relation(session, relation: dict) -> None:
    relations = get_relations(session)
    relations[relation["relation_id"]] = relation
    session["relations"] = relations
    session.modified = True


def new_relation_id() -> str:
    return f"rel_{str(uuid7()).replace('-', '')[:12]}"


def host_data_dir() -> str:
    return settings.SPORE_DATA_DIR


def host_path_for_stream(stream_name: str) -> str:
    return os.path.join(host_data_dir(), "streams", stream_name, "source.parquet")


def kernel_path_for_stream(stream_name: str) -> str:
    mount = settings.KERNEL_DATA_MOUNT.rstrip("/")
    return f"{mount}/streams/{stream_name}/source.parquet"
