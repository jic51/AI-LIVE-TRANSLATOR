# AI Live Translator (EN ⇄ ES)

Traductor en tiempo real (texto y voz) entre inglés y español.

## Arquitectura

El pipeline de un traductor de voz en vivo tiene 3 etapas independientes:

```
voz/texto entrada → [1. ASR: voz→texto] → [2. MT: traducción] → [3. TTS: texto→voz] → salida
```

[VibeVoice](https://github.com/microsoft/VibeVoice) (el repo que diste) es un modelo de
**TTS** (texto-a-voz) de Microsoft: genera audio largo, multi-hablante y muy natural a
partir de texto. **No hace traducción ni reconocimiento de voz** — por eso este proyecto
lo usa solo como motor de voz opcional para la etapa 3 (la voz "bonita" del resultado),
y resuelve las etapas 1 y 2 con otras piezas:

| Etapa | Tecnología usada | Por qué |
|---|---|---|
| 1. ASR (voz→texto) | Web Speech API del navegador (`SpeechRecognition`), con gancho para `faster-whisper` en servidor | Streaming real, gratis, cero latencia de red para el MVP |
| 2. MT (traducción) | `argostranslate` (offline, EN⇄ES) en el backend | Traducción real sin depender de APIs de pago, corre local |
| 3. TTS (texto→voz) | `window.speechSynthesis` del navegador por defecto; **VibeVoice** como motor "alta calidad" opcional vía backend | Latencia mínima por defecto; VibeVoice cuando se quiere voz natural/clonada |

## Estructura

```
backend/    FastAPI: /translate, /tts, /health
frontend/   Web app: mic en vivo, subtítulos duales, reproducción
```

## Cómo correrlo

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# Instala los modelos de traducción offline EN<->ES la primera vez:
python -c "from translator import ensure_models; ensure_models()"
uvicorn main:app --reload --port 8000
```

### VibeVoice (opcional, voz de alta calidad)

```bash
git clone https://github.com/microsoft/VibeVoice.git backend/vibevoice_src
cd backend/vibevoice_src && pip install -e .
# Descarga el checkpoint según las instrucciones del repo de VibeVoice (requiere GPU
# para tiempos de generación razonables). Configura la ruta del modelo con:
export VIBEVOICE_MODEL_PATH=/ruta/al/checkpoint
```

Si `VIBEVOICE_MODEL_PATH` no está configurado, el endpoint `/tts` responde `501` y el
frontend cae automáticamente a la voz nativa del navegador — la app funciona igual,
solo sin la voz "premium".

### Frontend

Solo abre `frontend/index.html` en el navegador (Chrome/Edge recomendado por
`SpeechRecognition`), o sírvelo con cualquier servidor estático:

```bash
cd frontend && python -m http.server 5173
```

Configura la URL del backend en el campo de la UI (por defecto `http://localhost:8000`).

## Flujo de uso

1. Elige dirección: Inglés → Español o Español → Inglés.
2. Pulsa el micrófono y habla, o escribe texto directamente.
3. La transcripción aparece en vivo, se traduce automáticamente al soltar/pausar, y se
   reproduce en voz (nativa del navegador o VibeVoice si está configurado).
