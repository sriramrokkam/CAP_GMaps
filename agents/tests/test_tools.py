from tools.driver_tools import (
    list_drivers,
    list_assignments,
    get_driver_status,
    get_live_location,
    assign_driver,
    confirm_delivery,
    get_qr_code,
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
    assert not hasattr(mod, "create_driver"), "create_driver was merged into assign_driver"
    assert not hasattr(mod, "get_driver_by_mobile"), "get_driver_by_mobile was merged into list_drivers"


def test_driver_tools_have_guidance():
    assert "list_assignments" in get_driver_status.description.lower() or "UUID" in get_driver_status.description
    assert "list_assignments" in get_live_location.description.lower() or "UUID" in get_live_location.description


def test_list_drivers_accepts_filters():
    schema = list_drivers.args_schema.schema()
    props = schema.get("properties", {})
    assert "name" in props
    assert "mobile" in props
    assert "is_active" in props
    assert "top" in props


def test_list_assignments_accepts_filters():
    schema = list_assignments.args_schema.schema()
    props = schema.get("properties", {})
    assert "status" in props
    assert "driver_name" in props
    assert "delivery_doc" in props
    assert "top" in props


def test_get_qr_code_takes_delivery_doc():
    schema = get_qr_code.args_schema.schema()
    props = schema.get("properties", {})
    assert "delivery_doc" in props
    assert "assignment_id" not in props


from tools.delivery_tools import list_deliveries, get_delivery_items, get_delivery_route


def test_list_deliveries_accepts_filters():
    schema = list_deliveries.args_schema.schema()
    props = schema.get("properties", {})
    assert "status" in props
    assert "route" in props
    assert "driver_name" in props
    assert "ship_to" in props
    assert "top" in props


def test_delivery_tools_have_guidance():
    assert "list_deliveries" in get_delivery_items.description.lower() or "DeliveryDocument" in get_delivery_items.description


def test_old_delivery_tools_removed():
    import tools.delivery_tools as mod
    assert not hasattr(mod, "list_open_deliveries"), "list_open_deliveries was merged into list_deliveries"
    assert not hasattr(mod, "list_unassigned_deliveries"), "list_unassigned_deliveries was merged into list_deliveries"


from tools.route_tools import list_routes, get_route_steps


def test_list_routes_accepts_filters():
    schema = list_routes.args_schema.schema()
    props = schema.get("properties", {})
    assert "origin" in props
    assert "destination" in props
    assert "top" in props


def test_old_route_tools_removed():
    import tools.route_tools as mod
    assert not hasattr(mod, "list_all_routes"), "list_all_routes was renamed to list_routes"


def test_route_tools_have_guidance():
    assert "list_routes" in get_route_steps.description.lower() or "UUID" in get_route_steps.description
