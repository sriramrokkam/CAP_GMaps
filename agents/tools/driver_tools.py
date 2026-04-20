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
    """List all active driver assignments. Returns assignment IDs (UUIDs) needed by other tools."""
    data = _client.get("/odata/v4/tracking/DriverAssignment", {"$filter": "Status ne 'DELIVERED'", "$top": "50"})
    assignments = data.get("value", [])
    if not assignments:
        return "No active assignments."
    lines = [f"- ID: {a.get('ID','?')} | {a.get('DriverName','?')} | Delivery: {a.get('DeliveryDocument','?')} | Status: {a.get('Status','?')} | Truck: {a.get('TruckRegistration','?')}" for a in assignments]
    return f"{len(assignments)} active assignments:\n" + "\n".join(lines)


@tool
def get_driver_status(assignment_id: str) -> str:
    """Get full status of a driver assignment. Pass the assignment UUID from list_assignments()."""
    data = _client.get(f"/odata/v4/tracking/getAssignment(assignmentId={assignment_id})")
    return (f"Driver: {data.get('DriverName','?')} | Status: {data.get('Status','?')} | "
            f"Delivery: {data.get('DeliveryDocument','?')} | Truck: {data.get('TruckRegistration','?')} | "
            f"Assigned: {data.get('AssignedAt','?')}")


@tool
def get_live_location(assignment_id: str) -> str:
    """Get latest GPS location for a driver assignment. Pass the assignment UUID from list_assignments()."""
    data = _client.get(f"/odata/v4/tracking/latestGps(assignmentId={assignment_id})")
    return (f"Last GPS: Lat {data.get('Latitude','?')}, Lng {data.get('Longitude','?')} | "
            f"Speed: {data.get('Speed','?')} m/s | Updated: {data.get('LastGpsAt','?')}")


@tool
def assign_driver(delivery_doc: str, mobile_number: str, truck_registration: str, driver_name: str) -> str:
    """Assign a driver to a delivery. This is a write action — the graph will pause for human confirmation before executing."""
    data = _client.post("/odata/v4/tracking/assignDriver", {
        "deliveryDoc": delivery_doc,
        "mobileNumber": mobile_number,
        "truckRegistration": truck_registration,
        "driverName": driver_name,
    })
    return f"Driver {driver_name} assigned to delivery {delivery_doc}. Assignment ID: {data.get('ID','?')}"


@tool
def confirm_delivery(assignment_id: str) -> str:
    """Confirm a delivery as completed. This is a write action — the graph will pause for human confirmation before executing."""
    _client.post("/odata/v4/tracking/confirmDelivery", {"assignmentId": assignment_id})
    return f"Delivery confirmed for assignment {assignment_id}."
