"""Adaptive Card builders for Teams Bot responses."""


def chat_response_card(text: str) -> dict:
    """Format agent reply as an Adaptive Card."""
    body = [{"type": "TextBlock", "text": text, "wrap": True}]
    return _card(body)


def error_card(error_msg: str) -> dict:
    """Error response card."""
    body = [
        {"type": "TextBlock", "text": "Something went wrong", "weight": "Bolder", "color": "Attention"},
        {"type": "TextBlock", "text": error_msg, "wrap": True},
    ]
    return _card(body)


def hitl_card(reply: str, pending_action: dict) -> dict:
    """Card with Approve/Reject buttons for human-in-the-loop confirmation."""
    body = [
        {"type": "TextBlock", "text": reply, "wrap": True},
        {"type": "TextBlock", "text": "Confirm this action?", "weight": "Bolder", "spacing": "Medium"},
        {"type": "TextBlock", "text": f"Tool: {pending_action.get('tool', '?')}", "isSubtle": True, "wrap": True},
    ]
    actions = [
        {
            "type": "Action.Submit",
            "title": "Approve",
            "data": {"action": "confirm", "confirm": True},
            "style": "positive",
        },
        {
            "type": "Action.Submit",
            "title": "Reject",
            "data": {"action": "confirm", "confirm": False},
            "style": "destructive",
        },
    ]
    return _card(body, actions)


def dashboard_card(stats: dict) -> dict:
    """Dashboard summary card."""
    body = [
        {"type": "TextBlock", "text": "Dispatch Dashboard", "weight": "Bolder", "size": "Medium"},
        {"type": "TextBlock", "text": f"Updated: {stats.get('timestamp', '—')}", "isSubtle": True},
        {"type": "FactSet", "facts": [
            {"title": "Open Deliveries", "value": str(stats.get("open_deliveries", "—"))},
            {"title": "Unassigned", "value": str(stats.get("unassigned", "—"))},
            {"title": "Total Drivers", "value": str(stats.get("total_drivers", "—"))},
            {"title": "In Transit", "value": str(stats.get("in_transit", "—"))},
            {"title": "Active Assignments", "value": str(stats.get("active_assignments", "—"))},
        ]},
    ]
    actions = [
        {"type": "Action.Submit", "title": "Refresh", "data": {"action": "dashboard"}},
    ]
    return _card(body, actions)


def _card(body: list, actions: list | None = None) -> dict:
    """Wrap body + actions in Adaptive Card envelope."""
    card = {
        "type": "AdaptiveCard",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": "1.4",
        "body": body,
    }
    if actions:
        card["actions"] = actions
    return {
        "content_type": "application/vnd.microsoft.card.adaptive",
        "content": card,
    }
