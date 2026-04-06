"""FastAPI application entry point."""
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from config import settings
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from api.routes.auth import router as auth_router
from api.routes.chat import router as chat_router
from api.routes.copilot import router as copilot_router
from api.routes.dashboard import router as dashboard_router
from api.routes.knowledge import router as knowledge_router
from db.conversation_store import init_db
from engine.auto_transitions import start_auto_transition_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    asyncio.create_task(start_auto_transition_loop())
    yield


app = FastAPI(
    title="CS Bot API",
    description="AI Customer Support Agent — Freedom Platform & Bitazza Exchange",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict to Freedom/Bitazza domains in production
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(chat_router)
app.include_router(copilot_router)
app.include_router(dashboard_router)
app.include_router(knowledge_router)

# Mount mock User/KYC API and token issuer only in development
if settings.USE_MOCK_USER_API:
    from engine.mock_api.router import router as mock_user_router
    from engine.mock_api.auth import router as mock_auth_router
    app.include_router(mock_user_router)
    app.include_router(mock_auth_router)

_assets_dir = Path(__file__).parent.parent / "engine" / "assets"
app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

_uploads_dir = Path(__file__).parent.parent / "uploads"
_uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_uploads_dir), name="uploads")


@app.get("/health")
def health():
    return {"status": "ok"}
