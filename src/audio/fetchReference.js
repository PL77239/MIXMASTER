/**
 * Resolve a pasted reference URL into an AudioBuffer.
 * Quality policy: always prefer lossless (WAV/FLAC). Streaming links are
 * lossy fallbacks with explicit warnings (Spotify previews, YouTube AAC/Opus).
 */

import { decodeArrayBuffer } from './decode.js';

const LOSSLESS_EXT = /\.(flac|wav|aiff?|wave)(\?|#|$)/i;
const LOSSY_EXT = /\.(mp3|m4a|aac|ogg|opus|webm)(\?|#|$)/i;

function classifyUrl(url) {
  const u = url.trim();
  if (/open\.spotify\.com\/(track|album|playlist|episode)\//i.test(u) || /spotify:track:/i.test(u)) {
    return { kind: 'spotify', url: u };
  }
  if (/youtu\.be\/|youtube\.com\/(watch|shorts|embed)/i.test(u) || /music\.youtube\.com\//i.test(u)) {
    return { kind: 'youtube', url: u };
  }
  if (/soundcloud\.com\//i.test(u)) {
    return { kind: 'soundcloud', url: u };
  }
  if (LOSSLESS_EXT.test(u)) return { kind: 'direct-lossless', url: u };
  if (LOSSY_EXT.test(u) || /^https?:\/\//i.test(u)) return { kind: 'direct', url: u };
  return { kind: 'unknown', url: u };
}

function youtubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0];
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(shorts|embed)\/([^/?#]+)/);
    if (m) return m[2];
  } catch {
    /* noop */
  }
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

function spotifyTrackId(url) {
  const m = url.match(/track\/([A-Za-z0-9]+)/) || url.match(/spotify:track:([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

async function fetchBytes(url, timeoutMs = 45000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.arrayBuffer();
  } finally {
    clearTimeout(t);
  }
}

async function fetchViaProxy(url) {
  // allorigins — last-resort CORS bridge for embed HTML / public APIs
  const proxied = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  return fetchBytes(proxied, 60000);
}

/**
 * Spotify: only 30s lossy preview is available in-browser (DRM blocks full tracks).
 * Prefer uploading a lossless file when possible.
 */
async function resolveSpotify(url) {
  const id = spotifyTrackId(url);
  if (!id) throw new Error('Could not parse Spotify track ID. Use a track link (open.spotify.com/track/…).');

  const embedUrl = `https://open.spotify.com/embed/track/${id}`;
  let html;
  try {
    html = new TextDecoder().decode(await fetchViaProxy(embedUrl));
  } catch {
    throw new Error('Could not reach Spotify embed. Upload a WAV/FLAC reference instead.');
  }

  const preview =
    html.match(/"audioPreview"\s*:\s*\{\s*"url"\s*:\s*"([^"]+)"/) ||
    html.match(/preview_url\\?":\s*\\?"(https:[^"\\]+)/) ||
    html.match(/https:\/\/p\.scdn\.co\/mp3-preview\/[a-f0-9]+/);

  let previewUrl = null;
  if (preview) {
    previewUrl = preview[1] ? preview[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/') : preview[0];
  }
  if (!previewUrl) {
    throw new Error(
      'No Spotify preview available for this track. Upload a lossless WAV/FLAC reference instead.'
    );
  }

  const buf = await fetchBytes(previewUrl);
  const decoded = await decodeArrayBuffer(buf, 'mp3');
  return {
    ...decoded,
    name: `Spotify preview (${id})`,
    quality: 'lossy-preview',
    warning:
      'Spotify full tracks are DRM-protected. Using a 30s lossy preview — for accurate matching, upload a lossless WAV/FLAC of the same track.',
  };
}

const INVIDIOUS_HOSTS = [
  'https://inv.nadeko.net',
  'https://invidious.jing.rocks',
  'https://y.com.sb',
  'https://invidious.protokolla.fi',
  'https://inv.tux.pizza',
];

/**
 * YouTube: best-effort highest audio via public Invidious instances.
 * Still lossy (Opus/AAC) — warn user to prefer lossless upload.
 */
async function resolveYouTube(url) {
  const id = youtubeId(url);
  if (!id) throw new Error('Could not parse YouTube video ID.');

  const errors = [];
  for (const host of INVIDIOUS_HOSTS) {
    try {
      const api = `${host}/api/v1/videos/${id}`;
      let json;
      try {
        const raw = await fetchBytes(api, 12000);
        json = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        const raw = await fetchViaProxy(api);
        json = JSON.parse(new TextDecoder().decode(raw));
      }

      const formats = [
        ...(json.adaptiveFormats || []),
        ...(json.formatStreams || []),
      ].filter((f) => {
        const t = `${f.type || ''} ${f.mimeType || ''} ${f.container || ''}`.toLowerCase();
        return t.includes('audio') || t.includes('opus') || t.includes('m4a') || t.includes('webm');
      });

      // Prefer highest bitrate / opus
      formats.sort((a, b) => (b.bitrate || b.audioBitrate || 0) - (a.bitrate || a.audioBitrate || 0));
      const best = formats[0];
      if (!best?.url) {
        errors.push(`${host}: no audio format`);
        continue;
      }

      let audioBuf;
      try {
        audioBuf = await fetchBytes(best.url, 90000);
      } catch {
        audioBuf = await fetchViaProxy(best.url);
      }

      const mime = (best.type || best.mimeType || 'audio/webm').split(';')[0];
      const ext = mime.includes('mp4') || mime.includes('m4a') ? 'm4a'
        : mime.includes('webm') || mime.includes('opus') ? 'webm'
          : 'mp3';
      const decoded = await decodeArrayBuffer(audioBuf, ext);
      const title = json.title || id;
      return {
        ...decoded,
        name: `YouTube · ${title}`.slice(0, 80),
        quality: 'lossy-stream',
        warning:
          'YouTube audio is lossy (Opus/AAC). For reference matching, prefer a lossless WAV/FLAC of the same mix when available.',
      };
    } catch (e) {
      errors.push(`${host}: ${e.message || e}`);
    }
  }

  throw new Error(
    `Could not fetch YouTube audio in-browser (${errors.slice(0, 2).join('; ')}). ` +
      'Download best audio as WAV/FLAC and upload it as a file reference instead.'
  );
}

async function resolveDirect(url, preferLosslessNote = false) {
  let buf;
  try {
    buf = await fetchBytes(url);
  } catch {
    buf = await fetchViaProxy(url);
  }
  const path = url.split('?')[0];
  const ext = (path.match(/\.([a-z0-9]+)$/i) || [, 'mp3'])[1].toLowerCase();
  const decoded = await decodeArrayBuffer(buf, ext === 'wave' ? 'wav' : ext);
  const lossless = LOSSLESS_EXT.test(url);
  return {
    ...decoded,
    name: path.split('/').pop() || 'Reference',
    quality: lossless ? 'lossless' : 'lossy',
    warning: lossless
      ? null
      : preferLosslessNote
        ? 'This URL looks lossy. Prefer WAV/FLAC for reference matching when possible.'
        : 'Fetched lossy audio — matching will be approximate vs a lossless reference.',
  };
}

/**
 * @returns {Promise<{ audioBuffer: AudioBuffer, name: string, format: string, quality: string, warning: string|null, meta?: object }>}
 */
export async function fetchReferenceFromUrl(urlString) {
  const classified = classifyUrl(urlString);
  if (classified.kind === 'unknown') {
    throw new Error('Paste a YouTube, Spotify track, or direct WAV/FLAC/MP3 link.');
  }

  if (classified.kind === 'spotify') return resolveSpotify(classified.url);
  if (classified.kind === 'youtube') return resolveYouTube(classified.url);
  if (classified.kind === 'soundcloud') {
    throw new Error(
      'SoundCloud links aren’t resolved in-browser yet. Download WAV/FLAC and upload, or paste a direct media URL.'
    );
  }
  if (classified.kind === 'direct-lossless') return resolveDirect(classified.url);
  return resolveDirect(classified.url, true);
}

export function qualityBadge(quality) {
  if (quality === 'lossless') return 'Lossless';
  if (quality === 'lossy-preview') return 'Lossy preview (30s)';
  if (quality === 'lossy-stream') return 'Lossy stream';
  return 'Lossy';
}
