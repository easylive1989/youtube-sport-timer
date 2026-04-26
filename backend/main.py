import logging
import os
import re
import shutil
import time
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)

app = FastAPI()

_allowed_origins = os.getenv(
    "ALLOWED_ORIGINS", "http://127.0.0.1:5500,http://localhost:5500"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

_cache: dict = {}
_cache_times: dict = {}
CACHE_TTL = 600  # seconds


@app.get("/health")
def health():
    return {"status": "ok"}


class AnalyzeRequest(BaseModel):
    url: str


def extract_video_id(url: str) -> str | None:
    patterns = [
        r"(?:v=)([A-Za-z0-9_-]+?)(?:[&\s]|$)",
        r"(?:youtu\.be/)([A-Za-z0-9_-]+?)(?:[?&\s]|$)",
        r"(?:embed/)([A-Za-z0-9_-]+?)(?:[?&\s]|$)",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


@app.post("/analyze")
async def analyze(request: AnalyzeRequest):
    from analyzer import download_audio, detect_beeps

    video_id = extract_video_id(request.url)
    if not video_id:
        raise HTTPException(status_code=422, detail="請輸入有效的 YouTube 網址")

    now = time.time()
    if video_id in _cache and now - _cache_times[video_id] < CACHE_TTL:
        return _cache[video_id]

    try:
        file_path, title, vid_id = download_audio(request.url)
    except Exception:
        raise HTTPException(status_code=422, detail="無法存取此影片，可能為私人或地區限制")

    try:
        beeps = detect_beeps(file_path)
    except Exception:
        raise HTTPException(status_code=500, detail="音頻分析失敗，請稍後再試")
    finally:
        shutil.rmtree(os.path.dirname(file_path), ignore_errors=True)

    result = {"video_id": vid_id, "title": title, "beeps": beeps}
    _cache[video_id] = result
    _cache_times[video_id] = now
    return result
