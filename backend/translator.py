"""Offline EN<->ES machine translation backed by argostranslate."""
from functools import lru_cache
from threading import Lock

import argostranslate.package
import argostranslate.translate

LANG_PAIRS = [("en", "es"), ("es", "en")]
_ready = False
_lock = Lock()


def models_ready() -> bool:
    return _ready


def ensure_models() -> None:
    """Download and install EN<->ES packages if missing. Safe to call multiple times."""
    global _ready
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
        _ready = True


@lru_cache(maxsize=1)
def _installed_languages():
    return argostranslate.translate.get_installed_languages()


def translate(text: str, source_lang: str, target_lang: str) -> str:
    if not _ready:
        raise RuntimeError(
            "Translation models not loaded yet. Run ensure_models() on startup."
        )
    languages = _installed_languages()
    source = next((l for l in languages if l.code == source_lang), None)
    target = next((l for l in languages if l.code == target_lang), None)
    if source is None or target is None:
        raise RuntimeError(f"Language not found: {source_lang} or {target_lang}")
    translation = source.get_translation(target)
    if translation is None:
        raise RuntimeError(
            f"No translation model for {source_lang}->{target_lang}. Run ensure_models()."
        )
    return translation.translate(text)
