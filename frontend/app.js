/* ─── State ─────────────────────────────────────────────────────────────── */
const state = {
  sourceLang: 'en',
  targetLang: 'es',
  ttsEnabled: true,
  micActive: false,
  backendUrl: localStorage.getItem('backendUrl') || 'http://localhost:8000',
};

let recognition = null;
let debounceTimer = null;
let currentAudio = null;

/* ─── DOM refs ───────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const finalOriginalEl    = $('final-original');
const interimOriginalEl  = $('interim-original');
const finalTranslatedEl  = $('final-translated');
const interimTranslatedEl = $('interim-translated');
const micBtn             = $('mic-btn');
const micLabel           = $('mic-label');
const statusBar          = $('status-bar');
const ttsToggle          = $('tts-toggle');
const ttsThumb           = $('tts-thumb');
const ttsStatus          = $('tts-status');
const transIndicator     = $('translating-indicator');
const langSourceLabel    = $('lang-source-label');
const langTargetLabel    = $('lang-target-label');
const panelSourceLabel   = $('panel-source-label');
const panelTargetLabel   = $('panel-target-label');

/* ─── Language labels ────────────────────────────────────────────────────── */
const LANG_NAMES = { en: 'Inglés', es: 'Español' };

function updateLanguageLabels() {
  const src = LANG_NAMES[state.sourceLang];
  const tgt = LANG_NAMES[state.targetLang];
  langSourceLabel.textContent = src;
  langTargetLabel.textContent = tgt;
  panelSourceLabel.textContent = `${src} — original`;
  panelTargetLabel.textContent = `${tgt} — traducción`;
  if (recognition) {
    recognition.lang = state.sourceLang === 'en' ? 'en-US' : 'es-ES';
  }
}

/* ─── TTS toggle ─────────────────────────────────────────────────────────── */
function applyTtsUI() {
  ttsToggle.setAttribute('aria-checked', state.ttsEnabled);
  if (state.ttsEnabled) {
    ttsToggle.classList.add('bg-brand');
    ttsToggle.classList.remove('bg-gray-300');
    ttsThumb.classList.add('translate-x-6');
    ttsThumb.classList.remove('translate-x-1');
  } else {
    ttsToggle.classList.remove('bg-brand');
    ttsToggle.classList.add('bg-gray-300');
    ttsThumb.classList.remove('translate-x-6');
    ttsThumb.classList.add('translate-x-1');
  }
}

function toggleTts() {
  state.ttsEnabled = !state.ttsEnabled;
  applyTtsUI();
  if (!state.ttsEnabled) stopAudio();
}

/* ─── Language swap ──────────────────────────────────────────────────────── */
function swapLanguages() {
  [state.sourceLang, state.targetLang] = [state.targetLang, state.sourceLang];
  updateLanguageLabels();
  clearAll();
}

/* ─── Clear ──────────────────────────────────────────────────────────────── */
function clearAll() {
  finalOriginalEl.textContent    = '';
  interimOriginalEl.textContent  = '';
  finalTranslatedEl.textContent  = '';
  interimTranslatedEl.textContent = '';
  stopAudio();
  hideStatus();
}

/* ─── Status bar ─────────────────────────────────────────────────────────── */
function showStatus(msg, type = 'info') {
  statusBar.textContent = msg;
  statusBar.className = 'rounded-xl px-4 py-3 text-sm fade-in ';
  statusBar.className += type === 'error'
    ? 'bg-red-50 text-red-700 border border-red-100'
    : 'bg-blue-50 text-blue-700 border border-blue-100';
  statusBar.classList.remove('hidden');
}

function hideStatus() {
  statusBar.classList.add('hidden');
}

/* ─── Translation ────────────────────────────────────────────────────────── */
async function translateText(text, updateInterim = false) {
  if (!text.trim()) return;

  transIndicator.classList.remove('hidden');

  try {
    const res = await fetch(`${state.backendUrl}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        source_lang: state.sourceLang,
        target_lang: state.targetLang,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const translated = data.translated_text;

    if (updateInterim) {
      interimTranslatedEl.textContent = translated;
    } else {
      finalTranslatedEl.textContent += (finalTranslatedEl.textContent ? ' ' : '') + translated;
      interimTranslatedEl.textContent = '';
      if (state.ttsEnabled) speakText(translated, state.targetLang);
    }

    hideStatus();
  } catch (err) {
    showStatus(`Error de traducción: ${err.message}. ¿Está corriendo el backend?`, 'error');
  } finally {
    transIndicator.classList.add('hidden');
  }
}

/* ─── TTS (browser speech synthesis) ────────────────────────────────────── */
function speakText(text, lang) {
  stopAudio();
  if (!('speechSynthesis' in window)) return;

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang === 'en' ? 'en-US' : 'es-ES';
  utter.rate = 1.0;
  utter.pitch = 1.0;

  utter.onstart  = () => ttsStatus.classList.remove('hidden');
  utter.onend    = () => ttsStatus.classList.add('hidden');
  utter.onerror  = () => ttsStatus.classList.add('hidden');

  window.speechSynthesis.speak(utter);
  currentAudio = utter;
}

function stopAudio() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (currentAudio instanceof HTMLAudioElement) { currentAudio.pause(); currentAudio = null; }
  ttsStatus.classList.add('hidden');
}

/* ─── Speech Recognition ─────────────────────────────────────────────────── */
function buildRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) return null;

  const rec = new SpeechRec();
  rec.continuous      = true;
  rec.interimResults  = true;
  rec.maxAlternatives = 1;
  rec.lang            = state.sourceLang === 'en' ? 'en-US' : 'es-ES';

  rec.onresult = e => {
    let interim = '';
    let final   = '';

    for (let i = e.resultIndex; i < e.results.length; i++) {
      const transcript = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        final += transcript;
      } else {
        interim += transcript;
      }
    }

    if (interim) {
      interimOriginalEl.textContent = interim;
      // Translate interim with debounce for a "live preview" feel
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => translateText(interim, true), 600);
    }

    if (final) {
      finalOriginalEl.textContent += (finalOriginalEl.textContent ? ' ' : '') + final.trim();
      interimOriginalEl.textContent = '';
      interimTranslatedEl.textContent = '';
      clearTimeout(debounceTimer);
      translateText(final.trim(), false);
    }
  };

  rec.onerror = e => {
    if (e.error === 'not-allowed') {
      showStatus('Permiso de micrófono denegado. Habilítalo en la configuración del navegador.', 'error');
      setMicState(false);
    } else if (e.error !== 'no-speech') {
      showStatus(`Error de micrófono: ${e.error}`, 'error');
    }
  };

  rec.onend = () => {
    // Auto-restart if user didn't stop manually
    if (state.micActive) rec.start();
  };

  return rec;
}

function setMicState(active) {
  state.micActive = active;
  if (active) {
    micBtn.classList.add('pulse-ring', 'bg-red-500');
    micBtn.classList.remove('bg-brand', 'hover:bg-brand-dark');
    micBtn.setAttribute('title', 'Detener');
    micLabel.textContent = 'Escuchando… pulsa para detener';
    micLabel.classList.replace('text-gray-400', 'text-red-500');
  } else {
    micBtn.classList.remove('pulse-ring', 'bg-red-500');
    micBtn.classList.add('bg-brand', 'hover:bg-brand-dark');
    micBtn.setAttribute('title', 'Pulsa para hablar');
    micLabel.textContent = 'Pulsa el micrófono para empezar';
    micLabel.classList.replace('text-red-500', 'text-gray-400');
  }
}

function toggleMic() {
  if (state.micActive) {
    // Stop
    state.micActive = false;
    recognition?.stop();
    setMicState(false);
    hideStatus();
  } else {
    // Check browser support
    if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
      showStatus('Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.', 'error');
      return;
    }
    if (!recognition) recognition = buildRecognition();
    try {
      recognition.start();
      setMicState(true);
      hideStatus();
    } catch {
      // Already started; ignore
    }
  }
}

/* ─── Text input fallback ────────────────────────────────────────────────── */
function submitText() {
  const input = $('text-input');
  const text  = input.value.trim();
  if (!text) return;
  finalOriginalEl.textContent += (finalOriginalEl.textContent ? ' ' : '') + text;
  input.value = '';
  translateText(text, false);
}

$('text-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitText();
  }
});

/* ─── Settings modal ─────────────────────────────────────────────────────── */
function openSettings() {
  $('backend-url-input').value = state.backendUrl;
  $('settings-modal').classList.remove('hidden');
}

function closeSettings() {
  $('settings-modal').classList.add('hidden');
}

function saveSettings() {
  const url = $('backend-url-input').value.trim().replace(/\/$/, '');
  if (url) {
    state.backendUrl = url;
    localStorage.setItem('backendUrl', url);
  }
  closeSettings();
  pingBackend();
}

$('settings-modal').addEventListener('click', e => {
  if (e.target === $('settings-modal')) closeSettings();
});

/* ─── Backend health check ───────────────────────────────────────────────── */
async function pingBackend() {
  try {
    const res = await fetch(`${state.backendUrl}/health`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      if (!data.models_ready) {
        showStatus('Backend conectado. Cargando modelos de traducción (primera vez, puede tardar)…');
      } else {
        hideStatus();
      }
    }
  } catch {
    showStatus(`No se pudo conectar al backend en ${state.backendUrl}. Verifica que esté corriendo.`, 'error');
  }
}

/* ─── Init ───────────────────────────────────────────────────────────────── */
applyTtsUI();
updateLanguageLabels();
pingBackend();

// PWA service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
