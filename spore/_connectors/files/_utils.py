from __future__ import annotations

import os


def _file_size_pretty(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    if size_bytes < 1024**2:
        return f"{size_bytes / 1024:.1f} KB"
    if size_bytes < 1024**3:
        return f"{size_bytes / (1024**2):.1f} MB"
    return f"{size_bytes / (1024**3):.2f} GB"


def _stat(path: str) -> tuple[int, str]:
    try:
        size = os.path.getsize(path)
    except Exception:
        size = 0
    return size, _file_size_pretty(size)


def _column_types_from_arrow(schema) -> dict[str, str]:
    # schema: pyarrow.Schema
    return {field.name: str(field.type) for field in schema}

