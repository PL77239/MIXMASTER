import Flac from 'libflacjs/dist/libflac.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

let readyPromise = null;
function whenReady() {
  if (!readyPromise) {
    readyPromise = new Promise((resolve) => {
      if (Flac.isReady && Flac.isReady()) resolve();
      else Flac.on('ready', () => resolve());
    });
  }
  return readyPromise;
}

function floatToInt32(channels, bps) {
  const numCh = channels.length;
  const len = channels[0].length;
  const max = Math.pow(2, bps - 1) - 1;
  const min = -Math.pow(2, bps - 1);
  const out = new Int32Array(len * numCh);
  let idx = 0;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = channels[c][i];
      s = s > 1 ? 1 : s < -1 ? -1 : s;
      const v = Math.round(s < 0 ? s * -min : s * max);
      out[idx++] = v > max ? max : v < min ? min : v;
    }
  }
  return out;
}

export async function encodeFlac(channels, sampleRate, bitDepth = 16, onProgress) {
  await whenReady();
  const bps = bitDepth === 24 ? 24 : 16;
  const numCh = channels.length;
  const compression = 6;
  const totalSamples = channels[0].length;

  const encoder = Flac.create_libflac_encoder(
    sampleRate, numCh, bps, compression, totalSamples, false);
  if (encoder === 0) throw new Error('Failed to create FLAC encoder');

  const output = [];
  const initStatus = Flac.init_encoder_stream(
    encoder,
    (buffer) => output.push(buffer.slice()),
    () => {},
    false,
    0,
  );
  if (initStatus !== 0) {
    Flac.FLAC__stream_encoder_delete(encoder);
    throw new Error('Failed to initialize FLAC encoder (status ' + initStatus + ')');
  }

  const interleaved = floatToInt32(channels, bps);
  const chunk = 32768; // samples per channel per process call

  for (let start = 0; start < totalSamples; start += chunk) {
    const count = Math.min(chunk, totalSamples - start);
    const slice = interleaved.subarray(start * numCh, (start + count) * numCh);
    const ok = Flac.FLAC__stream_encoder_process_interleaved(encoder, slice, count);
    if (!ok) {
      Flac.FLAC__stream_encoder_delete(encoder);
      throw new Error('FLAC encoding failed');
    }
    onProgress && onProgress(start / totalSamples);
    await tick();
  }

  Flac.FLAC__stream_encoder_finish(encoder);
  Flac.FLAC__stream_encoder_delete(encoder);

  return new Blob(output, { type: 'audio/flac' });
}
