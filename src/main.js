import './style.css';
import { GENRES, DEFAULT_GENRE } from './audio/genres.js';
import { decodeFile } from './audio/decode.js';
import { analyzeBuffer } from './audio/analyze.js';
import { masterTrack } from './audio/engine.js';
import { getRoom } from './audio/rooms.js';
import { fetchReferenceFromUrl, qualityBadge } from './audio/fetchReference.js';
import { encodeBuffer, EXTENSIONS } from './encode/index.js';
import { drawWaveform, drawSpectrum } from './ui/visualizer.js';
import { ABPlayer } from './ui/player.js';
import { initCursor, initReveals } from './ui/cursor.js';
import { initTidewave } from './ui/tidewave.js';

const $ = (id) => document.getElementById(id);

const state = {
  decoded: null,
  analysis: null,
  result: null,
  outputBlob: null,
  genre: DEFAULT_GENRE,
  room: 'studio',
  listenRoom: 'studio',
  references: [], // { name, audioBuffer }
  busy: false,
};

/** Reset UI + session so the user can upload a new track (logo / brand click). */
function resetSession() {
  if (state.busy) {
    toast('Wait for the current job to finish…', true);
    return;
  }
  player.pause();
  state.decoded = null;
  state.analysis = null;
  state.result = null;
  state.outputBlob = null;
  state.references = [];
  state.room = 'studio';
  state.listenRoom = 'studio';

  const fileInput = $('fileInput');
  if (fileInput) fileInput.value = '';
  const refInput = $('refInput');
  if (refInput) refInput.value = '';
  const refUrl = $('refUrlInput');
  if (refUrl) refUrl.value = '';

  $('fileCard')?.classList.add('hidden');
  $('progressCard')?.classList.add('hidden');
  $('resultCard')?.classList.add('hidden');
  $('processBtn').disabled = true;
  $('progressBar').style.width = '0%';

  // Reset room UI
  $('roomToggle')?.querySelectorAll('.room-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.room === 'studio');
  });
  const room = getRoom('studio');
  if ($('roomHint')) $('roomHint').textContent = room.desc;
  $('listenRoom')?.querySelectorAll('.room-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.listen === 'studio');
  });
  player.setRoom('studio');

  if (typeof updateRefHint === 'function') updateRefHint();

  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast('Ready for a new track.');
  setTimeout(() => $('dropCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
}

function bindBrandHome() {
  const goHome = (e) => {
    e.preventDefault();
    resetSession();
  };
  $('brandHome')?.addEventListener('click', goHome);
  $('heroHome')?.addEventListener('click', goHome);
}

// ---------- toast ----------
let toastEl;
function toast(msg, isError = false) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.className = 'toast show' + (isError ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (toastEl.className = 'toast'), 4200);
}

// ---------- genre grid ----------
function buildGenreGrid() {
  const grid = $('genreGrid');
  grid.innerHTML = '';
  for (const [key, g] of Object.entries(GENRES)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'genre' + (key === state.genre ? ' is-active' : '');
    btn.dataset.key = key;
    btn.innerHTML = `<div class="genre__emoji">${g.emoji}</div>
      <div class="genre__name">${g.label}</div>
      <div class="genre__desc">${g.desc}</div>`;
    btn.addEventListener('click', () => {
      state.genre = key;
      grid.querySelectorAll('.genre').forEach((b) =>
        b.classList.toggle('is-active', b.dataset.key === key));
    });
    grid.appendChild(btn);
  }
}

// ---------- sliders ----------
function bindSliders() {
  const map = [
    ['warmth', 'warmthOut', (v) => (v > 0 ? '+' : '') + v],
    ['brightness', 'brightOut', (v) => (v > 0 ? '+' : '') + v],
    ['bass', 'bassOut', (v) => (v > 0 ? '+' : '') + v],
    ['vocal', 'vocalOut', (v) => (v > 0 ? '+' : '') + v],
    ['width', 'widthOut', (v) => v],
  ];
  for (const [id, out, fmt] of map) {
    const el = $(id);
    const o = $(out);
    const update = () => (o.textContent = fmt(parseFloat(el.value)));
    el.addEventListener('input', update);
    update();
  }
}

// ---------- room (process + listen) ----------
function bindRooms() {
  const toggle = $('roomToggle');
  toggle.querySelectorAll('.room-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.room = btn.dataset.room;
      toggle.querySelectorAll('.room-btn').forEach((b) =>
        b.classList.toggle('is-active', b === btn));
      const room = getRoom(state.room);
      $('roomHint').textContent = room.desc;
    });
  });

  const listen = $('listenRoom');
  if (listen) {
    listen.querySelectorAll('.room-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.listenRoom = btn.dataset.listen;
        listen.querySelectorAll('.room-btn').forEach((b) =>
          b.classList.toggle('is-active', b === btn));
        player.setRoom(state.listenRoom);
      });
    });
  }
}

// ---------- references ----------
function updateRefHint() {
  const n = state.references.length;
  $('refClearBtn').classList.toggle('hidden', n === 0);
  if (!n) {
    $('refHint').textContent = 'Analyzed first, then your track is pulled toward them. Prefer lossless WAV/FLAC.';
    return;
  }
  $('refHint').textContent = state.references.map((r) => {
    const q = r.quality ? ` [${qualityBadge(r.quality)}]` : '';
    return `${r.name}${q}`;
  }).join(' · ');
}

async function handleRefs(fileList) {
  const files = [...fileList].filter((f) => /\.(wav|flac|mp3)$/i.test(f.name));
  if (!files.length) {
    toast('References must be WAV, FLAC or MP3.', true);
    return;
  }
  try {
    for (const file of files.slice(0, 4)) {
      const decoded = await decodeFile(file);
      const lossless = /\.(wav|flac)$/i.test(file.name);
      state.references.push({
        name: file.name,
        audioBuffer: decoded.audioBuffer,
        quality: lossless ? 'lossless' : 'lossy',
        warning: lossless ? null : 'Lossy file — prefer WAV/FLAC when matching.',
      });
    }
    updateRefHint();
    toast(`Loaded ${files.length} reference track(s) — will analyze before matching.`);
  } catch (err) {
    console.error(err);
    toast('Could not decode a reference file.', true);
  }
}

async function handleRefUrl() {
  const input = $('refUrlInput');
  const url = (input.value || '').trim();
  if (!url) {
    toast('Paste a YouTube, Spotify, or direct audio URL.', true);
    return;
  }
  if (state.references.length >= 4) {
    toast('Max 4 references.', true);
    return;
  }
  $('refUrlBtn').disabled = true;
  $('refHint').textContent = 'Fetching reference (prefer lossless when possible)…';
  try {
    const decoded = await fetchReferenceFromUrl(url);
    state.references.push({
      name: decoded.name,
      audioBuffer: decoded.audioBuffer,
      quality: decoded.quality,
      warning: decoded.warning,
    });
    input.value = '';
    updateRefHint();
    if (decoded.warning) toast(decoded.warning, true);
    else toast(`Reference added (${qualityBadge(decoded.quality)}).`);
  } catch (err) {
    console.error(err);
    toast(err.message || 'Could not fetch that link.', true);
    updateRefHint();
  } finally {
    $('refUrlBtn').disabled = false;
  }
}

function bindRefs() {
  const input = $('refInput');
  $('refBrowseBtn').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files?.length) handleRefs(input.files);
    input.value = '';
  });
  $('refClearBtn').addEventListener('click', () => {
    state.references = [];
    updateRefHint();
  });
  $('refUrlBtn').addEventListener('click', handleRefUrl);
  $('refUrlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleRefUrl(); }
  });
}

// ---------- file handling ----------
function fmtDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function handleFile(file) {
  if (!file || state.busy) return;
  const okExt = /\.(wav|flac|mp3)$/i.test(file.name);
  if (!okExt) {
    toast('Please upload a .wav, .flac or .mp3 file.', true);
    return;
  }
  state.busy = true;
  try {
    $('fileCard').classList.remove('hidden');
    $('fileName').textContent = file.name;
    $('fileSub').textContent = 'Decoding…';
    $('processBtn').disabled = true;

    const decoded = await decodeFile(file);
    state.decoded = { ...decoded, name: file.name, size: file.size };
    $('fileFormat').textContent = decoded.format.toUpperCase();

    $('fileSub').textContent = 'Analyzing loudness & spectrum…';
    await new Promise((r) => setTimeout(r, 30));
    state.analysis = analyzeBuffer(decoded.audioBuffer);

    const a = state.analysis;
    $('fileSub').textContent =
      `${decoded.format.toUpperCase()} · ${a.sampleRate.toLocaleString()} Hz · ` +
      `${a.channels === 1 ? 'mono' : 'stereo'} · ${fmtDuration(a.duration)} · ` +
      `${isFinite(a.lufs) ? a.lufs.toFixed(1) : '—'} LUFS`;
    $('processBtn').disabled = false;
    toast('Loaded. Set your direction and master it.');
  } catch (err) {
    console.error(err);
    toast('Could not decode that file. Try another WAV/FLAC/MP3.', true);
    $('fileSub').textContent = 'Decode failed.';
  } finally {
    state.busy = false;
  }
}

function bindDropzone() {
  const dz = $('dropzone');
  const input = $('fileInput');
  const trigger = () => input.click();
  dz.addEventListener('click', trigger);
  $('browseBtn').addEventListener('click', (e) => { e.stopPropagation(); trigger(); });
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger(); }
  });
  input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });

  ['dragenter', 'dragover'].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-drag'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-drag'); }));
  dz.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  $('clearBtn').addEventListener('click', () => {
    state.decoded = null;
    state.analysis = null;
    input.value = '';
    $('fileCard').classList.add('hidden');
    $('processBtn').disabled = true;
  });
}

// ---------- settings ----------
function gatherSettings() {
  return {
    genre: state.genre,
    room: state.room,
    targetLufs: parseFloat($('targetLufs').value),
    dynamicsProfile: $('dynamics').value,
    warmth: parseFloat($('warmth').value),
    brightness: parseFloat($('brightness').value),
    bass: parseFloat($('bass').value),
    vocal: parseFloat($('vocal').value),
    width: parseFloat($('width').value),
    referenceBuffers: state.references.map((r) => r.audioBuffer),
    referenceNames: state.references.map((r) => r.name),
  };
}

function setProgress(fraction, text) {
  $('progressBar').style.width = Math.round(fraction * 100) + '%';
  if (text) $('progressStage').textContent = text;
}

// ---------- results ----------
const player = new ABPlayer({
  onTime: (t, d) => {
    $('scrubFill').style.width = (d ? (t / d) * 100 : 0) + '%';
    $('timeLabel').textContent = `${fmtDuration(t)} / ${fmtDuration(d)}`;
  },
  onEnd: () => { $('playBtn').textContent = '▶'; },
});

let currentView = 'original';
function drawCurrentWave() {
  if (!state.result) return;
  const buf = currentView === 'original'
    ? state.decoded.audioBuffer
    : state.result.buffer;
  const colors = currentView === 'original'
    ? ['#9a9a9a', '#3a3a3a']
    : ['#0a3d91', '#121212'];
  drawWaveform($('waveCanvas'), buf, colors[0], colors[1]);
}

function meterCard(label, value, unit, delta) {
  return `<div class="meter">
    <div class="meter__label">${label}</div>
    <div class="meter__val">${value}<small>${unit || ''}</small></div>
    ${delta || ''}
  </div>`;
}

function renderMeters(before, after, target) {
  const d = (v) => (isFinite(v) ? v.toFixed(1) : '—');
  const lufsDelta = isFinite(after.lufs) && isFinite(before.lufs)
    ? `<div class="meter__delta ${after.lufs > before.lufs ? 'up' : 'down'}">
        from ${d(before.lufs)} LUFS</div>` : '';
  const onTarget = isFinite(after.lufs) && Math.abs(after.lufs - target) <= 0.7;
  const widthPct = Math.round((after.stereo.width || 0) * 100);
  $('meters').innerHTML = [
    meterCard('Integrated loudness', d(after.lufs), ' LUFS',
      lufsDelta + (onTarget ? '<div class="meter__delta up">✓ on target</div>' : '')),
    meterCard('True peak', d(after.truePeakDb), ' dBTP',
      `<div class="meter__delta ${after.truePeakDb <= -0.9 ? 'up' : 'down'}">ceiling polish</div>`),
    meterCard('Dynamics (crest)', d(after.crest), ' dB',
      `<div class="meter__delta">was ${d(before.crest)} dB</div>`),
    meterCard('Stereo width', widthPct, ' %',
      `<div class="meter__delta">side / mid energy</div>`),
    meterCard('Sample peak', d(after.peakDb), ' dBFS', ''),
    meterCard('Short-term max', d(after.shortTerm), ' LUFS', ''),
  ].join('');
}

function renderNotes(result) {
  const {
    corrective, gainDb, genre, settings, regionsBefore, regionsAfter,
    engineerLog, plan, diag,
  } = result;
  const intensityLabel = {
    open: 'Low', balanced: 'Medium', punchy: 'High',
  }[settings.dynamicsProfile] || settings.dynamicsProfile;

  const logHtml = (engineerLog || [])
    .map((l) => {
      if (l.type === 'role') return `<li><b>${l.text}</b></li>`;
      if (l.type === 'room') return `<li>🏠 ${l.text}</li>`;
      if (l.type === 'finding') return `<li style="opacity:.95">🔍 ${l.text}</li>`;
      if (l.type === 'decision') return `<li>→ ${l.text}</li>`;
      return `<li>${l.text}</li>`;
    }).join('');

  const moves = (corrective || []).length
    ? corrective.map((m) => `<li><b>${m.band}</b>${m.freq ? ` (${Math.round(m.freq)} Hz)` : ''}:
        ${m.gain > 0 ? '+' : ''}${(m.gain || 0).toFixed(1)} dB
        ${m.detail ? `<span style="opacity:.7"> — ${m.detail}</span>` : ''}</li>`).join('')
    : '<li>No EQ moves needed.</li>';

  const fmtR = (r) => r
    ? `sub ${(r.sub * 100).toFixed(0)}% · bass ${(r.bass * 100).toFixed(0)}% · low-mid ${(r.lowMid * 100).toFixed(0)}% · mid ${(r.mid * 100).toFixed(0)}% · high ${(r.high * 100).toFixed(0)}% · air ${(r.air * 100).toFixed(0)}%`
    : '—';

  const kb = plan?.kickBass
    ? `<li>Kick/bass space: duck ${plan.kickBass.duckDb.toFixed(1)} dB @ ${plan.kickBass.bandHz} Hz</li>`
    : '<li>Kick/bass: left alone</li>';

  const peak = plan?.peak
    ? `<li>Peak chain: ${plan.peak.softClip ? 'soft clip → ' : ''}limit @ ${plan.peak.ceilingDb} dBTP</li>`
    : '';

  const instruments = diag?.instruments?.detected?.length
    ? `<li>Detected: ${diag.instruments.detected.join(', ')}</li>`
    : '';

  const roomLabel = plan?.room?.label || settings.room || 'Studio';
  const refLine = plan?.refProfile
    ? `<li>Matched toward: <b>${plan.refProfile.name}</b> (${plan.refProfile.lufs.toFixed(1)} LUFS)</li>`
    : '<li>No reference tracks — genre polish only</li>';

  $('analysisNotes').innerHTML = `
    <h4>Engineer session</h4>
    <ul>${logHtml}</ul>
    <h4>Moves applied</h4>
    <ul>${instruments}${moves}${kb}${peak}</ul>
    <h4>Spectral check</h4>
    <ul>
      <li>Before: ${fmtR(regionsBefore)}</li>
      <li>After: ${fmtR(regionsAfter)}</li>
    </ul>
    <h4>Delivery</h4>
    <ul>
      <li>Genre desk: <b>${genre.label}</b> · Intensity <b>${intensityLabel}</b> · Room <b>${roomLabel}</b></li>
      ${refLine}
      <li>Normalized <b>${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB</b>
        → <b>${settings.targetLufs} LUFS</b></li>
    </ul>`;
}

function showResults(result) {
  state.result = result;
  $('resultCard').classList.remove('hidden');
  currentView = 'original';
  $('abOriginal').classList.add('is-active');
  $('abMastered').classList.remove('is-active');
  player.setBuffers(state.decoded.audioBuffer, result.buffer);
  player.setRoom(state.listenRoom);
  player.switchTo('original');
  $('playBtn').textContent = '▶';

  drawCurrentWave();
  drawSpectrum($('spectrumCanvas'), result.before, result.after);
  renderMeters(result.before, result.after, result.settings.targetLufs);
  renderNotes(result);

  const sizeKB = (state.outputBlob.size / 1024).toFixed(0);
  $('downloadNote').textContent =
    `Ready as ${state.decoded.format.toUpperCase()} · ${sizeKB} KB · ` +
    `same format & sample rate as your upload.`;
  $('resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- process ----------
async function runProcess() {
  if (!state.decoded || state.busy) return;
  state.busy = true;
  $('processBtn').disabled = true;
  $('progressCard').classList.remove('hidden');
  $('resultCard').classList.add('hidden');
  player.pause();
  setProgress(0.02, 'Warming up the console…');

  try {
    const settings = gatherSettings();
    const result = await masterTrack(
      state.decoded.audioBuffer,
      state.analysis,
      settings,
      (p, stage) => setProgress(0.02 + p * 0.78, stage),
    );

    setProgress(0.82, `Encoding ${state.decoded.format.toUpperCase()}…`);
    state.outputBlob = await encodeBuffer(
      result.buffer,
      state.decoded.format,
      state.decoded.meta,
      (ep) => setProgress(0.82 + ep * 0.16, `Encoding ${state.decoded.format.toUpperCase()}…`),
    );

    setProgress(1, 'Master ready.');
    await new Promise((r) => setTimeout(r, 250));
    $('progressCard').classList.add('hidden');
    showResults(result);
    toast('Master complete — have a listen.');
  } catch (err) {
    console.error(err);
    toast('Processing failed: ' + (err.message || err), true);
    $('progressCard').classList.add('hidden');
  } finally {
    state.busy = false;
    $('processBtn').disabled = false;
  }
}

// ---------- transport / A-B ----------
function bindResultControls() {
  $('abOriginal').addEventListener('click', () => {
    currentView = 'original';
    $('abOriginal').classList.add('is-active');
    $('abMastered').classList.remove('is-active');
    player.switchTo('original');
    drawCurrentWave();
  });
  $('abMastered').addEventListener('click', () => {
    currentView = 'mastered';
    $('abMastered').classList.add('is-active');
    $('abOriginal').classList.remove('is-active');
    player.switchTo('mastered');
    drawCurrentWave();
  });
  $('playBtn').addEventListener('click', () => {
    const playing = player.toggle();
    $('playBtn').textContent = playing ? '❚❚' : '▶';
  });
  const scrub = document.querySelector('.scrub');
  scrub.addEventListener('click', (e) => {
    const rect = scrub.getBoundingClientRect();
    player.seek((e.clientX - rect.left) / rect.width);
  });

  $('downloadBtn').addEventListener('click', () => {
    if (!state.outputBlob) return;
    const ext = EXTENSIONS[state.decoded.format];
    const base = state.decoded.name.replace(/\.[^.]+$/, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(state.outputBlob);
    a.download = `${base} (Mastered).${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
}

let resizeDrawTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeDrawTimer);
  resizeDrawTimer = setTimeout(() => {
    if (state.result) {
      drawCurrentWave();
      drawSpectrum($('spectrumCanvas'), state.result.before, state.result.after);
    }
  }, 120);
});

// ---------- init ----------
buildGenreGrid();
bindSliders();
bindRooms();
bindRefs();
bindDropzone();
bindResultControls();
bindBrandHome();
initCursor();
initTidewave();
initReveals();
$('processBtn').addEventListener('click', runProcess);
