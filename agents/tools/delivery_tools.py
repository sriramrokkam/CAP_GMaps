from langchain_core.tools import tool
from tools.odata_client import ODataClient
from config import settings


_client = ODataClient(settings)


@tool
def list_open_deliveries() -> str:
    """List all open outbound deliveries from EWM."""
    data = _client.get("/odata/v4/ewm/OutboundDeliveries", {"$filter": "DriverStatus eq 'OPEN' or DriverStatus eq null", "$top": "50"})
    deliveries = data.get("value", [])
    if not deliveries:
        return "No open deliveries found."
    lines = [f"- {d['DeliveryDocument']} | Ship-To: {d.get('ShipToParty','?')} | Route: {d.get('ActualDeliveryRoute','?')}" for d in deliveries]
    return f"{len(deliveries)} open deliveries:\n" + "\n".join(lines)


@tool
def list_unassigned_deliveries() -> str:
    """List open deliveries with no driver assigned."""
    data = _client.get("/odata/v4/ewm/OutboundDeliveries", {"$filter": "DriverStatus eq null or DriverStatus eq 'OPEN'", "$top": "50"})
    deliveries = [d for d in data.get("value", []) if not d.get("DriverMobile")]
    if not deliveries:
        return "All deliveries have drivers assigned."
    lines = [f"- {d['DeliveryDocument']} | Ship-To: {d.get('ShipToParty','?')} | Date: {d.get('DeliveryDate','?')}" for d in deliveries]
    return f"{len(deliveries)} unassigned deliveries:\n" + "\n".join(lines)


@tool
def get_delivery_items(delivery_doc: str) -> str:
    """Get line items for a specific delivery. Pass the DeliveryDocument number from list_open_deliveries()."""
    data = _client.post("/odata/v4/ewm/getDeliveryItems", {"deliveryDoc": delivery_doc})
    items = data.get("value", [])
    if not items:
        return f"No items found for delivery {delivery_doc}."
    lines = [f"- {i.get('Material','?')} | Qty: {i.get('DeliveryQuantity','?')} {i.get('DeliveryQuantityUnit','')}" for i in items]
    return f"Items for {delivery_doc}:\n" + "\n".join(lines)


@tool
def get_delivery_route(delivery_doc: str) -> str:
    """Fetch Google Maps route for a delivery. Pass the DeliveryDocument number from list_open_deliveries()."""
    data = _client.post("/odata/v4/ewm/getDeliveryRoute", {"deliveryDoc": delivery_doc})
    if not data:
        return f"No route found for delivery {delivery_doc}."
    return f"Route for {delivery_doc}: {data.get('origin','?')} → {data.get('destination','?')} | Distance: {data.get('distance','?')} | Duration: {data.get('duration','?')}"
