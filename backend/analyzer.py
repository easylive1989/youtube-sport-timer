import glob
import os
import tempfile
from typing import Tuple

import librosa
import numpy as np
import yt_dlp


def detect_beeps(audio_path: str) -> list[float]:
    """Return timestamps (seconds) of electronic beeps in an audio file."""
    y, sr = librosa.load(audio_path, sr=22050, mono=True)
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

    # Adaptive energy threshold: 10x the median RMS across all frames
    # This cleanly separates electronic beeps (loud) from background noise
    onset_energies = [
        float(rms[min(int(f), len(rms) - 1)]) for f in onset_frames
    ]
    global_median_rms = float(np.median(rms))
    energy_threshold = max(global_median_rms * 10.0, 1e-6)

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


def download_audio(url: str) -> Tuple[str, str, str]:
    """Download audio from YouTube URL. Returns (file_path, title, video_id)."""
    tmp_dir = tempfile.mkdtemp()
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(tmp_dir, "%(id)s.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        title = info.get("title", "")
        video_id = info.get("id", "")

    files = glob.glob(os.path.join(tmp_dir, f"{video_id}.*"))
    if not files:
        raise FileNotFoundError(f"Downloaded file not found for {video_id}")

    return files[0], title, video_id
