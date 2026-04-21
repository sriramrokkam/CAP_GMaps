"""Teams Bot — thin adapter between Bot Framework and agents /chat endpoint."""

import httpx
from botbuilder.core import ActivityHandler, TurnContext, MessageFactory
from botbuilder.schema import Activity, Attachment

from config import AGENTS_API_URL
from cards import chat_response_card, error_card, hitl_card, dashboard_card


class DispatchBot(ActivityHandler):

    async def on_message_activity(self, turn_context: TurnContext):
        # Check if this is a card button click (Action.Submit)
        if turn_context.activity.value:
            await self._handle_card_action(turn_context)
            return

        user_text = turn_context.activity.text or ""
        if not user_text.strip():
            return

        # Use Teams conversation ID as thread_id for persistent context
        thread_id = turn_context.activity.conversation.id

        # Special commands
        if user_text.strip().lower() in ("dashboard", "summary", "status"):
            await self._send_dashboard(turn_context, thread_id)
            return

        # Forward to agents /chat endpoint
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{AGENTS_API_URL}/chat",
                    json={"thread_id": thread_id, "message": user_text},
                )
                resp.raise_for_status()
                data = resp.json()
        except Exception as e:
            card = error_card(f"Agent unavailable: {e}")
            await turn_context.send_activity(
                MessageFactory.attachment(Attachment(**card))
            )
            return

        reply = data.get("reply", "No response.")
        pending = data.get("pending_action")

        if pending:
            card = hitl_card(reply, pending)
        else:
            card = chat_response_card(reply)

        await turn_context.send_activity(
            MessageFactory.attachment(Attachment(**card))
        )

    async def _handle_card_action(self, turn_context: TurnContext):
        """Handle Adaptive Card button clicks."""
        value = turn_context.activity.value
        action = value.get("action", "")
        thread_id = turn_context.activity.conversation.id

        if action == "confirm":
            confirm = value.get("confirm", False)
            try:
                async with httpx.AsyncClient(timeout=60) as client:
                    resp = await client.post(
                        f"{AGENTS_API_URL}/chat",
                        json={"thread_id": thread_id, "message": "confirm", "confirm": confirm},
                    )
                    resp.raise_for_status()
                    data = resp.json()
                reply = data.get("reply", "Done.")
            except Exception as e:
                reply = f"Error: {e}"

            card = chat_response_card(f"{'Approved' if confirm else 'Rejected'}: {reply}")
            await turn_context.send_activity(
                MessageFactory.attachment(Attachment(**card))
            )

        elif action == "dashboard":
            await self._send_dashboard(turn_context, thread_id)

    async def _send_dashboard(self, turn_context: TurnContext, thread_id: str):
        """Collect stats from agent tools and send dashboard card."""
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(f"{AGENTS_API_URL}/health")
                resp.raise_for_status()
                health = resp.json()

            from datetime import datetime, timezone
            stats = {
                "timestamp": datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC"),
                "open_deliveries": "—",
                "unassigned": "—",
                "total_drivers": "—",
                "in_transit": "—",
                "active_assignments": "—",
            }

            # Get live counts from agents
            async with httpx.AsyncClient(timeout=60) as client:
                for label, msg in [
                    ("open_deliveries", "list open deliveries"),
                    ("total_drivers", "show drivers"),
                ]:
                    try:
                        r = await client.post(
                            f"{AGENTS_API_URL}/chat",
                            json={"thread_id": f"dashboard-{thread_id}", "message": msg},
                        )
                        text = r.json().get("reply", "")
                        # Extract count from first line like "50 open deliveries:" or "5 drivers:"
                        first_word = text.split()[0] if text.split() else "—"
                        if first_word.isdigit():
                            stats[label] = first_word
                    except Exception:
                        pass

            card = dashboard_card(stats)
            await turn_context.send_activity(
                MessageFactory.attachment(Attachment(**card))
            )
        except Exception as e:
            card = error_card(f"Dashboard error: {e}")
            await turn_context.send_activity(
                MessageFactory.attachment(Attachment(**card))
            )

    async def on_members_added_activity(self, members_added, turn_context: TurnContext):
        """Welcome message when bot is added to a channel."""
        for member in members_added:
            if member.id != turn_context.activity.recipient.id:
                await turn_context.send_activity(
                    "Dispatch Bot ready. Ask me about deliveries, drivers, or routes. "
                    "Type **dashboard** for a summary."
                )
