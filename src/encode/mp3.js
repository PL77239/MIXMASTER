import { Mp3Encoder } from '@breezystack/lamejs';

const tick = () => new Promise((r) => setTimeout(r, 0));

function floatToInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    let s = f32[i];
    s = s > 1 ? 1 : s < -1 ? -1 : s;
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export async function encodeMp3(channels, sampleRate, kbps = 320, onProgress) {
  const numCh = channels.length >= 2 ? 2 : 1;
  const bitrate = kbps && kbps >= 96 ? kbps : 320;
  const enc = new Mp3Encoder(numCh, sampleRate, bitrate);
  const len = channels[0].length;
  const left = floatToInt16(channels[0]);
  const right = numCh === 2 ? floatToInt16(channels[1]) : null;
  const block = 1152;
  const data = [];

  for (let i = 0; i < len; i += block) {
    const le = left.subarray(i, i + block);
    let buf;
    if (numCh === 2) {
      const re = right.subarray(i, i + block);
      buf = enc.encodeBuffer(le, re);
    } else {
      buf = enc.encodeBuffer(le);
    }
    if (buf.length > 0) data.push(new Uint8Array(buf));
    if (i % (block * 400) === 0) {
      onProgress && onProgress(i / len);
      await tick();
    }
  }
  const end = enc.flush();
  if (end.length > 0) data.push(new Uint8Array(end));
  return new Blob(data, { type: 'audio/mpeg' });
}
