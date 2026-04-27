from unittest.mock import patch


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