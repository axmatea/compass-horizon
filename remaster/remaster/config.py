"""Runtime configuration. Everything comes from env vars (or a local .env file)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv():
    p = ROOT / ".env"
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()


def env(name, default=None):
    v = os.environ.get(name)
    return v if v not in (None, "") else default


# --- LLMs (all Liquid AI — sponsor models) -----------------------------------
# BRAIN=local (default): two llama-server instances on this machine, zero cost, private.
# BRAIN=openrouter: Liquid's hosted free tier (needs OPENROUTER_API_KEY).
BRAIN = env("REMASTER_BRAIN", "openrouter")

STRATEGIST_BASE = env("REMASTER_STRATEGIST_BASE", "http://localhost:8081/v1")
DOER_BASE = env("REMASTER_DOER_BASE", "http://localhost:8080/v1")
MODEL_STRATEGIST = env("REMASTER_MODEL_STRATEGIST", "lfm2.5-8b-a1b")
MODEL_DOER = env("REMASTER_MODEL_DOER", "lfm2.5-2.6b")

OPENROUTER_API_KEY = env("OPENROUTER_API_KEY")
OPENROUTER_BASE = env("OPENROUTER_BASE", "https://openrouter.ai/api/v1")
MODEL_LIQUID = env("REMASTER_MODEL_LIQUID", "liquid/lfm-2.5-2.6b:free")

if BRAIN == "openrouter":
    STRATEGIST_BASE = DOER_BASE = OPENROUTER_BASE
    MODEL_STRATEGIST = MODEL_DOER = MODEL_LIQUID

# --- Sponsors ---------------------------------------------------------------
NIMBLE_API_KEY = env("NIMBLE_API_KEY")
NIMBLE_BASE = env("NIMBLE_BASE", "https://sdk.nimbleway.com/v2")

RAWTREE_TOKEN = env("RAWTREE_TOKEN")
RAWTREE_HOST = env("RAWTREE_HOST", "https://api.rawtree.com")
RAWTREE_DATABASE = env("RAWTREE_DATABASE")          # optional; key default otherwise
RAWTREE_TABLE = env("RAWTREE_TABLE", "remaster_events")

BFL_API_KEY = env("BFL_API_KEY")
BFL_BASE = env("BFL_BASE", "https://api.bfl.ai/v1")


def mock_llm():
    """Mock mode: forced via REMASTER_MOCK=1, or openrouter brain without a key."""
    if env("REMASTER_MOCK") == "1":
        return True
    return BRAIN == "openrouter" and not OPENROUTER_API_KEY


def status():
    return {
        "brain": "MOCK" if mock_llm() else f"liquid-{BRAIN}",
        "nimble": "live" if NIMBLE_API_KEY else "offline-fixture",
        "rawtree": "live" if RAWTREE_TOKEN else "local-sqlite-only",
        "flux": "live" if BFL_API_KEY else "off",
    }
