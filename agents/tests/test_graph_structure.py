from state import AgentState
from typing import get_type_hints


def test_agent_state_has_messages_only():
    hints = get_type_hints(AgentState, include_extras=True)
    assert "messages" in hints
    assert "pending_action" not in hints
    assert "confirmed" not in hints
    assert "_route" not in hints
    assert "thread_id" not in hints


import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)

from unittest.mock import patch, MagicMock


def _make_fake_llm():
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatResult, ChatGeneration

    class FakeLLM(BaseChatModel):
        @property
        def _llm_type(self):
            return "fake"

        def _generate(self, messages, **kwargs):
            return ChatResult(generations=[ChatGeneration(message=AIMessage(content="hi"))])

        def bind_tools(self, tools, **kwargs):
            return self

    return FakeLLM()


@patch("agents.driver_agent.get_llm")
def test_driver_agent_has_tools_node(mock_get_llm):
    mock_get_llm.return_value = _make_fake_llm()
    from agents.driver_agent import build_driver_agent
    agent = build_driver_agent()
    assert "tools" in list(agent.nodes.keys()), "Driver agent must have a 'tools' node"


@patch("agents.driver_agent.get_llm")
@patch("agents.delivery_agent.get_llm")
@patch("agents.route_agent.get_llm")
@patch("agents.supervisor.get_llm")
def test_supervisor_graph_nodes(mock_sup_llm, mock_route_llm, mock_del_llm, mock_drv_llm):
    fake = _make_fake_llm()
    mock_sup_llm.return_value = fake
    mock_route_llm.return_value = fake
    mock_del_llm.return_value = fake
    mock_drv_llm.return_value = fake

    import importlib
    import agents.supervisor as sup_mod
    importlib.reload(sup_mod)
    graph = sup_mod.graph

    node_names = list(graph.nodes.keys())
    assert "classify" in node_names
    assert "delivery" in node_names
    assert "driver" in node_names
    assert "route" in node_names
    assert "await_confirm" not in node_names, "await_confirm should be removed"


@patch("agents.driver_agent.get_llm")
@patch("agents.delivery_agent.get_llm")
@patch("agents.route_agent.get_llm")
@patch("agents.supervisor.get_llm")
def test_supervisor_graph_is_compiled(mock_sup_llm, mock_route_llm, mock_del_llm, mock_drv_llm):
    fake = _make_fake_llm()
    mock_sup_llm.return_value = fake
    mock_route_llm.return_value = fake
    mock_del_llm.return_value = fake
    mock_drv_llm.return_value = fake

    import importlib
    import agents.supervisor as sup_mod
    importlib.reload(sup_mod)

    from langgraph.graph.state import CompiledStateGraph
    assert isinstance(sup_mod.graph, CompiledStateGraph)


def test_supervisor_has_no_build_function():
    import agents.supervisor as sup_mod
    assert not hasattr(sup_mod, "build_supervisor"), "build_supervisor() should be removed"


@patch("agents.route_agent.get_llm")
def test_route_agent_accepts_mcp_tools(mock_get_llm):
    """build_route_agent() should include extra MCP tools when passed."""
    mock_get_llm.return_value = _make_fake_llm()
    from agents.route_agent import build_route_agent
    from langchain_core.tools import tool

    @tool
    def fake_mcp_tool(query: str) -> str:
        """A fake MCP tool for testing."""
        return query

    agent = build_route_agent(mcp_tools=[fake_mcp_tool])
    assert "tools" in list(agent.nodes.keys())


@patch("agents.route_agent.get_llm")
def test_route_agent_works_without_mcp_tools(mock_get_llm):
    """build_route_agent() without args uses only the 4 standard tools."""
    mock_get_llm.return_value = _make_fake_llm()
    from agents.route_agent import build_route_agent
    agent = build_route_agent()
    assert "tools" in list(agent.nodes.keys())


@patch("agents.route_agent.get_llm")
def test_supervisor_set_route_agent_replaces_instance(mock_get_llm):
    """set_route_agent() replaces the module-level _route_agent in supervisor."""
    mock_get_llm.return_value = _make_fake_llm()
    import importlib
    import agents.supervisor as sup_mod
    importlib.reload(sup_mod)

    sentinel = object()
    sup_mod.set_route_agent(sentinel)
    assert sup_mod._route_agent is sentinel
