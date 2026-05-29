''' Basic settings and configurations for the application.'''

import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    SECRET_KEY = os.getenv("SECRET_KEY", "scalable_secret_key")
    SQLALCHEMY_URI = os.getenv("SQLALCHEMY_URI")
    DEBUG = os.getenv("DEBUG", "True") == "True"

    OLLAMA_ENDPOINT = os.getenv("OLLAMA_ENDPOINT", "http://localhost:11434")
    LMSTUDIO_ENDPOINT = os.getenv("LMSTUDIO_ENDPOINT", "http://localhost:1234")
    DEFAULT_MODEL = os.getenv("OLLAMA_LLM")
    
    APP_HOST = os.getenv("APP_HOST", "127.0.0.1")
    APP_PORT = int(os.getenv("APP_PORT", 5000))
    
    REDIS_HOST = os.getenv("REDIS_HOST", "127.0.0.1")
    REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
    REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", None)
    
    # Host path where materialized data lands (Flask / ingest)
    SPORE_DATA_DIR = os.getenv("SPORE_DATA_DIR", os.path.join(os.getcwd(), "volumes"))
    
    # Path visible inside the sandboxed Jupyter kernel container
    KERNEL_DATA_MOUNT = os.getenv("KERNEL_DATA_MOUNT", "/data")

settings = Settings()

raw_origins = os.getenv("ALLOWED_ORIGINS", "http://127.0.0.1:5000,http://localhost:5000")
ALLOWED_ORIGINS = [origin.strip() for origin in raw_origins.split(",")]

# common_layers.py

COMMON_LAYERS = {
    "ssh_tunnel": {
        "id": "ssh",
        "label": "SSH Tunnel",
        "description": "Connect securely via a bastion host.",
        "fields": {
            "ssh_host": {"label": "SSH Host", "type": "text", "placeholder": "bastion.example.com", "required": True},
            "ssh_port": {"label": "SSH Port", "type": "number", "default": 22, "required": True},
            "ssh_user": {"label": "SSH User", "type": "text", "placeholder": "ubuntu", "required": True},
            "ssh_auth": {
                "label": "Auth Method",
                "type": "select",
                "options": ["key", "password"],
                "default": "key",
                "required": True,
            },
            "ssh_private_key": {"label": "Private Key", "type": "file", "required": False},
            "ssh_key_passphrase": {"label": "Key Passphrase", "type": "password", "required": False},
            "ssh_password": {"label": "SSH Password", "type": "password", "required": False},
        }
    },
    "ssl_tls": {
        "id": "ssl",
        "label": "SSL / TLS Encryption",
        "description": "Require encrypted transport or Mutual TLS (mTLS) via certificates.",
        "fields": {
            "sslmode": {"label": "SSL Mode", "type": "select", "options": ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"], "default": "prefer", "required": True},
            "sslrootcert": {"label": "CA Root Certificate", "type": "file", "required": False},
            "sslcert": {"label": "Client Certificate (mTLS)", "type": "file", "required": False},
            "sslkey": {"label": "Client Private Key", "type": "file", "required": False}
        }
    }
}

REST_SSL_PROFILE = {
    "label": "TLS / Client Certificates",
    "description": "Verify server certificates and optionally present a client cert.",
    "fields": {
        "verify_ssl": {
            "label": "Verify Server Certificate",
            "type": "select",
            "options": ["true", "false"],
            "default": "true",
            "required": False,
        },
        "ca_bundle": {"label": "CA Bundle", "type": "file", "required": False},
        "client_cert": {"label": "Client Certificate", "type": "file", "required": False},
        "client_key": {"label": "Client Private Key", "type": "file", "required": False},
    }
}

SNOWFLAKE_SSL_PROFILE = {
    "label": "Key-Pair Authentication",
    "description": "Use a private key file instead of (or with) password auth.",
    "fields": {
        "private_key_file": {"label": "Private Key File", "type": "file", "required": False},
        "private_key_passphrase": {"label": "Key Passphrase", "type": "password", "required": False},
    }
}

VENDOR_CONFIG = [
    ("Databases", {
        "postgresql": {
            "metadata": {
                "id": "postgresql",
                "label": "PostgreSQL",
                "kind": "database",
                "image": "icons/postgres.png",
            },
            "fields": {
                "host": {"label": "Host", "type": "text", "placeholder": "db.example.com", "required": True},
                "port": {"label": "Port", "type": "number", "default": 5432, "required": True},
                "database": {"label": "Database Name", "type": "text", "default": "postgres", "required": True},
                "user": {"label": "Username", "type": "text", "required": True},
                "password": {"label": "Password", "type": "password", "required": True},
                "schema": {"label": "Default Schema", "type": "text", "default": "public", "required": False}
            },
            "features": {"supports_ssh": True, "supports_ssl": True}
        },
    }),

    ("Data Warehouses", {
        "bigquery": {
            "metadata": {
                "id": "bigquery",
                "label": "BigQuery",
                "kind": "warehouse",
                "image": "icons/BigQuery.png",
            },
            "fields": {
                "project_id": {"label": "GCP Project ID", "type": "text", "required": True},
                "dataset_id": {"label": "Dataset ID", "type": "text", "required": True},
                "service_account_json": {"label": "Service Account JSON Key", "type": "file", "required": True}
            },
            "features": {"supports_ssh": False, "supports_ssl": False}
        },
        "snowflake": {
            "metadata": {
                "id": "snowflake",
                "label": "Snowflake",
                "kind": "warehouse",
                "image": "icons/snowflake.png",
            },
            "fields": {
                "account_identifier": {"label": "Account Identifier", "type": "text", "placeholder": "xy12345.us-east-1", "required": True},
                "warehouse": {"label": "Warehouse", "type": "text", "required": True},
                "database": {"label": "Database", "type": "text", "required": True},
                "user": {"label": "Username", "type": "text", "required": True},
                "password": {"label": "Password", "type": "password", "required": False},
            },
            "ssl_profile": SNOWFLAKE_SSL_PROFILE,
            "features": {"supports_ssh": False, "supports_ssl": True}
        }
    }),
    ("APIs", {
        "rest_api": {
            "metadata": {
                "id": "rest_api",
                "label": "REST API",
                "kind": "api",
                "image": "icons/rest_api.png",
            },
            "fields": {
                "endpoint": {"label": "API Endpoint", "type": "text", "placeholder": "https://api.example.com/data", "required": True},
                "auth_type": {"label": "Authentication Type", "type": "select", "options": ["None", "API Key", "Bearer Token", "Basic Auth"], "default": "None", "required": True},
                "auth_details": {"label": "Authentication Details", "type": "json", "placeholder": '{"api_key": "your_api_key_here"}', "required": False}
            },
            "ssl_profile": REST_SSL_PROFILE,
            "features": {"supports_ssh": False, "supports_ssl": True}
        },
        "graphql_api": {
            "metadata": {
                "id": "graphql_api",
                "label": "GraphQL API",
                "kind": "api",
                "image": "icons/graphql.png",
            },
            "fields": {
                "endpoint": {"label": "API Endpoint", "type": "text", "placeholder": "https://api.example.com/graphql", "required": True},
                "auth_type": {"label": "Authentication Type", "type": "select", "options": ["None", "API Key", "Bearer Token", "Basic Auth"], "default": "None", "required": True},
                "auth_details": {"label": "Authentication Details", "type": "json", "placeholder": '{"api_key": "your_api_key_here"}', "required": False}
            },
            "ssl_profile": REST_SSL_PROFILE,
            "features": {"supports_ssh": False, "supports_ssl": True}
        }
    }),
    ("Local Files", {
        "csv_file": {
            "metadata": {
                "id": "csv_file",
                "label": "CSV File",
                "kind": "file",
                "image": "icons/csv.png",
            },
            "fields": {
                "file_path": {"label": "File Path", "type": "file", "required": True},
                "delimiter": {"label": "Delimiter", "type": "text", "default": ",", "required": False},
                "has_header": {"label": "Has Header Row", "type": "checkbox", "default": True, "required": False}
            },
            "features": {"supports_ssh": False, "supports_ssl": False}
        },
        "excel_file": {
            "metadata": {
                "id": "excel_file",
                "label": "Excel File",
                "kind": "file",
                "image": "icons/excel.png",
            },
            "fields": {
                "file_path": {"label": "File Path", "type": "file", "required": True},
                "sheet_name": {"label": "Sheet Name", "type": "text", "default": "Sheet1", "required": False}
            },
            "features": {"supports_ssh": False, "supports_ssl": False}
        },
        "json_file": {
            "metadata": {
                "id": "json_file",
                "label": "JSON File",
                "kind": "file",
                "image": "icons/json.png",
            },
            "fields": {
                "file_path": {"label": "File Path", "type": "file", "required": True},
                "is_nested": {"label": "Is Nested JSON", "type": "checkbox", "default": False, "required": False}
            },
            "features": {"supports_ssh": False, "supports_ssl": False}
        }
    })
]

"""
                                ('APIs', [
                                ('REST API', 'rest_api', '', 'Connect via standard HTTP endpoints.'),
                                ('GraphQL API', 'graphql_api', '', 'Query specific data via GraphQL.'),
                                ('gRPC API', 'grpc_api', '', 'High-performance RPC framework.')
                                ]),
                            
                                ('Local Files', [
                                ('CSV File', 'csv_file', '', 'Ingest flat CSV data.'),
                                ('Excel File', 'excel_file', '', 'Import sheets from .xlsx files.'),
                                ('JSON File', 'json_file', '', 'Parse nested or flat JSON files.')
                                ])

"""

# For LLMs
PROVIDER_FIELDS = {
    "ollama": ["model", "keep_alive", "num_predict", "num_ctx", "num_batch", "num_thread", "num_gpu", "top_k", "top_p", "temperature", "repeat_penalty", "use_mmap", "use_mlock"],
    "openai": ["model", "num_predict", "temperature", "top_p", "frequency_penalty", "presence_penalty"],
    "anthropic": ["model", "num_predict", "temperature", "top_p", "top_k"],
    "gemini": ["model", "num_predict", "temperature", "top_p", "top_k"],
    "lmstudio": ["model", "num_predict", "temperature", "top_p"],
}
