from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable

from web_lite3.constants import (
    JOB_STATUS_CANCEL_REQUESTED,
    JOB_STATUS_CANCELLED,
    JOB_STATUS_FAILED,
    JOB_STATUS_PENDING,
    JOB_STATUS_RUNNING,
    JOB_STATUS_SUCCEEDED,
    JOB_TERMINAL_STATUSES,
)


def _utc_now() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


class JobCancelledError(Exception):
    pass


@dataclass
class JobState:
    job_id: str
    kind: str
    history_id: str
    status: str = JOB_STATUS_PENDING
    message: str = "等待任务"
    created_at: str = field(default_factory=_utc_now)
    updated_at: str = field(default_factory=_utc_now)
    remote_task_id: str | None = None
    outputs: list[dict[str, Any]] = field(default_factory=list)
    error_message: str | None = None
    elapsed_ms: int | None = None
    started_monotonic: float = field(default_factory=time.monotonic, repr=False)
    cancel_event: threading.Event = field(default_factory=threading.Event, repr=False)
    cancel_remote: Callable[[str], dict[str, Any]] | None = field(default=None, repr=False)
    remote_cancel_attempted: bool = field(default=False, repr=False)
    terminal_monotonic: float | None = field(default=None, repr=False)


class JobContext:
    def __init__(self, registry: "JobRegistry", state: JobState) -> None:
        self.registry = registry
        self.state = state

    @property
    def job_id(self) -> str:
        return self.state.job_id

    @property
    def history_id(self) -> str:
        return self.state.history_id

    def is_cancelled(self) -> bool:
        return self.state.cancel_event.is_set()

    def publish(
        self,
        *,
        status: str | None = None,
        message: str | None = None,
        artifact: dict[str, Any] | None = None,
        error_message: str | None = None,
    ) -> None:
        self.registry._publish(
            self.state.job_id,
            status=status,
            message=message,
            artifact=artifact,
            error_message=error_message,
        )

    def set_remote_task_id(self, remote_task_id: str) -> None:
        self.registry._set_remote_task_id(self.state.job_id, remote_task_id)

    def attach_remote_cancel(self, callback: Callable[[str], dict[str, Any]]) -> None:
        self.registry._set_remote_cancel(self.state.job_id, callback)


class JobRegistry:
    def __init__(self, max_workers: int = 4, *, terminal_ttl_seconds: int = 300, max_terminal_snapshots: int = 256) -> None:
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self._jobs: dict[str, JobState] = {}
        self._batches: dict[str, list[str]] = {}
        self._lock = threading.Lock()
        self._terminal_ttl_seconds = max(30, int(terminal_ttl_seconds))
        self._max_terminal_snapshots = max(32, int(max_terminal_snapshots))

    def _mark_terminal_locked(self, state: JobState) -> None:
        if state.status in JOB_TERMINAL_STATUSES and state.terminal_monotonic is None:
            state.terminal_monotonic = time.monotonic()

    def _prune_locked(self) -> None:
        if not self._jobs:
            return
        now = time.monotonic()
        terminal_states = [
            state for state in self._jobs.values()
            if state.status in JOB_TERMINAL_STATUSES
        ]
        removable: set[str] = {
            state.job_id
            for state in terminal_states
            if state.terminal_monotonic is not None and now - state.terminal_monotonic > self._terminal_ttl_seconds
        }
        overflow = max(0, len(terminal_states) - len(removable) - self._max_terminal_snapshots)
        if overflow > 0:
            survivors = [
                state for state in terminal_states
                if state.job_id not in removable
            ]
            survivors.sort(key=lambda state: state.terminal_monotonic or state.started_monotonic)
            removable.update(state.job_id for state in survivors[:overflow])
        for job_id in removable:
            self._jobs.pop(job_id, None)
        if removable:
            empty_batches = []
            for batch_id, job_ids in self._batches.items():
                remaining = [job_id for job_id in job_ids if job_id in self._jobs]
                if remaining:
                    self._batches[batch_id] = remaining
                else:
                    empty_batches.append(batch_id)
            for batch_id in empty_batches:
                self._batches.pop(batch_id, None)

    def create(
        self,
        *,
        job_id: str,
        kind: str,
        history_id: str,
    ) -> dict[str, Any]:
        state = JobState(job_id=job_id, kind=kind, history_id=history_id)
        with self._lock:
            self._prune_locked()
            self._jobs[job_id] = state
        return self.get(job_id) or {}

    def restore(
        self,
        *,
        job_id: str,
        kind: str,
        history_id: str,
        status: str = JOB_STATUS_RUNNING,
        message: str | None = None,
        created_at: str | None = None,
        updated_at: str | None = None,
        remote_task_id: str | None = None,
        outputs: list[dict[str, Any]] | None = None,
        error_message: str | None = None,
        elapsed_ms: int | None = None,
    ) -> dict[str, Any]:
        resumed_elapsed_ms = max(0, int(elapsed_ms or 0))
        started_monotonic = time.monotonic() - (resumed_elapsed_ms / 1000.0)
        state = JobState(
            job_id=job_id,
            kind=kind,
            history_id=history_id,
            status=status or JOB_STATUS_RUNNING,
            message=message or "服务重启后正在恢复任务状态",
            created_at=created_at or _utc_now(),
            updated_at=updated_at or _utc_now(),
            remote_task_id=remote_task_id,
            outputs=list(outputs or []),
            error_message=error_message,
            elapsed_ms=resumed_elapsed_ms if resumed_elapsed_ms > 0 else None,
            started_monotonic=started_monotonic,
        )
        with self._lock:
            self._prune_locked()
            self._jobs[job_id] = state
        return self.get(job_id) or {}

    def launch(
        self,
        *,
        job_id: str,
        runner: Callable[[JobContext], dict[str, Any]],
    ) -> dict[str, Any]:
        with self._lock:
            state = self._jobs[job_id]
        context = JobContext(self, state)

        def _wrapped() -> None:
            self._publish(job_id, status=JOB_STATUS_RUNNING, message="任务已开始")
            try:
                result = runner(context) or {}
                self._finalize_success(job_id, result)
            except JobCancelledError:
                self._publish(
                    job_id,
                    status=JOB_STATUS_CANCELLED,
                    message="任务已取消",
                    error_message="任务已取消",
                )
            except Exception as exc:
                self._publish(
                    job_id,
                    status=JOB_STATUS_FAILED,
                    message=str(exc),
                    error_message=str(exc),
                )

        self.executor.submit(_wrapped)
        return self.get(job_id) or {}

    def submit(
        self,
        *,
        job_id: str,
        kind: str,
        history_id: str,
        runner: Callable[[JobContext], dict[str, Any]],
    ) -> dict[str, Any]:
        self.create(job_id=job_id, kind=kind, history_id=history_id)
        return self.launch(job_id=job_id, runner=runner)

    def register_batch(self, batch_session_id: str, job_ids: list[str]) -> None:
        with self._lock:
            self._prune_locked()
            self._batches[batch_session_id] = list(job_ids)

    def batch_job_ids(self, batch_session_id: str) -> list[str]:
        with self._lock:
            self._prune_locked()
            return list(self._batches.get(batch_session_id) or [])

    def cancel_batch(self, batch_session_id: str) -> list[dict[str, Any]]:
        snapshots: list[dict[str, Any]] = []
        for job_id in self.batch_job_ids(batch_session_id):
            snapshot = self.cancel(job_id)
            if snapshot:
                snapshots.append(snapshot)
        return snapshots

    def any_cancel_requested(self, job_ids: list[str]) -> bool:
        with self._lock:
            self._prune_locked()
            for job_id in job_ids:
                state = self._jobs.get(job_id)
                if state and state.cancel_event.is_set():
                    return True
            return False

    def publish_manual(
        self,
        job_id: str,
        *,
        status: str | None = None,
        message: str | None = None,
        artifact: dict[str, Any] | None = None,
        error_message: str | None = None,
    ) -> dict[str, Any] | None:
        with self._lock:
            if job_id not in self._jobs:
                return None
        self._publish(
            job_id,
            status=status,
            message=message,
            artifact=artifact,
            error_message=error_message,
        )
        return self.get(job_id)

    def finalize_manual(self, job_id: str, result: dict[str, Any]) -> dict[str, Any] | None:
        with self._lock:
            if job_id not in self._jobs:
                return None
        self._finalize_success(job_id, result)
        return self.get(job_id) or {}

    def fail_manual(
        self,
        job_id: str,
        *,
        message: str,
        error_message: str | None = None,
        status: str = JOB_STATUS_FAILED,
    ) -> dict[str, Any] | None:
        with self._lock:
            if job_id not in self._jobs:
                return None
        self._publish(
            job_id,
            status=status,
            message=message,
            error_message=error_message or message,
        )
        return self.get(job_id)

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            self._prune_locked()
            state = self._jobs.get(job_id)
            if not state:
                return None
            return self._serialize(state)

    def has_active_jobs(self) -> bool:
        with self._lock:
            self._prune_locked()
            return any(state.status not in JOB_TERMINAL_STATUSES for state in self._jobs.values())

    def list_snapshots(self, *, kind: str | None = None, active_only: bool = False) -> list[dict[str, Any]]:
        with self._lock:
            self._prune_locked()
            states = list(self._jobs.values())
            if kind:
                states = [state for state in states if state.kind == kind]
            if active_only:
                states = [state for state in states if state.status not in JOB_TERMINAL_STATUSES]
            return [self._serialize(state) for state in states]

    def cancel(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            self._prune_locked()
            state = self._jobs.get(job_id)
            if not state:
                return None
            if state.status in JOB_TERMINAL_STATUSES:
                self._mark_terminal_locked(state)
                return self._serialize(state)
            state.cancel_event.set()
            state.status = JOB_STATUS_CANCEL_REQUESTED
            state.message = "已请求取消"
            state.updated_at = _utc_now()
            if state.remote_task_id and state.cancel_remote and not state.remote_cancel_attempted:
                state.remote_cancel_attempted = True
                try:
                    cancel_result = state.cancel_remote(state.remote_task_id)
                    state.message = cancel_result.get("error") or cancel_result.get("status") or state.message
                except Exception as exc:
                    state.message = str(exc)
            return self._serialize(state)

    def _publish(
        self,
        job_id: str,
        *,
        status: str | None = None,
        message: str | None = None,
        artifact: dict[str, Any] | None = None,
        error_message: str | None = None,
    ) -> None:
        with self._lock:
            state = self._jobs[job_id]
            if status:
                state.status = status
            if message is not None:
                state.message = message
            if error_message is not None:
                state.error_message = error_message
            if artifact:
                state.outputs.append(artifact)
            if state.status in JOB_TERMINAL_STATUSES:
                state.elapsed_ms = int((time.monotonic() - state.started_monotonic) * 1000)
                self._mark_terminal_locked(state)
            state.updated_at = _utc_now()

    def _set_remote_task_id(self, job_id: str, remote_task_id: str) -> None:
        with self._lock:
            state = self._jobs[job_id]
            state.remote_task_id = remote_task_id
            state.updated_at = _utc_now()

    def _set_remote_cancel(self, job_id: str, callback: Callable[[str], dict[str, Any]]) -> None:
        with self._lock:
            state = self._jobs[job_id]
            state.cancel_remote = callback

    def _finalize_success(self, job_id: str, result: dict[str, Any]) -> None:
        with self._lock:
            state = self._jobs[job_id]
            if state.cancel_event.is_set() and result.get("status") != JOB_STATUS_SUCCEEDED:
                state.status = JOB_STATUS_CANCELLED
                state.message = "任务已取消"
            else:
                state.status = str(result.get("status") or JOB_STATUS_SUCCEEDED)
                state.message = str(result.get("message") or "任务完成")
            if isinstance(result.get("outputs"), list):
                state.outputs = list(result["outputs"])
            if result.get("error_message"):
                state.error_message = str(result["error_message"])
            result_elapsed_ms = result.get("elapsed_ms")
            if result_elapsed_ms is not None:
                state.elapsed_ms = int(result_elapsed_ms)
            elif state.elapsed_ms is None:
                state.elapsed_ms = int((time.monotonic() - state.started_monotonic) * 1000)
            self._mark_terminal_locked(state)
            state.updated_at = _utc_now()

    def _serialize(self, state: JobState) -> dict[str, Any]:
        elapsed_ms = state.elapsed_ms
        if elapsed_ms is None:
            elapsed_ms = int((time.monotonic() - state.started_monotonic) * 1000)
        return {
            "job_id": state.job_id,
            "kind": state.kind,
            "history_id": state.history_id,
            "status": state.status,
            "message": state.message,
            "created_at": state.created_at,
            "updated_at": state.updated_at,
            "remote_task_id": state.remote_task_id,
            "outputs": list(state.outputs),
            "error_message": state.error_message,
            "elapsed_ms": elapsed_ms,
        }
