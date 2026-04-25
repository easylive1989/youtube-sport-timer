from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_health_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

def test_cors_header_present():
    # Default ALLOWED_ORIGINS includes localhost:5500 for local dev
    response = client.get(
        "/health",
        headers={"Origin": "http://localhost:5500"},
    )
    assert "access-control-allow-origin" in response.headers
