from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any


DEFAULT_MODEL = "tarteel-ai/whisper-base-ar-quran"


def transcript_text(result: Any) -> str:
    """Normalize the response shapes returned by supported NeMo versions."""
    if isinstance(result, tuple):
        result = result[0]
    if isinstance(result, (list, tuple)):
        result = result[0] if result else ""
    if hasattr(result, "text"):
        result = result.text
    return str(result or "").strip()


class QuranAsrEngine:
    def __init__(self) -> None:
        self.model_name = os.getenv("QURAN_ASR_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
        self.checkpoint = os.getenv("QURAN_ASR_CHECKPOINT", "").strip()
        self.backend = os.getenv("QURAN_ASR_BACKEND", "auto").strip().lower() or "auto"
        self._model: Any = None
        self._load_lock = threading.Lock()
        self._inference_lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        if self._model is not None:
            return
        with self._load_lock:
            if self._model is not None:
                return
            backend = self.backend
            if backend == "auto":
                backend = "nemo" if self.model_name == "Muno459/fastconformer-quran" or self.checkpoint.endswith(".nemo") else "transformers"
            if backend == "nemo":
                self._model = self._load_nemo()
            elif backend == "transformers":
                self._model = self._load_transformers()
            else:
                raise RuntimeError(f"Unsupported QURAN_ASR_BACKEND: {backend}")
            self.backend = backend

    def _load_nemo(self) -> Any:
        import torch
        from nemo.collections.asr.models import ASRModel

        if self.checkpoint:
            checkpoint = Path(self.checkpoint).expanduser().resolve()
            if not checkpoint.is_file():
                raise RuntimeError(f"QURAN_ASR_CHECKPOINT was not found: {checkpoint}")
            model = ASRModel.restore_from(restore_path=str(checkpoint), map_location="cpu")
        else:
            model = ASRModel.from_pretrained(model_name=self.model_name, map_location="cpu")
        if torch.cuda.is_available():
            model = model.cuda()
        model.eval()
        return model

    def _load_transformers(self) -> Any:
        from transformers import pipeline

        source = self.model_name
        if self.checkpoint:
            checkpoint = Path(self.checkpoint).expanduser().resolve()
            if not checkpoint.exists():
                raise RuntimeError(f"QURAN_ASR_CHECKPOINT was not found: {checkpoint}")
            source = str(checkpoint)
        return pipeline(
            "automatic-speech-recognition",
            model=source,
            device=-1,
        )

    def transcribe(self, wav_path: Path) -> str:
        self.load()
        with self._inference_lock:
            with __import__("torch").inference_mode():
                if self.backend == "nemo":
                    result = self._model.transcribe(audio=[str(wav_path)], batch_size=1)
                else:
                    result = self._model(str(wav_path))
                    if isinstance(result, dict):
                        result = result.get("text", "")
        return transcript_text(result)
