from langgraph.prebuilt import create_react_agent
from langchain_core.messages import SystemMessage
from tools.delivery_tools import list_open_deliveries, list_unassigned_deliveries, get_delivery_items, get_delivery_route
from ai_core import get_llm

SYSTEM = SystemMessage(content="""You are the DeliveryAgent. You answer questions about EWM outbound deliveries.
Use the available tools to list open deliveries, show delivery items, and fetch route information.
Be concise. Format lists clearly. Never make up delivery document numbers.""")


def build_delivery_agent():
    return create_react_agent(
        get_llm(),
        tools=[list_open_deliveries, list_unassigned_deliveries, get_delivery_items, get_delivery_route],
        state_modifier=SYSTEM,
    )
