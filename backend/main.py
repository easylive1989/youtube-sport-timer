import logging
import os
import shutil
import tempfile
import time
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)

app = FastAPI()

_allowed_origins = os.getenv(
    "ALLOWED_ORIGINS", "http://127.0.0.1:5500,http://localhost:5500"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_cache: dict = {}
_cache_times: dict = {}
CACHE_TTL = 600  # seconds


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(
    video_id: str = Form(...),
    title: str = Form(""),
    audio: UploadFile = File(...),
):
    from analyzer import detect_beeps

    now = time.time()
    if video_id in _cache and now - _cache_times[video_id] < CACHE_TTL:
        return _cache[video_id]

    tmp_dir = tempfile.mkdtemp()
    suffix = os.path.splitext(audio.filename or "")[1] or ".webm"
    audio_path = os.path.join(tmp_dir, f"{video_id}{suffix}")

    try:
        with open(audio_path, "wb") as f:
            f.write(await audio.read())

        beeps = detect_beeps(audio_path)
    except Exception:
        raise HTTPException(status_code=500, detail="音頻分析失敗，請稍後再試")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    result = {"video_id": video_id, "title": title, "beeps": beeps}
    _cache[video_id] = result
    _cache_times[video_id] = now
    return result
