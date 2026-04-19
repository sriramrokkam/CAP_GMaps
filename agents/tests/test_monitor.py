from unittest.mock import patch
from datetime import datetime, timezone, timedelta
import agents.monitor_agent  # noqa: F401 — pre-import so patch() can resolve the module


def make_delivery(doc, age_min, has_driver=False):
    created = datetime.now(timezone.utc) - timedelta(minutes=age_min)
    return {
        "DeliveryDocument": doc,
        "createdAt": created.isoformat(),
        "DriverMobile": "+91999" if has_driver else None,
        "ShipToParty": "17100001",
    }


def make_assignment(id_, status, last_gps_min_ago):
    last_gps = datetime.now(timezone.utc) - timedelta(minutes=last_gps_min_ago)
    return {
        "ID": id_,
        "Status": status,
        "DriverName": "Raj",
        "TruckRegistration": "KA01",
        "DeliveryDocument": "80000001",
        "CurrentLat": 12.9,
        "CurrentLng": 77.5,
        "modifiedAt": last_gps.isoformat(),
    }


def test_check_unassigned_threshold_detects_old_deliveries():
    with patch("agents.monitor_agent._client") as mock_client, \
         patch("agents.monitor_agent.post_teams_alert") as mock_alert:
        mock_client.get.return_value = {"value": [make_delivery("80000001", age_min=45, has_driver=False)]}
        from agents.monitor_agent import check_unassigned_deliveries
        # clear cooldown state before test
        import agents.monitor_agent as m
        m._alert_cooldown.clear()
        check_unassigned_deliveries()
        mock_alert.assert_called_once()
        call_args = mock_alert.call_args[0][0]
        assert "80000001" in call_args or "unassigned" in call_args.lower()


def test_check_unassigned_threshold_skips_recent():
    with patch("agents.monitor_agent._client") as mock_client, \
         patch("agents.monitor_agent.post_teams_alert") as mock_alert:
        mock_client.get.return_value = {"value": [make_delivery("80000002", age_min=5, has_driver=False)]}
        from agents.monitor_agent import check_unassigned_deliveries
        import agents.monitor_agent as m
        m._alert_cooldown.clear()
        check_unassigned_deliveries()
        mock_alert.assert_not_called()


def test_check_idle_drivers_fires_for_assigned_no_gps():
    with patch("agents.monitor_agent._client") as mock_client, \
         patch("agents.monitor_agent.post_teams_alert") as mock_alert:
        mock_client.get.return_value = {"value": [make_assignment("id1", "ASSIGNED", last_gps_min_ago=25)]}
        from agents.monitor_agent import check_idle_drivers
        import agents.monitor_agent as m
        m._alert_cooldown.clear()
        check_idle_drivers()
        mock_alert.assert_called_once()
        assert "Raj" in mock_alert.call_args[0][0]
