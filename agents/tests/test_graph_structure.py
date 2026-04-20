from state import AgentState
from typing import get_type_hints


def test_agent_state_has_messages_only():
    hints = get_type_hints(AgentState, include_extras=True)
    assert "messages" in hints
    assert "pending_action" not in hints
    assert "confirmed" not in hints
    assert "_route" not in hints
    assert "thread_id" not in hints
