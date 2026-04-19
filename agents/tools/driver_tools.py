import json
from langchain_core.tools import tool
from tools.odata_client import ODataClient
from config import settings


_client = ODataClient(settings)


@tool
def list_drivers() -> str:
    """List all registered drivers."""
    data = _client.get("/odata/v4/tracking/Driver")
    drivers = data.get("value", [])
    if not drivers:
        return "No drivers registered."
    lines = [f"- {d.get('Name','?')} | Mobile: {d.get('Mobile','?')}" for d in drivers]
    return f"{len(drivers)} drivers:\n" + "\n".join(lines)


@tool
def list_assignments() -> str:
    """List all active driver assignments."""
    data = _client.get("/odata/v4/tracking/DriverAssignment", {"$filter": "Status ne 'DELIVERED'", "$top": "50"})
    assignments = data.get("value", [])
    if not assignments:
        return "No active assignments."
    lines = [f"- {a.get('DriverName','?')} | Delivery: {a.get('DeliveryDocument','?')} | Status: {a.get('Status','?')} | Truck: {a.get('TruckRegistration','?')}" for a in assignments]
    return f"{len(assignments)} active assignments:\n" + "\n".join(lines)


@tool
def get_driver_status(assignment_id: str) -> str:
    """Get full status of a driver assignment by ID."""
    data = _client.get(f"/odata/v4/tracking/getAssignment(assignmentId={assignment_id})")
    return (f"Driver: {data.get('DriverName','?')} | Status: {data.get('Status','?')} | "
            f"Delivery: {data.get('DeliveryDocument','?')} | Truck: {data.get('TruckRegistration','?')} | "
            f"Assigned: {data.get('AssignedAt','?')}")


@tool
def get_live_location(assignment_id: str) -> str:
    """Get latest GPS location for a driver assignment."""
    data = _client.get(f"/odata/v4/tracking/latestGps(assignmentId={assignment_id})")
    return (f"Last GPS: Lat {data.get('Latitude','?')}, Lng {data.get('Longitude','?')} | "
            f"Speed: {data.get('Speed','?')} m/s | Updated: {data.get('LastGpsAt','?')}")


@tool
def propose_assign_driver(delivery_doc: str, mobile_number: str, truck_registration: str, driver_name: str) -> str:
    """Propose assigning a driver to a delivery. Returns a proposal for human confirmation — does NOT execute."""
    return (f"PROPOSAL|tool=execute_assign_driver|"
            f"args={json.dumps({'deliveryDoc': delivery_doc, 'mobileNumber': mobile_number, 'truckRegistration': truck_registration, 'driverName': driver_name})}|"
            f"reasoning=Assign {driver_name} ({truck_registration}) to delivery {delivery_doc}")


@tool
def propose_confirm_delivery(assignment_id: str) -> str:
    """Propose confirming a delivery as completed. Returns a proposal for human confirmation — does NOT execute."""
    return (f"PROPOSAL|tool=execute_confirm_delivery|"
            f"args={json.dumps({'assignmentId': assignment_id})}|"
            f"reasoning=Mark assignment {assignment_id} as DELIVERED")


def execute_assign_driver(delivery_doc: str, mobile_number: str, truck_registration: str, driver_name: str) -> str:
    """Execute driver assignment after human confirmation."""
    data = _client.post("/odata/v4/tracking/assignDriver", {
        "deliveryDoc": delivery_doc,
        "mobileNumber": mobile_number,
        "truckRegistration": truck_registration,
        "driverName": driver_name,
    })
    return f"Driver {driver_name} assigned to delivery {delivery_doc}. Assignment ID: {data.get('ID','?')}"


def execute_confirm_delivery(assignment_id: str) -> str:
    """Execute delivery confirmation after human confirmation."""
    _client.post("/odata/v4/tracking/confirmDelivery", {"assignmentId": assignment_id})
    return f"Delivery confirmed for assignment {assignment_id}."
