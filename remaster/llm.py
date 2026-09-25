"""Minimal OpenAI-compatible chat client (stdlib only).

Used for OpenAI (strategist / doer / cleaner / shadows) and OpenRouter (Liquid LFM).
All agents ask for JSON output, so every call returns a parsed dict.
"""
import json
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

    def json(self, messages, temperature=None, cache_key=None, max_retries=3):
        body = {"model": self.model, "messages": messages,
                "response_format": {"type": "json_object"}}
        if temperature is not None:
            body["temperature"] = temperature
        if cache_key and "openai.com" in self.base:
            body["prompt_cache_key"] = cache_key
        data = self._post("/chat/completions", body, max_retries)
        u = data.get("usage") or {}
        self.usage["calls"] += 1
        self.usage["prompt_tokens"] += u.get("prompt_tokens", 0)
        self.usage["completion_tokens"] += u.get("completion_tokens", 0)
        self.usage["cached_tokens"] += (u.get("prompt_tokens_details") or {}).get("cached_tokens", 0) or 0
        text = data["choices"][0]["message"].get("content") or "{}"
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            start, end = text.find("{"), text.rfind("}")
            if start >= 0 and end > start:
                return json.loads(text[start:end + 1])
            raise LLMError(f"{self.name}: non-JSON output: {text[:200]}")

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
            except Exception as e:  # network
                last = LLMError(f"{self.name}: {e}")
            time.sleep(2 * (attempt + 1))
        raise last


def openai_client(model):
    return ChatClient(config.OPENAI_BASE, config.OPENAI_API_KEY, model, f"openai:{model}")


def liquid_client():
    if not config.OPENROUTER_API_KEY:
        return None
    return ChatClient(config.OPENROUTER_BASE, config.OPENROUTER_API_KEY, config.MODEL_LIQUID,
                      f"liquid:{config.MODEL_LIQUID}",
                      {"HTTP-Referer": "https://github.com/remaster", "X-Title": "REMaster"})


def approx_tokens(text):
    return max(1, len(text) // 4)
