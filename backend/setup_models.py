"""Run once to download and install the EN<->ES translation models offline."""
import sys
print("Downloading argostranslate EN<->ES models (requires internet, ~100MB)…")
from translator import ensure_models
ensure_models()
print("Done. Translation models ready for offline use.")
