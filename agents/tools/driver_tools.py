from langchain_core.tools import tool
from tools.odata_client import ODataClient
from config import settings


_client = ODataClient(settings)


# ── Read tools ──

@tool
def list_drivers() -> str:
    """List all registered drivers."""
    data = _client.get("/odata/v4/tracking/Driver")
    drivers = data.get("value", [])
    if not drivers:
        return "No drivers registered."
    lines = [f"- {d.get('DriverName','?')} | Mobile: {d.get('MobileNumber','?')} | Truck: {d.get('TruckRegistration','?')} | License: {d.get('LicenseNumber','?')} | Active: {d.get('IsActive','?')}" for d in drivers]
    return f"{len(drivers)} drivers:\n" + "\n".join(lines)


@tool
def get_driver_by_mobile(mobile_number: str) -> str:
    """Look up a driver by mobile number. Use the full number including country code (e.g. +919876543210)."""
    data = _client.get("/odata/v4/tracking/Driver", {"$filter": f"MobileNumber eq '{mobile_number}'"})
    drivers = data.get("value", [])
    if not drivers:
        return f"No driver found with mobile {mobile_number}."
    d = drivers[0]
    return (f"Driver: {d.get('DriverName','?')} | ID: {d.get('ID','?')} | Mobile: {d.get('MobileNumber','?')} | "
            f"Truck: {d.get('TruckRegistration','?')} | License: {d.get('LicenseNumber','?')} | Active: {d.get('IsActive','?')}")


@tool
def list_assignments() -> str:
    """List all active driver assignments (not yet delivered). Returns assignment IDs (UUIDs) needed by other tools."""
    data = _client.get("/odata/v4/tracking/DriverAssignment", {"$filter": "Status ne 'DELIVERED'", "$top": "50"})
    assignments = data.get("value", [])
    if not assignments:
        return "No active assignments."
    lines = [f"- ID: {a.get('ID','?')} | {a.get('DriverName','?')} | Delivery: {a.get('DeliveryDocument','?')} | Status: {a.get('Status','?')} | Truck: {a.get('TruckRegistration','?')}" for a in assignments]
    return f"{len(assignments)} active assignments:\n" + "\n".join(lines)


@tool
def get_driver_status(assignment_id: str) -> str:
    """Get full status of a driver assignment including GPS. Pass the assignment UUID from list_assignments()."""
    try:
        data = _client.get(f"/odata/v4/tracking/getAssignment(assignmentId={assignment_id})")
    except Exception as e:
        return f"Could not get assignment: {e}"
    return (f"Driver: {data.get('DriverName','?')} | Status: {data.get('Status','?')} | "
            f"Delivery: {data.get('DeliveryDocument','?')} | Truck: {data.get('TruckRegistration','?')} | "
            f"Assigned: {data.get('AssignedAt','?')} | "
            f"Current GPS: {data.get('CurrentLat','?')}, {data.get('CurrentLng','?')} | "
            f"Speed: {data.get('CurrentSpeed','?')} | Last GPS: {data.get('LastGpsAt','?')}")


@tool
def get_live_location(assignment_id: str) -> str:
    """Get latest GPS location for a driver assignment. Pass the assignment UUID from list_assignments()."""
    try:
        data = _client.get(f"/odata/v4/tracking/latestGps(assignmentId={assignment_id})")
    except Exception as e:
        return f"Could not get location: {e}"
    return (f"Last GPS: Lat {data.get('Latitude','?')}, Lng {data.get('Longitude','?')} | "
            f"Speed: {data.get('Speed','?')} m/s | Updated: {data.get('LastGpsAt','?')}")


# ── Write tools ──

@tool
def create_driver(mobile_number: str, driver_name: str, truck_registration: str, delivery_doc: str) -> str:
    """Register a new driver by assigning them to a delivery. The driver is auto-created if the mobile number is new.
    You MUST provide a delivery document number — use list_open_deliveries() from the delivery agent to find one."""
    try:
        data = _client.post("/odata/v4/tracking/assignDriver", {
            "deliveryDoc": delivery_doc,
            "mobileNumber": mobile_number,
            "truckRegistration": truck_registration,
            "driverName": driver_name,
        })
        return (f"Driver '{driver_name}' created and assigned to delivery {delivery_doc}. "
                f"Assignment ID: {data.get('ID','?')}")
    except Exception as e:
        return f"Could not create driver: {e}"


@tool
def update_driver(driver_id: str, driver_name: str = "", truck_registration: str = "", license_number: str = "", is_active: bool = True) -> str:
    """Update a driver's details. Pass the driver UUID from list_drivers() or get_driver_by_mobile(). Only non-empty fields are updated."""
    patch = {"IsActive": is_active}
    if driver_name:
        patch["DriverName"] = driver_name
    if truck_registration:
        patch["TruckRegistration"] = truck_registration
    if license_number:
        patch["LicenseNumber"] = license_number
    try:
        resp = _client.patch(f"/odata/v4/tracking/Driver({driver_id})", patch)
        return f"Driver {driver_id} updated."
    except Exception as e:
        return f"Could not update driver: {e}"


@tool
def assign_driver(delivery_doc: str, mobile_number: str, truck_registration: str, driver_name: str) -> str:
    """Assign a driver to a delivery. Auto-creates the driver if the mobile number is new. This is a write action."""
    try:
        data = _client.post("/odata/v4/tracking/assignDriver", {
            "deliveryDoc": delivery_doc,
            "mobileNumber": mobile_number,
            "truckRegistration": truck_registration,
            "driverName": driver_name,
        })
        return f"Driver {driver_name} assigned to delivery {delivery_doc}. Assignment ID: {data.get('ID','?')}"
    except Exception as e:
        return f"Could not assign driver: {e}"


@tool
def update_location(assignment_id: str, latitude: float, longitude: float, speed: float = 0, accuracy: float = 10) -> str:
    """Send a GPS location update for an active assignment. Changes status from ASSIGNED to IN_TRANSIT on first call."""
    try:
        data = _client.post("/odata/v4/tracking/updateLocation", {
            "assignmentId": assignment_id,
            "latitude": latitude,
            "longitude": longitude,
            "speed": speed,
            "accuracy": accuracy,
        })
        return f"Location updated for assignment {assignment_id}. Lat: {latitude}, Lng: {longitude}"
    except Exception as e:
        return f"Could not update location: {e}"


@tool
def confirm_delivery(assignment_id: str) -> str:
    """Confirm a delivery as completed. Sets status to DELIVERED and stamps end coordinates. This is a write action."""
    try:
        _client.post("/odata/v4/tracking/confirmDelivery", {"assignmentId": assignment_id})
        return f"Delivery confirmed for assignment {assignment_id}."
    except Exception as e:
        return f"Could not confirm delivery: {e}"


@tool
def get_qr_code(assignment_id: str) -> str:
    """Get QR code data for a driver assignment (for mobile tracking app). Pass the assignment UUID."""
    try:
        data = _client.post("/odata/v4/tracking/getQRCode", {"assignmentId": assignment_id})
        return f"QR Code: {str(data)[:200]}"
    except Exception as e:
        return f"Could not get QR code: {e}"
