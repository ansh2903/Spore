"""Tests for kernel memory limit bounds and security_runtime clamping."""

from __future__ import annotations

from unittest.mock import patch

from spore._utils import (
    _clamp_mem_limit_mb,
    kernel_mem_limit_bounds,
    security_runtime,
)


def test_kernel_mem_limit_bounds_defaults():
    with patch("spore._config.settings.settings") as mock_settings:
        mock_settings.KERNEL_MEM_LIMIT = "4g"
        mock_settings.KERNEL_MEM_LIMIT_MAX_MB = 131072
        bounds = kernel_mem_limit_bounds()

    assert bounds["min_mb"] == 250
    assert bounds["max_mb"] == 131072
    assert bounds["default_mb"] == 4096


def test_clamp_mem_limit_mb_within_range():
    with patch("spore._utils.kernel_mem_limit_bounds") as mock_bounds:
        mock_bounds.return_value = {"min_mb": 250, "max_mb": 131072, "default_mb": 4096}
        assert _clamp_mem_limit_mb(8192) == 8192
        assert _clamp_mem_limit_mb(250) == 250
        assert _clamp_mem_limit_mb(131072) == 131072


def test_clamp_mem_limit_mb_above_max():
    with patch("spore._utils.kernel_mem_limit_bounds") as mock_bounds:
        mock_bounds.return_value = {"min_mb": 250, "max_mb": 131072, "default_mb": 4096}
        assert _clamp_mem_limit_mb(200000) == 131072


def test_clamp_mem_limit_mb_below_min():
    with patch("spore._utils.kernel_mem_limit_bounds") as mock_bounds:
        mock_bounds.return_value = {"min_mb": 250, "max_mb": 131072, "default_mb": 4096}
        assert _clamp_mem_limit_mb(100) == 250


def test_security_runtime_clamps_stored_value():
    with patch("spore._utils.kernel_mem_limit_bounds") as mock_bounds, patch(
        "spore._utils.load_settings"
    ) as mock_load, patch("spore._config.settings.settings") as mock_settings:
        mock_bounds.return_value = {"min_mb": 250, "max_mb": 131072, "default_mb": 4096}
        mock_load.return_value = {"security": {"mem_limit_mb": 200000, "pids_limit": 256}}
        mock_settings.KERNEL_PIDS_LIMIT = 256
        runtime = security_runtime()

    assert runtime["mem_limit_mb"] == 131072
    assert runtime["mem_limit_max_mb"] == 131072
    assert runtime["mem_limit"] == "131072m"


def test_security_runtime_accepts_8192_mb():
    with patch("spore._utils.kernel_mem_limit_bounds") as mock_bounds, patch(
        "spore._utils.load_settings"
    ) as mock_load, patch("spore._config.settings.settings") as mock_settings:
        mock_bounds.return_value = {"min_mb": 250, "max_mb": 131072, "default_mb": 4096}
        mock_load.return_value = {"security": {"mem_limit_mb": 8192}}
        mock_settings.KERNEL_PIDS_LIMIT = 256
        runtime = security_runtime()

    assert runtime["mem_limit_mb"] == 8192
