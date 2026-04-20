import warnings
from typing import Annotated
from langgraph.graph import StateGraph, END, START
from langgraph.graph.message import add_messages
from langchain_core.messages import HumanMessage
from typing_extensions import TypedDict
from agents.delivery_agent import build_delivery_agent
from agents.driver_agent import build_driver_agent
from agents.route_agent import build_route_agent
from ai_core import get_llm

warnings.filterwarnings("ignore", category=DeprecationWarning)

ROUTE_PROMPT = """You are a dispatch supervisor. Classify this message into one of: delivery, driver, route, unknown.
Reply with ONLY the single word classification.

Message: {message}"""

_delivery_agent = build_delivery_agent()
_driver_agent = build_driver_agent()
_route_agent = build_route_agent()
_llm = get_llm()


class UserInput(TypedDict):
    """Input schema for LangGraph Studio — type your message here."""
    message: str


class SupervisorState(TypedDict):
    messages: Annotated[list, add_messages]
    message: str


def parse_input(state: SupervisorState) -> dict:
    if state.get("message"):
        return {"messages": [HumanMessage(content=state["message"])]}
    return {}


def classify(state: SupervisorState) -> dict:
    last_msg = state["messages"][-1].content if state["messages"] else ""
    resp = _llm.invoke(ROUTE_PROMPT.format(message=last_msg))
    return {"messages": [resp]}


def route_message(state: SupervisorState) -> str:
    last = state["messages"][-1].content.strip().lower() if state["messages"] else ""
    if last in ("delivery", "driver", "route"):
        return last
    return "delivery"


def _user_messages(state: SupervisorState) -> list:
    return [m for m in state["messages"] if m.type == "human"]


def run_delivery(state: SupervisorState) -> dict:
    msgs = _user_messages(state) or state["messages"][:1]
    result = _delivery_agent.invoke({"messages": msgs})
    return {"messages": result["messages"]}


def run_driver(state: SupervisorState) -> dict:
    msgs = _user_messages(state) or state["messages"][:1]
    result = _driver_agent.invoke({"messages": msgs})
    return {"messages": result["messages"]}


def run_route(state: SupervisorState) -> dict:
    msgs = _user_messages(state) or state["messages"][:1]
    result = _route_agent.invoke({"messages": msgs})
    return {"messages": result["messages"]}


_builder = StateGraph(SupervisorState, input=UserInput)
_builder.add_node("parse_input", parse_input)
_builder.add_node("classify", classify)
_builder.add_node("delivery", run_delivery)
_builder.add_node("driver", run_driver)
_builder.add_node("route", run_route)

_builder.add_edge(START, "parse_input")
_builder.add_edge("parse_input", "classify")
_builder.add_conditional_edges("classify", route_message, {
    "delivery": "delivery",
    "driver": "driver",
    "route": "route",
})
_builder.add_edge("delivery", END)
_builder.add_edge("driver", END)
_builder.add_edge("route", END)

graph = _builder.compile()
