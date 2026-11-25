import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp, dbToGain, gainToDb, normalizeSettings, FX_RANGES, FX_DEFAULTS, PRESETS, compressorParams,
  makeImpulseResponse, peakDb, rmsDb, encodeWav, pickRecorderMime, formatTime } from '../src/lib/fxMath.js';

test('dB/gain conversion round-trips', () => {
  assert.ok(Math.abs(dbToGain(0) - 1) < 1e-12);
  assert.ok(Math.abs(dbToGain(-6.0206) - 0.5) < 1e-4);
  assert.ok(Math.abs(gainToDb(dbToGain(-12)) + 12) < 1e-9);
  assert.equal(gainToDb(0), -120);
});

test('clamp handles NaN and bounds', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(NaN, 2, 3), 2);
});

test('normalizeSettings fills defaults, clamps, and drops unknown keys', () => {
  const s = normalizeSettings({ reverbMix: 99, delayMs: -5, bogus: 1, outputDb: 'abc' });
  assert.equal(s.reverbMix, FX_RANGES.reverbMix.max);
  assert.equal(s.delayMs, FX_RANGES.delayMs.min);
  assert.equal(s.outputDb, FX_RANGES.outputDb.min); // NaN falls to the minimum
  assert.equal('bogus' in s, false);
  assert.equal(s.lowCutHz, FX_DEFAULTS.lowCutHz);
});

test('every preset is already inside the allowed ranges', () => {
  for (const [name, p] of Object.entries(PRESETS)) {
    assert.deepEqual(normalizeSettings(p), p, `preset ${name} has out-of-range values`);
  }
});

test('compressor maps amount 0 to off and 1 to heavy', () => {
  assert.equal(compressorParams(0).ratio, 1);
  assert.equal(compressorParams(1).ratio, 8);
  assert.ok(compressorParams(1).threshold < compressorParams(0).threshold);
  assert.equal(compressorParams(5).ratio, 8);
});

test('impulse response decays and is stereo', () => {
  let n = 0; const rand = () => ((n++ * 0.6180339887) % 1);
  const [l, r] = makeImpulseResponse(8000, 1, rand);
  assert.equal(l.length, 8000); assert.equal(r.length, 8000);
  const head = rmsDb(l.slice(0, 800)); const tail = rmsDb(l.slice(-800));
  assert.ok(head - tail > 30, `expected >30 dB decay, got ${head - tail}`);
});

test('peak and rms of a full-scale sine', () => {
  const x = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000));
  assert.ok(Math.abs(peakDb(x)) < 0.01);
  assert.ok(Math.abs(rmsDb(x) + 3.01) < 0.05);
  assert.equal(rmsDb(new Float32Array(0)), -120);
});

test('encodeWav writes a valid 16-bit PCM header and clips safely', () => {
  const ch = [Float32Array.from([0, 0.5, -0.5, 2, -2])];
  const dv = new DataView(encodeWav(ch, 44100));
  const tag = (o) => String.fromCharCode(...[0, 1, 2, 3].map((i) => dv.getUint8(o + i)));
  assert.equal(tag(0), 'RIFF'); assert.equal(tag(8), 'WAVE'); assert.equal(tag(36), 'data');
  assert.equal(dv.getUint32(4, true), 36 + 10);
  assert.equal(dv.getUint16(22, true), 1); assert.equal(dv.getUint32(24, true), 44100); assert.equal(dv.getUint16(34, true), 16);
  assert.equal(dv.getInt16(44 + 6, true), 32767); // +2 clipped to full scale
  assert.equal(dv.getInt16(44 + 8, true), -32768);
  assert.equal(dv.byteLength, 44 + 10);
});

test('encodeWav interleaves stereo', () => {
  const dv = new DataView(encodeWav([Float32Array.from([1, 1]), Float32Array.from([-1, -1])], 48000));
  assert.equal(dv.getInt16(44, true), 32767); assert.equal(dv.getInt16(46, true), -32768);
  assert.equal(dv.getUint16(32, true), 4);
});

test('pickRecorderMime prefers webm/opus, falls back, or returns empty', () => {
  assert.equal(pickRecorderMime(() => true), 'audio/webm;codecs=opus');
  assert.equal(pickRecorderMime((m) => m === 'audio/mp4'), 'audio/mp4');
  assert.equal(pickRecorderMime(() => false), '');
});

test('formatTime', () => {
  assert.equal(formatTime(0), '0:00'); assert.equal(formatTime(65.9), '1:05'); assert.equal(formatTime(-3), '0:00');
});
