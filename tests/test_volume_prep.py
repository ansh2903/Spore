"""Tests for shared data volume prep and volume overview API."""

from __future__ import annotations

import os
import stat
from io import BytesIO
from unittest.mock import patch

import pytest

from spore._utils import (
    STREAMS_DIR_MODE,
    STREAMS_FILE_MODE,
    kernel_cache_dir,
    prepare_data_volume_for_kernel,
)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("SPORE_DATA_DIR", str(tmp_path))
    from spore._config.settings import settings

    monkeypatch.setattr(settings, "SPORE_DATA_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture
def fs_client(data_dir):
    from flask import Flask
    from spore._routes.fs import fs_blueprint

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(fs_blueprint)
    return app.test_client()


def test_prepare_data_volume_creates_hf_cache_with_writable_mode(data_dir):
    paths = prepare_data_volume_for_kernel(str(data_dir))
    cache = paths["hf_cache"]
    assert cache.is_dir()
    mode = stat.S_IMODE(cache.stat().st_mode)
    assert mode == STREAMS_DIR_MODE

    parent_cache = cache.parent
    assert parent_cache.name == ".cache"
    assert stat.S_IMODE(parent_cache.stat().st_mode) == STREAMS_DIR_MODE


def test_kernel_cache_dir_is_writable(data_dir):
    cache = kernel_cache_dir(str(data_dir))
    probe = cache / "write_probe"
    probe.write_text("ok")
    ensure = cache
    mode = stat.S_IMODE(ensure.stat().st_mode)
    assert mode == STREAMS_DIR_MODE
    probe.unlink()


def test_volume_overview_returns_all_zones(fs_client, data_dir):
    prepare_data_volume_for_kernel(str(data_dir))
    res = fs_client.get("/api/volume/overview")
    assert res.status_code == 200
    body = res.get_json()
    zone_ids = {z["id"] for z in body["zones"]}
    assert zone_ids == {"streams", "notebooks", "hf_cache", "workspaces_db"}
    assert body["data_dir"] == str(data_dir)
    assert "kernel" in body
    assert "image" in body["kernel"]


def test_fs_list_cache_zone_allows_dot_entries(fs_client, data_dir):
    cache = kernel_cache_dir(str(data_dir))
    hidden = cache / ".locks"
    hidden.mkdir()
    (hidden / "x").write_text("1")

    res = fs_client.get("/api/fs/list?zone=cache")
    assert res.status_code == 200
    names = {e["name"] for e in res.get_json()["entries"]}
    assert ".locks" in names


def test_fs_upload_sets_kernel_file_mode(fs_client, data_dir):
    streams = prepare_data_volume_for_kernel(str(data_dir))["streams"]
    res = fs_client.post(
        "/api/fs/upload",
        data={
            "path": "",
            "file": (BytesIO(b"hello"), "probe.txt"),
        },
        content_type="multipart/form-data",
    )
    assert res.status_code == 200
    dest = streams / "probe.txt"
    assert dest.is_file()
    assert stat.S_IMODE(dest.stat().st_mode) == STREAMS_FILE_MODE
