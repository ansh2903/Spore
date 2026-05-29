from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..base import BaseSource, SourceCapabilities, SourceKind
from ..utils import requests_tls_kwargs
from spore._logger import logging


@dataclass
class _NoopConn:
    def close(self) -> None:  # pragma: no cover
        return


class RestAPISource(BaseSource):
    kind = SourceKind.API
    capabilities = SourceCapabilities(
        can_preview=False,
        can_ingest=False,
        can_stream=False,
        needs_ssh=False,
        needs_credentials=True,
    )

    def _create_connection(self, host: str, port: int | None) -> Any:
        return _NoopConn()

    def test_connection(self) -> tuple[bool, str]:
        endpoint = (self.config.get("endpoint") or "").strip()
        if not endpoint:
            return False, "Missing endpoint"

        try:
            import requests

            tls = requests_tls_kwargs(self.config)
            # Prefer a quick HEAD, but some APIs block it; fall back to GET.
            r = requests.head(
                endpoint,
                timeout=self.connect_timeout,
                allow_redirects=True,
                **tls,
            )
            if r.status_code >= 400:
                r = requests.get(
                    endpoint,
                    timeout=self.connect_timeout,
                    allow_redirects=True,
                    **tls,
                )
            return True, f"Reachable ({r.status_code})"
        except Exception as e:
            logging.error(f"[rest_api] test_connection failed: {e}")
            return False, str(e)

    def fetch_metadata(self) -> tuple[bool, dict]:
        endpoint = (self.config.get("endpoint") or "").strip()
        auth_type = self.config.get("auth_type")
        return True, {
            "db_type": "rest_api",
            "kind": self.kind.value,
            "base_url": endpoint,
            "auth_type": auth_type,
            # Future: populate from user-saved requests / OpenAPI import.
            "entities": {},
        }

