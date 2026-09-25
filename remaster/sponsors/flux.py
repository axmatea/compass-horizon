"""Black Forest Labs Flux 3: the Monday team-briefing video (video + voice)."""
import json
import time
import urllib.request

from .. import config


def _req(url, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET",
                                 headers={"x-key": config.BFL_API_KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def generate(prompt, out_path, video=True, duration=10, timeout_s=900):
    """Submit, poll `polling_url`, download result.sample immediately (URL expires)."""
    if not config.BFL_API_KEY:
        return None
    base = config.BFL_BASE.rstrip("/")
    if video:
        sub = _req(f"{base}/flux-3-video", {"mode": "t2v", "prompt": prompt, "aspect_ratio": "16:9",
                                              "duration": duration, "generate_audio": True})
    else:
        sub = _req(f"{base}/flux-2-pro", {"prompt": prompt, "width": 1280, "height": 720})
    poll, deadline = sub["polling_url"], time.time() + timeout_s
    while time.time() < deadline:
        st = _req(poll)
        status = st.get("status")
        if status == "Ready":
            urllib.request.urlretrieve(st["result"]["sample"], out_path)
            return out_path
        if status in ("Error", "Request Moderated", "Content Moderated", "Task not found"):
            raise RuntimeError(f"flux: {status}")
        time.sleep(5)
    raise TimeoutError("flux: generation timed out")


def briefing_prompt(week, headline, focus_lines):
    bullets = "; ".join(focus_lines[:3])
    return (f"A friendly animated startup team briefing, flat illustration style, warm colors. "
            f"A presenter character says in clear English: 'Week {week} briefing. {headline}. {bullets}.' "
            f"On-screen kanban board with sticky notes, subtle upbeat music.")
