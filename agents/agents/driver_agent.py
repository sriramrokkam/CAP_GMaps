import warnings
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import SystemMessage
from tools.driver_tools import (
    list_drivers, get_driver_by_mobile, list_assignments, get_driver_status,
    get_live_location, create_driver, update_driver, assign_driver,
    update_location, confirm_delivery, get_qr_code,
)
from ai_core import get_llm

SYSTEM = SystemMessage(content="""You are the DriverAgent. You manage drivers, assignments, and GPS tracking.

You can:
- List/search drivers, create new drivers, update driver details
- Assign drivers to deliveries (auto-creates driver if mobile number is new)
- Track GPS locations, update locations, confirm deliveries
- Generate QR codes for mobile tracking

For write actions (create, update, assign, confirm), always explain what you're about to do before executing.
When assigning a driver, check if they already exist with get_driver_by_mobile() first.""")

warnings.filterwarnings("ignore", category=DeprecationWarning)


def build_driver_agent():
    return create_react_agent(
        get_llm(),
        tools=[
            list_drivers, get_driver_by_mobile, list_assignments, get_driver_status,
            get_live_location, create_driver, update_driver, assign_driver,
            update_location, confirm_delivery, get_qr_code,
        ],
        prompt=SYSTEM,
    )
