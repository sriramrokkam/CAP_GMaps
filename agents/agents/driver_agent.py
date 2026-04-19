from langgraph.prebuilt import create_react_agent
from langchain_core.messages import SystemMessage
from tools.driver_tools import list_drivers, list_assignments, get_driver_status, get_live_location, propose_assign_driver, propose_confirm_delivery
from ai_core import get_llm

SYSTEM = SystemMessage(content="""You are the DriverAgent. You manage driver assignments and track GPS locations.
For any write action (assigning a driver, confirming delivery), you MUST use propose_assign_driver or propose_confirm_delivery.
Never call execute functions directly. Always explain your reasoning when proposing an action.""")


def build_driver_agent():
    return create_react_agent(
        get_llm(),
        tools=[list_drivers, list_assignments, get_driver_status, get_live_location, propose_assign_driver, propose_confirm_delivery],
        state_modifier=SYSTEM,
    )
