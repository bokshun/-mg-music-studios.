import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeTrack, normalizeTrack, panGains, audibleTrackIds, parseTime, formatClock,
  normalizeCutList, voiceAt, parseCutListText, voiceEnvelope, envelopeAt, mixdown, TRACK_LIMITS,
} from '../src/lib/mixMath.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);

test('normalizeTrack clamps volume, pan and offset and fixes role', () => {
  const t = normalizeTrack({ id: 'a', volumeDb: 99, pan: -5, offsetMs: 1e9, role: 'weird', mute: 1 });
  assert.equal(t.volumeDb, TRACK_LIMITS.volumeDb.max);
  assert.equal(t.pan, -1);
  assert.equal(t.offsetMs, TRACK_LIMITS.offsetMs.max);
  assert.equal(t.role, 'always');
  assert.equal(t.mute, true);
});

test('pan law: centre untouched, extremes silence the far side, never boosts', () => {
  assert.deepEqual(panGains(0), { left: 1, right: 1 });
  near(panGains(1).left, 0); near(panGains(1).right, 1);
  near(panGains(-1).right, 0); near(panGains(-1).left, 1);
  const half = panGains(0.5);
  assert.ok(half.left < 1 && half.left > 0 && half.right === 1);
});

test('solo overrides, mute always wins', () => {
  const a = makeTrack('a'); const b = makeTrack('b'); const c = makeTrack('c');
  assert.deepEqual([...audibleTrackIds([a, b, c])].sort(), [a.id, b.id, c.id].sort());
  b.solo = true;
  assert.deepEqual([...audibleTrackIds([a, b, c])], [b.id]);
  b.mute = true;
  assert.deepEqual([...audibleTrackIds([a, b, c])], []);
});

test('parseTime reads m:ss, m:ss.s and plain seconds, rejects junk', () => {
  assert.equal(parseTime('1:23'), 83);
  assert.equal(parseTime('0:11'), 11);
  assert.equal(parseTime('83.5'), 83.5);
  assert.equal(parseTime('2:05.25'), 125.25);
  assert.ok(Number.isNaN(parseTime('abc')));
  assert.ok(Number.isNaN(parseTime('')));
  assert.ok(Number.isNaN(parseTime('1:2:3')));
});

test('formatClock', () => {
  assert.equal(formatClock(0), '0:00.0');
  assert.equal(formatClock(83.46), '1:23.5');
  assert.equal(formatClock(-4), '0:00.0');
});

test('normalizeCutList clamps, sorts, drops bad rows, later rows win overlaps, joins neighbours', () => {
  const out = normalizeCutList([
    { start: 30, end: 40, trackId: 'F' },
    { start: 5, end: 15, trackId: 'F' },
    { start: 10, end: 20, trackId: 'B' }, // overlaps the 5-15 row; later row wins 10-15
    { start: 50, end: 49, trackId: 'F' }, // backwards, dropped
    { start: 'x', end: 3, trackId: 'F' }, // unreadable, dropped
    { start: 60, end: 99999, trackId: 'F' }, // clamped to song length
    { start: 40, end: 45, trackId: 'F' }, // touches 30-40 with same voice, merges
  ], 100);
  assert.deepEqual(out, [
    { start: 5, end: 10, trackId: 'F' },
    { start: 10, end: 20, trackId: 'B' },
    { start: 30, end: 45, trackId: 'F' },
    { start: 60, end: 100, trackId: 'F' },
  ]);
});

test('voiceAt picks the listed voice inside a row and the default outside', () => {
  const list = [{ start: 11, end: 25, trackId: 'F' }];
  assert.equal(voiceAt(list, 'B', 5), 'B');
  assert.equal(voiceAt(list, 'B', 11), 'F');
  assert.equal(voiceAt(list, 'B', 24.99), 'F');
  assert.equal(voiceAt(list, 'B', 25), 'B');
});

test('parseCutListText reads lines, allows comments, reports every problem', () => {
  const ids = { flomar: 'F', 'bokshun 1': 'B' };
  const { rows, problems } = parseCutListText(
    '# Flomar sections\n0:11-0:25 Flomar\n0:53 - 1:14 flomar\n1:00-0:50 Flomar\n2:00-2:10 Nobody\nnonsense\n1:56 to 2:12 Bokshun 1', ids);
  assert.deepEqual(rows, [
    { start: 11, end: 25, trackId: 'F' },
    { start: 53, end: 74, trackId: 'F' },
    { start: 116, end: 132, trackId: 'B' },
  ]);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /end must be after/);
  assert.match(problems[1], /no voice track named "Nobody"/);
  assert.match(problems[2], /could not read/);
});

test('voiceEnvelope: 1 where chosen, 0 elsewhere, with a short fade at each change', () => {
  const list = [{ start: 10, end: 20, trackId: 'F' }];
  const f = voiceEnvelope('F', list, 'B', 60, 0.04);
  const b = voiceEnvelope('B', list, 'B', 60, 0.04);
  near(envelopeAt(f, 0), 0); near(envelopeAt(f, 15), 1); near(envelopeAt(f, 30), 0);
  near(envelopeAt(b, 0), 1); near(envelopeAt(b, 15), 0); near(envelopeAt(b, 30), 1);
  // Halfway through a fade both voices are at half level, so the sum stays level.
  near(envelopeAt(f, 10) + envelopeAt(b, 10), 1);
  near(envelopeAt(f, 10.01) + envelopeAt(b, 10.01), 1);
  near(envelopeAt(f, 19.99) + envelopeAt(b, 19.99), 1);
});

test('voiceEnvelope: a voice that is the default everywhere stays at 1', () => {
  const e = voiceEnvelope('B', [], 'B', 30);
  near(envelopeAt(e, 0), 1); near(envelopeAt(e, 29), 1);
});

function tone(freqOrValue, seconds, sr, isDc = false) {
  const n = Math.round(seconds * sr);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = isDc ? freqOrValue : 0.3 * Math.sin((2 * Math.PI * freqOrValue * i) / sr);
  return [a, a.slice()];
}
const rms = (arr, from, to) => { let s = 0; for (let i = from; i < to; i++) s += arr[i] * arr[i]; return Math.sqrt(s / (to - from)); };

test('mixdown swaps the voice by section and keeps the band playing throughout', () => {
  const sr = 8000;
  const band = makeTrack('Band', { role: 'always' });
  const bok = makeTrack('Bokshun 1', { role: 'voice' });
  const flo = makeTrack('Flomar', { role: 'voice' });
  const items = [
    { track: band, channels: tone(0.1, 6, sr, true) },
    { track: bok, channels: tone(0.2, 6, sr, true) },
    { track: flo, channels: tone(0.4, 6, sr, true) },
  ];
  const out = mixdown(items, { cutList: [{ start: 2, end: 4, trackId: flo.id }], defaultId: bok.id, sampleRate: sr, ceilingDb: 0 });
  const at = (s) => out.channels[0][Math.round(s * sr)];
  near(at(1), 0.1 + 0.2);   // band + Bokshun
  near(at(3), 0.1 + 0.4);   // band + Flomar
  near(at(5), 0.1 + 0.2);   // back to Bokshun
  assert.equal(out.duration, 6);
  assert.equal(out.scaled, false);
});

test('mixdown honours mute, solo, volume and the offset nudge', () => {
  const sr = 8000;
  const a = makeTrack('A', { volumeDb: -6.0206 });
  const b = makeTrack('B', { offsetMs: 500 });
  const items = [{ track: a, channels: tone(0.5, 2, sr, true) }, { track: b, channels: tone(0.25, 1, sr, true) }];
  const out = mixdown(items, { sampleRate: sr, ceilingDb: 0 });
  near(out.channels[0][Math.round(0.25 * sr)], 0.25, 1e-3);          // only A (half level) before B starts
  near(out.channels[0][Math.round(1.0 * sr)], 0.25 + 0.25, 1e-3);    // A + B after the 0.5 s nudge
  a.mute = true;
  const muted = mixdown(items, { sampleRate: sr, ceilingDb: 0 });
  near(muted.channels[0][Math.round(0.25 * sr)], 0);
  a.mute = false; b.solo = true;
  const solo = mixdown(items, { sampleRate: sr, ceilingDb: 0 });
  near(solo.channels[0][Math.round(1.0 * sr)], 0.25, 1e-3);
});

test('mixdown pulls the level down under the ceiling instead of clipping', () => {
  const sr = 8000;
  const items = [
    { track: makeTrack('A'), channels: tone(0.9, 1, sr, true) },
    { track: makeTrack('B'), channels: tone(0.9, 1, sr, true) },
  ];
  const out = mixdown(items, { sampleRate: sr, ceilingDb: -1 });
  assert.equal(out.scaled, true);
  const max = Math.max(...out.channels[0].map(Math.abs));
  assert.ok(max <= Math.pow(10, -1 / 20) + 1e-6);
});

test('mixdown handles a mono file and an empty project', () => {
  const sr = 8000;
  const mono = { track: makeTrack('M'), channels: [new Float32Array(sr).fill(0.2)] };
  const out = mixdown([mono], { sampleRate: sr, ceilingDb: 0 });
  near(out.channels[0][100], 0.2); near(out.channels[1][100], 0.2);
  assert.throws(() => mixdown([], { sampleRate: sr }), /Load at least one track/);
});
