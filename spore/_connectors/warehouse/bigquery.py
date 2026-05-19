"""
BigQuery warehouse connector — remote pushdown preview + streaming ingest to Parquet.
"""

import json
import os

import pyarrow.parquet as pq

from ..base import BaseSource, SourceKind, SourceCapabilities
from spore._config.settings import settings
from spore._logger import logging


class BigQuerySource(BaseSource):
    kind = SourceKind.WAREHOUSE
    capabilities = SourceCapabilities(
        can_preview=True,
        can_ingest=True,
        can_stream=True,
        needs_ssh=False,
        needs_credentials=True,
    )

    def _client(self):
        try:
            from google.cloud import bigquery
            from google.oauth2 import service_account
        except ImportError as e:
            raise RuntimeError(
                "google-cloud-bigquery is required. pip install google-cloud-bigquery"
            ) from e

        c = self.config
        key_path = c.get("service_account_json")
        if key_path and os.path.isfile(key_path):
            creds = service_account.Credentials.from_service_account_file(key_path)
            return bigquery.Client(project=c["project_id"], credentials=creds)

        if c.get("service_account_json_text"):
            info = json.loads(c["service_account_json_text"])
            creds = service_account.Credentials.from_service_account_info(info)
            return bigquery.Client(project=c["project_id"], credentials=creds)

        return bigquery.Client(project=c["project_id"])

    def _create_connection(self, host: str, port: int):
        return self._client()

    def test_connection(self) -> tuple[bool, str]:
        try:
            client = self._client()
            list(client.list_datasets(max_results=1))
            return True, "Connection successful"
        except Exception as e:
            return False, str(e)

    def fetch_metadata(self) -> tuple[bool, dict]:
        try:
            client = self._client()
            dataset = self.config.get("dataset_id")
            tables_ref = client.list_tables(f"{client.project}.{dataset}")
            tables = {t.table_id: {"columns": {}} for t in tables_ref}
            return True, {
                "db_type": "bigquery",
                "project": self.config.get("project_id"),
                "dataset": dataset,
                "tables": tables,
            }
        except Exception as e:
            logging.error(f"[bigquery] metadata failed: {e}")
            return False, {}

    def preview(self, query: str, limit: int = 500):
        try:
            client = self._client()
            job = client.query(f"SELECT * FROM ({query.rstrip(';')}) LIMIT {int(limit)}")
            table = job.result()
            arrow = table.to_arrow()
            rows = arrow.to_pylist()

            count_job = client.query(f"SELECT COUNT(*) AS cnt FROM ({query.rstrip(';')})")
            try:
                total_rows = list(count_job.result())[0]["cnt"]
            except Exception:
                total_rows = "unknown"

            yield {"type": "columns", "content": arrow.schema.names}
            yield {"type": "metadata", "total_rows": total_rows, "preview_count": len(rows)}
            yield {"type": "rows", "content": rows}
        except Exception as e:
            logging.error(f"[bigquery] preview failed: {e}")
            yield {"type": "error", "content": str(e)}

    def ingest(
        self,
        stream_name: str,
        query: str,
        destination_path: str | None = None,
        memory_ceiling: str = "1GB",
        batch_row_size: int = 10_000,
    ) -> tuple[str, str]:
        dest = destination_path or settings.SPORE_DATA_DIR
        stream_dir = os.path.join(dest, "streams", stream_name)
        os.makedirs(stream_dir, exist_ok=True)
        source_path = os.path.join(stream_dir, "source.parquet")

        try:
            client = self._client()
            job = client.query(query)
            arrow_table = job.result().to_arrow(max_results=None)
            pq.write_table(arrow_table, source_path, compression="snappy")
            return "success", stream_dir
        except Exception as e:
            logging.error(f"[bigquery] ingest failed: {e}")
            return "error", str(e)
