from __future__ import annotations

import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from flask import abort, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

from spore._routes.utils import generate_blueprint
from spore._utils import (
    data_runtime,
    dir_size_bytes,
    ensure_kernel_writable_path,
    file_size_fmt,
    kernel_cache_dir,
    kernel_runtime,
    prepare_data_volume_for_kernel,
    security_runtime,
    streams_dir,
)
from spore._logger import logging
from spore._config.settings import settings

fs_blueprint = generate_blueprint("fs")

MEMORY_THRESHOLD = 1 * 1024**3  # 1GB

# Back-compat for data.py staging paths (streams zone root).
ROOT = str(streams_dir(settings.SPORE_DATA_DIR))

_FS_ZONES = {
    "streams": {
        "label": "Data streams",
        "relative_path": "streams",
        "purpose": "Materialized Parquet datasets and working files",
    },
    "cache": {
        "label": "Model cache",
        "relative_path": ".cache/huggingface",
        "purpose": "Hugging Face / transformers model downloads",
    },
}


def _fs_zone() -> str:
    zone = (request.args.get("zone") or "streams").strip().lower()
    if zone not in _FS_ZONES:
        abort(400, "Invalid zone")
    return zone


def _zone_root(zone: str | None = None) -> str:
    zone = zone or _fs_zone()
    data_dir = settings.SPORE_DATA_DIR
    if zone == "cache":
        return str(kernel_cache_dir(data_dir))
    return str(streams_dir(data_dir))


def _norm_rel(rel: str | None) -> str:
    rel = (rel or "").strip().replace("\\", "/").strip("/")
    parts = []
    for part in rel.split("/"):
        if not part or part == ".":
            continue
        if part == "..":
            raise ValueError("path traversal")
        parts.append(part)
    return "/".join(parts)


def _safe_resolve(rel: str | None, *, root: str | None = None) -> str:
    root = root or _zone_root()
    try:
        rel_norm = _norm_rel(rel)
    except ValueError:
        abort(400, "Invalid path")
    abs_path = os.path.abspath(os.path.join(root, rel_norm))
    if not (abs_path == root or abs_path.startswith(root + os.sep)):
        abort(400, "path escapes root")
    return abs_path


def _rel_from_abs(abs_path: str, root: str | None = None) -> str:
    root = root or _zone_root()
    rel = os.path.relpath(abs_path, root)
    return "" if rel == "." else rel.replace("\\", "/")


def _parent_rel(rel: str) -> str | None:
    if not rel:
        return None
    parent = os.path.dirname(rel.replace("/", os.sep))
    return parent.replace("\\", "/") if parent != "." else ""


def _is_stream_dir(abs_dir: str, rel: str) -> bool:
    """Top-level stream folder containing ``source.<ext>``."""
    if not rel or "/" in rel:
        return False
    if not os.path.isdir(abs_dir):
        return False
    try:
        for name in os.listdir(abs_dir):
            if name.startswith("source.") and os.path.isfile(os.path.join(abs_dir, name)):
                return True
    except OSError:
        return False
    return False


def _tree_total_bytes(root: str) -> int:
    return dir_size_bytes(Path(root))


def _entry_meta(abs_path: str, name: str, rel_parent: str, *, zone: str) -> dict:
    rel = f"{rel_parent}/{name}" if rel_parent else name
    is_dir = os.path.isdir(abs_path)
    entry: dict = {
        "name": name,
        "path": rel,
        "type": "dir" if is_dir else "file",
        "is_stream": False,
    }
    try:
        entry["modified"] = datetime.fromtimestamp(
            os.path.getmtime(abs_path), tz=timezone.utc
        ).isoformat()
    except OSError:
        entry["modified"] = None

    if is_dir:
        entry["is_stream"] = zone == "streams" and _is_stream_dir(abs_path, rel)
        entry["size_bytes"] = 0
        entry["size_pretty"] = ""
    else:
        try:
            size = os.path.getsize(abs_path)
        except OSError:
            size = 0
        entry["size_bytes"] = size
        entry["size_pretty"] = file_size_fmt(size)
        entry["memory_safe"] = size < MEMORY_THRESHOLD

    return entry


def _kernel_mount_path(relative_path: str) -> str:
    rel = relative_path.strip("/")
    mount = settings.KERNEL_DATA_MOUNT.rstrip("/")
    return f"{mount}/{rel}" if rel else mount


def _volume_zone_meta(
    zone_id: str,
    label: str,
    relative_path: str,
    abs_path: Path,
    *,
    purpose: str = "",
) -> dict:
    exists = abs_path.exists()
    size = dir_size_bytes(abs_path) if exists else 0
    return {
        "id": zone_id,
        "label": label,
        "relative_path": relative_path,
        "kernel_path": _kernel_mount_path(relative_path),
        "purpose": purpose,
        "size_bytes": size,
        "size_pretty": file_size_fmt(size),
        "exists": exists,
    }


@fs_blueprint.route("/api/volume/overview")
def volume_overview():
    paths = prepare_data_volume_for_kernel(settings.SPORE_DATA_DIR)
    data_dir = paths["data_dir"]
    runtime = data_runtime()
    kernel = kernel_runtime()
    sec = security_runtime()
    managed = kernel.get("packages") or []

    image_available = False
    try:
        from spore._routes.settings import _image_installed_versions

        image_available = bool(_image_installed_versions(kernel["image"]))
    except Exception:
        pass

    workspaces_db = data_dir / "workspaces.db"
    zones = [
        _volume_zone_meta(
            "streams",
            "Data streams",
            "streams",
            paths["streams"],
            purpose="Materialized Parquet datasets and working files",
        ),
        _volume_zone_meta(
            "notebooks",
            "Notebooks",
            "notebooks",
            paths["notebooks"],
            purpose="Saved .ipynb notebook files",
        ),
        _volume_zone_meta(
            "hf_cache",
            "Model cache",
            ".cache/huggingface",
            paths["hf_cache"],
            purpose="Hugging Face / transformers model downloads",
        ),
        _volume_zone_meta(
            "workspaces_db",
            "Workspaces",
            "workspaces.db",
            workspaces_db,
            purpose="Workspace and notebook metadata (SQLite)",
        ),
    ]

    return jsonify(
        {
            "data_dir": str(data_dir),
            "runtime_data_dir": runtime["data_dir"],
            "zones": zones,
            "kernel": {
                "image": kernel["image"],
                "python_version": kernel["python_version"],
                "mem_limit_mb": sec["mem_limit_mb"],
                "mem_limit": sec["mem_limit"],
                "managed_package_count": len(managed),
                "packages": managed,
                "image_available": image_available,
            },
        }
    )


@fs_blueprint.route("/api/fs/list")
def fs_list():
    zone = _fs_zone()
    root = _zone_root(zone)
    if zone == "streams":
        streams_dir(settings.SPORE_DATA_DIR)
    else:
        kernel_cache_dir(settings.SPORE_DATA_DIR)

    rel = _norm_rel(request.args.get("path", ""))
    abs_dir = _safe_resolve(rel, root=root)
    if not os.path.isdir(abs_dir):
        return jsonify({"error": "Not a directory"}), 404

    entries = []
    try:
        names = sorted(os.listdir(abs_dir), key=str.lower)
    except OSError as e:
        logging.error("fs list error: %s", e)
        return jsonify({"error": "Failed to list directory"}), 500

    for name in names:
        if name.startswith(".") and zone != "cache":
            continue
        abs_path = os.path.join(abs_dir, name)
        entries.append(_entry_meta(abs_path, name, rel, zone=zone))

    entries.sort(key=lambda e: (0 if e["type"] == "dir" else 1, e["name"].lower()))
    total_bytes = _tree_total_bytes(root)

    return jsonify(
        {
            "zone": zone,
            "path": rel,
            "parent": _parent_rel(rel),
            "total_bytes": total_bytes,
            "total_pretty": file_size_fmt(total_bytes),
            "entries": entries,
        }
    )


@fs_blueprint.route("/api/fs/mkdir", methods=["POST"])
def fs_mkdir():
    data = request.get_json(silent=True) or {}
    rel = (data.get("path") or "").strip()
    if not rel:
        return jsonify({"error": "path is required"}), 400

    abs_path = _safe_resolve(rel)
    if os.path.exists(abs_path):
        return jsonify({"error": "Already exists"}), 409

    try:
        ensure_kernel_writable_path(abs_path, is_dir=True)
    except OSError as e:
        logging.error("fs mkdir error: %s", e)
        return jsonify({"error": str(e)}), 500

    return jsonify({"ok": True, "path": _norm_rel(rel)})


@fs_blueprint.route("/api/fs/upload", methods=["POST"])
def fs_upload():
    rel = _norm_rel(request.form.get("path", ""))
    abs_dir = _safe_resolve(rel)
    if not os.path.isdir(abs_dir):
        return jsonify({"error": "Target directory not found"}), 404

    overwrite = request.args.get("overwrite", "").lower() in ("1", "true", "yes")
    uploaded = request.files.getlist("files") or request.files.getlist("file")
    if not uploaded:
        single = request.files.get("file")
        if single:
            uploaded = [single]

    if not uploaded:
        return jsonify({"error": "No files provided"}), 400

    saved = []
    for storage in uploaded:
        raw_name = storage.filename or "upload"
        name = secure_filename(raw_name) or "upload"
        dest = os.path.join(abs_dir, name)
        if os.path.exists(dest) and not overwrite:
            return jsonify({"error": f"File already exists: {name}"}), 409
        try:
            storage.save(dest)
            ensure_kernel_writable_path(dest, is_dir=False)
            saved.append(_rel_from_abs(dest))
        except OSError as e:
            logging.error("fs upload error: %s", e)
            return jsonify({"error": str(e)}), 500

    return jsonify({"ok": True, "paths": saved})


@fs_blueprint.route("/api/fs/move", methods=["POST"])
def fs_move():
    data = request.get_json(silent=True) or {}
    src_rel = (data.get("src") or "").strip()
    dst_rel = (data.get("dst") or "").strip()
    if not src_rel or not dst_rel:
        return jsonify({"error": "src and dst are required"}), 400

    src_abs = _safe_resolve(src_rel)
    dst_abs = _safe_resolve(dst_rel)

    if not os.path.exists(src_abs):
        return jsonify({"error": "Source not found"}), 404
    if os.path.exists(dst_abs):
        return jsonify({"error": "Destination already exists"}), 409
    if os.path.abspath(dst_abs).startswith(os.path.abspath(src_abs) + os.sep):
        return jsonify({"error": "Cannot move into itself"}), 400

    dst_parent = os.path.dirname(dst_abs)
    if not os.path.isdir(dst_parent):
        return jsonify({"error": "Destination parent not found"}), 404

    try:
        if os.path.dirname(src_abs) == dst_parent:
            os.replace(src_abs, dst_abs)
        else:
            shutil.move(src_abs, dst_abs)
    except OSError as e:
        logging.error("fs move error: %s", e)
        return jsonify({"error": str(e)}), 500

    return jsonify({"ok": True, "path": _rel_from_abs(dst_abs)})


@fs_blueprint.route("/api/fs", methods=["DELETE"])
def fs_delete():
    rel = _norm_rel(request.args.get("path", ""))
    if not rel:
        return jsonify({"error": "Cannot delete root"}), 400

    abs_path = _safe_resolve(rel)
    if not os.path.exists(abs_path):
        return jsonify({"error": "Not found"}), 404

    try:
        if os.path.isdir(abs_path):
            shutil.rmtree(abs_path)
        else:
            os.remove(abs_path)
    except OSError as e:
        logging.error("fs delete error: %s", e)
        return jsonify({"error": str(e)}), 500

    return jsonify({"ok": True})


@fs_blueprint.route("/api/fs/download")
def fs_download():
    rel = _norm_rel(request.args.get("path", ""))
    if not rel:
        return jsonify({"error": "path is required"}), 400

    abs_path = _safe_resolve(rel)
    if not os.path.isfile(abs_path):
        return jsonify({"error": "Not a file"}), 400

    directory = os.path.dirname(abs_path)
    filename = os.path.basename(abs_path)
    return send_from_directory(directory, filename, as_attachment=True)
