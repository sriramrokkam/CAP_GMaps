from typing import Annotated
from dataclasses import dataclass
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


@dataclass
class ActionProposal:
    tool: str
    args: dict
    reasoning: str


class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    thread_id: str
    pending_action: ActionProposal | None
    confirmed: bool | None
    _route: str
