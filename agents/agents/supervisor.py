import json
from langgraph.graph import StateGraph, END, START
from langchain_core.messages import HumanMessage, AIMessage
from state import AgentState, ActionProposal
from agents.delivery_agent import build_delivery_agent
from agents.driver_agent import build_driver_agent
from agents.route_agent import build_route_agent
from ai_core import get_llm
from langgraph.checkpoint.memory import MemorySaver

ROUTE_PROMPT = """You are a dispatch supervisor. Classify this message into one of: delivery, driver, route, unknown.
Reply with ONLY the single word classification.

Message: {message}"""


def _parse_proposal(text: str) -> ActionProposal | None:
    """Parse PROPOSAL|tool=...|args=...|reasoning=... format from tool output."""
    if "PROPOSAL|" not in text:
        return None
    try:
        parts = dict(p.split("=", 1) for p in text.split("|")[1:])
        return ActionProposal(
            tool=parts["tool"],
            args=json.loads(parts["args"]),
            reasoning=parts["reasoning"],
        )
    except Exception:
        return None


def build_supervisor() -> tuple:
    delivery_agent = build_delivery_agent()
    driver_agent = build_driver_agent()
    route_agent = build_route_agent()
    llm = get_llm()
    memory = MemorySaver()

    def classify(state: AgentState) -> dict:
        last_msg = state["messages"][-1].content if state["messages"] else ""
        resp = llm.invoke(ROUTE_PROMPT.format(message=last_msg))
        return {"_route": resp.content.strip().lower()}

    def route_message(state: AgentState) -> str:
        return state.get("_route", "delivery")

    def run_delivery(state: AgentState) -> dict:
        result = delivery_agent.invoke({"messages": state["messages"]})
        return {"messages": result["messages"]}

    def run_driver(state: AgentState) -> dict:
        result = driver_agent.invoke({"messages": state["messages"]})
        last = result["messages"][-1].content
        proposal = _parse_proposal(last)
        if proposal:
            confirm_msg = (f"I'd like to perform this action:\n\n"
                           f"**{proposal.tool.replace('_', ' ').title()}**\n"
                           f"Reason: {proposal.reasoning}\n\n"
                           f"Confirm? Reply **yes** to proceed or **no** to cancel.")
            return {"messages": [AIMessage(content=confirm_msg)], "pending_action": proposal}
        return {"messages": result["messages"], "pending_action": None}

    def run_route(state: AgentState) -> dict:
        result = route_agent.invoke({"messages": state["messages"]})
        return {"messages": result["messages"]}

    def handle_confirmation(state: AgentState) -> dict:
        if not state.get("pending_action"):
            return {}
        last = state["messages"][-1].content.strip().lower()
        if last in ("yes", "y", "confirm", "ok", "proceed"):
            action = state["pending_action"]
            from tools import driver_tools
            fn = getattr(driver_tools, action.tool, None)
            if fn:
                result = fn(**action.args)
                return {"messages": [AIMessage(content=f"Done. {result}")], "pending_action": None, "confirmed": True}
        return {"messages": [AIMessage(content="Action cancelled.")], "pending_action": None, "confirmed": False}

    def should_confirm(state: AgentState) -> str:
        if state.get("pending_action"):
            return "await_confirm"
        return END

    graph = StateGraph(AgentState)
    graph.add_node("classify", classify)
    graph.add_node("delivery", run_delivery)
    graph.add_node("driver", run_driver)
    graph.add_node("route", run_route)
    graph.add_node("await_confirm", handle_confirmation)

    graph.add_edge(START, "classify")
    graph.add_conditional_edges("classify", route_message, {
        "delivery": "delivery",
        "driver": "driver",
        "route": "route",
        "unknown": "delivery",
    })
    graph.add_conditional_edges("driver", should_confirm, {"await_confirm": "await_confirm", END: END})
    graph.add_edge("delivery", END)
    graph.add_edge("route", END)
    graph.add_edge("await_confirm", END)

    return graph.compile(checkpointer=memory), memory
