from typing import Optional, Any, Generator

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from contextlib import contextmanager

from spore._logger import logging
from spore._exception import CustomException

class SourceKind(Enum):
    DATABASE    = "database"
    WAREHOUSE   = "warehouse"
    API         = "api"
    FILE        = "file"

@dataclass 
class SourceCapabilities:
    can_preview:        bool
    can_ingest:         bool
    can_stream:         bool
    needs_ssh:          bool
    needs_credentials:  bool

@dataclass
class SecurityConfig:
    """Handles SSL/TLS. Values align with Prisma/Standard PG params."""
    ssl_mode: str = "prefer"
    ca_cert_path: Optional[str] = None
    client_cert_path: Optional[str] = None
    client_key_path: Optional[str] = None
    
    @classmethod
    def from_dict(cls, d: dict, use_ssl: bool):
        if not use_ssl:
            return cls(ssl_mode="disable")
        
        return cls(
            ssl_mode         = d.get("sslmode") or d.get("ssl_mode", "verify-full"),
            ca_cert_path     = d.get("sslrootcert"),
            client_cert_path = d.get("sslcert"),
            client_key_path  = d.get("sslkey")
        )

@dataclass
class TransportConfig:
    """Handles the plumbing (SSH tunnels)."""
    use_ssh_tunnel: bool = False
    ssh_host: Optional[str] = None
    ssh_port: int = 22
    ssh_user: Optional[str] = None
    ssh_private_key: Optional[str] = None
    remote_host: Optional[str] = None
    remote_port: Optional[int] = None

    @classmethod
    def from_dict(cls, d: dict, use_ssh: bool):
        if not use_ssh:
            return cls(use_ssh_tunnel=False)
        
        return cls(
            use_ssh_tunnel  = True,
            ssh_host        = d.get("ssh_host"),
            ssh_port        = int(d.get("ssh_port", 22)),
            ssh_user        = d.get("ssh_user"),
            ssh_private_key = d.get("ssh_private_key"),
            remote_host     = d.get("host"),
            remote_port     = int(d.get("port", 0)) if d.get("port") else None
        )

class BaseSource(ABC):
    """
    General governance class for connectors
    """
    kind: SourceKind
    capabilities: SourceCapabilities
    connect_timeout: int = 5

    def __init__(self, config: dict, use_ssh: bool, use_ssl: bool):
        self.config = config
        self.security_config = SecurityConfig.from_dict(config, use_ssl)
        self.transport_config = TransportConfig.from_dict(config, use_ssh)

    def _resolve_host_port(self) -> tuple[str, int | None]:
        """Resolve host/port for connection, including Docker localhost remap."""
        from spore._utils import is_running_in_docker

        host = self.config.get("host", "127.0.0.1")
        raw_port = self.config.get("port")
        port = int(raw_port) if raw_port not in (None, "") else None

        if is_running_in_docker() and host in ("Localhost", "localhost", "127.0.0.1"):
            host = "host.docker.internal"

        return host, port

    @contextmanager
    def connection_context(self) -> Generator[Any, None, None]:
        """
        Unified Context Manager.
        Handles the SSH Transport layer automatically if required by the source.
        Yields the driver-specific connection/client to be used in queries.
        """
        host, port = self._resolve_host_port()

        tunnel = None

        if self.transport_config.use_ssh_tunnel: # Only when tunnel usage is allowed obviously
            try:
                from sshtunnel import SSHTunnelForwarder
                tunnel = SSHTunnelForwarder(
                    (self.transport_config.ssh_host, self.transport_config.ssh_port),
                    ssh_username=self.transport_config.ssh_user,
                    ssh_pkey=self.transport_config.ssh_private_key,
                    remote_bind_address=(
                        self.transport_config.remote_host,
                        self.transport_config.remote_port,
                    ),
                )
                tunnel.start()
                host = "127.0.0.1"
                port = tunnel.local_bind_port

            except Exception as e:
                logging.error(f"Transport layer failure: {e}")
                raise CustomException(e)

        conn = None
        try:
            conn = self._create_connection(host, port)
            yield conn
        finally:
            if conn:
                self._close_connection(conn)
            if tunnel:
                tunnel.stop()

    @abstractmethod
    def _create_connection(self, host: str, port: int) -> Any:
        """
        Subclasses receive the already-resolved host/port.
        SSH tunnel is handled by connection_context — subclass never touches it.
        """
        pass

    def _close_connection(self, conn: Any):
        """
        Default closer. Override in subclass if the connection uses something 
        other than .close() to terminate (like an API session that might not need closing).
        """
        try:
            conn.close()
        except Exception as e:
            logging.warning(f"Error closing connection: {e}")

    @abstractmethod
    def test_connection(self) -> tuple[bool, str]:
        """Ping the source, validate credentials/paths."""
        pass

    @abstractmethod
    def fetch_metadata(self) -> tuple[bool, dict]:
        """
        Return schema info -- tables, columns, types.
        For APIs: endpoints + expected shape.
        For Files: inferred schema
        """
        pass

    def preview(self, query: str, limit: int = 500):
        """
        Live chunked query. Only implemented by database sources.
        Warehouses and API raise NotImplementedError.
        """
        raise NotImplementedError(
            f"{self.__class__.__name__} does not support live preview. "
            "Run ingestion first, then query via DuckDB."
        )
    
    def ingest(self, destination_path: str, **kwargs):
        """
        Full pipeline extraction via dlt or duckdb copy.
        Lands data as parquet in destination_path.
        """
        raise NotImplementedError(
            f"{self.__class__.__name__} does not support ingestion."
        )