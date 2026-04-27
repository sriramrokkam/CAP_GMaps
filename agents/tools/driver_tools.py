from langchain_core.tools import tool
from tools.odata_client import ODataClient, build_filter
from tools.teams_tools import post_teams_alert
from config import settings
import os
import math
import httpx


_client = ODataClient(settings)


def _reverse_geocode(lat: float, lng: float) -> str:
    """Return a human-readable address for coordinates, or 'lat,lng' if unavailable."""
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY", "")
    if not api_key or lat is None or lng is None:
        return f"{lat}, {lng}"
    try:
        resp = httpx.get(
            "https://maps.googleapis.com/maps/api/geocode/json",
            params={"latlng": f"{lat},{lng}", "key": api_key},
            timeout=10,
        )
        results = resp.json().get("results", [])
        if results:
            return results[0].get("formatted_address", f"{lat}, {lng}")
    except Exception:
        pass
    return f"{lat}, {lng}"


def _geocode_address(address: str) -> tuple[float, float] | None:
    """Convert a text address to (lat, lng) via Google Geocoding API. Returns None on failure."""
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY", "")
    if not api_key or not address:
        return None
    try:
        resp = httpx.get(
            "https://maps.googleapis.com/maps/api/geocode/json",
            params={"address": address, "key": api_key},
            timeout=10,
        )
        results = resp.json().get("results", [])
        if results:
            loc = results[0]["geometry"]["location"]
            return loc["lat"], loc["lng"]
    except Exception:
        pass
    return None


def _haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Return great-circle distance in metres between two GPS points."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ── Read tools ──

@tool
def list_free_drivers(top: int = 20) -> str:
    """List drivers with no active delivery — i.e. 'free' or 'available' drivers.
    A driver is free if they have no DriverAssignment with Status ASSIGNED or IN_TRANSIT.
    Use this when the user asks for 'free drivers', 'available drivers', or 'idle drivers'."""
    try:
        drivers = _client.get("/odata/v4/tracking/Driver", {
            "$filter": "IsActive eq true",
            "$top": "200",
        }).get("value", [])
        if not drivers:
            return "No active drivers found."

        busy_resp = _client.get("/odata/v4/tracking/DriverAssignment", {
            "$filter": "Status eq 'ASSIGNED' or Status eq 'IN_TRANSIT'",
            "$select": "MobileNumber",
            "$top": "200",
        })
        busy_mobiles = {a["MobileNumber"] for a in busy_resp.get("value", []) if a.get("MobileNumber")}

        free = [d for d in drivers if d.get("MobileNumber") not in busy_mobiles]
        if not free:
            return "All active drivers currently have deliveries assigned."
        free = free[:top]
        lines = []
        for d in free:
            lines.append(
                f"- {d.get('DriverName', '?')} | ID: {d.get('ID', '?')} | "
                f"Mobile: {d.get('MobileNumber', '?')} | Truck: {d.get('TruckRegistration', '?')}"
            )
        return f"{len(free)} free drivers:\n" + "\n".join(lines)
    except Exception as e:
        return f"Could not list free drivers: {e}"


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
    lat = data.get('CurrentLat')
    lng = data.get('CurrentLng')
    location = _reverse_geocode(lat, lng) if lat and lng else "Unknown"
    eta = data.get('EstimatedDuration', '?')
    return (f"Driver: {data.get('DriverName', '?')} | Status: {data.get('Status', '?')} | "
            f"Delivery: {data.get('DeliveryDocument', '?')} | Truck: {data.get('TruckRegistration', '?')} | "
            f"Assigned: {data.get('AssignedAt', '?')} | "
            f"Current Location: {location} | "
            f"Speed: {data.get('CurrentSpeed', '?')} km/h | Last GPS: {data.get('LastGpsAt', '?')} | "
            f"Estimated delivery time remaining: {eta}")


@tool
def get_live_location(assignment_id: str) -> str:
    """Get latest GPS location for a driver assignment. Pass the assignment UUID from list_assignments()."""
    try:
        data = _client.get(f"/odata/v4/tracking/latestGps(assignmentId={assignment_id})")
    except Exception as e:
        return f"Could not get location: {e}"
    lat = data.get('Latitude')
    lng = data.get('Longitude')
    location = _reverse_geocode(lat, lng) if lat and lng else "Unknown"
    return (f"Current Location: {location} | "
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
        # Fetch assignment before confirming to capture current GPS and delivery doc
        assignment_data = _client.get("/odata/v4/tracking/DriverAssignment", {
            "$filter": f"ID eq '{assignment_id}'",
            "$top": "1",
        }).get("value", [])
        current_lat = None
        current_lng = None
        driver_name = "?"
        delivery_doc = "?"
        if assignment_data:
            a = assignment_data[0]
            current_lat = a.get("CurrentLat")
            current_lng = a.get("CurrentLng")
            driver_name = a.get("DriverName", "?")
            delivery_doc = a.get("DeliveryDocument", "?")

        _client.post("/odata/v4/tracking/confirmDelivery", {"assignmentId": assignment_id})
        result = f"Delivery confirmed for assignment {assignment_id}."

        # Geofence check: compare driver's GPS against expected delivery destination
        if current_lat and current_lng and delivery_doc and delivery_doc != "?":
            try:
                route_data = _client.post("/odata/v4/ewm/getDeliveryRoute", {"deliveryDoc": delivery_doc})
                destination = route_data.get("destination", "") if route_data else ""
                coords = _geocode_address(destination) if destination else None
                if coords:
                    dest_lat, dest_lng = coords
                    distance_m = _haversine_meters(current_lat, current_lng, dest_lat, dest_lng)
                    radius = settings.geofence_radius_meters
                    if distance_m > radius:
                        dist_km = distance_m / 1000
                        actual_location = _reverse_geocode(current_lat, current_lng)
                        alert_msg = (
                            f"Driver **{driver_name}** confirmed delivery **{delivery_doc}** "
                            f"at the wrong location.\n\n"
                            f"**Actual location:** {actual_location}\n"
                            f"**Expected destination:** {destination}\n"
                            f"**Distance from expected:** {dist_km:.2f} km "
                            f"(threshold: {radius}m)"
                        )
                        post_teams_alert(alert_msg, title="⚠️ Delivery Location Mismatch")
                        result += (
                            f" ⚠️ Warning: driver was {dist_km:.2f} km from the expected "
                            f"destination ({destination}). A Teams alert has been sent."
                        )
            except Exception:
                pass  # Geofence check is best-effort; never block delivery confirmation

        return result
    except Exception as e:
        return f"Could not confirm delivery: {e}"


@tool
def get_qr_code(delivery_doc: str) -> str:
    """Get QR code image and tracking link for a delivery's active driver assignment.
    Pass the DeliveryDocument number — the tool resolves the active assignment internally.
    Returns a markdown image tag so the QR code is rendered visually."""
    try:
        data = _client.get("/odata/v4/tracking/DriverAssignment", {
            "$filter": f"DeliveryDocument eq '{delivery_doc}' and Status ne 'DELIVERED'",
            "$top": "1",
        })
        assignments = data.get("value", [])
        if not assignments:
            return f"No active assignment found for delivery {delivery_doc}."
        a = assignments[0]
        qr_image = a.get("QRCodeImage", "")
        qr_url = a.get("QRCodeUrl", "")
        if not qr_image and not qr_url:
            return f"Assignment {a['ID']} exists but has no QR code yet."
        absolute_url = f"{settings.cap_base_url}{qr_url}" if qr_url else ""
        result = (f"**QR Code for delivery {delivery_doc}**\n"
                  f"Driver: {a.get('DriverName', '?')} | Assignment: {a['ID']}\n\n")
        if qr_image:
            result += f"![QR Code]({qr_image})\n\n"
        if absolute_url:
            result += f"Tracking link: {absolute_url}"
        return result
    except Exception as e:
        return f"Could not get QR code: {e}"
