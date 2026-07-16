# MIXMASTER LA

A **client-side AI mix & mastering studio** — a single-page web app, LA-sunset
themed, that mixes and masters your track entirely in the browser. Your audio
never leaves your device.

Upload a **WAV**, **FLAC** or **MP3**, pick a genre + direction, and get back a
streaming-ready master **in the same format you uploaded**, normalized to the
Spotify-standard **−14 LUFS** (or another target you choose) with a **−1 dBTP**
true-peak ceiling.

## What it actually does

This is not a toy — it runs a real mastering signal chain built on the Web Audio
API and a from-scratch loudness engine. The processing philosophy follows
**published Mixea-style controls** (Intensity × warmer/brighter EQ) and
**Dolby Music loudness / clarity guidance** (ITU-R BS.1770, −1 dBTP, mono-safe
bass, anti-masking) — not proprietary Dolby or Mixea code.

1. **Analysis** — decodes the file at its native sample rate and measures:
   - **Integrated / short-term / momentary loudness** via a from-scratch
     **ITU-R BS.1770-4** implementation (K-weighting + absolute & relative
     gating). Calibration verified against `pyloudnorm` (within ~0.05 LU).
   - **Spectral balance** across 8 bands (sub → air) via FFT.
   - **Dynamics** (crest factor), **sample/true peak**, and **stereo** width.
2. **Subtractive-first clarity EQ** — cuts the 200–500 Hz mud/boxiness zone
   before any boosts; content matching is capped gently so the track is not
   remoulded into a different genre.
3. **Mixea-style Intensity** — Low / Medium / High scales compression amount
   (and backs off further if the source is already squashed).
4. **Stem-aware dynamics** — a light 4-band compressor treats **bass**,
   **low-mid (drum body)**, **mids (vocals/instrumental)** and **highs**
   separately, with soft makeup so bands don’t stack into haze.
5. **Dolby-inspired Mid/Side** — vocal presence on the mid channel; sides get
   a steep high-pass + mud cut so **bass stays mono** and width stays clean.
6. **Light glue + soft saturation**, then **loudness normalization** to the
   target LUFS and a **look-ahead true-peak limiter** at −1 dBTP.

Output is re-encoded to the **same container** as the input:
WAV (16/24-bit or 32-bit float), MP3 (via LAME), or FLAC (via libFLAC).

## Genres / standards included

Hip-Hop/Trap, Pop, EDM/House, Rock/Alt, R&B/Soul, Acoustic/Folk, Lo-Fi/Chill,
Reggaeton/Latin, Metal/Heavy, Jazz, Classical/Score, Podcast/Vocal — each with
its own target spectral signature, multiband dynamics, saturation, width and
vocal-presence settings. On top of that you get **Warmth**, **Brightness/Air**,
**Bass weight**, **Vocal presence** and **Stereo width** controls plus a
**dynamics profile** (Open / Balanced / Loud & punchy) and a **target loudness**
selector (−14 / −16 / −9 / −23 LUFS).

## Run it

**Live site:** https://pl77239.github.io/MIXMASTER/

```bash
npm install
npm run dev      # local Vite dev server
# or
npm run build    # production build + publish assets for GitHub Pages
npm run preview  # preview the Vite dist/ locally
```

`npm run build` bundles CSS/JS into `assets/` and writes a production `index.html` at the repo root so GitHub Pages (which serves this branch from `/`) gets a fully styled, working app — not the raw Vite source.

Everything runs in the browser — no server, no upload of your audio.

## Tech notes

- Pure client-side; processing uses `OfflineAudioContext` render passes plus
  hand-written DSP (loudness, limiter, encoders).
- Best in a recent Chromium/Firefox (needs `AudioBuffer`/`OfflineAudioContext`
  and FLAC decode support). Files up to ~10 minutes are comfortable.
- Built with [Vite](https://vitejs.dev/),
  [@breezystack/lamejs](https://github.com/zhuker/lamejs) (MP3) and
  [libflacjs](https://github.com/mmig/libflac.js) (FLAC).
