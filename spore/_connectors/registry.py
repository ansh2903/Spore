from .db.postgresql import PostgreSQLSource
from .warehouse.bigquery import BigQuerySource
from .warehouse.snowflake import SnowflakeSource
from .api.rest import RestAPISource
from .api.graphql import GraphQLAPISource
from .files.csv import CSVFileSource
from .files.excel import ExcelFileSource
from .files.json import JSONFileSource
from .files.parquet import ParquetFileSource

REGISTRY = {
    "postgresql": PostgreSQLSource,
    "bigquery": BigQuerySource,
    "snowflake": SnowflakeSource,
    "rest_api": RestAPISource,
    "graphql_api": GraphQLAPISource,
    "csv_file": CSVFileSource,
    "excel_file": ExcelFileSource,
    "json_file": JSONFileSource,
    "parquet_file": ParquetFileSource,
}
