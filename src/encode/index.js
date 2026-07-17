import { encodeWav } from './wav.js';
import { encodeMp3 } from './mp3.js';
import { encodeFlac } from './flac.js';

// Encode an AudioBuffer back into a Blob of the requested format, matching the
// source container so downloads come back in the same format they arrived in.
export async function encodeBuffer(audioBuffer, format, meta, onProgress) {
  const channels = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }
  const sampleRate = audioBuffer.sampleRate;

  if (format === 'mp3') {
    return encodeMp3(channels, sampleRate, meta.bitrate || 320, onProgress);
  }
  if (format === 'flac') {
    return encodeFlac(channels, sampleRate, meta.bitDepth || 16, onProgress);
  }
  // default WAV
  return encodeWav(channels, sampleRate, meta.bitDepth || 16);
}

export const EXTENSIONS = { wav: 'wav', mp3: 'mp3', flac: 'flac' };
export const MIME = { wav: 'audio/wav', mp3: 'audio/mpeg', flac: 'audio/flac' };
