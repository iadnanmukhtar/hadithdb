# Self-hosted Quran ASR

This service runs Quran recitation speech recognition locally and exposes the
`POST /transcribe` contract consumed by HadithDB. User recordings are converted
to 16 kHz mono WAV files, transcribed in process, and deleted when the request
finishes. It does not call OpenAI or another per-request AI API.

The default checkpoint is the ungated
[`tarteel-ai/whisper-base-ar-quran`](https://huggingface.co/tarteel-ai/whisper-base-ar-quran),
an Apache 2.0 Quran-specific Whisper model. The more accurate
[`Muno459/fastconformer-quran`](https://huggingface.co/Muno459/fastconformer-quran)
remains supported through the NeMo backend, but its repository owner must
approve your Hugging Face account before it can be downloaded. Model weights
are not committed to this repository.

## Requirements

- Linux with an NVIDIA GPU is recommended. CPU inference is supported but may
  be too slow for interactive traffic.
- Python 3.11 or 3.12.
- `ffmpeg`.
- Enough disk space for the Python environment and approximately 500 MB model.
- A Hugging Face account is not required for the default ungated model.

## Start

Install the isolated service environment:

```sh
cd services/quran-asr
./setup
```

Set a private service token and start the service:

```sh
export QURAN_ASR_TOKEN='replace-with-a-long-random-value'
./run
```

On the first start, Transformers downloads the default checkpoint. After it is
cached, the service requires no model-account traffic.

To use the gated FastConformer after the repository owner approves access,
authenticate with `.venv/bin/hf auth login`, then set:

```sh
export QURAN_ASR_MODEL='Muno459/fastconformer-quran'
export QURAN_ASR_BACKEND='nemo'
```

For an offline production host, download `nemo/fastconformer-quran.nemo`
separately and set `QURAN_ASR_CHECKPOINT` to that local file.

Configure HadithDB's `~/.hadithdb/settings.json` with the matching token:

```json
{
  "quran": {
    "recitationFeedback": {
      "enabled": true,
      "endpoint": "http://127.0.0.1:8010/transcribe",
      "model": "tarteel-ai/whisper-base-ar-quran",
      "token": "replace-with-a-long-random-value"
    }
  }
}
```

Check readiness:

```sh
curl http://127.0.0.1:8010/health
```

The service binds to loopback by default. Keep it private; HadithDB is the
authenticated, rate-limited public gateway.
