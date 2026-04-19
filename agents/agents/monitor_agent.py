from datetime import datetime, timezone, timedelta
from tools.odata_client import ODataClient
from tools.teams_tools import post_teams_alert
from config import settings


_client = ODataClient(settings)
_alert_cooldown: dict[tuple, datetime] = {}
_COOLDOWN_MIN = 30


def _should_alert(key: tuple) -> bool:
    last = _alert_cooldown.get(key)
    if last and datetime.now(timezone.utc) - last < timedelta(minutes=_COOLDOWN_MIN):
        return False
    _alert_cooldown[key] = datetime.now(timezone.utc)
    return True


def check_unassigned_deliveries():
    data = _client.get("/odata/v4/ewm/OutboundDeliveries", {"$filter": "DriverStatus eq null or DriverStatus eq 'OPEN'", "$top": "50"})
    threshold = timedelta(minutes=settings.unassigned_threshold_min)
    now = datetime.now(timezone.utc)
    old = []
    for d in data.get("value", []):
        if d.get("DriverMobile"):
            continue
        created_str = d.get("createdAt", "")
        try:
            created = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
            age = now - created
            if age > threshold:
                old.append((d["DeliveryDocument"], int(age.total_seconds() // 60)))
        except Exception:
            continue
    if not old:
        return
    key = ("unassigned", tuple(d for d, _ in old))
    if not _should_alert(key):
        return
    oldest_min = max(m for _, m in old)
    msg = f"📦 {len(old)} deliveries unassigned — oldest waiting {oldest_min} min. Docs: {', '.join(d for d, _ in old)}"
    post_teams_alert(msg, title="Unassigned Deliveries")


def check_idle_drivers():
    data = _client.get("/odata/v4/tracking/DriverAssignment", {"$filter": "Status eq 'ASSIGNED'", "$top": "50"})
    threshold = timedelta(minutes=settings.idle_threshold_min)
    now = datetime.now(timezone.utc)
    for a in data.get("value", []):
        modified_str = a.get("modifiedAt", "")
        try:
            modified = datetime.fromisoformat(modified_str.replace("Z", "+00:00"))
            idle_min = int((now - modified).total_seconds() // 60)
            if idle_min < settings.idle_threshold_min:
                continue
        except Exception:
            continue
        key = ("idle", a["ID"])
        if not _should_alert(key):
            continue
        msg = (f"🚛 Driver {a.get('DriverName','?')} ({a.get('TruckRegistration','?')}) "
               f"assigned but not moving for {idle_min} min — delivery {a.get('DeliveryDocument','?')}")
        post_teams_alert(msg, title="Idle Driver Alert")


def check_batch_opportunities():
    data = _client.get("/odata/v4/ewm/OutboundDeliveries", {"$filter": "DriverStatus eq null or DriverStatus eq 'OPEN'", "$top": "50"})
    zone_map: dict[str, list[str]] = {}
    for d in data.get("value", []):
        if d.get("DriverMobile"):
            continue
        zone = d.get("ShipToParty", "UNKNOWN")
        zone_map.setdefault(zone, []).append(d["DeliveryDocument"])
    for zone, docs in zone_map.items():
        if len(docs) < 2:
            continue
        key = ("batch", zone)
        if not _should_alert(key):
            continue
        msg = f"📍 {len(docs)} deliveries for ship-to {zone} — consider assigning same driver: {', '.join(docs)}"
        post_teams_alert(msg, title="Batch Opportunity")


def run_all_checks():
    for check in [check_unassigned_deliveries, check_idle_drivers, check_batch_opportunities]:
        try:
            check()
        except Exception as e:
            print(f"Monitor check {check.__name__} failed: {e}")
