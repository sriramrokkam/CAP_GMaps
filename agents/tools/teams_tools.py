import httpx
from config import settings


def post_teams_alert(message: str, title: str = "Dispatch Alert") -> bool:
    """Post a MessageCard to the Teams Incoming Webhook. Returns True on success."""
    card = {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        "summary": title,
        "themeColor": "E8A000",
        "title": title,
        "text": message,
    }
    try:
        resp = httpx.post(settings.teams_webhook_url, json=card, timeout=10)
        return resp.status_code == 200
    except Exception:
        return False
