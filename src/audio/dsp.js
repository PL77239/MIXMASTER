// Shared DSP helpers for the mastering engine.

// Create an AudioBuffer from an array of Float32 channel arrays.
export function makeBuffer(channelArrays, sampleRate) {
  const length = channelArrays[0].length;
  const buf = new AudioBuffer({
    length,
    numberOfChannels: channelArrays.length,
    sampleRate,
  });
  for (let c = 0; c < channelArrays.length; c++) buf.copyToChannel(channelArrays[c], c);
  return buf;
}

export function getChannelArrays(audioBuffer) {
  const arr = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    arr.push(audioBuffer.getChannelData(c).slice());
  }
  return arr;
}

// Render a node graph offline. `build(ctx, source)` must return the final node
// to be connected to the destination (or connect it itself and return null).
export async function renderGraph(inputBuffer, build) {
  const ctx = new OfflineAudioContext({
    numberOfChannels: inputBuffer.numberOfChannels,
    length: inputBuffer.length,
    sampleRate: inputBuffer.sampleRate,
  });
  const source = ctx.createBufferSource();
  source.buffer = inputBuffer;
  const tail = build(ctx, source);
  if (tail) tail.connect(ctx.destination);
  source.start(0);
  return ctx.startRendering();
}

// Connect a chain of nodes in series and return the last node.
export function chain(nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

export function peaking(ctx, freq, gain, q = 1.0) {
  const f = ctx.createBiquadFilter();
  f.type = 'peaking';
  f.frequency.value = freq;
  f.gain.value = gain;
  f.Q.value = q;
  return f;
}

export function lowShelf(ctx, freq, gain) {
  const f = ctx.createBiquadFilter();
  f.type = 'lowshelf';
  f.frequency.value = freq;
  f.gain.value = gain;
  return f;
}

export function highShelf(ctx, freq, gain) {
  const f = ctx.createBiquadFilter();
  f.type = 'highshelf';
  f.frequency.value = freq;
  f.gain.value = gain;
  return f;
}

export function highpass(ctx, freq, q = Math.SQRT1_2) {
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

export function lowpass(ctx, freq, q = Math.SQRT1_2) {
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

export function gainNode(ctx, value) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

// Gentle tanh saturation curve (adds even/odd harmonics, normalised to unity).
export function saturationCurve(amount) {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = amount * 3.2;
  const denom = Math.tanh(1 + k) || 1;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh((1 + k) * x) / denom;
  }
  return curve;
}

export function compressor(ctx, { threshold, ratio, attack, release, knee = 6 }) {
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = threshold;
  c.ratio.value = ratio;
  c.attack.value = attack;
  c.release.value = release;
  c.knee.value = knee;
  return c;
}

export function dbToLin(db) {
  return Math.pow(10, db / 20);
}
