from contextlib import asynccontextmanager
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from apscheduler.schedulers.background import BackgroundScheduler
import httpx

from agents.supervisor import graph
from agents.monitor_agent import run_all_checks
from agents.route_agent import build_route_agent
from agents.supervisor import set_route_agent
from mcp_client import load_mcp_tools
from config import settings
from tools.odata_client import ODataClient
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

_memory = MemorySaver()
_graph = graph.copy()
_graph.checkpointer = _memory

_scheduler = None
_monitor_state = {"last_run": None, "next_run": None, "status": "stopped"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler

    # Load Google Maps MCP tools and rebuild route agent with them
    mcp_tools = await load_mcp_tools()
    if mcp_tools:
        set_route_agent(build_route_agent(mcp_tools))

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


CHAT_HTML = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Dispatch Agent Chat</title>
<style>
  body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 16px; background: #f5f5f5; }
  h1 { font-size: 1.2rem; color: #333; }
  #log { background: #fff; border: 1px solid #ddd; border-radius: 6px; height: 480px; overflow-y: auto; padding: 12px; margin-bottom: 10px; }
  .msg { margin: 6px 0; }
  .user { color: #0a6; font-weight: bold; }
  .agent { color: #333; }
  .error { color: #c00; }
  .pending { color: #888; font-style: italic; }
  #row { display: flex; gap: 8px; }
  #input { flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 0.95rem; }
  button { padding: 8px 16px; background: #0070d2; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
  button:hover { background: #005fb2; }
  #confirm-row { display: none; gap: 8px; margin-top: 8px; }
  .btn-yes { background: #0a6; }
  .btn-no { background: #c00; }
</style>
</head>
<body>
<h1>Dispatch Agent Chat</h1>
<div id="log"></div>
<div id="row">
  <input id="input" placeholder="Ask something (e.g. 'list open deliveries')" onkeydown="if(event.key==='Enter')send()">
  <button onclick="send()">Send</button>
</div>
<div id="confirm-row">
  <strong>Confirm action?</strong>
  <button class="btn-yes" onclick="confirm_(true)">Yes</button>
  <button class="btn-no" onclick="confirm_(false)">No</button>
</div>
<script>
const log = document.getElementById('log');
const input = document.getElementById('input');
const confirmRow = document.getElementById('confirm-row');
let threadId = 'ui-' + Math.random().toString(36).slice(2);
let pendingAction = null;

function append(cls, text) {
  const d = document.createElement('div');
  d.className = 'msg ' + cls;
  d.textContent = text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

async function send() {
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  confirmRow.style.display = 'none';
  append('user', 'You: ' + msg);
  append('pending', 'Agent is thinking...');
  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({thread_id: threadId, message: msg})
    });
    const data = await res.json();
    log.lastChild.remove();
    append('agent', 'Agent: ' + data.reply);
    if (data.pending_action) {
      pendingAction = data.pending_action;
      confirmRow.style.display = 'flex';
    }
  } catch(e) {
    log.lastChild.remove();
    append('error', 'Error: ' + e.message);
  }
}

async function confirm_(yes) {
  confirmRow.style.display = 'none';
  append('user', yes ? 'You: yes' : 'You: no');
  append('pending', 'Agent is thinking...');
  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({thread_id: threadId, message: yes ? 'yes' : 'no', confirm: yes})
    });
    const data = await res.json();
    log.lastChild.remove();
    append('agent', 'Agent: ' + data.reply);
    pendingAction = null;
  } catch(e) {
    log.lastChild.remove();
    append('error', 'Error: ' + e.message);
  }
}
</script>
</body>
</html>"""


@app.get("/", response_class=HTMLResponse)
def index():
    return CHAT_HTML


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    config = {"configurable": {"thread_id": req.thread_id}}

    # Check if graph is interrupted (awaiting confirmation)
    state = await _graph.aget_state(config)
    if state.tasks and any(t.interrupts for t in state.tasks):
        if req.confirm is True:
            result = await _graph.ainvoke(Command(resume=True), config=config)
        else:
            result = await _graph.ainvoke(
                {"message": "Action cancelled by user."},
                config=config,
            )
        last_msg = result["messages"][-1].content if result.get("messages") else "No response."
        return ChatResponse(reply=last_msg)

    # Normal message — invoke graph (pass via UserInput schema)
    result = await _graph.ainvoke(
        {"message": req.message},
        config=config,
    )

    # Check if graph is now interrupted after invocation
    state = await _graph.aget_state(config)
    pending = None
    if state.tasks and any(t.interrupts for t in state.tasks):
        for task in state.tasks:
            for intr in task.interrupts:
                pending = {"tool": str(intr.value), "description": "Awaiting human confirmation"}
                break

    last_msg = result["messages"][-1].content if result.get("messages") else "No response."
    return ChatResponse(reply=last_msg, pending_action=pending)


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
            "list_deliveries": _probe_connection("list_deliveries", lambda: client.get("/odata/v4/ewm/OutboundDeliveries", {"$top": "1"})),
            "list_drivers": _probe_connection("list_drivers", lambda: client.get("/odata/v4/tracking/Driver", {"$top": "1"})),
            "get_live_location": "ok",
            "get_route_for_delivery": "ok",
        },
    }
