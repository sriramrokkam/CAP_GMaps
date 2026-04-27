from unittest.mock import patch
from tools.odata_client import build_filter


# ── build_filter tests ──

def test_build_filter_exact_string():
    assert build_filter(exact={"Status": "ASSIGNED"}) == "Status eq 'ASSIGNED'"


def test_build_filter_exact_bool():
    assert build_filter(exact={"IsActive": True}) == "IsActive eq true"
    assert build_filter(exact={"IsActive": False}) == "IsActive eq false"


def test_build_filter_contains():
    assert build_filter(contains={"DriverName": "Sriram"}) == "contains(DriverName,'Sriram')"


def test_build_filter_mixed():
    result = build_filter(
        exact={"Status": "IN_TRANSIT"},
        contains={"DriverName": "Raj"},
    )
    assert "Status eq 'IN_TRANSIT'" in result
    assert "contains(DriverName,'Raj')" in result
    assert " and " in result


def test_build_filter_skips_none():
    assert build_filter(exact={"Status": None, "Route": "TR0002"}) == "Route eq 'TR0002'"


def test_build_filter_empty():
    assert build_filter() == ""
    assert build_filter(exact={}, contains={}) == ""


# ── get_last_known_location tests ──

def test_get_last_known_location_returns_formatted_string():
    from tools.route_tools import get_last_known_location

    with patch("tools.route_tools._client") as mock_client:
        mock_client.get.return_value = {
            "Latitude": 12.971,
            "Longitude": 77.594,
            "Speed": 8.3,
            "LastGpsAt": "2026-04-27T10:30:00Z",
        }
        result = get_last_known_location.invoke({"assignment_id": "abc-123"})

    assert "12.971" in result
    assert "77.594" in result


def test_get_last_known_location_handles_odata_error():
    from tools.route_tools import get_last_known_location

    with patch("tools.route_tools._client") as mock_client:
        mock_client.get.side_effect = Exception("Connection refused")
        result = get_last_known_location.invoke({"assignment_id": "bad-id"})

    assert "could not" in result.lower() or "error" in result.lower()


def test_get_last_known_location_is_a_tool():
    from tools.route_tools import get_last_known_location
    assert get_last_known_location.name == "get_last_known_location"
    assert "assignment" in get_last_known_location.description.lower()


def test_get_last_known_location_includes_coords_for_maps():
    """Result should include a comma-separated lat,lng suitable for passing to MCP tools."""
    from tools.route_tools import get_last_known_location

    with patch("tools.route_tools._client") as mock_client:
        mock_client.get.return_value = {
            "Latitude": 12.971,
            "Longitude": 77.594,
            "Speed": 8.3,
            "LastGpsAt": "2026-04-27T10:30:00Z",
        }
        result = get_last_known_location.invoke({"assignment_id": "abc-123"})

    assert "12.971,77.594" in result


# ── list_routes filter tests ──

def test_list_routes_with_origin_filter():
    from tools.route_tools import list_routes

    with patch("tools.route_tools._client") as mock_client:
        mock_client.get.return_value = {"value": [
            {"ID": "r1", "origin": "New York", "destination": "Atlanta", "distance": "881 mi", "duration": "13h"}
        ]}
        result = list_routes.invoke({"origin": "New York"})

    assert "New York" in result
    assert "Atlanta" in result
    call_params = mock_client.get.call_args[0][1] if len(mock_client.get.call_args[0]) > 1 else mock_client.get.call_args[1].get("params", {})
    assert "contains(origin,'New York')" in str(call_params)


def test_list_routes_no_filters():
    from tools.route_tools import list_routes

    with patch("tools.route_tools._client") as mock_client:
        mock_client.get.return_value = {"value": []}
        result = list_routes.invoke({})

    assert "no routes" in result.lower()
