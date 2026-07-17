// Decode uploaded audio into an AudioBuffer while preserving the source's native
// sample rate, and detect enough container metadata to re-encode in the same
// format later.

export function detectFormat(file) {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (name.endsWith('.wav') || type.includes('wav')) return 'wav';
  if (name.endsWith('.flac') || type.includes('flac')) return 'flac';
  if (name.endsWith('.mp3') || type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  return 'wav';
}

function readWavMeta(view) {
  // Standard RIFF/WAVE parse: find 'fmt ' chunk.
  if (view.getUint32(0, false) !== 0x52494646) return null; // 'RIFF'
  let offset = 12;
  const len = view.byteLength;
  const meta = {};
  while (offset + 8 <= len) {
    const id = view.getUint32(offset, false);
    const size = view.getUint32(offset + 4, true);
    if (id === 0x666d7420) {
      // 'fmt '
      meta.audioFormat = view.getUint16(offset + 8, true);
      meta.channels = view.getUint16(offset + 10, true);
      meta.sampleRate = view.getUint32(offset + 12, true);
      meta.bitDepth = view.getUint16(offset + 22, true);
    }
    offset += 8 + size + (size % 2);
  }
  return meta.sampleRate ? meta : null;
}

function readMp3Meta(bytes) {
  let i = 0;
  // Skip ID3v2 tag if present.
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    i = 10 + size;
  }
  for (; i < bytes.length - 4; i++) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) {
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      const versionBits = (b1 >> 3) & 0x03;
      const srIndex = (b2 >> 2) & 0x03;
      const bitrateIndex = (b2 >> 4) & 0x0f;
      const srTable = {
        3: [44100, 48000, 32000], // MPEG1
        2: [22050, 24000, 16000], // MPEG2
        0: [11025, 12000, 8000], // MPEG2.5
      };
      const table = srTable[versionBits];
      if (!table || srIndex === 3) continue;
      const brV1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
      return {
        sampleRate: table[srIndex],
        bitrate: versionBits === 3 ? brV1[bitrateIndex] || 0 : 0,
      };
    }
  }
  return null;
}

function readFlacMeta(bytes) {
  if (!(bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43)) {
    return null; // 'fLaC'
  }
  const o = 18; // STREAMINFO sample-rate field
  const sampleRate = (bytes[o] << 12) | (bytes[o + 1] << 4) | (bytes[o + 2] >> 4);
  const channels = ((bytes[o + 2] >> 1) & 0x07) + 1;
  const bitDepth = (((bytes[o + 2] & 0x01) << 4) | (bytes[o + 3] >> 4)) + 1;
  return { sampleRate, channels, bitDepth };
}

export async function decodeFile(file) {
  const format = detectFormat(file);
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  let meta = {};
  try {
    if (format === 'wav') meta = readWavMeta(new DataView(arrayBuffer)) || {};
    else if (format === 'mp3') meta = readMp3Meta(bytes) || {};
    else if (format === 'flac') meta = readFlacMeta(bytes) || {};
  } catch (e) {
    meta = {};
  }

  // Decode in a context matched to the source sample rate to avoid resampling.
  const rate = meta.sampleRate || 44100;
  let audioBuffer;
  try {
    const ctx = new OfflineAudioContext(2, Math.ceil(rate * 0.1), rate);
    audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } catch (err) {
    // Fallback: let the platform pick a rate.
    const ctx2 = new (window.AudioContext || window.webkitAudioContext)();
    audioBuffer = await ctx2.decodeAudioData(arrayBuffer.slice(0));
    ctx2.close();
  }

  return {
    audioBuffer,
    format,
    meta: {
      sampleRate: audioBuffer.sampleRate,
      channels: audioBuffer.numberOfChannels,
      bitDepth: meta.bitDepth || 16,
      bitrate: meta.bitrate || 0,
    },
  };
}

/**
 * Decode a raw ArrayBuffer (from URL fetch) the same way as an upload.
 * @param {ArrayBuffer} arrayBuffer
 * @param {string} formatHint wav|flac|mp3|m4a|webm|ogg
 */
export async function decodeArrayBuffer(arrayBuffer, formatHint = 'mp3') {
  const hint = (formatHint || 'mp3').toLowerCase();
  const format =
    hint === 'flac' ? 'flac'
      : hint === 'wav' || hint === 'wave' || hint === 'aif' || hint === 'aiff' ? 'wav'
        : hint === 'mp3' ? 'mp3'
          : 'mp3'; // WebAudio decodes m4a/webm/ogg too; we treat as mp3 for re-encode meta

  const bytes = new Uint8Array(arrayBuffer);
  let meta = {};
  try {
    if (format === 'wav') meta = readWavMeta(new DataView(arrayBuffer)) || {};
    else if (format === 'mp3') meta = readMp3Meta(bytes) || {};
    else if (format === 'flac') meta = readFlacMeta(bytes) || {};
  } catch {
    meta = {};
  }

  const rate = meta.sampleRate || 44100;
  let audioBuffer;
  try {
    const ctx = new OfflineAudioContext(2, Math.ceil(rate * 0.1), rate);
    audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } catch {
    const ctx2 = new (window.AudioContext || window.webkitAudioContext)();
    try {
      audioBuffer = await ctx2.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      ctx2.close();
    }
  }

  return {
    audioBuffer,
    format: ['wav', 'flac', 'mp3'].includes(format) ? format : 'mp3',
    meta: {
      sampleRate: audioBuffer.sampleRate,
      channels: audioBuffer.numberOfChannels,
      bitDepth: meta.bitDepth || 16,
      bitrate: meta.bitrate || 0,
    },
  };
}
