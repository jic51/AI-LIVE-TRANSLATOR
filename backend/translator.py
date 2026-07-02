"""
Translation engine with two providers:

  1. DeepL API (preferred) — used when DEEPL_API_KEY is set in the environment.
     Free tier: 500,000 characters/month. Quality is significantly better than
     argostranslate and latency is ~100ms vs ~300ms.

  2. argostranslate (fallback) — 100% offline, no API key needed.
     Used automatically when DEEPL_API_KEY is not set or the DeepL call fails.

Set your key before starting the server:
    Windows PowerShell:  $env:DEEPL_API_KEY = "your-key-here:fx"
    Linux/Mac:           export DEEPL_API_KEY="your-key-here:fx"

Free API keys end in ":fx" and use the api-free.deepl.com endpoint.
Get one at: https://www.deepl.com/pro-api (free tier, no credit card needed)
"""
import os
from functools import lru_cache
from threading import Lock

# ── DeepL ─────────────────────────────────────────────────────────────────────
_deepl_client = None
_deepl_ready = False

DEEPL_API_KEY = os.environ.get("DEEPL_API_KEY", "").strip()

DEEPL_LANG_MAP = {
    "en": "EN",
    "es": "ES",
}


def _init_deepl():
    global _deepl_client, _deepl_ready
    if not DEEPL_API_KEY:
        return
    try:
        import deepl
        _deepl_client = deepl.Translator(DEEPL_API_KEY)
        # Quick ping to verify key is valid
        _deepl_client.get_usage()
        _deepl_ready = True
    except Exception as e:
        print(f"[translator] DeepL init failed ({e}), falling back to argostranslate")
        _deepl_client = None
        _deepl_ready = False


def _translate_deepl(text: str, source_lang: str, target_lang: str) -> str:
    result = _deepl_client.translate_text(
        text,
        source_lang=DEEPL_LANG_MAP[source_lang],
        target_lang=DEEPL_LANG_MAP[target_lang],
    )
    return result.text


# ── argostranslate (fallback) ─────────────────────────────────────────────────
import argostranslate.package
import argostranslate.translate

LANG_PAIRS = [("en", "es"), ("es", "en")]
_argo_ready = False
_lock = Lock()


def _ensure_argos():
    global _argo_ready
    with _lock:
        installed = {
            (p.from_code, p.to_code)
            for p in argostranslate.package.get_installed_packages()
        }
        missing = [pair for pair in LANG_PAIRS if pair not in installed]
        if missing:
            argostranslate.package.update_package_index()
            available = argostranslate.package.get_available_packages()
            for from_code, to_code in missing:
                match = next(
                    p for p in available
                    if p.from_code == from_code and p.to_code == to_code
                )
                argostranslate.package.install_from_path(match.download())
        _argo_ready = True


@lru_cache(maxsize=1)
def _argo_languages():
    return argostranslate.translate.get_installed_languages()


def _translate_argos(text: str, source_lang: str, target_lang: str) -> str:
    languages = _argo_languages()
    source = next((l for l in languages if l.code == source_lang), None)
    target = next((l for l in languages if l.code == target_lang), None)
    if not source or not target:
        raise RuntimeError(f"Language not found: {source_lang} or {target_lang}")
    translation = source.get_translation(target)
    if not translation:
        raise RuntimeError(f"No argostranslate model for {source_lang}→{target_lang}")
    return translation.translate(text)


# ── Public API ─────────────────────────────────────────────────────────────────

def ensure_models() -> None:
    """Called on server startup. Initializes whichever providers are available."""
    _init_deepl()
    if not _deepl_ready:
        print("[translator] DeepL not available — loading argostranslate models…")
        _ensure_argos()
    else:
        print("[translator] Using DeepL API (high quality)")
        # Still ensure argos is installed for fallback, but don't block startup
        try:
            _ensure_argos()
        except Exception:
            pass  # argos fallback is best-effort


def active_provider() -> str:
    if _deepl_ready:
        return "deepl"
    if _argo_ready:
        return "argostranslate"
    return "none"


def models_ready() -> bool:
    return _deepl_ready or _argo_ready


def translate(text: str, source_lang: str, target_lang: str) -> str:
    if source_lang not in ("en", "es") or target_lang not in ("en", "es"):
        raise ValueError("Only 'en' and 'es' are supported.")
    if source_lang == target_lang:
        return text
    if not text.strip():
        return text

    # Try DeepL first
    if _deepl_ready:
        try:
            return _translate_deepl(text, source_lang, target_lang)
        except Exception as e:
            print(f"[translator] DeepL error ({e}), falling back to argostranslate")

    # Fallback to argostranslate
    if _argo_ready:
        return _translate_argos(text, source_lang, target_lang)

    raise RuntimeError(
        "No translation provider available. "
        "Set DEEPL_API_KEY or run setup_models.py to install argostranslate."
    )
