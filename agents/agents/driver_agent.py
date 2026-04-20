import warnings
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import SystemMessage
from tools.driver_tools import (
    list_drivers, list_assignments, get_driver_status,
    get_live_location, assign_driver, confirm_delivery,
)
from ai_core import get_llm

SYSTEM = SystemMessage(content="""You are the DriverAgent. You manage driver assignments and track GPS locations.
You can assign drivers and confirm deliveries — these write actions will be paused for human confirmation before executing.
Always explain your reasoning when proposing a write action.""")

warnings.filterwarnings("ignore", category=DeprecationWarning)


def build_driver_agent():
    return create_react_agent(
        get_llm(),
        tools=[list_drivers, list_assignments, get_driver_status, get_live_location, assign_driver, confirm_delivery],
        prompt=SYSTEM,
    )
