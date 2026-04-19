import sys
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

# gen_ai_hub is not installed in the test environment; stub it before any module
# that transitively imports it (agents.supervisor → delivery_agent → ai_core).
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
    mock_graph.invoke.return_value = {
        "messages": [MagicMock(content="3 open deliveries found.")],
        "pending_action": None,
    }
    with patch("agents.supervisor.build_supervisor", return_value=(mock_graph, MagicMock())), \
         patch("agents.monitor_agent.run_all_checks"), \
         patch("tools.teams_tools.post_teams_alert"), \
         patch("apscheduler.schedulers.background.BackgroundScheduler"):
        from main import app
        with TestClient(app) as tc:
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
