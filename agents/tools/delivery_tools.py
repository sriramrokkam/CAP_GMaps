from langchain_core.tools import tool
from tools.odata_client import ODataClient, build_filter
from config import settings


_client = ODataClient(settings)

_STATUS_FILTERS = {
    "unassigned": "DriverStatus eq null or DriverStatus eq 'OPEN'",
    "assigned": "DriverStatus eq 'ASSIGNED'",
    "in_transit": "DriverStatus eq 'IN_TRANSIT'",
    "delivered": "DriverStatus eq 'DELIVERED'",
    "open": "DriverStatus eq 'OPEN' or DriverStatus eq null",
}


@tool
def list_deliveries(
    status: str = "",
    route: str = "",
    driver_name: str = "",
    ship_to: str = "",
    goods_mvt_status: str = "",
    billing_status: str = "",
    top: int = 20,
) -> str:
    """List outbound deliveries with optional filters.
    - status: driver/transit status — 'unassigned', 'assigned', 'in_transit', 'delivered', or 'open' (default: open + unassigned)
    - route: filter by ActualDeliveryRoute (e.g. 'TR0002')
    - driver_name: partial match on assigned driver name (e.g. 'Sriram')
    - ship_to: filter by ShipToParty (e.g. '17100001')
    - goods_mvt_status: EWM goods movement incompletion status — 'C' (complete) or '' (incomplete)
    - billing_status: EWM billing incompletion status — 'C' (complete) or '' (incomplete)
    - top: max results (default 20)
    Returns delivery list with document number, ship-to, route, driver status, goods mvt status, and driver name."""
    try:
        filters = []
        if status:
            key = status.lower().replace("-", "_").replace(" ", "_")
            if key in _STATUS_FILTERS:
                filters.append(f"({_STATUS_FILTERS[key]})")
            else:
                return f"Unknown status '{status}'. Valid: {', '.join(_STATUS_FILTERS.keys())}"
        else:
            filters.append(f"({_STATUS_FILTERS['open']})")

        extra = build_filter(
            exact={
                "ActualDeliveryRoute": route or None,
                "ShipToParty": ship_to or None,
                "HdrGoodsMvtIncompletionStatus": goods_mvt_status or None,
                "HeaderBillgIncompletionStatus": billing_status or None,
            },
            contains={"DriverName": driver_name or None},
        )
        if extra:
            filters.append(extra)

        params = {"$filter": " and ".join(filters), "$top": str(top)}
        data = _client.get("/odata/v4/ewm/OutboundDeliveries", params)
        deliveries = data.get("value", [])
        if not deliveries:
            return "No deliveries match the given filters."
        lines = []
        for d in deliveries:
            parts = [
                d["DeliveryDocument"],
                f"Ship-To: {d.get('ShipToParty', '?')}",
                f"Route: {d.get('ActualDeliveryRoute', '?')}",
                f"Driver: {d.get('DriverStatus', 'OPEN')}",
                f"GoodsMvt: {d.get('HdrGoodsMvtIncompletionStatus', '?')}",
            ]
            if d.get("DriverName"):
                parts.append(f"Driver: {d['DriverName']}")
            lines.append("- " + " | ".join(parts))
        return f"{len(deliveries)} deliveries:\n" + "\n".join(lines)
    except Exception as e:
        return f"Could not list deliveries: {e}"


@tool
def get_delivery_items(delivery_doc: str) -> str:
    """Get line items for a specific delivery. Pass the DeliveryDocument number from list_deliveries()."""
    try:
        data = _client.post("/odata/v4/ewm/getDeliveryItems", {"deliveryDoc": delivery_doc})
        items = data.get("value", [])
        if not items:
            return f"No items found for delivery {delivery_doc}."
        lines = [f"- {i.get('Material', '?')} | Qty: {i.get('DeliveryQuantity', '?')} {i.get('DeliveryQuantityUnit', '')}" for i in items]
        return f"Items for {delivery_doc}:\n" + "\n".join(lines)
    except Exception as e:
        return f"Could not get items for {delivery_doc}: {e}"


@tool
def get_delivery_route(delivery_doc: str) -> str:
    """Fetch Google Maps route for a delivery. Pass the DeliveryDocument number from list_deliveries()."""
    try:
        data = _client.post("/odata/v4/ewm/getDeliveryRoute", {"deliveryDoc": delivery_doc})
        if not data:
            return f"No route found for delivery {delivery_doc}."
        return (f"Route for {delivery_doc}: {data.get('origin', '?')} → {data.get('destination', '?')} | "
                f"Distance: {data.get('distance', '?')} | Duration: {data.get('duration', '?')}")
    except Exception as e:
        return f"Could not get route for {delivery_doc}: {e}"
