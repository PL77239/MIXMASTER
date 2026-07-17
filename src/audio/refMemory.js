/**
 * Client-side reference memory — learn spectral / loudness / width targets
 * from user-supplied references and reuse them on similar future uploads.
 * Profiles only (no audio) in localStorage.
 */

const KEY = 'mixa.refMemory.v1';
const MAX = 24;

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function loadAll() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // Quota / private mode — fail quietly
  }
}

function regionDistance(a, b) {
  if (!a || !b) return 1;
  const keys = ['sub', 'bass', 'lowMid', 'mid', 'high', 'air'];
  let s = 0;
  for (const k of keys) {
    s += Math.abs((a[k] || 0) - (b[k] || 0));
  }
  return s / keys.length;
}

/**
 * Similarity 0..1 — higher = closer spectral / loudness / width match.
 */
export function similarityScore(candidate, target, genre) {
  const reg = 1 - Math.min(1, regionDistance(candidate.regions, target.regions) / 0.12);
  const lufs = 1 - Math.min(1, Math.abs((candidate.lufs ?? -14) - (target.lufs ?? -14)) / 8);
  const width = 1 - Math.min(1, Math.abs((candidate.width ?? 0.15) - (target.width ?? 0.15)) / 0.2);
  const crest = 1 - Math.min(1, Math.abs((candidate.crest ?? 10) - (target.crest ?? 10)) / 8);
  const genreBonus = candidate.genre && genre && candidate.genre === genre ? 0.08 : 0;
  return clamp01(reg * 0.5 + lufs * 0.22 + width * 0.14 + crest * 0.14 + genreBonus);
}

export function listMemories() {
  return loadAll();
}

export function memoryCount() {
  return loadAll().length;
}

export function clearMemories() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* noop */ }
}

/**
 * Persist a learned profile after a session that used user references.
 */
export function rememberReference({ profile, genre, plan }) {
  if (!profile?.regions) return null;
  const list = loadAll();
  const entry = {
    id: `ref_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: profile.name || 'Reference',
    savedAt: Date.now(),
    genre: genre || null,
    regions: { ...profile.regions },
    lufs: profile.lufs,
    width: profile.width,
    crest: profile.crest,
    peakDb: profile.peakDb,
    learned: {
      spectrum: { ...profile.regions },
      targetLufs: plan?.peak?.targetLufs ?? profile.lufs,
      width: plan?.widthTarget ?? profile.width,
      mudBias: plan?.eq?.find((e) => e.label === 'Mud cut')?.gain ?? null,
      peakStyle: plan?.peak?.style || null,
    },
    useCount: 0,
  };

  // Merge into nearest existing memory if very similar (avoid duplicates)
  let bestIdx = -1;
  let best = 0;
  for (let i = 0; i < list.length; i++) {
    const s = similarityScore(list[i], entry, genre);
    if (s > best) {
      best = s;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0 && best >= 0.88) {
    const prev = list[bestIdx];
    const blend = (a, b, t = 0.35) => a * (1 - t) + b * t;
    const keys = Object.keys(entry.regions);
    for (const k of keys) {
      prev.regions[k] = blend(prev.regions[k], entry.regions[k]);
    }
    let sum = 0;
    for (const k of keys) sum += prev.regions[k];
    for (const k of keys) prev.regions[k] /= sum;
    prev.lufs = blend(prev.lufs, entry.lufs);
    prev.width = blend(prev.width, entry.width);
    prev.crest = blend(prev.crest, entry.crest);
    prev.learned = { ...prev.learned, ...entry.learned, spectrum: { ...prev.regions } };
    prev.name = entry.name;
    prev.savedAt = Date.now();
    prev.genre = genre || prev.genre;
    prev.useCount = (prev.useCount || 0) + 1;
    saveAll(list);
    return prev;
  }

  list.unshift(entry);
  saveAll(list);
  return entry;
}

/**
 * Find the best remembered profile for this upload.
 * @returns {{ memory, score } | null}
 */
export function findSimilar(targetProfile, genre, minScore = 0.62) {
  const list = loadAll();
  if (!list.length || !targetProfile?.regions) return null;
  let best = null;
  let bestScore = 0;
  for (const m of list) {
    const s = similarityScore(m, targetProfile, genre);
    if (s > bestScore) {
      bestScore = s;
      best = m;
    }
  }
  if (!best || bestScore < minScore) return null;
  best.useCount = (best.useCount || 0) + 1;
  best.lastUsedAt = Date.now();
  saveAll(list);
  return {
    memory: best,
    score: bestScore,
    profile: {
      name: `Memory · ${best.name}`,
      regions: { ...(best.learned?.spectrum || best.regions) },
      lufs: best.learned?.targetLufs ?? best.lufs,
      width: best.learned?.width ?? best.width,
      crest: best.crest,
      peakDb: best.peakDb,
      fromMemory: true,
      memoryScore: bestScore,
    },
  };
}
