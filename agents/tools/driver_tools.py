from langchain_core.tools import tool
from tools.odata_client import ODataClient, build_filter
from config import settings


_client = ODataClient(settings)


# ── Read tools ──

@tool
def list_drivers(
    name: str = "",
    mobile: str = "",
    is_active: bool | None = None,
    top: int = 20,
) -> str:
    """List registered drivers with optional filters.
    - name: partial match on driver name (e.g. 'Sriram')
    - mobile: exact or partial match on mobile number (e.g. '+919876543210')
    - is_active: true for active drivers, false for inactive, omit for all
    - top: max results (default 20)
    Returns driver list with name, mobile, truck, license, active status, and driver ID."""
    try:
        f = build_filter(
            exact={"IsActive": is_active},
            contains={"DriverName": name or None, "MobileNumber": mobile or None},
        )
        params = {"$top": str(top)}
        if f:
            params["$filter"] = f
        data = _client.get("/odata/v4/tracking/Driver", params)
        drivers = data.get("value", [])
        if not drivers:
            return "No drivers match the given filters."
        lines = []
        for d in drivers:
            lines.append(
                f"- {d.get('DriverName', '?')} | ID: {d.get('ID', '?')} | "
                f"Mobile: {d.get('MobileNumber', '?')} | Truck: {d.get('TruckRegistration', '?')} | "
                f"License: {d.get('LicenseNumber', '?')} | Active: {d.get('IsActive', '?')}"
            )
        return f"{len(drivers)} drivers:\n" + "\n".join(lines)
    except Exception as e:
        return f"Could not list drivers: {e}"


@tool
def list_assignments(
    status: str = "",
    driver_name: str = "",
    delivery_doc: str = "",
    top: int = 20,
) -> str:
    """List driver assignments with optional filters.
    - status: 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', or empty for all active (non-delivered)
    - driver_name: partial match on driver name
    - delivery_doc: exact match on delivery document number
    - top: max results (default 20)
    Returns assignment IDs (UUIDs) needed by get_driver_status, get_live_location, update_location, confirm_delivery.
    'ASSIGNED' status means idle/waiting drivers. 'IN_TRANSIT' means currently driving."""
    try:
        filters = []
        if status:
            filters.append(f"Status eq '{status.upper()}'")
        else:
            filters.append("Status ne 'DELIVERED'")

        extra = build_filter(
            exact={"DeliveryDocument": delivery_doc or None},
            contains={"DriverName": driver_name or None},
        )
        if extra:
            filters.append(extra)

        params = {"$filter": " and ".join(filters), "$top": str(top)}
        data = _client.get("/odata/v4/tracking/DriverAssignment", params)
        assignments = data.get("value", [])
        if not assignments:
            return "No assignments match the given filters."
        lines = []
        for a in assignments:
            lines.append(
                f"- ID: {a.get('ID', '?')} | {a.get('DriverName', '?')} | "
                f"Delivery: {a.get('DeliveryDocument', '?')} | Status: {a.get('Status', '?')} | "
                f"Truck: {a.get('TruckRegistration', '?')}"
            )
        return f"{len(assignments)} assignments:\n" + "\n".join(lines)
    except Exception as e:
        return f"Could not list assignments: {e}"


@tool
def get_driver_status(assignment_id: str) -> str:
    """Get full status of a driver assignment including GPS. Pass the assignment UUID from list_assignments()."""
    try:
        data = _client.get(f"/odata/v4/tracking/getAssignment(assignmentId={assignment_id})")
    except Exception as e:
        return f"Could not get assignment: {e}"
    return (f"Driver: {data.get('DriverName', '?')} | Status: {data.get('Status', '?')} | "
            f"Delivery: {data.get('DeliveryDocument', '?')} | Truck: {data.get('TruckRegistration', '?')} | "
            f"Assigned: {data.get('AssignedAt', '?')} | "
            f"Current GPS: {data.get('CurrentLat', '?')}, {data.get('CurrentLng', '?')} | "
            f"Speed: {data.get('CurrentSpeed', '?')} | Last GPS: {data.get('LastGpsAt', '?')}")


@tool
def get_live_location(assignment_id: str) -> str:
    """Get latest GPS location for a driver assignment. Pass the assignment UUID from list_assignments()."""
    try:
        data = _client.get(f"/odata/v4/tracking/latestGps(assignmentId={assignment_id})")
    except Exception as e:
        return f"Could not get location: {e}"
    return (f"Last GPS: Lat {data.get('Latitude', '?')}, Lng {data.get('Longitude', '?')} | "
            f"Speed: {data.get('Speed', '?')} m/s | Updated: {data.get('LastGpsAt', '?')}")


# ── Write tools ──

@tool
def update_driver(driver_id: str, driver_name: str = "", truck_registration: str = "", license_number: str = "", is_active: bool = True) -> str:
    """Update a driver's details. Pass the driver UUID from list_drivers(). Only non-empty fields are updated."""
    patch = {"IsActive": is_active}
    if driver_name:
        patch["DriverName"] = driver_name
    if truck_registration:
        patch["TruckRegistration"] = truck_registration
    if license_number:
        patch["LicenseNumber"] = license_number
    try:
        _client.patch(f"/odata/v4/tracking/Driver({driver_id})", patch)
        return f"Driver {driver_id} updated."
    except Exception as e:
        return f"Could not update driver: {e}"


@tool
def assign_driver(delivery_doc: str, mobile_number: str, truck_registration: str, driver_name: str) -> str:
    """Assign a driver to a delivery. Auto-creates the driver if the mobile number is new. This is a write action.
    Use list_drivers() to check if driver exists first. Use list_deliveries(status='unassigned') to find deliveries needing a driver."""
    try:
        data = _client.post("/odata/v4/tracking/assignDriver", {
            "deliveryDoc": delivery_doc,
            "mobileNumber": mobile_number,
            "truckRegistration": truck_registration,
            "driverName": driver_name,
        })
        return f"Driver {driver_name} assigned to delivery {delivery_doc}. Assignment ID: {data.get('ID', '?')}"
    except Exception as e:
        return f"Could not assign driver: {e}"


@tool
def update_location(assignment_id: str, latitude: float, longitude: float, speed: float = 0, accuracy: float = 10) -> str:
    """Send a GPS location update for an active assignment. Changes status from ASSIGNED to IN_TRANSIT on first call."""
    try:
        _client.post("/odata/v4/tracking/updateLocation", {
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
def get_qr_code(delivery_doc: str) -> str:
    """Get QR code data for a delivery's active driver assignment (for mobile tracking app).
    Pass the DeliveryDocument number — the tool resolves the active assignment internally."""
    try:
        data = _client.get("/odata/v4/tracking/DriverAssignment", {
            "$filter": f"DeliveryDocument eq '{delivery_doc}' and Status ne 'DELIVERED'",
            "$top": "1",
        })
        assignments = data.get("value", [])
        if not assignments:
            return f"No active assignment found for delivery {delivery_doc}."
        assignment_id = assignments[0]["ID"]
        qr = _client.post("/odata/v4/tracking/getQRCode", {"assignmentId": assignment_id})
        return f"QR Code for delivery {delivery_doc} (assignment {assignment_id}): {str(qr)[:200]}"
    except Exception as e:
        return f"Could not get QR code: {e}"
