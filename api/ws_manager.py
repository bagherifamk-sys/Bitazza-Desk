"""WebSocket connection manager for real-time dashboard and widget events."""
from collections import defaultdict
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        # Dashboard connections (not subscribed to a specific conversation)
        self.active: list[WebSocket] = []
        # Widget connections subscribed to a specific conversation
        self._rooms: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active = [c for c in self.active if c != ws]
        for cid, sockets in self._rooms.items():
            self._rooms[cid] = [s for s in sockets if s != ws]

    async def connect_widget(self, ws: WebSocket, conversation_id: str):
        await ws.accept()
        self._rooms[conversation_id].append(ws)

    def disconnect_widget(self, ws: WebSocket, conversation_id: str):
        self._rooms[conversation_id] = [
            s for s in self._rooms.get(conversation_id, []) if s != ws
        ]

    async def broadcast(self, conversation_id: str, event: dict, dashboard_only: bool = False):
        """Broadcast to all dashboard connections and optionally widget subscribers for this conversation.

        Set dashboard_only=True for internal events (internal notes, copilot summaries) that
        must never reach the customer-facing widget.
        """
        targets = self.active if dashboard_only else self.active + self._rooms.get(conversation_id, [])
        dead = []
        for ws in targets:
            try:
                await ws.send_json(event)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()
