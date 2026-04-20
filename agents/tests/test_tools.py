from tools.driver_tools import (
    list_drivers,
    list_assignments,
    get_driver_status,
    get_live_location,
    assign_driver,
    confirm_delivery,
)


def test_assign_driver_is_a_real_tool():
    assert assign_driver.name == "assign_driver"
    assert "assign" in assign_driver.description.lower()


def test_confirm_delivery_is_a_real_tool():
    assert confirm_delivery.name == "confirm_delivery"
    assert "confirm" in confirm_delivery.description.lower()


def test_proposal_tools_removed():
    import tools.driver_tools as mod
    assert not hasattr(mod, "propose_assign_driver")
    assert not hasattr(mod, "propose_confirm_delivery")
    assert not hasattr(mod, "execute_assign_driver")
    assert not hasattr(mod, "execute_confirm_delivery")


def test_driver_tools_have_guidance():
    assert "list_assignments" in get_driver_status.description.lower() or "UUID" in get_driver_status.description
    assert "list_assignments" in get_live_location.description.lower() or "UUID" in get_live_location.description


from tools.delivery_tools import get_delivery_items, get_delivery_route
from tools.route_tools import get_route_steps, get_route_for_delivery


def test_delivery_tools_have_guidance():
    assert "list_open_deliveries" in get_delivery_items.description.lower() or "DeliveryDocument" in get_delivery_items.description


def test_route_tools_have_guidance():
    assert "list_all_routes" in get_route_steps.description.lower() or "UUID" in get_route_steps.description
