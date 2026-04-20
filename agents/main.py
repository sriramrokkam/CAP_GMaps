from contextlib import asynccontextmanager
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from pydantic import BaseModel
from apscheduler.schedulers.background import BackgroundScheduler
import httpx

from agents.supervisor import build_supervisor
from agents.monitor_agent import run_all_checks
from config import settings
from tools.odata_client import ODataClient
from langchain_core.messages import HumanMessage

_supervisor_graph = None
_scheduler = None
_monitor_state = {"last_run": None, "next_run": None, "status": "stopped"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _supervisor_graph, _scheduler
    _supervisor_graph, _ = build_supervisor()

    _scheduler = BackgroundScheduler()

    def _run():
        _monitor_state["last_run"] = datetime.now(timezone.utc).isoformat()
        try:
            run_all_checks()
            _monitor_state["status"] = "running"
        except Exception as e:
            _monitor_state["status"] = f"error: {e}"

    _scheduler.add_job(_run, "interval", seconds=settings.monitor_poll_interval_sec, id="monitor")
    _scheduler.start()
    _monitor_state["status"] = "running"
    yield
    _scheduler.shutdown(wait=False)


app = FastAPI(title="Dispatch Agents", lifespan=lifespan)


class ChatRequest(BaseModel):
    thread_id: str
    message: str
    confirm: bool | None = None


class ChatResponse(BaseModel):
    reply: str
    pending_action: dict | None = None


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    config = {"configurable": {"thread_id": req.thread_id}}
    msg_text = req.message
    if req.confirm is True:
        msg_text = "yes"
    elif req.confirm is False:
        msg_text = "no"
    result = _supervisor_graph.invoke(
        {"messages": [HumanMessage(content=msg_text)], "thread_id": req.thread_id},
        config=config,
    )
    last_msg = result["messages"][-1].content if result.get("messages") else "No response."
    pending = result.get("pending_action")
    return ChatResponse(
        reply=last_msg,
        pending_action={"tool": pending.tool, "args": pending.args, "reasoning": pending.reasoning} if pending else None,
    )


def _probe_connection(name: str, fn) -> str:
    try:
        fn()
        return "ok"
    except Exception:
        return "error"


@app.get("/health")
def health():
    client = ODataClient(settings)

    def probe_xsuaa():
        client._get_token()

    def probe_cap():
        client.get("/odata/v4/ewm/OutboundDeliveries", {"$top": "1"})

    def probe_teams():
        httpx.head(settings.teams_webhook_url, timeout=5)

    connections = {
        "xsuaa": _probe_connection("xsuaa", probe_xsuaa),
        "cap_odata": _probe_connection("cap_odata", probe_cap),
        "teams_webhook": _probe_connection("teams_webhook", probe_teams),
        "aicore": "ok",
    }
    overall = "ok" if all(v == "ok" for v in connections.values()) else "degraded"
    return {
        "status": overall,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "connections": connections,
        "agents": {
            "supervisor": "ready",
            "delivery_agent": "ready",
            "driver_agent": "ready",
            "route_agent": "ready",
        },
        "monitor": {
            "status": _monitor_state["status"],
            "last_run": _monitor_state["last_run"],
            "next_run": _monitor_state["next_run"],
            "checks": {
                "unassigned_deliveries": "ok",
                "idle_drivers": "ok",
                "batch_opportunities": "ok",
            },
        },
        "tools": {
            "list_open_deliveries": _probe_connection("list_open_deliveries", lambda: client.get("/odata/v4/ewm/OutboundDeliveries", {"$top": "1"})),
            "list_drivers": _probe_connection("list_drivers", lambda: client.get("/odata/v4/tracking/Driver", {"$top": "1"})),
            "get_live_location": "ok",
            "get_route_for_delivery": "ok",
        },
    }
