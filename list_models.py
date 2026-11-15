"""Print the model ids the configured endpoint offers (GET /v1/models).

Usage, from the project root:
    python list_models.py            # all models
    python list_models.py llama      # only ids containing "llama"

Pick one id and paste it into `defaults.model` in backend/config.yaml.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import openai
import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent


def main() -> int:
    load_dotenv(ROOT / ".env")
    try:
        config = yaml.safe_load((ROOT / "backend" / "config.yaml").read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as exc:
        print(f"Impossibile leggere backend/config.yaml: {exc}", file=sys.stderr)
        return 1
    defaults = config.get("defaults") or {}
    base_url = defaults.get("base_url", "https://integrate.api.nvidia.com/v1")
    key_env = defaults.get("api_key_env", "NVIDIA_API_KEY")
    api_key = os.getenv(key_env)
    if not api_key:
        print(f"Variabile d'ambiente {key_env} non impostata: mettila in .env (vedi .env.example).", file=sys.stderr)
        return 1

    needle = sys.argv[1].lower() if len(sys.argv) > 1 else ""
    try:
        models = openai.OpenAI(base_url=base_url, api_key=api_key, timeout=30).models.list()
    except openai.OpenAIError as exc:
        print(f"Richiesta a {base_url}/models fallita: {exc}", file=sys.stderr)
        return 1
    ids = sorted(m.id for m in models.data if needle in m.id.lower())
    print("\n".join(ids))
    print(f"\n{len(ids)} modelli da {base_url}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
