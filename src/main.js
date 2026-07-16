import './style.css';
import { GENRES, DEFAULT_GENRE } from './audio/genres.js';
import { decodeFile } from './audio/decode.js';
import { analyzeBuffer } from './audio/analyze.js';
import { masterTrack } from './audio/engine.js';
import { encodeBuffer, EXTENSIONS } from './encode/index.js';
import { drawWaveform, drawSpectrum } from './ui/visualizer.js';
import { ABPlayer } from './ui/player.js';

const $ = (id) => document.getElementById(id);

const state = {
  decoded: null,
  analysis: null,
  result: null,
  outputBlob: null,
  genre: DEFAULT_GENRE,
  busy: false,
};

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
    targetLufs: parseFloat($('targetLufs').value),
    dynamicsProfile: $('dynamics').value,
    warmth: parseFloat($('warmth').value),
    brightness: parseFloat($('brightness').value),
    bass: parseFloat($('bass').value),
    vocal: parseFloat($('vocal').value),
    width: parseFloat($('width').value),
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
    ? ['#8f7fb3', '#a855f7']
    : ['#ffd25a', '#ff2d95'];
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
      `<div class="meter__delta ${after.truePeakDb <= -0.9 ? 'up' : 'down'}">ceiling &minus;1.0</div>`),
    meterCard('Dynamics (crest)', d(after.crest), ' dB',
      `<div class="meter__delta">was ${d(before.crest)} dB</div>`),
    meterCard('Stereo width', widthPct, ' %',
      `<div class="meter__delta">side / mid energy</div>`),
    meterCard('Sample peak', d(after.peakDb), ' dBFS', ''),
    meterCard('Short-term max', d(after.shortTerm), ' LUFS', ''),
  ].join('');
}

function renderNotes(result) {
  const { before, after, corrective, gainDb, genre, settings } = result;
  const intensityLabel = {
    open: 'Low', balanced: 'Medium', punchy: 'High',
  }[settings.dynamicsProfile] || settings.dynamicsProfile;
  const moves = corrective.length
    ? corrective.map((m) => `<li><b>${m.band}</b> (${Math.round(m.freq)} Hz):
        ${m.gain > 0 ? '+' : ''}${m.gain.toFixed(1)} dB</li>`).join('')
    : '<li>Spectrum already close — only gentle haze cleanup applied.</li>';

  $('analysisNotes').innerHTML = `
    <h4>Clarity EQ moves <span style="font-weight:400;text-transform:none;letter-spacing:0">(subtractive-first)</span></h4>
    <ul>${moves}</ul>
    <h4>Mastering chain</h4>
    <ul>
      <li>Genre: <b>${genre.label}</b> · Mixea-style Intensity
        <b>${intensityLabel}</b></li>
      <li>Mud / masking cleanup in <b>200–500 Hz</b>, then light genre tone</li>
      <li>4-band dynamics on <b>bass / low-mid / mid / highs</b>
        (crossovers ${genre.dynamics.crossovers.join(' / ')} Hz), soft makeup</li>
      <li>Dolby-inspired M/S: <b>mono bass</b>, side mud cut, controlled width
        (${settings.width}%)</li>
      <li>Light bus glue + soft saturation · normalized
        <b>${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB</b>
        → <b>${settings.targetLufs} LUFS</b> · ceiling <b>&minus;1 dBTP</b></li>
    </ul>`;
}

function showResults(result) {
  state.result = result;
  $('resultCard').classList.remove('hidden');
  currentView = 'original';
  $('abOriginal').classList.add('is-active');
  $('abMastered').classList.remove('is-active');
  player.setBuffers(state.decoded.audioBuffer, result.buffer);
  player.switchTo('original');
  $('playBtn').textContent = '▶';

  drawCurrentWave();
  drawSpectrum($('spectrumCanvas'), result.before, result.after);
  renderMeters(result.before, result.after, result.settings.targetLufs);
  renderNotes(result);

  const ext = EXTENSIONS[state.decoded.format];
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

window.addEventListener('resize', () => {
  if (state.result) {
    drawCurrentWave();
    drawSpectrum($('spectrumCanvas'), state.result.before, state.result.after);
  }
});

// ---------- init ----------
buildGenreGrid();
bindSliders();
bindDropzone();
bindResultControls();
$('processBtn').addEventListener('click', runProcess);
