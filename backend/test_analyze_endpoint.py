import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient
from main import app, _cache, _cache_times

client = TestClient(app)


@pytest.fixture(autouse=True)
def clear_cache():
    _cache.clear()
    _cache_times.clear()
    yield
    _cache.clear()
    _cache_times.clear()


def test_analyze_returns_beeps():
    with patch("analyzer.download_audio") as mock_dl, patch("analyzer.detect_beeps") as mock_det:
        mock_dl.return_value = ("/tmp/fake/abc123xyz.wav", "Test Video", "abc123xyz")
        mock_det.return_value = [10.5, 25.0, 40.0]

        response = client.post(
            "/analyze", json={"url": "https://www.youtube.com/watch?v=abc123xyz"}
        )

    assert response.status_code == 200
    data = response.json()
    assert data["video_id"] == "abc123xyz"
    assert data["title"] == "Test Video"
    assert data["beeps"] == [10.5, 25.0, 40.0]


def test_analyze_invalid_url():
    response = client.post("/analyze", json={"url": "not-a-url"})
    assert response.status_code == 422
    assert "YouTube" in response.json()["detail"]


def test_analyze_missing_url_field():
    response = client.post("/analyze", json={})
    assert response.status_code == 422


def test_analyze_caches_result():
    with patch("analyzer.download_audio") as mock_dl, patch("analyzer.detect_beeps") as mock_det:
        mock_dl.return_value = ("/tmp/fake/abc123xyz.wav", "Test Video", "abc123xyz")
        mock_det.return_value = [10.5]

        client.post("/analyze", json={"url": "https://youtu.be/abc123xyz"})
        client.post("/analyze", json={"url": "https://youtu.be/abc123xyz"})

    assert mock_dl.call_count == 1


def test_analyze_download_failure_returns_422():
    with patch("analyzer.download_audio") as mock_dl:
        mock_dl.side_effect = Exception("access denied")

        response = client.post(
            "/analyze", json={"url": "https://www.youtube.com/watch?v=abc123xyz"}
        )

    assert response.status_code == 422
    assert "私人" in response.json()["detail"]
