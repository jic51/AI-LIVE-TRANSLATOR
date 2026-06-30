"""Optional high-quality TTS via Microsoft VibeVoice.

VibeVoice (https://github.com/microsoft/VibeVoice) is a text-to-speech model, not a
translator. We use it purely for stage 3 of the pipeline (text -> natural voice) once
the text has already been translated by translator.py.

This module is a thin, lazily-loaded wrapper: if VibeVoice isn't installed or
VIBEVOICE_MODEL_PATH isn't set, `is_available()` returns False and the API falls back
to the browser's built-in speech synthesis instead.
"""
import os
from functools import lru_cache
from io import BytesIO

MODEL_PATH = os.environ.get("VIBEVOICE_MODEL_PATH")


def is_available() -> bool:
    if not MODEL_PATH:
        return False
    try:
        import vibevoice  # noqa: F401
    except ImportError:
        return False
    return True


@lru_cache(maxsize=1)
def _load_pipeline():
    from vibevoice.modular.modeling_vibevoice_inference import (
        VibeVoiceForConditionalGenerationInference,
    )
    from vibevoice.processor.vibevoice_processor import VibeVoiceProcessor

    processor = VibeVoiceProcessor.from_pretrained(MODEL_PATH)
    model = VibeVoiceForConditionalGenerationInference.from_pretrained(MODEL_PATH)
    return processor, model


def synthesize(text: str, language: str) -> bytes:
    """Generate WAV audio bytes for `text` using VibeVoice.

    Raises RuntimeError if VibeVoice isn't configured; callers should check
    is_available() first and fall back to client-side TTS otherwise.
    """
    if not is_available():
        raise RuntimeError(
            "VibeVoice is not configured. Set VIBEVOICE_MODEL_PATH and install the "
            "VibeVoice package (see README) to enable high-quality voice synthesis."
        )

    import soundfile as sf

    processor, model = _load_pipeline()
    inputs = processor(text=[text], return_tensors="pt")
    output = model.generate(**inputs, max_new_tokens=None)
    audio = output.speech_outputs[0]

    buffer = BytesIO()
    sf.write(buffer, audio.cpu().numpy(), samplerate=24000, format="WAV")
    return buffer.getvalue()
