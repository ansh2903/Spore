from .db.postgresql import PostgreSQLSource

REGISTRY = {
    "postgresql": PostgreSQLSource,
}

try:
    from .warehouse.bigquery import BigQuerySource
    REGISTRY["bigquery"] = BigQuerySource
except ImportError:
    pass

try:
    from .warehouse.snowflake import SnowflakeSource
    REGISTRY["snowflake"] = SnowflakeSource
except ImportError:
    pass