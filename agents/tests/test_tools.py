import pytest
import respx
import httpx
from unittest.mock import MagicMock, patch


def test_list_open_deliveries_returns_list():
    with patch("tools.delivery_tools._client") as mock_client:
        mock_client.get.return_value = {"value": [{"DeliveryDocument": "80000001", "DriverStatus": "OPEN"}]}
        from tools.delivery_tools import list_open_deliveries
        result = list_open_deliveries.invoke({})
        assert "80000001" in result


def test_list_unassigned_deliveries_filters_correctly():
    with patch("tools.delivery_tools._client") as mock_client:
        mock_client.get.return_value = {"value": [{"DeliveryDocument": "80000002"}]}
        from tools.delivery_tools import list_unassigned_deliveries
        result = list_unassigned_deliveries.invoke({})
        assert "80000002" in result


def test_get_delivery_items_returns_items():
    with patch("tools.delivery_tools._client") as mock_client:
        mock_client.post.return_value = {"value": [{"Material": "MAT001", "DeliveryQuantity": 10}]}
        from tools.delivery_tools import get_delivery_items
        result = get_delivery_items.invoke({"delivery_doc": "80000001"})
        assert "MAT001" in result


def test_list_drivers_returns_names():
    with patch("tools.driver_tools._client") as mock_client:
        mock_client.get.return_value = {"value": [{"ID": "d1", "Name": "Raj Kumar", "Mobile": "+91999"}]}
        from tools.driver_tools import list_drivers
        result = list_drivers.invoke({})
        assert "Raj Kumar" in result


def test_get_driver_status_returns_status():
    with patch("tools.driver_tools._client") as mock_client:
        mock_client.get.return_value = {"Status": "IN_TRANSIT", "DeliveryDocument": "80000001", "DriverName": "Raj"}
        from tools.driver_tools import get_driver_status
        result = get_driver_status.invoke({"assignment_id": "some-uuid"})
        assert "IN_TRANSIT" in result


def test_propose_assign_driver_returns_proposal_not_executes():
    with patch("tools.driver_tools._client") as mock_client:
        from tools.driver_tools import propose_assign_driver
        result = propose_assign_driver.invoke({
            "delivery_doc": "80000001",
            "mobile_number": "+91999",
            "truck_registration": "KA01AB1234",
            "driver_name": "Raj Kumar"
        })
        mock_client.post.assert_not_called()
        assert "PROPOSAL" in result
        assert "80000001" in result
