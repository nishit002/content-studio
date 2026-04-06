"""
llm_client.py — LLM helpers for the ATLAS pipeline.

Two clients:
  GeminiClient  — calls Google Gemini REST API (flash model)
  QwenClient    — calls Qwen3-235B-A22B via HuggingFace Router (same as content-generator)
                  Falls back to Gemini if HF is unavailable.

Both return plain strings. JSON parsing is the caller's responsibility.
"""

from __future__ import annotations

import json
import logging
import os
import random
import time
from typing import Optional

import requests
from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger("atlas.llm")

GEMINI_KEY    = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL  = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

HF_URL        = os.getenv("HF_API_URL", "https://router.huggingface.co/v1/chat/completions")
HF_MODEL      = os.getenv("HF_MODEL", "Qwen/Qwen3-235B-A22B")

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


# ─── Gemini ───────────────────────────────────────────────────────────────────

class GeminiClient:
    """
    Calls Gemini via REST.
    Usage:
        client = GeminiClient()
        text = client.generate("Summarise this...")
        data = client.generate_json("Return JSON with keys x, y...")
    """

    def __init__(self, model: Optional[str] = None):
        self.model = model or GEMINI_MODEL
        if not GEMINI_KEY:
            raise EnvironmentError("GEMINI_API_KEY not set in .env")

    def generate(
        self,
        prompt: str,
        temperature: float = 0.2,
        max_tokens: int = 8192,
        retries: int = 3,
    ) -> str:
        url = f"{GEMINI_BASE}/{self.model}:generateContent?key={GEMINI_KEY}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            },
        }
        for attempt in range(retries):
            try:
                resp = requests.post(url, json=payload, timeout=120)
                resp.raise_for_status()
                result = resp.json()
                # Filter out thought parts (Gemini 2.5 Flash returns thinking traces)
                candidates = result.get("candidates", [])
                if not candidates:
                    raise ValueError("No candidates in Gemini response")
                parts = candidates[0].get("content", {}).get("parts", [])
                text_parts = [p["text"] for p in parts if not p.get("thought", False) and "text" in p]
                if not text_parts:
                    raise ValueError("No text parts in Gemini response")
                return "".join(text_parts).strip()
            except requests.exceptions.HTTPError as e:
                status = e.response.status_code if e.response else 0
                if status == 429:
                    wait = 2 ** attempt * 5
                    log.warning(f"Gemini rate-limit, waiting {wait}s (attempt {attempt+1}/{retries})")
                    time.sleep(wait)
                elif status >= 500:
                    log.warning(f"Gemini server error {status}, retrying...")
                    time.sleep(3)
                else:
                    raise
            except Exception as e:
                if attempt < retries - 1:
                    log.warning(f"Gemini attempt {attempt+1} failed: {e} — retrying")
                    time.sleep(2)
                else:
                    raise
        raise RuntimeError("Gemini: all retries exhausted")

    def generate_json(
        self,
        prompt: str,
        temperature: float = 0.1,
        max_tokens: int = 8192,
        retries: int = 3,
    ) -> dict | list:
        """
        Like generate() but strips markdown fences and parses JSON.
        Retries up to `retries` times if JSON is truncated or malformed.
        Raises ValueError if all attempts fail.
        """
        full_prompt = (
            prompt
            + "\n\nIMPORTANT: Respond with valid JSON only. No markdown fences, no explanation, "
            "no text before or after the JSON."
        )
        last_err: Exception | None = None
        for attempt in range(retries):
            raw = self.generate(full_prompt, temperature=temperature, max_tokens=max_tokens)
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                lines = cleaned.split("\n")
                cleaned = "\n".join(lines[1:-1] if lines[-1].startswith("```") else lines[1:])
            try:
                return json.loads(cleaned)
            except json.JSONDecodeError as e:
                last_err = e
                log.warning(f"Gemini JSON parse failed (attempt {attempt+1}/{retries}): {e}")
                log.debug(f"Raw response:\n{raw[:300]}")
                if attempt < retries - 1:
                    time.sleep(2)
        log.error(f"Gemini JSON parse failed after {retries} attempts.\nRaw response:\n{raw[:500]}")
        raise ValueError(f"Gemini did not return valid JSON: {last_err}") from last_err


# ─── Qwen via HuggingFace Router ─────────────────────────────────────────────

class QwenClient:
    """
    Calls Qwen3-235B-A22B via HuggingFace Router.
    Same model + API setup as the content-generator pipeline.
    Falls back to Gemini if HF is unavailable or returns an error.

    Reads HF keys from (in order, all deduped into a pool):
      HF_API_KEY, HF_TOKEN, HF_API_KEYS (comma-separated), HF_API_KEY_2..5
    Rotates keys round-robin per call.
    """

    def __init__(self):
        self._gemini_fallback = GeminiClient()
        self.model = HF_MODEL
        self.url   = HF_URL

        # Load all HF keys — same logic as content-generator/src/llm_client.py
        pool: list[str] = []
        for varname in ("HF_API_KEY", "HF_TOKEN"):
            v = os.getenv(varname, "").strip()
            if v and v not in pool:
                pool.append(v)
        for v in os.getenv("HF_API_KEYS", "").split(","):
            v = v.strip()
            if v and v not in pool:
                pool.append(v)
        for i in range(2, 6):
            v = os.getenv(f"HF_API_KEY_{i}", "").strip()
            if v and v not in pool:
                pool.append(v)

        self._keys = pool
        self._key_idx = 0

        if self._keys:
            log.info(f"QwenClient: {len(self._keys)} HF key(s) loaded, model={self.model}")
        else:
            log.warning("QwenClient: no HF keys found — will fall back to Gemini for all writing")

    def _next_key(self) -> Optional[str]:
        if not self._keys:
            return None
        key = self._keys[self._key_idx % len(self._keys)]
        self._key_idx += 1
        return key

    def generate(
        self,
        system: str,
        user: str,
        temperature: float = 0.45,
        max_tokens: int = 8000,
    ) -> str:
        """
        Send system + user messages to Qwen via HF Router.
        Returns assistant reply as plain string.
        Falls back to Gemini if HF fails.
        """
        key = self._next_key()
        if not key:
            log.warning("QwenClient: no HF key — using Gemini fallback")
            return self._gemini_fallback.generate(
                f"{system}\n\n---\n\n{user}", temperature=temperature, max_tokens=max_tokens
            )

        messages = [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ]

        # Cap max_tokens to fit Qwen's 128K context window
        prompt_chars = len(system) + len(user)
        estimated_tokens = prompt_chars // 3
        safe_max = max(4000, 128000 - estimated_tokens - 200)
        max_tokens = min(max_tokens, safe_max)

        payload = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
        }
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

        # 504 = HF overloaded — go to Gemini immediately, no retry
        # 429 = rate limit — rotate key and retry twice
        # 503 = transient — retry once
        retry_delays = [5, 15]
        for attempt, delay in enumerate([0] + retry_delays):
            if delay:
                time.sleep(delay + random.uniform(1, 2))
            try:
                resp = requests.post(self.url, json=payload, headers=headers, timeout=90)

                if resp.status_code == 200:
                    data = resp.json()
                    # Reject if HF Router silently served a different model
                    served = data.get("model", "")
                    if served and "qwen" not in served.lower():
                        log.warning(f"HF Router served '{served}' instead of Qwen — using Gemini fallback")
                        break
                    text = data["choices"][0]["message"]["content"].strip()
                    log.debug(f"Qwen: {len(text)} chars (attempt {attempt+1})")
                    return text

                if resp.status_code == 504:
                    # Gateway timeout — HF is overloaded, retrying won't help
                    log.warning("Qwen HF 504 (gateway timeout) — falling back to Gemini immediately")
                    break

                if resp.status_code in (429, 503) and attempt < len(retry_delays):
                    log.warning(f"Qwen HF {resp.status_code}, retrying (attempt {attempt+1})")
                    # Rotate key on 429
                    key = self._next_key() or key
                    headers["Authorization"] = f"Bearer {key}"
                    continue

                log.error(f"Qwen HF error {resp.status_code}: {resp.text[:200]}")
                break

            except requests.exceptions.Timeout:
                log.warning(f"Qwen attempt {attempt+1} timed out (90s) — falling back to Gemini")
                break
            except Exception as e:
                log.warning(f"Qwen attempt {attempt+1} exception: {e}")
                if attempt < len(retry_delays):
                    continue
                break

        # Gemini fallback
        log.warning("QwenClient: falling back to Gemini")
        return self._gemini_fallback.generate(
            f"{system}\n\n---\n\n{user}", temperature=temperature, max_tokens=max_tokens
        )
