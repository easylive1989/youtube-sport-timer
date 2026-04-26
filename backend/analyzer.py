import base64
import logging
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Tuple

import librosa
import numpy as np

logger = logging.getLogger(__name__)

def _yt_dlp_bin() -> str:
    # Prefer yt-dlp in the same venv as the running Python interpreter
    candidate = Path(sys.executable).parent / "yt-dlp"
    return str(candidate) if candidate.exists() else "yt-dlp"


def _to_wav(audio_path: str) -> str:
    wav_path = os.path.splitext(audio_path)[0] + '.wav'
    subprocess.run(
        ['ffmpeg', '-i', audio_path, '-ar', '11025', '-ac', '1', '-y', '-loglevel', 'error', wav_path],
        check=True,
    )
    return wav_path


def detect_beeps(audio_path: str) -> list[float]:
    """Return timestamps (seconds) of electronic beeps in an audio file."""
    try:
        wav_path = _to_wav(audio_path)
        y, sr = librosa.load(wav_path, sr=11025, mono=True)
    except Exception:
        y, sr = librosa.load(audio_path, sr=11025, mono=True)
    if len(y) == 0:
        return []

    hop_length = 512
    frame_length = 2048

    onset_frames = librosa.onset.onset_detect(
        y=y, sr=sr, units="frames", hop_length=hop_length
    )
    if len(onset_frames) == 0:
        return []

    onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop_length)

    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
    spectral_centroid = librosa.feature.spectral_centroid(
        y=y, sr=sr, hop_length=hop_length
    )[0]

    onset_energies = [
        float(rms[min(int(f), len(rms) - 1)]) for f in onset_frames
    ]
    global_median_rms = float(np.median(rms))
    energy_threshold = max(global_median_rms * 3.0, 1e-6)

    candidates = []
    for t, frame_idx, energy in zip(onset_times, onset_frames, onset_energies):
        if energy < energy_threshold:
            continue
        centroid = spectral_centroid[min(int(frame_idx), len(spectral_centroid) - 1)]
        if not (400.0 <= centroid <= 4000.0):
            continue
        candidates.append(float(t))

    if not candidates:
        return []

    merged = [candidates[0]]
    for t in candidates[1:]:
        if t - merged[-1] >= 0.3:
            merged.append(t)

    return [round(t, 2) for t in merged]


def _extract_video_id(url: str) -> str:
    match = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", url)
    if not match:
        raise ValueError(f"Cannot extract video ID from: {url}")
    return match.group(1)


def _write_cookies_file(tmp_dir: str) -> str | None:
    """Write YOUTUBE_COOKIES env var (base64-encoded) to a temp cookies.txt."""
    encoded = os.getenv("YOUTUBE_COOKIES", "")
    if not encoded:
        return None
    try:
        cookies_data = base64.b64decode(encoded).decode("utf-8")
        cookies_path = os.path.join(tmp_dir, "cookies.txt")
        with open(cookies_path, "w") as f:
            f.write(cookies_data)
        return cookies_path
    except Exception as e:
        logger.warning("Failed to decode YOUTUBE_COOKIES: %s", e)
        return None


def download_audio(url: str) -> Tuple[str, str, str]:
    """Download audio via yt-dlp. Returns (file_path, title, video_id)."""
    video_id = _extract_video_id(url)
    tmp_dir = tempfile.mkdtemp()
    output_template = os.path.join(tmp_dir, f"{video_id}.%(ext)s")

    cmd = [
        _yt_dlp_bin(),
        "--format", "bestaudio",
        "--output", output_template,
        "--no-playlist",
        "--quiet",
        "--print", "title",
        "--no-simulate",           # newer yt-dlp: --print implies --simulate, override it
        "--js-runtimes", "node",   # YouTube JS challenge solver
        "--remote-components", "ejs:github",
        url,
    ]

    cookies_path = _write_cookies_file(tmp_dir)
    if cookies_path:
        cmd += ["--cookies", cookies_path]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        logger.error("yt-dlp stderr: %s", result.stderr)
        raise RuntimeError(f"yt-dlp failed: {result.stderr[:200]}")

    title = result.stdout.strip().splitlines()[0] if result.stdout.strip() else ""

    # Find the downloaded file
    downloaded = [
        f for f in os.listdir(tmp_dir)
        if f.startswith(video_id) and not f.endswith(".txt")
    ]
    if not downloaded:
        raise RuntimeError("yt-dlp produced no output file")

    audio_path = os.path.join(tmp_dir, downloaded[0])
    return audio_path, title, video_id
