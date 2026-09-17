"""Unit tests for kernel bridge, image build helpers, and socket status contract."""

from __future__ import annotations

import queue
from collections import deque
from unittest.mock import MagicMock, patch

import pytest

from spore._kernel.execution_queue import _SessionQueue, clear_queue
from spore._kernel.image_build import package_specs, stop_all_kernel_containers
from spore._kernel.manager import (
    DockerKernel,
    _container_network_kwargs,
    _kernel_dns_servers,
    format_kernel_error,
)


def test_clear_queue_aborts_active_drain():
    socketio = MagicMock()
    queue = _SessionQueue("sess-abort")
    queue._draining = True
    queue._current_cell_id = "cell-1"
    queue._pending.append(("cell-2", "2+2"))

    from spore._kernel import execution_queue

    with patch.object(execution_queue, "_queues", {"sess-abort": queue}):
        clear_queue("sess-abort", socketio=socketio, reason="Kernel restart")

    assert queue._aborted is True
    assert queue._pending == deque()
    assert queue._current_cell_id is None
    socketio.emit.assert_any_call(
        "kernel_output",
        {
            "type": "error",
            "ename": "KernelInterrupted",
            "evalue": "Kernel restart",
            "traceback": ["KernelInterrupted: Kernel restart"],
            "content": "KernelInterrupted: Kernel restart",
            "cell_id": "cell-1",
        },
        to="sess-abort",
    )


def test_kernel_dns_servers_default_when_unset():
    with patch("spore._kernel.manager.settings") as mock_settings:
        mock_settings.KERNEL_DNS = []
        assert _kernel_dns_servers() == []


def test_kernel_dns_servers_uses_settings():
    with patch("spore._kernel.manager.settings") as mock_settings:
        mock_settings.KERNEL_DNS = ["1.0.0.1", "9.9.9.9"]
        assert _kernel_dns_servers() == ["1.0.0.1", "9.9.9.9"]


def test_container_network_kwargs_omits_dns_when_unset():
    client = MagicMock()
    with patch("spore._kernel.manager.settings") as mock_settings, patch(
        "spore._kernel.manager._ensure_dind_network", return_value="kernel_net"
    ):
        mock_settings.KERNEL_ALLOW_NETWORK = True
        mock_settings.KERNEL_NETWORK = "kernel_net"
        mock_settings.KERNEL_DNS = []

        kwargs = _container_network_kwargs(client)

    assert kwargs == {"network": "kernel_net"}


def test_container_network_kwargs_includes_dns_and_clears_search():
    client = MagicMock()
    with patch("spore._kernel.manager.settings") as mock_settings, patch(
        "spore._kernel.manager._ensure_dind_network", return_value="kernel_net"
    ):
        mock_settings.KERNEL_ALLOW_NETWORK = True
        mock_settings.KERNEL_NETWORK = "kernel_net"
        mock_settings.KERNEL_DNS = ["8.8.8.8", "1.1.1.1"]

        kwargs = _container_network_kwargs(client)

    assert kwargs == {
        "network": "kernel_net",
        "dns": ["8.8.8.8", "1.1.1.1"],
        "dns_search": [],
    }


def test_format_kernel_error_plain_traceback():
    payload = format_kernel_error(
        "ValueError",
        "bad input",
        ["\x1b[31mValueError\x1b[0m: bad input"],
    )
    assert payload["type"] == "error"
    assert payload["ename"] == "ValueError"
    assert "bad input" in payload["content"]
    assert "\x1b[" not in payload["traceback"][0]


def test_format_kernel_error_fallback_line():
    payload = format_kernel_error("KernelError", "")
    assert payload["content"] == "KernelError: "


def test_package_specs_pins_versions():
    specs = package_specs([
        {"name": "transformers", "version": "4.40.0"},
        {"name": "torch"},
    ])
    assert "transformers==4.40.0" in specs
    assert "torch" in specs
    assert "==" not in specs.split()[-1] or specs.endswith("torch")


def test_stop_all_kernel_containers_stops_running():
    running = MagicMock()
    running.name = "spore-kernel-abc123"
    running.status = "running"
    exited = MagicMock()
    exited.name = "spore-kernel-dead01"
    exited.status = "exited"
    other = MagicMock()
    other.name = "spore-app"
    other.status = "running"

    client = MagicMock()
    client.containers.list.return_value = [running, exited, other]

    stats = stop_all_kernel_containers(client)

    running.stop.assert_called_once_with(timeout=5)
    running.remove.assert_called_once_with(force=True)
    exited.remove.assert_called_once_with(force=True)
    other.stop.assert_not_called()
    other.remove.assert_not_called()
    assert stats["containers_stopped"] == 1
    assert stats["containers_removed"] == 2


def test_execute_ignores_queue_empty_then_completes():
    """queue.Empty during IOPub poll must not surface as a false KernelError."""
    kernel = object.__new__(DockerKernel)
    kernel._security = {"exec_timeout": 0}
    kernel.interrupt = MagicMock()
    kernel._container = MagicMock()
    kernel._container.reload = MagicMock()
    kernel._container.attrs = {"State": {"Status": "running"}}

    msg_id = "exec-1"
    kernel.kc = MagicMock()
    kernel.kc.execute.return_value = msg_id

    idle_msg = {
        "header": {"msg_type": "status"},
        "parent_header": {"msg_id": msg_id},
        "content": {"execution_state": "idle"},
    }
    kernel.kc.get_iopub_msg.side_effect = [queue.Empty(), idle_msg]

    chunks = list(kernel.execute("1 + 1"))

    assert not any(c.get("ename") == "KernelError" and not c.get("evalue") for c in chunks)
    assert chunks[-1] == {"type": "done"}


def test_execute_emits_done_after_kernel_error():
    kernel = object.__new__(DockerKernel)
    kernel._security = {"exec_timeout": 0}
    kernel.interrupt = MagicMock()

    msg_id = "exec-2"
    kernel.kc = MagicMock()
    kernel.kc.execute.return_value = msg_id

    error_msg = {
        "header": {"msg_type": "error"},
        "parent_header": {"msg_id": msg_id},
        "content": {
            "ename": "ValueError",
            "evalue": "nope",
            "traceback": ["ValueError: nope"],
        },
    }
    idle_msg = {
        "header": {"msg_type": "status"},
        "parent_header": {"msg_id": msg_id},
        "content": {"execution_state": "idle"},
    }
    kernel.kc.get_iopub_msg.side_effect = [error_msg, idle_msg]

    chunks = list(kernel.execute("raise ValueError('nope')"))

    assert chunks[0]["type"] == "error"
    assert chunks[0]["ename"] == "ValueError"
    assert chunks[-1] == {"type": "done"}


def test_execute_detects_dead_container_on_poll_silence():
    kernel = object.__new__(DockerKernel)
    kernel._security = {"mem_limit": "1g", "exec_timeout": 0}
    kernel.interrupt = MagicMock()
    kernel._container = MagicMock()
    kernel._container.reload = MagicMock()
    kernel._container.attrs = {
        "State": {"Status": "exited", "OOMKilled": True, "ExitCode": 137},
    }

    msg_id = "exec-oom"
    kernel.kc = MagicMock()
    kernel.kc.execute.return_value = msg_id
    kernel.kc.get_iopub_msg.side_effect = queue.Empty()

    chunks = list(kernel.execute("from transformers import pipeline"))

    assert chunks[0]["type"] == "error"
    assert "out of memory" in chunks[0]["content"].lower()
    assert chunks[-1] == {"type": "done"}


def test_kernel_status_request_registered():
    from spore._kernel import socket_events

    socketio = MagicMock()
    handlers = {}

    def on(event_name):
        def decorator(fn):
            handlers[event_name] = fn
            return fn
        return decorator

    socketio.on = on
    socket_events.register_kernel_events(socketio)

    assert "kernel_status_request" in handlers

    emit = MagicMock()

    class FakeRequest:
        sid = "sess-123"

    with patch.object(socket_events, "request", FakeRequest()), patch.object(
        socket_events, "emit", emit
    ), patch.object(socket_events, "kernel_generation", return_value=7):
        handlers["kernel_status_request"]()

    emit.assert_called_once_with(
        "kernel_status",
        {"status": "connected", "session_id": "sess-123", "kernel_generation": 7},
    )
