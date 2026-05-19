"""
Snowflake warehouse connector — remote pushdown preview + streaming ingest to Parquet.
"""

import os

import pyarrow.parquet as pq

from ..base import BaseSource, SourceKind, SourceCapabilities
from spore._config.settings import settings
from spore._logger import logging


class SnowflakeSource(BaseSource):
    kind = SourceKind.WAREHOUSE
    capabilities = SourceCapabilities(
        can_preview=True,
        can_ingest=True,
        can_stream=True,
        needs_ssh=False,
        needs_credentials=True,
    )

    def _create_connection(self, host: str, port: int):
        try:
            import snowflake.connector
        except ImportError as e:
            raise RuntimeError(
                "snowflake-connector-python is required. pip install snowflake-connector-python"
            ) from e
        c = self.config
        return snowflake.connector.connect(
            account=c["account_identifier"],
            user=c["user"],
            password=c["password"],
            warehouse=c.get("warehouse"),
            database=c.get("database"),
            schema=c.get("schema", "PUBLIC"),
        )

    def _close_connection(self, conn) -> None:
        try:
            conn.close()
        except Exception:
            pass

    def test_connection(self) -> tuple[bool, str]:
        try:
            with self.connection_context() as conn:
                cur = conn.cursor()
                cur.execute("SELECT 1")
            return True, "Connection successful"
        except Exception as e:
            return False, str(e)

    def fetch_metadata(self) -> tuple[bool, dict]:
        try:
            with self.connection_context() as conn:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = CURRENT_SCHEMA()
                    AND table_type = 'BASE TABLE'
                    LIMIT 200
                    """
                )
                tables = {row[0]: {"columns": {}} for row in cur.fetchall()}
            return True, {
                "db_type": "snowflake",
                "database": self.config.get("database"),
                "tables": tables,
            }
        except Exception as e:
            logging.error(f"[snowflake] metadata failed: {e}")
            return False, {}

    def preview(self, query: str, limit: int = 500):
        try:
            with self.connection_context() as conn:
                cur = conn.cursor()
                try:
                    cur.execute(f"SELECT COUNT(*) FROM ({query.rstrip(';')}) AS _c")
                    total_rows = cur.fetchone()[0]
                except Exception:
                    total_rows = "unknown"

                cur.execute(f"SELECT * FROM ({query.rstrip(';')}) AS _q LIMIT {int(limit)}")
                cols = [d[0] for d in cur.description]
                rows = [dict(zip(cols, row)) for row in cur.fetchall()]

                yield {"type": "columns", "content": cols}
                yield {"type": "metadata", "total_rows": total_rows, "preview_count": len(rows)}
                yield {"type": "rows", "content": rows}
        except Exception as e:
            logging.error(f"[snowflake] preview failed: {e}")
            yield {"type": "error", "content": str(e)}

    def ingest(
        self,
        stream_name: str,
        query: str,
        destination_path: str | None = None,
        memory_ceiling: str = "1GB",
        batch_row_size: int = 10_000,
    ) -> tuple[str, str]:
        import pyarrow as pa

        dest = destination_path or settings.SPORE_DATA_DIR
        stream_dir = os.path.join(dest, "streams", stream_name)
        os.makedirs(stream_dir, exist_ok=True)
        source_path = os.path.join(stream_dir, "source.parquet")

        writer = None
        try:
            with self.connection_context() as conn:
                cur = conn.cursor()
                cur.execute(query)
                cols = [d[0] for d in cur.description]
                while True:
                    rows = cur.fetchmany(batch_row_size)
                    if not rows:
                        break
                    batch = pa.RecordBatch.from_pydict(
                        {cols[i]: [r[i] for r in rows] for i in range(len(cols))}
                    )
                    if writer is None:
                        writer = pq.ParquetWriter(source_path, batch.schema, compression="snappy")
                    writer.write_batch(batch)
            if writer is None:
                pq.write_table(pa.table({}), source_path)
            return "success", stream_dir
        except Exception as e:
            logging.error(f"[snowflake] ingest failed: {e}")
            return "error", str(e)
        finally:
            if writer:
                writer.close()
