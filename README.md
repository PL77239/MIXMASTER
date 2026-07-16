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
API and a from-scratch loudness engine:

1. **Analysis** — decodes the file at its native sample rate and measures:
   - **Integrated / short-term / momentary loudness** via a from-scratch
     **ITU-R BS.1770-4** implementation (K-weighting + absolute & relative
     gating). Calibration verified against `pyloudnorm` (within ~0.05 LU).
   - **Spectral balance** across 8 bands (sub → air) via FFT.
   - **Dynamics** (crest factor), **sample/true peak**, and **stereo** width.
2. **Content-aware EQ** — compares the track's measured spectrum to the chosen
   genre's target *signature* and applies gentle corrective peaking filters to
   move it toward that standard.
3. **Stem-aware dynamics** — a 4-band compressor treats **bass**, **low-mid
   (drum body)**, **mids (vocals/instrumental)** and **highs** separately, with
   genre-specific thresholds/ratios.
4. **Mid/Side vocal & width shaping** — vocal presence + de-ess on the mid
   (center) channel, air + widening on the sides, with **bass kept mono**.
5. **Glue + analog-style saturation** on the bus.
6. **Loudness normalization** to the target LUFS, followed by a **look-ahead
   true-peak limiter** at −1 dBTP. It iterates to land on target.

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
