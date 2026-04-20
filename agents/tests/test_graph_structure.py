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
def test_driver_agent_has_interrupt_before_tools(mock_get_llm):
    mock_get_llm.return_value = _make_fake_llm()
    from agents.driver_agent import build_driver_agent
    agent = build_driver_agent()
    assert "tools" in list(agent.nodes.keys()), "Driver agent must have a 'tools' node"
    assert agent.interrupt_before_nodes == ["tools"], (
        f"Driver agent must interrupt before 'tools', got {agent.interrupt_before_nodes}"
    )
