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

ROUTE_PROMPT = """You are a dispatch supervisor. Classify the LATEST message into exactly one of: delivery, driver, route.
Reply with ONLY the single word classification, nothing else.

Rules:
- driver: assign a driver, QR code, confirm delivery, driver location/status, free drivers, available drivers, list drivers, update driver, track assignment
- route: directions, Google Maps route, distance, how far, navigate, route steps
- delivery: everything else — list deliveries, delivery items, delivery details, filter by status/route/ship-to

If the latest message is a short follow-up ("yes", "yes please", "ok", "go ahead", "sure"), use the context of prior messages to determine the topic.

Examples:
"assign delivery 80000015 to Sriram" → driver
"can you assign the delivery to Driver Sriram?" → driver
"QR code for delivery 80000010" → driver
"confirm delivery 80000015" → driver
"free drivers" → driver
"drivers free now" → driver
"give me the drivers free now" → driver
"who is available to drive?" → driver
"where is driver Sriram?" → driver
"list unassigned deliveries" → delivery
"show deliveries on route TR0002" → delivery
"get route for delivery 80000010" → route
"directions from warehouse to customer" → route

Conversation context (last few messages):
{context}

Latest message: {message}"""

_delivery_agent = build_delivery_agent()
_driver_agent = build_driver_agent()
_route_agent = build_route_agent()
_llm = get_llm()


def set_route_agent(agent) -> None:
    """Replace the route agent with one that has MCP tools loaded. Called from main.py lifespan."""
    global _route_agent
    _route_agent = agent


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
    human_msgs = [m for m in state["messages"] if m.type == "human"]
    last_msg = human_msgs[-1].content if human_msgs else ""
    # Pass up to 3 prior human messages as context for short follow-ups
    prior = human_msgs[-11:-1] if len(human_msgs) > 1 else []
    context = "\n".join(f"- {m.content}" for m in prior) if prior else "(none)"
    resp = _llm.invoke(ROUTE_PROMPT.format(message=last_msg, context=context))
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


async def run_route(state: SupervisorState) -> dict:
    msgs = _user_messages(state) or state["messages"][:1]
    result = await _route_agent.ainvoke({"messages": msgs})
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
