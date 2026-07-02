/* ─── State ─────────────────────────────────────────────────────────────── */
const state = {
  sourceLang: 'en',
  targetLang: 'es',
  ttsEnabled: true,
  micActive: false,
  mode: 'meeting',          // 'meeting' | 'conversation'
  backendUrl: localStorage.getItem('backendUrl') || 'http://localhost:8000',
};

const LANG_NAMES = { en: 'Inglés', es: 'Español' };

// Audio queue: plays segments one by one without cutting off
const audioQueue = [];
let audioPlaying = false;
let lastTranslatedText = '';
let segmentCount = 0;

// For phrase-boundary detection during interim results
let interimBuffer = '';
let phraseTimer = null;       // debounce for preview translation (resets on each word)
let chunkTimer = null;        // force-commit every N seconds of continuous speech
let lastCommittedText = '';   // avoid translating the same text twice
let recognition = null;

const CHUNK_INTERVAL_MS = 2500;  // force translation every 2.5s of unbroken speech
const PREVIEW_DEBOUNCE_MS = 350; // preview after 350ms of silence in interim

/* ─── DOM ────────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

/* ─── Mode ───────────────────────────────────────────────────────────────── */
const MODE_DESC = {
  meeting: '<strong>Meeting:</strong> traducción continua frase por frase, historial con replay. Ideal para conferencias y grupos.',
  conversation: '<strong>Conversation:</strong> control manual del micrófono, replay y reenvío de traducciones individuales.',
};

function setMode(mode) {
  state.mode = mode;
  $('btn-meeting').classList.toggle('active', mode === 'meeting');
  $('btn-conversation').classList.toggle('active', mode === 'conversation');
  $('btn-meeting').classList.toggle('text-gray-500', mode !== 'meeting');
  $('btn-conversation').classList.toggle('text-gray-500', mode !== 'conversation');
  $('history-panel').classList.toggle('hidden', mode !== 'meeting');
  $('mode-desc-text').innerHTML = MODE_DESC[mode];
  if (state.micActive) stopMic();
  clearAll();
}

/* ─── Language ───────────────────────────────────────────────────────────── */
function updateLanguageLabels() {
  const src = LANG_NAMES[state.sourceLang];
  const tgt = LANG_NAMES[state.targetLang];
  $('lang-source-label').textContent = src;
  $('lang-target-label').textContent = tgt;
  $('panel-source-label').textContent = `${src} — original`;
  $('panel-target-label').textContent = `${tgt} — traducción`;
  if (recognition) recognition.lang = state.sourceLang === 'en' ? 'en-US' : 'es-ES';
}

function swapLanguages() {
  [state.sourceLang, state.targetLang] = [state.targetLang, state.sourceLang];
  updateLanguageLabels();
  clearAll();
}

/* ─── TTS ────────────────────────────────────────────────────────────────── */
function applyTtsUI() {
  const on = state.ttsEnabled;
  $('tts-toggle').setAttribute('aria-checked', on);
  $('tts-toggle').classList.toggle('bg-brand', on);
  $('tts-toggle').classList.toggle('bg-gray-300', !on);
  $('tts-thumb').classList.toggle('translate-x-4', on);
  $('tts-thumb').classList.toggle('translate-x-1', !on);
}

function toggleTts() {
  state.ttsEnabled = !state.ttsEnabled;
  applyTtsUI();
  if (!state.ttsEnabled) clearAudioQueue();
}

/* ─── Audio queue ────────────────────────────────────────────────────────── */
function enqueueAudio(text, lang) {
  if (!state.ttsEnabled || !text.trim()) return;
  audioQueue.push({ text, lang });
  if (!audioPlaying) drainQueue();
}

function drainQueue() {
  if (audioQueue.length === 0) {
    audioPlaying = false;
    $('tts-status').classList.add('hidden');
    return;
  }
  audioPlaying = true;
  $('tts-status').classList.remove('hidden');
  const { text, lang } = audioQueue.shift();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang === 'en' ? 'en-US' : 'es-ES';
  utter.rate = 1.05;
  utter.onend = () => drainQueue();
  utter.onerror = () => drainQueue();
  window.speechSynthesis.speak(utter);
}

function clearAudioQueue() {
  audioQueue.length = 0;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  audioPlaying = false;
  $('tts-status').classList.add('hidden');
}

function replayLast() {
  if (!lastTranslatedText) return;
  clearAudioQueue();
  enqueueAudio(lastTranslatedText, state.targetLang);
}

/* ─── Translation ────────────────────────────────────────────────────────── */
async function translateText(text, isInterim = false) {
  if (!text.trim()) return null;
  if (!isInterim) $('translating-indicator').classList.remove('hidden');

  try {
    const res = await fetch(`${state.backendUrl}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, source_lang: state.sourceLang, target_lang: state.targetLang }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    hideStatus();
    return data.translated_text;
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
    return null;
  } finally {
    if (!isInterim) $('translating-indicator').classList.add('hidden');
  }
}

/* ─── Commit a final phrase ──────────────────────────────────────────────── */
async function commitPhrase(text) {
  if (!text.trim()) return;

  // Show original
  const origEl = $('final-original');
  origEl.textContent += (origEl.textContent ? ' ' : '') + text.trim();
  $('interim-original').textContent = '';
  origEl.parentElement.scrollTop = origEl.parentElement.scrollHeight;

  // Translate
  const translated = await translateText(text.trim(), false);
  if (!translated) return;

  lastTranslatedText = translated;
  $('replay-btn').classList.remove('hidden');

  // Show in live panel
  const transEl = $('final-translated');
  transEl.textContent += (transEl.textContent ? ' ' : '') + translated;
  $('interim-translated').textContent = '';
  transEl.parentElement.scrollTop = transEl.parentElement.scrollHeight;

  // Enqueue audio (non-blocking, doesn't interrupt previous)
  enqueueAudio(translated, state.targetLang);

  // Add to history in Meeting mode
  if (state.mode === 'meeting') addHistorySegment(text.trim(), translated);
}

/* ─── History (Meeting mode) ─────────────────────────────────────────────── */
function addHistorySegment(original, translated) {
  const empty = $('history-empty');
  if (empty) empty.remove();

  segmentCount++;
  const id = `seg-${segmentCount}`;
  const capturedText = translated;
  const capturedLang = state.targetLang;

  const item = document.createElement('div');
  item.id = id;
  item.className = 'segment-item flex items-start gap-3 p-2.5 rounded-xl bg-gray-50 hover:bg-blue-50 transition-colors group';
  item.innerHTML = `
    <div class="flex-1 min-w-0">
      <p class="text-xs text-gray-400 truncate mb-0.5">${escapeHtml(original)}</p>
      <p class="text-sm text-gray-800 font-medium leading-snug">${escapeHtml(translated)}</p>
    </div>
    <button onclick="replaySegment('${id}')"
      class="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5 w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center text-xs hover:bg-brand-dark"
      title="Escuchar este segmento">▶</button>
  `;
  item.dataset.text = translated;
  item.dataset.lang = capturedLang;

  const list = $('history-list');
  list.appendChild(item);
  list.scrollTop = list.scrollHeight;
}

function replaySegment(id) {
  const item = $(id);
  if (!item) return;
  clearAudioQueue();
  enqueueAudio(item.dataset.text, item.dataset.lang);
}

function clearHistory() {
  const list = $('history-list');
  list.innerHTML = '<p id="history-empty" class="text-xs text-gray-300 text-center py-6">El historial aparece aquí mientras se traduce…</p>';
  segmentCount = 0;
}

function escapeHtml(t) {
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ─── Speech Recognition ─────────────────────────────────────────────────── */

// Detect phrase boundary: sentence-ending punctuation or long pause
const BOUNDARY_RE = /[.!?。]\s*$/;

function buildRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) return null;

  const rec = new SpeechRec();
  rec.continuous     = true;
  rec.interimResults = true;
  rec.lang           = state.sourceLang === 'en' ? 'en-US' : 'es-ES';

  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        // Final result = browser detected a natural sentence boundary
        clearTimeout(phraseTimer);
        clearTimeout(chunkTimer);
        chunkTimer = null;
        const text = (interimBuffer + ' ' + t).trim();
        interimBuffer = '';
        lastCommittedText = text;
        $('interim-original').textContent = '';
        $('interim-translated').textContent = '';
        commitPhrase(text);
      } else {
        interim += t;
      }
    }

    if (interim) {
      interimBuffer = interim;
      $('interim-original').textContent = interim;

      // Preview translation: fires 350ms after the last word (resets on each new word)
      clearTimeout(phraseTimer);
      phraseTimer = setTimeout(async () => {
        if (!interimBuffer.trim()) return;
        const preview = await translateText(interimBuffer, true);
        if (preview) $('interim-translated').textContent = preview;
      }, PREVIEW_DEBOUNCE_MS);

      // Punctuation boundary → commit immediately
      if (BOUNDARY_RE.test(interim.trim())) {
        clearTimeout(phraseTimer);
        clearTimeout(chunkTimer);
        chunkTimer = null;
        const text = interim.trim();
        interimBuffer = '';
        lastCommittedText = text;
        $('interim-original').textContent = '';
        $('interim-translated').textContent = '';
        commitPhrase(text);
        return;
      }

      // Force-commit every CHUNK_INTERVAL_MS of continuous speech
      // (handles long unbroken sentences where browser delays isFinal)
      if (!chunkTimer) {
        chunkTimer = setTimeout(() => {
          chunkTimer = null;
          const text = interimBuffer.trim();
          if (!text || text === lastCommittedText) return;
          lastCommittedText = text;
          interimBuffer = '';
          $('interim-original').textContent = '';
          $('interim-translated').textContent = '';
          commitPhrase(text);
        }, CHUNK_INTERVAL_MS);
      }
    }
  };

  rec.onerror = e => {
    if (e.error === 'not-allowed') {
      showStatus('Permiso de micrófono denegado. Habilítalo en el navegador.', 'error');
      setMicState(false);
    } else if (e.error === 'no-speech') {
      // Silence — ignore, keep listening
    } else {
      showStatus(`Error de micrófono: ${e.error}`, 'error');
    }
  };

  rec.onend = () => {
    // Auto-restart to keep mic always on while active
    if (state.micActive) {
      try { rec.start(); } catch {}
    }
  };

  return rec;
}

function setMicState(active) {
  state.micActive = active;
  const btn = $('mic-btn');
  if (active) {
    btn.classList.add('pulse-ring-red', 'bg-red-500');
    btn.classList.remove('bg-brand', 'hover:bg-brand-dark', 'pulse-ring');
    $('mic-label').textContent = 'Escuchando… toca para pausar';
    $('mic-label').classList.replace('text-gray-400', 'text-red-500');
  } else {
    btn.classList.remove('pulse-ring-red', 'bg-red-500');
    btn.classList.add('bg-brand', 'hover:bg-brand-dark');
    $('mic-label').textContent = 'Pulsa para escuchar';
    $('mic-label').classList.replace('text-red-500', 'text-gray-400');
  }
}

function stopMic() {
  state.micActive = false;
  recognition?.stop();
  setMicState(false);
  clearTimeout(phraseTimer);
  clearTimeout(chunkTimer);
  chunkTimer = null;
  // NOTE: audio queue is NOT cleared — translation keeps playing after mic stops
}

function toggleMic() {
  if (state.micActive) {
    stopMic();
    hideStatus();
  } else {
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
      // Already started
    }
  }
}

/* ─── Text input fallback ────────────────────────────────────────────────── */
function submitText() {
  const input = $('text-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  commitPhrase(text);
}

$('text-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitText(); }
});

/* ─── Clear ──────────────────────────────────────────────────────────────── */
function clearAll() {
  $('final-original').textContent    = '';
  $('interim-original').textContent  = '';
  $('final-translated').textContent  = '';
  $('interim-translated').textContent = '';
  $('replay-btn').classList.add('hidden');
  lastTranslatedText = '';
  interimBuffer = '';
  clearTimeout(phraseTimer);
  clearAudioQueue();
  hideStatus();
}

/* ─── Status bar ─────────────────────────────────────────────────────────── */
function showStatus(msg, type = 'info') {
  const bar = $('status-bar');
  bar.textContent = msg;
  bar.className = 'rounded-xl px-4 py-2.5 text-sm fade-in ';
  bar.className += type === 'error'
    ? 'bg-red-50 text-red-700 border border-red-100'
    : 'bg-blue-50 text-blue-700 border border-blue-100';
  bar.classList.remove('hidden');
}
function hideStatus() { $('status-bar').classList.add('hidden'); }

/* ─── Settings ───────────────────────────────────────────────────────────── */
function openSettings() { $('backend-url-input').value = state.backendUrl; $('settings-modal').classList.remove('hidden'); }
function closeSettings() { $('settings-modal').classList.add('hidden'); }
function saveSettings() {
  const url = $('backend-url-input').value.trim().replace(/\/$/, '');
  if (url) { state.backendUrl = url; localStorage.setItem('backendUrl', url); }
  closeSettings();
  pingBackend();
}

/* ─── Health check ───────────────────────────────────────────────────────── */
async function pingBackend() {
  try {
    const res = await fetch(`${state.backendUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      if (!data.models_ready) showStatus('Cargando modelos de traducción, espera un momento…');
      else hideStatus();
    }
  } catch {
    showStatus(`No se pudo conectar al backend en ${state.backendUrl}`, 'error');
  }
}

/* ─── Init ───────────────────────────────────────────────────────────────── */
applyTtsUI();
updateLanguageLabels();
setMode('meeting');
pingBackend();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
