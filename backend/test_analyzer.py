import numpy as np
import soundfile as sf
import tempfile
import os
import pytest
from analyzer import detect_beeps


def make_beep_audio(beep_times, sr=22050, duration=60.0):
    """Generate low-noise audio with 880 Hz sine beeps at given times."""
    audio = np.random.randn(int(sr * duration)) * 0.005
    for t in beep_times:
        start = int(t * sr)
        end = min(start + int(0.2 * sr), len(audio))
        t_arr = np.arange(end - start) / sr
        audio[start:end] += 0.8 * np.sin(2 * np.pi * 880 * t_arr)
    return audio, sr


@pytest.fixture
def beep_file(tmp_path):
    """Write a WAV file with beeps at 10s, 25s, 40s."""
    audio, sr = make_beep_audio([10.0, 25.0, 40.0])
    path = str(tmp_path / "beeps.wav")
    sf.write(path, audio, sr)
    return path


def test_detects_three_beeps(beep_file):
    result = detect_beeps(beep_file)
    assert len(result) == 3


def test_beep_times_within_half_second(beep_file):
    result = detect_beeps(beep_file)
    for expected, got in zip([10.0, 25.0, 40.0], sorted(result)):
        assert abs(expected - got) < 0.5


def test_returns_empty_for_silence(tmp_path):
    sr = 22050
    silence = np.zeros(sr * 10)
    path = str(tmp_path / "silence.wav")
    sf.write(path, silence, sr)
    assert detect_beeps(path) == []


def test_returns_floats(beep_file):
    result = detect_beeps(beep_file)
    assert all(isinstance(t, float) for t in result)
