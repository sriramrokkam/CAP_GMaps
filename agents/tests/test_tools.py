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
