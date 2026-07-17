// Encode Float32 channel arrays to a WAV blob, preserving bit depth.
// Supports 16-bit PCM, 24-bit PCM and 32-bit float.

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function clampSample(s) {
  return s > 1 ? 1 : s < -1 ? -1 : s;
}

export function encodeWav(channels, sampleRate, bitDepth = 16) {
  const bd = [16, 24, 32].includes(bitDepth) ? bitDepth : 16;
  const isFloat = bd === 32;
  const numCh = channels.length;
  const len = channels[0].length;
  const bytesPerSample = bd / 8;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = len * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, isFloat ? 3 : 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bd, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = clampSample(channels[c][i]);
      if (isFloat) {
        view.setFloat32(off, s, true);
        off += 4;
      } else if (bd === 16) {
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      } else {
        // 24-bit little-endian signed
        const v = Math.max(-8388608, Math.min(8388607, Math.round(s * 8388607)));
        const u = v < 0 ? v + 0x1000000 : v;
        view.setUint8(off, u & 0xff);
        view.setUint8(off + 1, (u >> 8) & 0xff);
        view.setUint8(off + 2, (u >> 16) & 0xff);
        off += 3;
      }
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
