"""Nimble: the agent's eyes on the live web. Search returns structured results, so raw
pages never enter the Doer's memory; only a short digest does."""
import json
import time
import urllib.error
import urllib.request

from .. import config


def _req(method, path, body=None, timeout=60):
    url = config.NIMBLE_BASE.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {config.NIMBLE_API_KEY}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def search(query, max_results=5, focus="news", depth="lite"):
    """Returns {"results": [{title, url, description}], "live": bool} or fixture-less error."""
    if not config.NIMBLE_API_KEY:
        return {"live": False, "results": []}
    try:
        res = _req("POST", "/search", {"query": query, "max_results": max_results,
                                        "search_depth": depth, "focus": focus})
        items = [{"title": r.get("title"), "url": r.get("url"),
                  "description": (r.get("description") or "")[:300]} for r in res.get("results", [])]
        return {"live": True, "results": items}
    except urllib.error.HTTPError as e:
        return {"live": True, "error": f"HTTP {e.code}: {e.read().decode(errors='replace')[:200]}", "results": []}
    except Exception as e:
        return {"live": True, "error": str(e), "results": []}


def research(question, effort="low", timeout_s=600):
    """Web Search Agent: offloads a whole research task; returns only the cited answer."""
    if not config.NIMBLE_API_KEY:
        return None
    run = _req("POST", "/agents/runs", {"input": question, "effort": effort})
    agent_id, run_id = run.get("web_search_agent_id"), run.get("id")
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        st = _req("GET", f"/agents/{agent_id}/runs/{run_id}")
        if not st.get("is_active"):
            break
        time.sleep(10)
    res = _req("GET", f"/agents/{agent_id}/runs/{run_id}/result")
    return (res.get("output") or {}).get("content")


def digest(results, limit=3):
    return " | ".join(f"{r['title']}: {r['description'][:160]} ({r['url']})" for r in results[:limit])
