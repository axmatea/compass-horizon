# Boson Claude CLI bridge

Voice interface to Claude Code. You speak into the browser; Boson's Higgs
Realtime model handles the conversation (speech in, speech out) and delegates
every piece of real work to the Claude Code CLI running on the host, via a
tool call. Claude's answers are read back aloud, and any file Claude produces
(a landing page, an image gallery) is rendered live in a preview pane.

The realtime voice model is deliberately a thin communication layer: it has
no ideas of its own. It relays intent to Claude, keeps the conversation alive
while Claude works, and reports results back.

## Architecture

- `index.html`: the whole browser client. Captures mic audio, streams PCM
  over a WebSocket to Boson Higgs Realtime (`wss://api.boson.ai/v1/realtime`),
  plays the audio replies. Exposes two tools to the model: `ask_claude(task)`
  (POSTed to the local server) and `show_screen(path)` (loads a `/files/...`
  URL into the preview iframe). Also renders transcript, tool-call and log
  panels, keeps a task ledger (running and finished tasks, re-injected as
  context on reconnect), and has Stop / Continue / Reset controls.
- `server.py`: stdlib-only Python HTTP server on `127.0.0.1:7910`.
  - `POST /session` mints a short-lived (600 s) Boson client key, so the real
    API key never reaches the browser.
  - `POST /ask_claude` shells out to the Claude CLI
    (`claude -p --continue ...`) inside `claude-scratch/`, with an appended
    system prompt that forces short, speakable answers. `--continue` keeps
    conversation memory across calls and falls back to a fresh conversation
    when there is nothing to continue.
  - `GET /files/<path>` serves anything Claude saved in `claude-scratch/`
    (realpath-contained, so no traversal).
  - Every route is gated by a shared access token (query param `?key=` or
    cookie); requests without it get 403.
- `claude-scratch/`: Claude's working directory. `CLAUDE.md` is the playbook
  the CLI reads (reply style, fast page-template recipe, demo flows);
  `templates/` holds the landing-page template it copies from. Everything
  else in there is generated at runtime and not part of the repo.
- `demo-reset.sh`: re-arms a specific live demo (restores a baseline site,
  clears generated files, archives the CLI session so the next call starts a
  fresh conversation). Demo tooling only; the bridge runs without it.

## Setup

Requirements: `python3` (stdlib only, 3.9+ is fine) and the
[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed
and authenticated on the host.

1. Boson API key: put it in `~/.config/vince-assistant/boson-api-key`, or set
   `BOSON_API_KEY` (or point `BOSON_API_KEY_PATH` at your own file).
2. Access token: `openssl rand -hex 24 > .access-token` in this directory.
   The server refuses to start without it.
3. If your Claude CLI is not at `~/.local/bin/claude`, set `CLAUDE_BIN`.

## Run

```
python3 server.py
```

Then open `http://127.0.0.1:7910/?key=<contents of .access-token>` and press
Connect. The token is set as a cookie on first load, so later navigation
works without the query param.

To use it from a phone, put a tunnel in front (for example
`cloudflared tunnel --url http://127.0.0.1:7910`) and open the tunnel URL
with the same `?key=` param. The token gate is the only protection, so treat
the full URL as a secret and prefer an access-gated tunnel.

Note: `--dangerously-skip-permissions` is passed to the CLI, so Claude runs
unattended inside `claude-scratch/`. Run this on a machine where that is
acceptable.

## Boson realtime quirks this code works around

Observed against `higgs-realtime` (September 2026):

- The server does not send `session.created` until it receives a first
  client event, and that first event is swallowed. The bridge sends a
  kickstart `session.update` on WebSocket open, then re-sends the real one
  once `session.created` arrives.
- `response.create` with inline `instructions` is ignored for context: it
  produced context-free replies. To make the model say something specific,
  the bridge injects a `conversation.item.create` message and follows it
  with a bare `response.create`, so session instructions and conversation
  history apply.
- Conversation items with `role: "system"` are rejected (400 Invalid role).
  All bridge notes (task-finished notifications, reconnect context, ledger
  reminders) go in as `role: "user"` items explicitly marked as bridge notes
  that are not the user speaking.
- The model only speaks when a `response.create` is sent; it cannot
  self-wake. The bridge never fires `response.create` while a response is
  already in flight (tracked via `response.created` / `response.done`), to
  avoid duplicate overlapping replies.
- Auth is the WebSocket subprotocol `bai-client-secret.<ephemeral key>`,
  with the ephemeral key minted server-side per session.
