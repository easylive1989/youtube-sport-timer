import json
import logging
import os
import shutil
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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

CACHE_DIR = Path(os.getenv("CACHE_DIR", "/opt/app/cache"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _cache_get(video_id: str) -> dict | None:
    path = CACHE_DIR / f"{video_id}.json"
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            path.unlink(missing_ok=True)
    return None


def _cache_set(video_id: str, result: dict) -> None:
    path = CACHE_DIR / f"{video_id}.json"
    path.write_text(json.dumps(result))


class AnalyzeRequest(BaseModel):
    url: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(req: AnalyzeRequest):
    from analyzer import download_audio, detect_beeps, _extract_video_id

    try:
        video_id = _extract_video_id(req.url)
    except ValueError:
        raise HTTPException(status_code=400, detail="無效的 YouTube 網址")

    cached = _cache_get(video_id)
    if cached:
        logger.info("Cache hit: %s", video_id)
        return cached

    tmp_dir = None
    try:
        audio_path, title, video_id = download_audio(req.url)
        tmp_dir = os.path.dirname(audio_path)
        beeps = detect_beeps(audio_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"分析失敗：{str(e)[:100]}")
    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    result = {"video_id": video_id, "title": title, "beeps": beeps}
    _cache_set(video_id, result)
    logger.info("Cached %d beeps for %s", len(beeps), video_id)
    return result
