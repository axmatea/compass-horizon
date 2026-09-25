"""Minimal OpenAI-compatible chat client (stdlib only).

Used for OpenAI (strategist / doer / cleaner / shadows) and OpenRouter (Liquid LFM).
All agents ask for JSON output, so every call returns a parsed dict.
"""
import json
import re
import time
import urllib.error
import urllib.request

from . import config


class LLMError(RuntimeError):
    pass


class ChatClient:
    def __init__(self, base, key, model, name, extra_headers=None):
        self.base, self.key, self.model, self.name = base.rstrip("/"), key, model, name
        self.extra_headers = extra_headers or {}
        self.usage = {"calls": 0, "prompt_tokens": 0, "cached_tokens": 0, "completion_tokens": 0}

    def json(self, messages, temperature=None, cache_key=None, max_retries=6):  # cache_key kept for API compat
        body = {"model": self.model, "messages": messages, "max_tokens": 1800,
                "response_format": {"type": "json_object"}}
        if temperature is not None:
            body["temperature"] = temperature
        data = self._post("/chat/completions", body, max_retries)
        u = data.get("usage") or {}
        self.usage["calls"] += 1
        self.usage["prompt_tokens"] += u.get("prompt_tokens", 0)
        self.usage["completion_tokens"] += u.get("completion_tokens", 0)
        self.usage["cached_tokens"] += (u.get("prompt_tokens_details") or {}).get("cached_tokens", 0) or 0
        text = data["choices"][0]["message"].get("content") or "{}"
        try:
            return self._coerce_json(text)
        except LLMError:
            # Truncated/malformed once: ask again, insisting on brevity.
            brief = messages + [{"role": "user", "content":
                "Your previous answer was cut off. Return the SAME decision as COMPACT JSON only. "
                "One short sentence per reason. No prose outside JSON."}]
            data = self._post("/chat/completions", {"model": self.model, "messages": brief,
                              "max_tokens": 1800, "response_format": {"type": "json_object"}}, max_retries)
            self.usage["calls"] += 1
            return self._coerce_json(data["choices"][0]["message"].get("content") or "{}")

    def _coerce_json(self, text):
        """Small models wrap JSON in fences, prepend prose, or leave trailing commas."""
        t = text.strip()
        if t.startswith("```"):
            t = t.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        for cand in (t,):
            try:
                return json.loads(cand)
            except json.JSONDecodeError:
                pass
        start, end = t.find("{"), t.rfind("}")
        if start >= 0 and end > start:
            frag = t[start:end + 1]
            for fix in (frag, re.sub(r",\s*([}\]])", r"\1", frag)):
                try:
                    return json.loads(fix)
                except json.JSONDecodeError:
                    continue
        repaired = self._repair_truncated(t)
        if repaired is not None:
            return repaired
        raise LLMError(f"{self.name}: non-JSON output: {text[:200]}")

    @staticmethod
    def _repair_truncated(t):
        """Output cut off by max_tokens: close open strings/brackets; if still
        invalid, cut back to the last complete pair and close again."""
        start = t.find("{")
        if start < 0:
            return None

        def closed(s):
            stack, in_str, esc = [], False, False
            for ch in s:
                if in_str:
                    if esc:
                        esc = False
                    elif ch == "\\":
                        esc = True
                    elif ch == '"':
                        in_str = False
                elif ch == '"':
                    in_str = True
                elif ch in "{[":
                    stack.append(ch)
                elif ch in "}]" and stack:
                    stack.pop()
            s += '"' if in_str else ""
            return s + "".join("}" if c == "{" else "]" for c in reversed(stack))

        cand = t[start:]
        for _ in range(40):
            try:
                return json.loads(re.sub(r",\s*([}\]])", r"\1", closed(cand)))
            except json.JSONDecodeError:
                cut = cand.rfind(",")
                if cut <= 0:
                    return None
                cand = cand[:cut]

    def _post(self, path, body, max_retries):
        payload = json.dumps(body).encode()
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {self.key}",
                   **self.extra_headers}
        last = None
        for attempt in range(max_retries):
            req = urllib.request.Request(self.base + path, data=payload, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=180) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                msg = e.read().decode(errors="replace")[:400]
                last = LLMError(f"{self.name} HTTP {e.code}: {msg}")
                # Some models reject temperature; drop it and retry once.
                if e.code == 400 and "temperature" in msg and "temperature" in body:
                    body.pop("temperature")
                    payload = json.dumps(body).encode()
                    continue
                if e.code not in (429, 500, 502, 503, 504):
                    raise last
                if e.code == 429:  # shared free-tier pool: wait it out, don't die
                    time.sleep(min(15 * (attempt + 1), 60))
                    continue
            except Exception as e:  # network
                last = LLMError(f"{self.name}: {e}")
            time.sleep(2 * (attempt + 1))
        raise last


def brain_key():
    return config.OPENROUTER_API_KEY if config.BRAIN == "openrouter" else "local"


def strategist_client():
    return ChatClient(config.STRATEGIST_BASE, brain_key(), config.MODEL_STRATEGIST,
                      f"strategist:{config.MODEL_STRATEGIST}")


def doer_client():
    return ChatClient(config.DOER_BASE, brain_key(), config.MODEL_DOER,
                      f"doer:{config.MODEL_DOER}")


def liquid_client():
    if not config.OPENROUTER_API_KEY:
        return None
    return ChatClient(config.OPENROUTER_BASE, config.OPENROUTER_API_KEY, config.MODEL_LIQUID,
                      f"liquid:{config.MODEL_LIQUID}",
                      {"HTTP-Referer": "https://github.com/remaster", "X-Title": "REMaster"})


def approx_tokens(text):
    return max(1, len(text) // 4)
