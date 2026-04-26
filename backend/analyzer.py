import logging
import os
import re
import subprocess
import tempfile
from typing import Tuple

import httpx
import librosa
import numpy as np

logger = logging.getLogger(__name__)

PIPED_INSTANCES = [
    "https://api.piped.private.coffee",
    "https://pipedapi.leptons.xyz",
    "https://pipedapi-libre.kavin.rocks",
]

INVIDIOUS_INSTANCES = [
    "https://inv.thepixora.com",
]


def _to_wav(audio_path: str) -> str:
    """Convert audio to WAV so soundfile (not slow audioread) handles loading."""
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

    # Adaptive energy threshold: 3x the median RMS across all frames
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

    # Merge onsets within 300ms (beeps are ~200ms; tail onset can appear up to ~210ms later)
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


def _best_audio_format(formats: list) -> dict:
    audio = [f for f in formats if f.get("type", "").startswith("audio/")]
    if not audio:
        raise ValueError("No audio-only formats found")
    return max(audio, key=lambda f: int(f.get("bitrate", 0)))


def _download_from_piped(video_id: str) -> Tuple[str, str]:
    """Try each Piped instance in order. Returns (audio_path, title)."""
    last_error: Exception = RuntimeError("No instances configured")
    for instance in PIPED_INSTANCES:
        try:
            logger.info("Trying Piped instance: %s", instance)
            with httpx.Client(timeout=15, follow_redirects=True) as client:
                resp = client.get(f"{instance}/streams/{video_id}")
                resp.raise_for_status()
                data = resp.json()

            title = data.get("title", "")
            audio_streams = data.get("audioStreams", [])
            if not audio_streams:
                raise ValueError("No audio streams found")

            best = max(audio_streams, key=lambda s: s.get("bitrate", 0))
            audio_url = best["url"]
            ext = "m4a" if "mp4" in best.get("mimeType", "") else "webm"

            tmp_dir = tempfile.mkdtemp()
            audio_path = os.path.join(tmp_dir, f"{video_id}.{ext}")

            with httpx.stream("GET", audio_url, timeout=120, follow_redirects=True) as r:
                r.raise_for_status()
                with open(audio_path, "wb") as f:
                    for chunk in r.iter_bytes(chunk_size=65536):
                        f.write(chunk)

            logger.info("Downloaded via Piped %s", instance)
            return audio_path, title
        except Exception as e:
            logger.warning("Piped instance %s failed: %s", instance, e)
            last_error = e
            continue

    raise RuntimeError(f"All Piped instances failed: {last_error}")


def _download_from_invidious(video_id: str) -> Tuple[str, str]:
    """Try each Invidious instance in order. Returns (audio_path, title)."""
    last_error: Exception = RuntimeError("No instances configured")
    for instance in INVIDIOUS_INSTANCES:
        try:
            logger.info("Trying Invidious instance: %s", instance)
            with httpx.Client(timeout=15, follow_redirects=True) as client:
                resp = client.get(f"{instance}/api/v1/videos/{video_id}")
                resp.raise_for_status()
                data = resp.json()

            title = data.get("title", "")
            fmt = _best_audio_format(data.get("adaptiveFormats", []))
            audio_url = fmt["url"]
            ext = "m4a" if "mp4" in fmt.get("type", "") else "webm"

            tmp_dir = tempfile.mkdtemp()
            audio_path = os.path.join(tmp_dir, f"{video_id}.{ext}")

            with httpx.stream("GET", audio_url, timeout=120, follow_redirects=True) as r:
                r.raise_for_status()
                with open(audio_path, "wb") as f:
                    for chunk in r.iter_bytes(chunk_size=65536):
                        f.write(chunk)

            logger.info("Downloaded via %s", instance)
            return audio_path, title
        except Exception as e:
            logger.warning("Invidious instance %s failed: %s", instance, e)
            last_error = e
            continue

    raise RuntimeError(f"All Invidious instances failed: {last_error}")


def download_audio(url: str) -> Tuple[str, str, str]:
    """Download audio from YouTube URL. Returns (file_path, title, video_id)."""
    video_id = _extract_video_id(url)

    # Try Piped first (more instances available)
    try:
        audio_path, title = _download_from_piped(video_id)
        return audio_path, title, video_id
    except Exception as e:
        logger.warning("All Piped instances failed, trying Invidious: %s", e)

    # Fallback: Invidious
    audio_path, title = _download_from_invidious(video_id)
    return audio_path, title, video_id
