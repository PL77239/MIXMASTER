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
import { LivePeakMeter } from './ui/peakMeter.js';
import { LiveEQ } from './ui/liveEq.js';
import { initCursor } from './ui/cursor.js';
import { initTidewave } from './ui/tidewave.js';
import {
  initScrollMotion,
  scrollGoHome,
  scrollGoTo,
} from './ui/scrollMotion.js';
import {
  rememberReference,
  memoryCount,
  clearMemories,
} from './audio/refMemory.js';

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

  scrollGoHome();
  toast('Ready for a new track.');
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
  const mem = memoryCount();
  $('refClearBtn').classList.toggle('hidden', n === 0);
  const forgetBtn = $('refForgetBtn');
  if (forgetBtn) forgetBtn.classList.toggle('hidden', mem === 0);
  if (!n) {
    $('refHint').textContent = mem
      ? `No refs this session · ${mem} learned profile${mem === 1 ? '' : 's'} ready for similar tracks. Prefer lossless WAV/FLAC.`
      : 'Upload or paste a reference — MIXA learns it for similar future masters. Prefer lossless WAV/FLAC.';
    return;
  }
  const listed = state.references.map((r) => {
    const q = r.quality ? ` [${qualityBadge(r.quality)}]` : '';
    return `${r.name}${q}`;
  }).join(' · ');
  $('refHint').textContent = mem
    ? `${listed} · +${mem} learned`
    : listed;
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
  const forgetBtn = $('refForgetBtn');
  if (forgetBtn) {
    forgetBtn.addEventListener('click', () => {
      clearMemories();
      updateRefHint();
      toast('Forgotten learned references.');
    });
  }
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

const peakMeter = new LivePeakMeter({
  root: $('peakMeter'),
  getPeakLin: () => player.getPeakLin(),
  isPlaying: () => player.playing,
  ceilingDb: -1.0,
});
peakMeter.start();

const liveEq = new LiveEQ({
  canvas: $('liveEqCanvas'),
  getFreq: () => player.getFrequencyData(),
  isPlaying: () => player.playing,
});
liveEq.start();

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

function renderMeters(before, after, target, ceilingDb = -1.0) {
  const d = (v) => (isFinite(v) ? v.toFixed(1) : '—');
  const lufsDelta = isFinite(after.lufs) && isFinite(before.lufs)
    ? `<div class="meter__delta ${after.lufs > before.lufs ? 'up' : 'down'}">
        from ${d(before.lufs)} LUFS</div>` : '';
  const onTarget = isFinite(after.lufs) && Math.abs(after.lufs - target) <= 0.7;
  const widthPct = Math.round((after.stereo.width || 0) * 100);
  const tpOk = isFinite(after.truePeakDb) && after.truePeakDb <= ceilingDb + 0.05;
  const tpHot = isFinite(after.truePeakDb) && after.truePeakDb > ceilingDb - 0.5;
  $('meters').innerHTML = [
    meterCard('Integrated loudness', d(after.lufs), ' LUFS',
      lufsDelta + (onTarget ? '<div class="meter__delta up">✓ on target</div>' : '')),
    meterCard('True peak', d(after.truePeakDb), ' dBTP',
      `<div class="meter__delta ${tpOk ? 'up' : 'down'}">${
        tpOk ? `under ${ceilingDb.toFixed(1)} ceiling` : tpHot ? 'near / over ceiling' : 'check peaks'
      }</div>`),
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
    engineerLog, plan, diag, clarity,
  } = result;
  const intensityLabel = {
    open: 'Low', balanced: 'Medium', punchy: 'High',
  }[settings.dynamicsProfile] || settings.dynamicsProfile;

  const role = (engineerLog || []).find((l) => l.type === 'role')?.text || '';
  const findings = (engineerLog || []).filter((l) => l.type === 'finding' || l.type === 'room' || l.type === 'priorities');
  const decisions = (engineerLog || []).filter((l) => l.type === 'decision');

  const listItems = (items) => items.length
    ? `<ul class="session__list">${items.map((l) => `<li>${l.text}</li>`).join('')}</ul>`
    : '<p class="session__empty">None noted.</p>';

  const moveRows = (corrective || []).length
    ? corrective.map((m) => `
        <div class="session__row">
          <span class="session__key">${m.band}${m.freq ? ` <em>${Math.round(m.freq)} Hz</em>` : ''}</span>
          <span class="session__val">${m.gain > 0 ? '+' : ''}${(m.gain || 0).toFixed(1)} dB</span>
          <span class="session__note">${m.detail || ''}</span>
        </div>`).join('')
    : '<p class="session__empty">No EQ moves needed.</p>';

  const bandRow = (label, r) => {
    if (!r) return '';
    const bands = [
      ['Sub', r.sub],
      ['Bass', r.bass],
      ['Low-mid', r.lowMid],
      ['Mid', r.mid],
      ['High', r.high],
      ['Air', r.air],
    ];
    return `
      <div class="session__spectrum">
        <div class="session__spectrum-label">${label}</div>
        <div class="session__bars">
          ${bands.map(([name, v]) => `
            <div class="session__bar" title="${name} ${(v * 100).toFixed(0)}%">
              <span class="session__bar-fill" style="height:${Math.max(4, Math.min(100, v * 280))}%"></span>
              <span class="session__bar-name">${name}</span>
              <span class="session__bar-pct">${(v * 100).toFixed(0)}</span>
            </div>`).join('')}
        </div>
      </div>`;
  };

  const roomLabel = plan?.room?.label || settings.room || 'Studio';
  const rackStages = plan?.rack?.stages?.length
    ? plan.rack.stages.join('  /  ')
    : 'Minimal';
  const peakLine = plan?.peak
    ? `${plan.peak.softClip ? 'Soft clip, then limit' : 'Transparent limit'} @ ${plan.peak.ceilingDb} dBTP`
    : '—';
  const kbLine = plan?.kickBass
    ? `Duck ${plan.kickBass.duckDb.toFixed(1)} dB @ ${plan.kickBass.bandHz} Hz`
    : 'Left alone';
  const instruments = diag?.instruments?.detected?.length
    ? diag.instruments.detected.join(', ')
    : '—';
  const refLine = plan?.refProfile
    ? `${plan.refProfile.name} (${plan.refProfile.lufs.toFixed(1)} LUFS${plan.refFromMemory ? ', memory' : ''})`
    : 'Genre polish only';
  const clarityLine = clarity
    ? (clarity.restored
      ? `Restored detail — presence ${(clarity.after.presence * 100).toFixed(1)}%, top ${(clarity.after.top * 100).toFixed(1)}%`
      : `Held — presence ${(clarity.after.presence * 100).toFixed(1)}%, top ${(clarity.after.top * 100).toFixed(1)}%`)
    : null;

  $('analysisNotes').innerHTML = `
    <div class="session">
      <header class="session__head">
        <p class="session__eyebrow">Engineer session</p>
        ${role ? `<h4 class="session__role">${role}</h4>` : ''}
      </header>

      <div class="session__grid">
        <section class="session__panel">
          <h5 class="session__title">Findings</h5>
          ${listItems(findings)}
        </section>
        <section class="session__panel">
          <h5 class="session__title">Decisions</h5>
          ${listItems(decisions)}
        </section>
      </div>

      ${clarityLine ? `
      <section class="session__panel session__panel--inline">
        <h5 class="session__title">Clarity</h5>
        <p class="session__clarity">${clarityLine}</p>
      </section>` : ''}

      <section class="session__panel">
        <h5 class="session__title">Chain</h5>
        <div class="session__kv">
          <div class="session__row"><span class="session__key">Detected</span><span class="session__val session__val--wide">${instruments}</span></div>
          <div class="session__row"><span class="session__key">Rack</span><span class="session__val session__val--wide">${rackStages}</span></div>
          <div class="session__row"><span class="session__key">Kick / bass</span><span class="session__val session__val--wide">${kbLine}</span></div>
          <div class="session__row"><span class="session__key">Peak</span><span class="session__val session__val--wide">${peakLine}</span></div>
          ${plan?.rack?.note ? `<p class="session__desk">${plan.rack.note}</p>` : ''}
        </div>
      </section>

      <section class="session__panel">
        <h5 class="session__title">EQ moves</h5>
        <div class="session__moves">${moveRows}</div>
      </section>

      <section class="session__panel">
        <h5 class="session__title">Spectrum</h5>
        <div class="session__spectrum-pair">
          ${bandRow('Before', regionsBefore)}
          ${bandRow('After', regionsAfter)}
        </div>
      </section>

      <section class="session__panel session__panel--delivery">
        <h5 class="session__title">Delivery</h5>
        <div class="session__kv session__kv--delivery">
          <div class="session__row"><span class="session__key">Genre</span><span class="session__val">${genre.label}</span></div>
          <div class="session__row"><span class="session__key">Intensity</span><span class="session__val">${intensityLabel}</span></div>
          <div class="session__row"><span class="session__key">Room</span><span class="session__val">${roomLabel}</span></div>
          <div class="session__row"><span class="session__key">Reference</span><span class="session__val session__val--wide">${refLine}</span></div>
          <div class="session__row"><span class="session__key">Gain</span><span class="session__val">${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB</span></div>
          <div class="session__row"><span class="session__key">Target</span><span class="session__val">${settings.targetLufs} LUFS</span></div>
        </div>
      </section>
    </div>`;
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
  const ceilingDb = result.plan?.peak?.ceilingDb ?? -1.0;
  peakMeter.setCeiling(ceilingDb);
  peakMeter.reset();
  liveEq.reset();
  renderMeters(result.before, result.after, result.settings.targetLufs, ceilingDb);
  renderNotes(result);

  const sizeKB = (state.outputBlob.size / 1024).toFixed(0);
  $('downloadNote').textContent =
    `Ready as ${state.decoded.format.toUpperCase()} · ${sizeKB} KB · ` +
    `same format & sample rate as your upload.`;
  scrollGoTo('resultCard');
}

// ---------- process ----------
async function runProcess() {
  if (!state.decoded || state.busy) return;
  state.busy = true;
  $('processBtn').disabled = true;
  $('progressCard').classList.remove('hidden');
  $('resultCard').classList.add('hidden');
  scrollGoTo('progressCard');
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

    // Learn from live references for similar future uploads
    if (result.plan?.liveRefProfiles?.length) {
      for (const profile of result.plan.liveRefProfiles) {
        rememberReference({
          profile,
          genre: settings.genre,
          plan: result.plan,
        });
      }
      updateRefHint();
      toast(`Master complete — learned ${result.plan.liveRefProfiles.length} reference(s) for similar tracks.`);
    } else {
      toast('Master complete — have a listen.');
    }
    showResults(result);
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
    peakMeter.reset();
    drawCurrentWave();
  });
  $('abMastered').addEventListener('click', () => {
    currentView = 'mastered';
    $('abMastered').classList.add('is-active');
    $('abOriginal').classList.remove('is-active');
    player.switchTo('mastered');
    peakMeter.reset();
    drawCurrentWave();
  });
  $('playBtn').addEventListener('click', () => {
    const playing = player.toggle();
    $('playBtn').textContent = playing ? '❚❚' : '▶';
  });
  const scrub = document.querySelector('.scrub');
  const scrubTo = (clientX) => {
    const rect = scrub.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    player.seek(t);
  };
  scrub.addEventListener('pointerdown', (e) => {
    scrub.classList.add('is-active');
    scrub.setPointerCapture(e.pointerId);
    scrubTo(e.clientX);
  });
  scrub.addEventListener('pointermove', (e) => {
    if (!scrub.hasPointerCapture(e.pointerId)) return;
    scrubTo(e.clientX);
  });
  scrub.addEventListener('pointerup', () => scrub.classList.remove('is-active'));
  scrub.addEventListener('pointercancel', () => scrub.classList.remove('is-active'));
  scrub.addEventListener('lostpointercapture', () => scrub.classList.remove('is-active'));
  scrub.addEventListener('click', (e) => scrubTo(e.clientX));

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
initScrollMotion();
void import('./ui/logo3d.js').then((m) => m.initLogo3d());
$('processBtn').addEventListener('click', runProcess);
