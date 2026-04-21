"""Teams Bot server — aiohttp entry point."""

import sys
import traceback
from aiohttp import web
from botbuilder.core import BotFrameworkAdapter, BotFrameworkAdapterSettings, TurnContext
from botbuilder.schema import Activity

from config import MICROSOFT_APP_ID, MICROSOFT_APP_PASSWORD, MICROSOFT_APP_TENANT_ID, BOT_PORT
from bot import DispatchBot

SETTINGS = BotFrameworkAdapterSettings(
    app_id=MICROSOFT_APP_ID,
    app_password=MICROSOFT_APP_PASSWORD,
    channel_auth_tenant=MICROSOFT_APP_TENANT_ID,
)
ADAPTER = BotFrameworkAdapter(SETTINGS)
BOT = DispatchBot()


async def on_error(context: TurnContext, error: Exception):
    print(f"[Bot Error] {error}", file=sys.stderr)
    traceback.print_exc()
    await context.send_activity("Sorry, something went wrong. Please try again.")


ADAPTER.on_turn_error = on_error


async def messages(req: web.Request) -> web.Response:
    """Bot Framework messaging endpoint — Azure Bot Service sends messages here."""
    if "application/json" not in req.headers.get("Content-Type", ""):
        return web.Response(status=415)

    body = await req.json()
    print(f"[Bot] Received: type={body.get('type')} text={body.get('text','')[:50]}", file=sys.stderr, flush=True)
    activity = Activity().deserialize(body)
    auth_header = req.headers.get("Authorization", "")

    try:
        response = await ADAPTER.process_activity(activity, auth_header, BOT.on_turn)
        if response:
            return web.json_response(data=response.body, status=response.status)
        return web.Response(status=201)
    except Exception as e:
        print(f"[Bot] process_activity error: {e}", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)
        return web.Response(status=500, text=str(e))


async def health(req: web.Request) -> web.Response:
    return web.json_response({"status": "ok", "bot": "dispatch-bot"})


APP = web.Application()
APP.router.add_post("/api/messages", messages)
APP.router.add_get("/api/health", health)

if __name__ == "__main__":
    print(f"Bot server starting on port {BOT_PORT}")
    print(f"Messaging endpoint: http://localhost:{BOT_PORT}/api/messages")
    print(f"Health check: http://localhost:{BOT_PORT}/api/health")
    web.run_app(APP, host="0.0.0.0", port=BOT_PORT)
