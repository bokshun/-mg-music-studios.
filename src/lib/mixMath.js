// Pure mixing maths for the Mixing room. No browser APIs here, so it can be
// unit-tested in Node and reused by the offline export.
import { clamp, dbToGain } from './fxMath.js';

export const TRACK_LIMITS = {
  volumeDb: { min: -40, max: 12 },
  pan: { min: -1, max: 1 },
  offsetMs: { min: -5000, max: 5000 },
};
export const DEFAULT_FADE_SEC = 0.03; // short crossfade so voice swaps never click

let nextId = 1;
export function makeTrack(name, extra = {}) {
  return {
    id: `t${nextId++}`,
    name,
    role: 'always', // 'always' plays the whole song; 'voice' only plays where the cut list picks it
    volumeDb: 0,
    pan: 0,
    offsetMs: 0,
    mute: false,
    solo: false,
    ...extra,
  };
}

export function normalizeTrack(t) {
  return {
    ...t,
    role: t.role === 'voice' ? 'voice' : 'always',
    volumeDb: clamp(Number(t.volumeDb), TRACK_LIMITS.volumeDb.min, TRACK_LIMITS.volumeDb.max),
    pan: clamp(Number(t.pan), TRACK_LIMITS.pan.min, TRACK_LIMITS.pan.max),
    offsetMs: clamp(Number(t.offsetMs), TRACK_LIMITS.offsetMs.min, TRACK_LIMITS.offsetMs.max),
    mute: Boolean(t.mute),
    solo: Boolean(t.solo),
  };
}

// Balance law for stereo songs: centre leaves both sides untouched, moving the pan
// fades the opposite side out (to silence at the extreme) and never boosts the near side.
export function panGains(pan) {
  const p = clamp(Number(pan), -1, 1);
  return {
    left: p <= 0 ? 1 : Math.cos((p * Math.PI) / 2),
    right: p >= 0 ? 1 : Math.cos((-p * Math.PI) / 2),
  };
}

// If any track is soloed, only soloed tracks are heard. Mute always wins.
export function audibleTrackIds(tracks) {
  const anySolo = tracks.some((t) => t.solo);
  return new Set(tracks.filter((t) => !t.mute && (!anySolo || t.solo)).map((t) => t.id));
}

// "1:23", "1:23.5", "83", "83.5" -> seconds. Returns NaN when it cannot be read.
export function parseTime(text) {
  const s = String(text ?? '').trim();
  if (!s) return NaN;
  const m = s.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return NaN;
  return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
}

export function formatClock(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

// Tidy a cut list: drop unreadable rows, clamp to the song length, sort, and let a
// later row win where two overlap. Rows: { start, end, trackId } in seconds.
export function normalizeCutList(rows, duration = Infinity) {
  const clean = [];
  for (const r of rows ?? []) {
    const start = clamp(Number(r.start), 0, duration);
    const end = clamp(Number(r.end), 0, duration);
    if (!r.trackId || !(end > start) || Number.isNaN(Number(r.start)) || Number.isNaN(Number(r.end))) continue;
    clean.push({ start, end, trackId: r.trackId });
  }
  // Later rows (as the person listed them) win overlaps.
  const out = [];
  for (const row of clean) {
    const next = [];
    for (const prev of out) {
      if (prev.end <= row.start || prev.start >= row.end) { next.push(prev); continue; }
      if (prev.start < row.start) next.push({ ...prev, end: row.start });
      if (prev.end > row.end) next.push({ ...prev, start: row.end });
    }
    next.push(row);
    out.length = 0; out.push(...next);
  }
  out.sort((a, b) => a.start - b.start);
  // Join touching rows that use the same voice.
  const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && last.trackId === r.trackId && Math.abs(last.end - r.start) < 1e-9) last.end = r.end;
    else merged.push({ ...r });
  }
  return merged;
}

// Which voice track is singing at time t.
export function voiceAt(cutList, defaultId, t) {
  const hit = cutList.find((r) => t >= r.start && t < r.end);
  return hit ? hit.trackId : defaultId;
}

// Text like "0:11-0:25 Flomar" (one per line) -> rows. nameToId maps lower-case names to track ids.
export function parseCutListText(text, nameToId) {
  const rows = [];
  const problems = [];
  String(text ?? '').split(/\r?\n/).forEach((line, i) => {
    const raw = line.trim();
    if (!raw || raw.startsWith('#')) return;
    const m = raw.match(/^([\d:.]+)\s*(?:-|–|—|to)\s*([\d:.]+)\s+(.+)$/i);
    if (!m) { problems.push(`Line ${i + 1}: could not read "${raw}". Use  0:11-0:25 Name`); return; }
    const start = parseTime(m[1]); const end = parseTime(m[2]);
    const id = nameToId[m[3].trim().toLowerCase()];
    if (Number.isNaN(start) || Number.isNaN(end)) { problems.push(`Line ${i + 1}: the times are not valid.`); return; }
    if (!(end > start)) { problems.push(`Line ${i + 1}: the end must be after the start.`); return; }
    if (!id) { problems.push(`Line ${i + 1}: no voice track named "${m[3].trim()}".`); return; }
    rows.push({ start, end, trackId: id });
  });
  return { rows, problems };
}

// Gain envelope for one voice track as breakpoints [{t, g}] (linear between points).
// 1 where this voice is chosen, 0 elsewhere, with a short crossfade at each change.
export function voiceEnvelope(trackId, cutList, defaultId, duration, fade = DEFAULT_FADE_SEC) {
  // Build the chosen-voice timeline as spans covering [0, duration].
  const spans = [];
  let cursor = 0;
  for (const r of cutList) {
    if (r.start > cursor) spans.push({ start: cursor, end: r.start, id: defaultId });
    spans.push({ start: r.start, end: r.end, id: r.trackId });
    cursor = r.end;
  }
  if (cursor < duration) spans.push({ start: cursor, end: duration, id: defaultId });
  const pts = [];
  const push = (t, g) => {
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.t - t) < 1e-9) last.g = g; else pts.push({ t, g });
  };
  let prevOn = null;
  for (const s of spans) {
    const on = s.id === trackId ? 1 : 0;
    if (prevOn === null) { push(0, on); }
    else if (on !== prevOn) {
      // Equal split of the fade either side of the boundary.
      push(Math.max(0, s.start - fade / 2), prevOn);
      push(s.start + fade / 2, on);
    }
    prevOn = on;
  }
  if (prevOn !== null) push(duration, prevOn);
  return pts;
}

// Value of a breakpoint envelope at time t.
export function envelopeAt(points, t) {
  if (!points.length) return 1;
  if (t <= points[0].t) return points[0].g;
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i].t) {
      const a = points[i - 1]; const b = points[i];
      const span = b.t - a.t;
      return span <= 0 ? b.g : a.g + ((b.g - a.g) * (t - a.t)) / span;
    }
  }
  return points[points.length - 1].g;
}

// Plain-JS mixdown used for export (and tests). tracks: [{ track, channels: Float32Array[] }]
// All channel data must already be at `sampleRate`. Returns { channels: [L, R], sampleRate, peak, scaled }.
export function mixdown(items, { cutList = [], defaultId = null, sampleRate, fade = DEFAULT_FADE_SEC, ceilingDb = -1 } = {}) {
  if (!items.length) throw new Error('Load at least one track first.');
  const tracks = items.map((i) => normalizeTrack(i.track));
  const audible = audibleTrackIds(tracks);
  const lengths = items.map((it, i) => it.channels[0].length + Math.round((tracks[i].offsetMs / 1000) * sampleRate));
  const total = Math.max(...lengths, 1);
  const duration = total / sampleRate;
  const list = normalizeCutList(cutList, duration);
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  items.forEach((item, idx) => {
    const t = tracks[idx];
    if (!audible.has(t.id)) return;
    const gain = dbToGain(t.volumeDb);
    const { left, right } = panGains(t.pan);
    const off = Math.round((t.offsetMs / 1000) * sampleRate);
    const src0 = item.channels[0];
    const src1 = item.channels[1] ?? item.channels[0];
    const env = t.role === 'voice' ? voiceEnvelope(t.id, list, defaultId, duration, fade) : null;
    let seg = 0; // moving index into env for speed
    for (let i = 0; i < src0.length; i++) {
      const o = i + off;
      if (o < 0 || o >= total) continue;
      let g = gain;
      if (env) {
        const time = o / sampleRate;
        while (seg < env.length - 2 && time > env[seg + 1].t) seg++;
        const a = env[seg]; const b = env[Math.min(seg + 1, env.length - 1)];
        const span = b.t - a.t;
        const e = span <= 0 ? b.g : a.g + ((b.g - a.g) * clamp((time - a.t) / span, 0, 1));
        if (e === 0) continue;
        g *= e;
      }
      L[o] += src0[i] * g * left;
      R[o] += src1[i] * g * right;
    }
  });
  // Keep the loudest point under the ceiling instead of letting it clip.
  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const ceiling = dbToGain(ceilingDb);
  let scaled = false;
  if (peak > ceiling) {
    const k = ceiling / peak;
    for (let i = 0; i < total; i++) { L[i] *= k; R[i] *= k; }
    scaled = true;
  }
  return { channels: [L, R], sampleRate, peak, scaled, duration };
}
