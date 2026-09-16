"""Resumable, account-scoped uploads and a single durable local processing queue."""
import json
import logging
import os
from pathlib import Path
import shutil
from threading import Event, RLock, Thread
import time
from uuid import NAMESPACE_URL, uuid5

from fastapi import HTTPException
from pydantic import BaseModel, Field

MAX_AUDIO_BYTES = 2 * 1024 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024
RETENTION_SECONDS = 24 * 60 * 60
SUPPORTED_AUDIO_TYPES = {"audio/aac", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav",
                         "audio/x-m4a", "audio/x-wav", "audio/webm"}
logger = logging.getLogger(__name__)


class RecordingUpload(BaseModel):
    recording_id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")
    total_bytes: int = Field(gt=0, le=MAX_AUDIO_BYTES)
    content_type: str = Field(max_length=100)
    filename: str = Field(default="recording.m4a", max_length=200)
    title: str | None = Field(default=None, max_length=200)
    started_at: str | None = Field(default=None, max_length=100)
    client_duration_seconds: float | None = Field(default=None, ge=0, le=86400)


def recording_key(user_id: str, recording_id: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"mirra:{user_id}:{recording_id}"))


class RecordingJobs:
    # ponytail: one process and one persistent volume. Use shared object storage and a DB lease
    # before running multiple workers/replicas; never point multiple processes at this directory.
    def __init__(self, directory):
        self.root = Path(directory)
        self.lock = RLock()
        self.stop_event = Event()
        self.thread = None
        self.active = None

    def _path(self, key):
        # Keys are generated here, never supplied as a filesystem path by a caller.
        from uuid import UUID
        return self.root / str(UUID(key))

    def _read(self, key, user_id=None):
        try:
            job = json.loads((self._path(key) / "state.json").read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise HTTPException(404, "Recording upload not found. Resume from the saved audio on your device.")
        if user_id is not None and job["user_id"] != user_id:
            raise HTTPException(404, "Recording upload not found.")
        return job

    def _write(self, job):
        folder = self._path(job["id"])
        folder.mkdir(parents=True, exist_ok=True)
        temporary = folder / "state.tmp"
        with temporary.open("w", encoding="utf-8") as target:
            json.dump(job, target)
            target.flush()
            os.fsync(target.fileno())
        temporary.replace(folder / "state.json")

    def _all(self):
        if not self.root.exists():
            return []
        return [self._read(path.parent.name) for path in self.root.glob("*/state.json")]

    def status(self, user_id, key):
        with self.lock:
            job = self._read(key, user_id)
            path = self._path(key) / "audio"
            return {**job, "uploaded_bytes": path.stat().st_size if path.exists() else 0,
                    "chunk_bytes": UPLOAD_CHUNK_BYTES}

    def create(self, user_id, payload: RecordingUpload):
        if payload.content_type not in SUPPORTED_AUDIO_TYPES:
            raise HTTPException(415, "Unsupported audio type")
        key = recording_key(user_id, payload.recording_id)
        with self.lock:
            folder = self._path(key)
            if (folder / "state.json").exists():
                job = self._read(key, user_id)
                if any(job[k] != payload.model_dump()[k] for k in ("total_bytes", "content_type")):
                    raise HTTPException(409, "This recording ID belongs to a different audio file.")
                if job["status"] == "cancelled":
                    raise HTTPException(410, "This recording was discarded.")
                if job["status"] == "failed" and (job.get("error_status") == 402 or
                        job.get("error_status", 0) >= 500 and job["retry_at"] <= time.time()):
                    job.update(status="uploading", attempts=0, updated_at=time.time())
                    self._write(job)
                return self.status(user_id, key)
            jobs = [j for j in self._all() if j["status"] not in ("completed", "cancelled")]
            if sum(j["user_id"] == user_id for j in jobs) >= 4 or sum(j["total_bytes"] for j in jobs) + payload.total_bytes > 8 * MAX_AUDIO_BYTES:
                raise HTTPException(503, "The recording queue is full. Your device will resume uploading later.")
            job = {**payload.model_dump(), "id": key, "user_id": user_id, "status": "uploading",
                   "progress": 0, "attempts": 0, "updated_at": time.time(), "retry_at": 0}
            self._write(job)
            return self.status(user_id, key)

    def append(self, user_id, key, offset, data):
        with self.lock:
            job = self._read(key, user_id)
            if job["status"] != "uploading":
                raise HTTPException(409, "This recording is no longer accepting audio.")
            path = self._path(key) / "audio"
            size = path.stat().st_size if path.exists() else 0
            if offset != size:
                raise HTTPException(409, "Upload position changed. Resume from the saved position.")
            if not data or len(data) > UPLOAD_CHUNK_BYTES or size + len(data) > job["total_bytes"]:
                raise HTTPException(413, "Invalid audio upload chunk.")
            if shutil.disk_usage(self.root).free < len(data) + 64 * 1024 * 1024:
                raise HTTPException(507, "Recording storage is temporarily full. Your audio remains on your device.")
            with path.open("ab") as target:
                try:
                    target.write(data)
                    target.flush()
                    os.fsync(target.fileno())
                except OSError:
                    target.truncate(size)
                    raise
            job["updated_at"] = time.time()
            self._write(job)
            return self.status(user_id, key)

    def enqueue(self, user_id, key):
        with self.lock:
            job = self.status(user_id, key)
            if job["status"] in ("queued", "processing", "completed"):
                return job
            if job["status"] == "cancelled":
                raise HTTPException(410, "This recording was discarded.")
            if job["uploaded_bytes"] != job["total_bytes"]:
                raise HTTPException(409, "The recording upload is not complete.")
            # Permanent media errors need a different source file, not automatic repeated AI calls.
            if job["status"] == "failed":
                raise HTTPException(job["error_status"], job["error"])
            job.update(status="queued", updated_at=time.time())
            self._write(job)
            return job

    def cancel(self, user_id, key):
        with self.lock:
            try:
                job = self._read(key, user_id)
            except HTTPException as exc:
                if exc.status_code == 404:
                    return
                raise
            job.update(status="cancelled", updated_at=time.time())
            self._write(job)
            if self.active != key:
                shutil.rmtree(self._path(key))

    def remove_user(self, user_id):
        with self.lock:
            for job in self._all():
                if job["user_id"] == user_id:
                    self.cancel(user_id, job["id"])

    def export(self, user_id):
        with self.lock:
            return [j for j in self._all() if j["user_id"] == user_id and j["status"] != "cancelled"]

    def process_one(self, process):
        with self.lock:
            jobs = self._all()
            for job in jobs:
                if job["status"] != "processing" and time.time() - job["updated_at"] > RETENTION_SECONDS:
                    shutil.rmtree(self._path(job["id"]))
            job = next((j for j in jobs if j["status"] == "queued" and j["retry_at"] <= time.time()
                        and self._path(j["id"]).exists()), None)
            if not job:
                return False
            self.active = job["id"]
            job.update(status="processing", attempts=job["attempts"] + 1, updated_at=time.time())
            self._write(job)

        def progress(value):
            with self.lock:
                current = self._read(job["id"])
                if current["status"] == "cancelled":
                    raise HTTPException(410, "This recording was discarded.")
                current.update(progress=value, updated_at=time.time())
                self._write(current)

        try:
            process(job, self._path(job["id"]) / "audio", progress)
            with self.lock:
                current = self._read(job["id"])
                if current["status"] != "cancelled":
                    current.update(status="completed", progress=100, updated_at=time.time())
                    self._write(current)
                (self._path(job["id"]) / "audio").unlink(missing_ok=True)
        except Exception as exc:
            with self.lock:
                current = self._read(job["id"])
                if current["status"] != "cancelled":
                    code = exc.status_code if isinstance(exc, HTTPException) else 503
                    retry = code >= 500 and current["attempts"] < 3
                    current.update(status="queued" if retry else "failed", error_status=code,
                                   error=str(exc.detail) if isinstance(exc, HTTPException) else
                                   "Could not finish processing. Your original recording is still saved on your device.",
                                   retry_at=time.time() + (60 * current["attempts"] if retry else 15 * 60),
                                   updated_at=time.time())
                    self._write(current)
                    logger.warning("Recording processing failed (%s)", type(exc).__name__)
        finally:
            with self.lock:
                if self._read(job["id"])["status"] == "cancelled":
                    shutil.rmtree(self._path(job["id"]))
                self.active = None
        return True

    def start(self, process):
        with self.lock:
            if self.thread and self.thread.is_alive():
                return
            self.root.mkdir(parents=True, exist_ok=True)
            for job in self._all():
                for directory in self._path(job["id"]).glob("analysis-*"):
                    if directory.is_dir():
                        shutil.rmtree(directory)
                if job["status"] == "processing":
                    job.update(status="queued", retry_at=0)
                    self._write(job)
                if job["status"] == "completed":
                    (self._path(job["id"]) / "audio").unlink(missing_ok=True)
                if job["status"] == "cancelled":
                    shutil.rmtree(self._path(job["id"]))
            self.stop_event.clear()

        def work():
            while not self.stop_event.is_set():
                try:
                    if self.process_one(process):
                        continue
                except Exception as exc:
                    logger.error("Recording worker failed (%s)", type(exc).__name__)
                self.stop_event.wait(1)

        self.thread = Thread(target=work, name="mirra-recordings", daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=2)
