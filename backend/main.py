from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import os

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
    source_lang: str
    target_lang: str


class TtsRequest(BaseModel):
    text: str
    language: str  # "en" | "es"


@app.get("/health")
def health():
    return {
        "status": "ok",
        "vibevoice_available": vibevoice_tts.is_available(),
        "models_ready": translator.models_ready(),
    }


@app.post("/translate", response_model=TranslateResponse)
def translate_text(req: TranslateRequest):
    if not req.text.strip():
        return TranslateResponse(
            translated_text="", source_lang=req.source_lang, target_lang=req.target_lang
        )
    if req.source_lang not in ("en", "es") or req.target_lang not in ("en", "es"):
        raise HTTPException(status_code=400, detail="Only 'en' and 'es' are supported.")
    if req.source_lang == req.target_lang:
        return TranslateResponse(
            translated_text=req.text, source_lang=req.source_lang, target_lang=req.target_lang
        )
    try:
        result = translator.translate(req.text, req.source_lang, req.target_lang)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return TranslateResponse(
        translated_text=result, source_lang=req.source_lang, target_lang=req.target_lang
    )


@app.post("/tts")
def text_to_speech(req: TtsRequest):
    if not vibevoice_tts.is_available():
        raise HTTPException(
            status_code=501,
            detail="VibeVoice not configured. Use browser TTS instead.",
        )
    try:
        audio_bytes = vibevoice_tts.synthesize(req.text, req.language)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return Response(content=audio_bytes, media_type="audio/wav")


# Serve frontend as static files when running in production
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
