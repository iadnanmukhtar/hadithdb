from __future__ import annotations

import asyncio
import os
import secrets
import shutil
import subprocess
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from .engine import QuranAsrEngine


MAX_AUDIO_BYTES = int(os.getenv("QURAN_ASR_MAX_AUDIO_BYTES", str(8 * 1024 * 1024)))
FFMPEG_TIMEOUT_SECONDS = int(os.getenv("QURAN_ASR_FFMPEG_TIMEOUT_SECONDS", "30"))
LAZY_LOAD = os.getenv("QURAN_ASR_LAZY_LOAD", "").lower() in {"1", "true", "yes"}
SERVICE_TOKEN = os.getenv("QURAN_ASR_TOKEN", "")
engine = QuranAsrEngine()


def authorize(authorization: str | None) -> None:
    if not SERVICE_TOKEN:
        return
    expected = f"Bearer {SERVICE_TOKEN}"
    if not authorization or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Invalid service token.")


async def save_upload(upload: UploadFile, destination: Path) -> int:
    size = 0
    with destination.open("wb") as target:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_AUDIO_BYTES:
                raise HTTPException(status_code=413, detail="Audio recording is too large.")
            target.write(chunk)
    if size == 0:
        raise HTTPException(status_code=400, detail="Audio recording is empty.")
    return size


def convert_to_wav(source: Path, destination: Path) -> None:
    ffmpeg = shutil.which(os.getenv("QURAN_ASR_FFMPEG", "ffmpeg"))
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required to decode browser audio.")
    completed = subprocess.run(
        [
            ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(destination),
        ],
        capture_output=True,
        check=False,
        timeout=FFMPEG_TIMEOUT_SECONDS,
    )
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()
        raise HTTPException(status_code=400, detail=detail or "Audio could not be decoded.")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not LAZY_LOAD:
        await run_in_threadpool(engine.load)
    yield


app = FastAPI(
    title="HadithDB Quran ASR",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "status": "ready" if engine.loaded else "loading_on_first_request",
        "model": engine.model_name,
        "loaded": engine.loaded,
    }


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form("ar"),
    prompt: str = Form(""),
    page: int | None = Form(None),
    model: str = Form(""),
    authorization: str | None = Header(None),
) -> dict[str, object]:
    authorize(authorization)
    if language.lower() != "ar":
        raise HTTPException(status_code=400, detail="Only Arabic Quran recitation is supported.")
    if page is not None and (page < 1 or page > 604):
        raise HTTPException(status_code=400, detail="Mushaf page must be between 1 and 604.")

    suffix = Path(file.filename or "recitation.webm").suffix[:10] or ".webm"
    with tempfile.TemporaryDirectory(prefix="hadithdb-quran-asr-") as temp_dir:
        source = Path(temp_dir) / f"upload{suffix}"
        wav = Path(temp_dir) / "recitation.wav"
        try:
            await save_upload(file, source)
            await run_in_threadpool(convert_to_wav, source, wav)
            text = await run_in_threadpool(engine.transcribe, wav)
        finally:
            await file.close()

    if not text:
        raise HTTPException(status_code=422, detail="No Quran recitation was recognized.")
    return {
        "text": text,
        "language": "ar",
        "page": page,
        "model": engine.model_name,
    }

