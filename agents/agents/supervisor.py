import warnings
from langgraph.graph import StateGraph, END, START
from state import AgentState
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


def classify(state: AgentState) -> dict:
    last_msg = state["messages"][-1].content if state["messages"] else ""
    resp = _llm.invoke(ROUTE_PROMPT.format(message=last_msg))
    return {"messages": [resp]}


def route_message(state: AgentState) -> str:
    last = state["messages"][-1].content.strip().lower() if state["messages"] else ""
    if last in ("delivery", "driver", "route"):
        return last
    return "delivery"


def run_delivery(state: AgentState) -> dict:
    result = _delivery_agent.invoke({"messages": state["messages"]})
    return {"messages": result["messages"]}


def run_driver(state: AgentState) -> dict:
    result = _driver_agent.invoke({"messages": state["messages"]})
    return {"messages": result["messages"]}


def run_route(state: AgentState) -> dict:
    result = _route_agent.invoke({"messages": state["messages"]})
    return {"messages": result["messages"]}


_builder = StateGraph(AgentState)
_builder.add_node("classify", classify)
_builder.add_node("delivery", run_delivery)
_builder.add_node("driver", run_driver)
_builder.add_node("route", run_route)

_builder.add_edge(START, "classify")
_builder.add_conditional_edges("classify", route_message, {
    "delivery": "delivery",
    "driver": "driver",
    "route": "route",
})
_builder.add_edge("delivery", END)
_builder.add_edge("driver", END)
_builder.add_edge("route", END)

graph = _builder.compile()
