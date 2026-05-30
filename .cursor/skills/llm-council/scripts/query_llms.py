#!/usr/bin/env python3
"""
Запрос перспектив у ChatGPT и Gemini.

Приоритет:
1. CLI (gemini, codex)
2. API (OPENAI_API_KEY, GEMINI_API_KEY из .env или окружения)
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Dict, Optional, Tuple


def load_env_file(env_path: str = ".env") -> Dict[str, str]:
    env_vars: Dict[str, str] = {}
    if not os.path.exists(env_path):
        return env_vars

    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env_vars[key.strip()] = value.strip().strip('"').strip("'")

    return env_vars


def is_cli_available(cli_name: str) -> bool:
    return shutil.which(cli_name) is not None


def query_gemini_cli(prompt: str, timeout: int = 60) -> Tuple[bool, str]:
    try:
        result = subprocess.run(
            ["gemini", "-p", prompt],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode == 0:
            return True, result.stdout.strip()
        return False, f"gemini-cli error: {result.stderr.strip()}"
    except subprocess.TimeoutExpired:
        return False, "gemini-cli timed out"
    except Exception as exc:
        return False, f"gemini-cli exception: {exc}"


def query_codex_cli(prompt: str, timeout: int = 60) -> Tuple[bool, str]:
    try:
        result = subprocess.run(
            ["codex", "-p", prompt],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode == 0:
            return True, result.stdout.strip()
        return False, f"codex error: {result.stderr.strip()}"
    except subprocess.TimeoutExpired:
        return False, "codex timed out"
    except Exception as exc:
        return False, f"codex exception: {exc}"


def http_post_json(url: str, payload: dict, headers: dict, timeout: int = 30) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def query_openai(prompt: str, api_key: str, model: str = "gpt-5-nano") -> Optional[str]:
    try:
        data = http_post_json(
            "https://api.openai.com/v1/chat/completions",
            {
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 2000,
                "temperature": 0.7,
            },
            {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )
        return data["choices"][0]["message"]["content"]
    except Exception as exc:
        return f"Error querying ChatGPT ({model}): {exc}"


def query_gemini(
    prompt: str, api_key: str, model: str = "gemini-3-flash-preview"
) -> Optional[str]:
    try:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={api_key}"
        )
        data = http_post_json(
            url,
            {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.7, "maxOutputTokens": 2000},
            },
            {"Content-Type": "application/json"},
        )
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as exc:
        return f"Error querying Gemini ({model}): {exc}"


def main() -> None:
    if len(sys.argv) < 2:
        print(
            json.dumps(
                {
                    "error": "Usage: query_llms.py <prompt>",
                    "chatgpt": None,
                    "gemini": None,
                },
                ensure_ascii=False,
            )
        )
        sys.exit(1)

    prompt = " ".join(sys.argv[1:])
    env_vars = load_env_file()

    openai_key = env_vars.get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    gemini_key = env_vars.get("GEMINI_API_KEY") or os.environ.get("GEMINI_API_KEY")
    openai_model = (
        env_vars.get("OPENAI_MODEL") or os.environ.get("OPENAI_MODEL") or "gpt-5-nano"
    )
    gemini_model = (
        env_vars.get("GEMINI_MODEL")
        or os.environ.get("GEMINI_MODEL")
        or "gemini-3-flash-preview"
    )

    chatgpt_response: Optional[str] = None
    chatgpt_source = "none"

    if is_cli_available("codex"):
        success, response = query_codex_cli(prompt)
        if success:
            chatgpt_response = response
            chatgpt_source = "codex-cli"

    if chatgpt_response is None:
        if openai_key:
            chatgpt_response = query_openai(prompt, openai_key, openai_model)
            chatgpt_source = f"api ({openai_model})"
        else:
            chatgpt_response = (
                "Error: codex CLI not available and OPENAI_API_KEY not found"
            )

    gemini_response: Optional[str] = None
    gemini_source = "none"

    if is_cli_available("gemini"):
        success, response = query_gemini_cli(prompt)
        if success:
            gemini_response = response
            gemini_source = "gemini-cli"

    if gemini_response is None:
        if gemini_key:
            gemini_response = query_gemini(prompt, gemini_key, gemini_model)
            gemini_source = f"api ({gemini_model})"
        else:
            gemini_response = (
                "Error: gemini CLI not available and GEMINI_API_KEY not found"
            )

    result = {
        "prompt": prompt,
        "chatgpt": {
            "model": openai_model,
            "source": chatgpt_source,
            "response": chatgpt_response,
        },
        "gemini": {
            "model": gemini_model,
            "source": gemini_source,
            "response": gemini_response,
        },
    }

    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
