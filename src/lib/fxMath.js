// Pure helpers for the Vocal Practice Room. No browser APIs here, so they are unit-testable in Node.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => (g > 1e-9 ? 20 * Math.log10(g) : -120);

// Every adjustable effect, with its safe range. The UI sliders and normalizeSettings both read this.
export const FX_RANGES = {
  inputGainDb: { min: -12, max: 12, step: 0.5, label: 'Mic level', unit: 'dB' },
  lowCutHz: { min: 40, max: 200, step: 5, label: 'Low cut (rumble)', unit: 'Hz' },
  warmthDb: { min: -6, max: 6, step: 0.5, label: 'Warmth (200 Hz)', unit: 'dB' },
  presenceDb: { min: -6, max: 6, step: 0.5, label: 'Presence (3 kHz)', unit: 'dB' },
  airDb: { min: -6, max: 6, step: 0.5, label: 'Air (10 kHz)', unit: 'dB' },
  compAmount: { min: 0, max: 1, step: 0.05, label: 'Compression', unit: '' },
  delayMix: { min: 0, max: 0.6, step: 0.02, label: 'Echo mix', unit: '' },
  delayMs: { min: 60, max: 800, step: 10, label: 'Echo time', unit: 'ms' },
  delayFeedback: { min: 0, max: 0.7, step: 0.02, label: 'Echo repeats', unit: '' },
  reverbMix: { min: 0, max: 0.8, step: 0.02, label: 'Reverb mix', unit: '' },
  reverbSeconds: { min: 0.3, max: 4, step: 0.1, label: 'Reverb size', unit: 's' },
  outputDb: { min: -18, max: 6, step: 0.5, label: 'Output level', unit: 'dB' },
};

export const FX_DEFAULTS = {
  inputGainDb: 0, lowCutHz: 80, warmthDb: 0, presenceDb: 0, airDb: 0,
  compAmount: 0.3, delayMix: 0, delayMs: 280, delayFeedback: 0.3,
  reverbMix: 0.15, reverbSeconds: 1.4, outputDb: 0,
};

export const PRESETS = {
  Clean: { ...FX_DEFAULTS, reverbMix: 0.05, compAmount: 0.2 },
  'Warm room': { ...FX_DEFAULTS, warmthDb: 2.5, presenceDb: 1, airDb: 1, compAmount: 0.4, reverbMix: 0.25, reverbSeconds: 1.8 },
  'Bright pop': { ...FX_DEFAULTS, lowCutHz: 110, warmthDb: -1, presenceDb: 3, airDb: 3, compAmount: 0.6, reverbMix: 0.18, delayMix: 0.12, delayMs: 220, delayFeedback: 0.25 },
  'Big hall': { ...FX_DEFAULTS, compAmount: 0.4, reverbMix: 0.5, reverbSeconds: 3.2, presenceDb: 1 },
  'Slapback echo': { ...FX_DEFAULTS, compAmount: 0.4, delayMix: 0.3, delayMs: 120, delayFeedback: 0.1, reverbMix: 0.08 },
};

// Fill missing values from defaults and clamp everything into range, so bad input can never reach the audio graph.
export function normalizeSettings(input = {}) {
  const out = {};
  for (const [key, r] of Object.entries(FX_RANGES)) {
    const raw = input[key] === undefined ? FX_DEFAULTS[key] : Number(input[key]);
    out[key] = clamp(raw, r.min, r.max);
  }
  return out;
}

// Map the single "Compression" amount (0..1) to compressor parameters.
export function compressorParams(amount) {
  const a = clamp(amount, 0, 1);
  return {
    threshold: -10 - 26 * a, // -10 dB (barely touching) .. -36 dB
    ratio: 1 + 7 * a, // 1:1 (off) .. 8:1
    knee: 24,
    attack: 0.006,
    release: 0.2,
  };
}

// Synthetic reverb impulse response: exponentially decaying noise. Uses no recorded samples, so there is no licence to track.
export function makeImpulseResponse(sampleRate, seconds, rand = Math.random) {
  const length = Math.max(1, Math.floor(sampleRate * clamp(seconds, 0.1, 6)));
  const channels = [new Float32Array(length), new Float32Array(length)];
  const decayRate = 6.9 / length; // reaches about -60 dB at the tail
  for (const ch of channels) {
    for (let i = 0; i < length; i++) ch[i] = (rand() * 2 - 1) * Math.exp(-decayRate * i);
  }
  return channels;
}

export function peakDb(samples) {
  let p = 0;
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > p) p = a; }
  return gainToDb(p);
}
export function rmsDb(samples) {
  if (!samples.length) return -120;
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
  return gainToDb(Math.sqrt(s / samples.length));
}

// Encode float channel data (-1..1) as a 16-bit PCM WAV file.
export function encodeWav(channels, sampleRate) {
  const nCh = channels.length;
  const len = channels[0].length;
  const dataBytes = len * nCh * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nCh * 2, true);
  v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      const s = clamp(channels[c][i], -1, 1);
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return buf;
}

// Pick the first recording format this browser can produce.
export function pickRecorderMime(isSupported) {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((m) => isSupported(m)) ?? '';
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
