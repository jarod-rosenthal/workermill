"""Pytest configuration and fixtures."""

import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

from src.main import app


@pytest.fixture
def client() -> TestClient:
    """Synchronous test client."""
    return TestClient(app)


@pytest.fixture
async def async_client() -> AsyncClient:
    """Asynchronous test client."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client
