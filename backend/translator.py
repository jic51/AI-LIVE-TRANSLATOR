"""Offline EN<->ES machine translation backed by argostranslate."""
from functools import lru_cache

import argostranslate.package
import argostranslate.translate

LANG_PAIRS = [("en", "es"), ("es", "en")]


def ensure_models() -> None:
    """Download and install the EN<->ES argostranslate packages if missing."""
    argostranslate.package.update_package_index()
    available = argostranslate.package.get_available_packages()
    installed = {
        (p.from_code, p.to_code) for p in argostranslate.package.get_installed_packages()
    }
    for from_code, to_code in LANG_PAIRS:
        if (from_code, to_code) in installed:
            continue
        match = next(
            p for p in available if p.from_code == from_code and p.to_code == to_code
        )
        argostranslate.package.install_from_path(match.download())


@lru_cache(maxsize=1)
def _installed_languages():
    return argostranslate.translate.get_installed_languages()


def translate(text: str, source_lang: str, target_lang: str) -> str:
    if source_lang not in ("en", "es") or target_lang not in ("en", "es"):
        raise ValueError("Only 'en' and 'es' are supported")
    if source_lang == target_lang:
        return text

    languages = _installed_languages()
    source = next(l for l in languages if l.code == source_lang)
    target = next(l for l in languages if l.code == target_lang)
    translation = source.get_translation(target)
    if translation is None:
        raise RuntimeError(
            f"No translation model installed for {source_lang}->{target_lang}. "
            "Run ensure_models() first."
        )
    return translation.translate(text)
