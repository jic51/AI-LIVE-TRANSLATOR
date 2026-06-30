from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import translator
import vibevoice_tts

app = FastAPI(title="AI Live Translator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TranslateRequest(BaseModel):
    text: str
    source_lang: str  # "en" | "es"
    target_lang: str  # "en" | "es"


class TranslateResponse(BaseModel):
    translated_text: str


class TtsRequest(BaseModel):
    text: str
    language: str  # "en" | "es"


@app.get("/health")
def health():
    return {"status": "ok", "vibevoice_available": vibevoice_tts.is_available()}


@app.post("/translate", response_model=TranslateResponse)
def translate_text(req: TranslateRequest):
    if not req.text.strip():
        return TranslateResponse(translated_text="")
    try:
        result = translator.translate(req.text, req.source_lang, req.target_lang)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return TranslateResponse(translated_text=result)


@app.post("/tts")
def text_to_speech(req: TtsRequest):
    if not vibevoice_tts.is_available():
        raise HTTPException(
            status_code=501,
            detail="VibeVoice not configured on this server; use browser TTS instead.",
        )
    audio_bytes = vibevoice_tts.synthesize(req.text, req.language)
    return Response(content=audio_bytes, media_type="audio/wav")
