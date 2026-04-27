import sys
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock, AsyncMock

# Stub gen_ai_hub before any import that pulls it transitively
_gen_ai_hub_mock = MagicMock()
for _mod in [
    "gen_ai_hub",
    "gen_ai_hub.proxy",
    "gen_ai_hub.proxy.langchain",
    "gen_ai_hub.proxy.langchain.openai",
    "gen_ai_hub.proxy.core",
    "gen_ai_hub.proxy.core.proxy_clients",
]:
    sys.modules.setdefault(_mod, _gen_ai_hub_mock)


@pytest.fixture
def client():
    mock_graph = MagicMock()
    mock_graph.checkpointer = None
    mock_state = MagicMock()
    mock_state.tasks = []
    mock_graph.aget_state = AsyncMock(return_value=mock_state)
    mock_graph.ainvoke = AsyncMock(return_value={
        "messages": [MagicMock(content="3 open deliveries found.")],
    })
    mock_graph.copy = MagicMock(return_value=mock_graph)

    with patch("agents.supervisor.graph", mock_graph), \
         patch("mcp_client.load_mcp_tools", new_callable=AsyncMock, return_value=[]), \
         patch("agents.monitor_agent.run_all_checks"), \
         patch("apscheduler.schedulers.background.BackgroundScheduler"):
        import importlib
        import main as main_mod
        importlib.reload(main_mod)
        with TestClient(main_mod.app) as tc:
            yield tc


def test_health_returns_ok(client):
    with patch("main.ODataClient") as mock_oc:
        mock_oc.return_value._get_token.return_value = "tok"
        mock_oc.return_value.get.return_value = {"value": []}
        resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert "status" in data
    assert "connections" in data
    assert "monitor" in data


def test_chat_returns_reply(client):
    resp = client.post("/chat", json={
        "thread_id": "test-thread",
        "message": "List open deliveries",
        "confirm": None,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "reply" in data
    assert "pending_action" in data
