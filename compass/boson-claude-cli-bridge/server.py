#!/usr/bin/env python3
"""Boson Higgs Realtime <-> Claude CLI voice bridge — local server.

- GET  /            -> web page (index.html)
- POST /session     -> mints a Boson ephemeral client key (main key stays here)
- POST /ask_claude  -> {"task": "..."} -> runs Claude CLI -> {"result": "..."}

Localhost only. Never prints the API key.
"""
import hmac
import json
import os
import subprocess
import time
import urllib.parse
import urllib.request
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 7910
KEY_PATH = os.environ.get(
    "BOSON_API_KEY_PATH",
    os.path.expanduser("~/.config/vince-assistant/boson-api-key"))
TOKEN_PATH = os.path.join(HERE, ".access-token")
CLAUDE_BIN = os.environ.get(
    "CLAUDE_BIN", os.path.expanduser("~/.local/bin/claude"))
SCRATCH = os.path.join(HERE, "claude-scratch")
LOG_PATH = os.path.join(HERE, "server.log")
CLAUDE_TIMEOUT = 240

APPEND_SYSTEM = (
    "Audio mode: your answer will be read aloud to a listener who cannot "
    "see a screen. Respond with the bare minimum — condensed, answer-first, "
    "one or two short plain sentences. Only what is necessary, never deep "
    "details, no enumerations of options, no caveats, unless the user "
    "specifically asks for detail. No markdown, no code unless explicitly "
    "asked. We need the fastest possible results: don't overload data, go to "
    "the minimum. "
    "You are reached through a voice bridge. Any file you save in your current "
    "working directory is downloadable by the user at /files/<filename> "
    "(clickable in their browser). When the user wants a link to something you "
    "made, save it in the working directory and answer with that /files/ path. "
    "Whenever you create or edit a file meant to be viewed (an HTML page, an "
    "image, a document), ALWAYS include its /files/<filename> path in your "
    "answer so it can be shown on screen. Even after building something, "
    "report it in ONE short spoken sentence plus the /files/ path — never "
    "list features or sections. "
    "You DO have web access (search, fetch): when asked to find something "
    "online, actually search for it instead of asking the user to provide it."
)


def log(msg):
    line = "[%s] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg)
    with open(LOG_PATH, "a") as f:
        f.write(line)


def read_key():
    key = os.environ.get("BOSON_API_KEY", "").strip()
    if key:
        return key
    try:
        with open(KEY_PATH) as f:
            return f.read().strip()
    except OSError:
        raise RuntimeError(
            "no Boson API key: set BOSON_API_KEY (or BOSON_API_KEY_PATH), "
            "or put the key in " + KEY_PATH)


try:
    with open(TOKEN_PATH) as _f:
        ACCESS_TOKEN = _f.read().strip()
except OSError:
    raise SystemExit(
        "missing .access-token — create one first, e.g.: "
        "openssl rand -hex 24 > .access-token")
if not ACCESS_TOKEN:
    raise SystemExit("empty .access-token — refusing to start ungated")


def mint_ephemeral():
    req = urllib.request.Request(
        "https://api.boson.ai/v1/realtime/client_secrets",
        data=json.dumps({"expires_after": {"seconds": 600}}).encode(),
        headers={
            "Authorization": "Bearer " + read_key(),
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def run_claude(task):
    env = {k: v for k, v in os.environ.items()
           if not (k.startswith("CLAUDE") or k.startswith("ANTHROPIC"))}
    start = time.time()
    base_cmd = [CLAUDE_BIN, "-p", "--model", "claude-sonnet-4-6",
                "--dangerously-skip-permissions",
                "--append-system-prompt", APPEND_SYSTEM]
    try:
        # --continue keeps conversation memory across ask_claude calls so
        # follow-ups ("send me the link") have context; falls back to a fresh
        # conversation when there is nothing to continue yet.
        proc = subprocess.run(
            base_cmd + ["--continue", task],
            cwd=SCRATCH, env=env, capture_output=True, text=True,
            timeout=CLAUDE_TIMEOUT,
        )
        if proc.returncode != 0 or not proc.stdout.strip():
            log("ask_claude --continue fell back (rc=%s stderr=%r)" %
                (proc.returncode, proc.stderr[-200:]))
            proc = subprocess.run(
                base_cmd + [task],
                cwd=SCRATCH, env=env, capture_output=True, text=True,
                timeout=CLAUDE_TIMEOUT,
            )
        dur = time.time() - start
        out = proc.stdout.strip()
        if proc.returncode != 0 or not out:
            log("ask_claude FAILED rc=%s dur=%.1fs stderr=%r" %
                (proc.returncode, dur, proc.stderr[-500:]))
            return "Sorry, Claude hit an error on that one.", dur
        log("ask_claude OK dur=%.1fs task=%r result=%r" %
            (dur, task[:200], out[:300]))
        return out, dur
    except subprocess.TimeoutExpired:
        dur = time.time() - start
        log("ask_claude TIMEOUT dur=%.1fs task=%r" % (dur, task[:200]))
        return ("Sorry, that took too long — Claude timed out after two "
                "minutes."), dur


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _client_ip(self):
        xff = self.headers.get("X-Forwarded-For")
        if xff:
            return xff.split(",")[0].strip()
        return self.client_address[0]

    def _has_token(self):
        """True iff the request carries the access token (query or cookie)."""
        qs = urllib.parse.urlparse(self.path).query
        for val in urllib.parse.parse_qs(qs).get("key", []):
            if hmac.compare_digest(val, ACCESS_TOKEN):
                return True
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
        except Exception:
            pass
        morsel = cookies.get("bridge_key")
        if morsel and hmac.compare_digest(morsel.value, ACCESS_TOKEN):
            return True
        return False

    def _deny(self):
        log("DENIED %s %s from %s" %
            (self.command, self.path.split("?")[0][:100], self._client_ip()))
        self._send(403, b"forbidden\n", "text/plain")

    def do_GET(self):
        if not self._has_token():
            self._deny()
            return
        path = urllib.parse.urlparse(self.path).path
        if path == "/":
            with open(os.path.join(HERE, "index.html"), "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Set-Cookie",
                             "bridge_key=%s; Path=/; Secure; SameSite=Lax"
                             % ACCESS_TOKEN)
            self.end_headers()
            self.wfile.write(data)
        elif path == "/question.wav":  # QA: fed to the getUserMedia shim
            with open(os.path.join(HERE, "qa", "question.wav"), "rb") as f:
                self._send(200, f.read(), "audio/wav")
        elif path.startswith("/files/"):
            # serve files Claude saved in its scratch dir (token-gated above);
            # subpaths allowed, realpath containment blocks traversal
            rel = urllib.parse.unquote(path[len("/files/"):])
            fp = os.path.realpath(os.path.join(SCRATCH, rel))
            if not fp.startswith(os.path.realpath(SCRATCH) + os.sep) \
                    or not os.path.isfile(fp):
                self._send(404, {"error": "not found"})
                return
            import mimetypes
            ctype = (mimetypes.guess_type(fp)[0]
                     or "application/octet-stream")
            if ctype == "text/html":
                ctype = "text/html; charset=utf-8"
            with open(fp, "rb") as f:
                self._send(200, f.read(), ctype)
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._has_token():
            self._deny()
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        path = urllib.parse.urlparse(self.path).path
        if path == "/session":
            try:
                secret = mint_ephemeral()
                log("session minted (expires_at=%s)" % secret.get("expires_at"))
                self._send(200, {"value": secret["value"],
                                 "expires_at": secret["expires_at"]})
            except Exception as e:
                log("session mint ERROR: %s" % e)
                self._send(502, {"error": "could not mint session key"})
        elif path == "/ask_claude":
            try:
                task = json.loads(raw).get("task", "").strip()
            except Exception:
                task = ""
            if not task:
                self._send(400, {"error": "missing task"})
                return
            log("ask_claude START task=%r" % task[:200])
            result, dur = run_claude(task)
            self._send(200, {"result": result, "duration_s": round(dur, 1)})
        else:
            self._send(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        pass  # quiet; we use server.log


if __name__ == "__main__":
    os.makedirs(SCRATCH, exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    log("server started on http://127.0.0.1:%d" % PORT)
    print("Bridge server on http://127.0.0.1:%d" % PORT)
    srv.serve_forever()
