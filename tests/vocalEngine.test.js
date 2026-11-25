// Verifies how the engine wires the audio graph and drives recorders, using a fake Web Audio implementation.
// This checks structure and parameter values. It cannot judge how the audio sounds; see README for browser testing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VocalEngine } from '../src/lib/vocalEngine.js';

class Param { constructor(v = 0) { this.value = v; this.calls = []; } setTargetAtTime(v, t, c) { this.calls.push([v, t, c]); this.value = v; } }
class Node {
  constructor(kind) { this.kind = kind; this.out = []; }
  connect(n) { this.out.push(n); return n; }
}
function fakeCtx() {
  return class FakeCtx {
    constructor() { this.sampleRate = 48000; this.currentTime = 0; this.state = 'running'; this.destination = new Node('destination'); this.closed = false; this.made = []; }
    _n(kind, params = {}) { const n = new Node(kind); Object.assign(n, params); this.made.push(n); return n; }
    createMediaStreamSource() { return this._n('source'); }
    createGain() { return this._n('gain', { gain: new Param(1) }); }
    createBiquadFilter() { return this._n('biquad', { type: '', frequency: new Param(350), gain: new Param(0), Q: new Param(1) }); }
    createDynamicsCompressor() { return this._n('comp', { threshold: new Param(), ratio: new Param(), knee: new Param(), attack: new Param(), release: new Param() }); }
    createDelay() { return this._n('delay', { delayTime: new Param() }); }
    createConvolver() { return this._n('convolver', { buffer: null }); }
    createAnalyser() { return this._n('analyser', { fftSize: 0, getFloatTimeDomainData(b) { b.fill(0.5); } }); }
    createMediaStreamDestination() { return this._n('recordDest', { stream: { id: 'processed' } }); }
    createBuffer(ch, len) { return { ch, len, data: [], copyToChannel(d, i) { this.data[i] = d; } }; }
    async resume() {} async close() { this.closed = true; }
  };
}
function fakeRecorder(log) {
  return class FakeRec {
    static isTypeSupported(m) { return m === 'audio/webm;codecs=opus'; }
    constructor(stream, opts) { this.stream = stream; this.opts = opts; this.mimeType = opts?.mimeType; log.push(this); }
    start() { this.started = true; }
    stop() { this.ondataavailable({ data: new Blob([`audio-from-${this.stream.id}`]) }); this.onstop(); }
  };
}
const rawStream = { id: 'raw', getTracks: () => [{ stop() { rawStream.stopped = true; } }] };
function make() {
  const recs = [];
  const e = new VocalEngine({ AudioContextCtor: fakeCtx(), mediaDevices: { getUserMedia: async (c) => { make.constraints = c; return rawStream; } }, MediaRecorderCtor: fakeRecorder(recs) });
  return { e, recs };
}

test('requests an unprocessed mono mic stream', async () => {
  const { e } = make(); await e.start();
  const a = make.constraints.audio;
  assert.equal(a.echoCancellation, false); assert.equal(a.noiseSuppression, false); assert.equal(a.autoGainControl, false);
});

test('signal path: mic -> chain -> output -> recorder tap and (muted) monitor', async () => {
  const { e } = make(); await e.start();
  const n = e.nodes;
  assert.ok(n.source.out.includes(n.input));
  assert.deepEqual([n.input, n.lowCut, n.warmth, n.presence, n.air, n.comp, n.dry].map((x, i, a) => i === a.length - 1 || x.out.includes(a[i + 1])), Array(7).fill(true));
  assert.ok(n.dry.out.includes(n.mix) && n.dry.out.includes(n.delaySend) && n.dry.out.includes(n.reverbSend));
  assert.ok(n.delay.out.includes(n.feedback) && n.feedback.out.includes(n.delay), 'echo feedback loop');
  assert.ok(n.delay.out.includes(n.mix) && n.reverb.out.includes(n.mix));
  assert.ok(n.output.out.includes(n.recordDest) && n.output.out.includes(n.monitor));
  assert.ok(n.monitor.out.includes(e.ctx.destination));
  assert.equal(n.monitor.gain.value, 0, 'monitoring starts muted to prevent feedback');
  assert.ok(n.reverb.buffer && n.reverb.buffer.len > 0, 'reverb impulse response installed');
});

test('settings reach the audio parameters and are clamped', async () => {
  const { e } = make(); await e.start();
  e.setSettings({ presenceDb: 4, reverbMix: 0.4, delayMs: 300, compAmount: 1, outputDb: 100 });
  const n = e.nodes;
  assert.equal(n.presence.gain.value, 4);
  assert.equal(n.reverbSend.gain.value, 0.4);
  assert.ok(Math.abs(n.delay.delayTime.value - 0.3) < 1e-9);
  assert.equal(n.comp.ratio.value, 8);
  assert.ok(Math.abs(n.output.gain.value - Math.pow(10, 6 / 20)) < 1e-9, 'output clamped to +6 dB');
});

test('reverb impulse is only rebuilt when the size changes', async () => {
  const { e } = make(); await e.start();
  const first = e.nodes.reverb.buffer;
  e.setSettings({ reverbMix: 0.3 }); assert.equal(e.nodes.reverb.buffer, first);
  e.setSettings({ reverbSeconds: 3 }); assert.notEqual(e.nodes.reverb.buffer, first);
});

test('monitoring toggles the monitor gain', async () => {
  const { e } = make(); await e.start();
  e.setMonitoring(true); assert.equal(e.nodes.monitor.gain.value, 1);
  e.setMonitoring(false); assert.equal(e.nodes.monitor.gain.value, 0);
});

test('records a processed take and an original take at the same time', async () => {
  const { e, recs } = make(); await e.start();
  e.startRecording();
  assert.equal(recs.length, 2); assert.ok(recs.every((r) => r.started));
  assert.deepEqual(recs.map((r) => r.stream.id).sort(), ['processed', 'raw']);
  assert.equal(recs[0].opts.mimeType, 'audio/webm;codecs=opus');
  e.ctx.currentTime = 2.5;
  const take = await e.stopRecording();
  assert.equal(take.seconds, 2.5);
  assert.equal(await take.wetBlob.text(), 'audio-from-processed');
  assert.equal(await take.dryBlob.text(), 'audio-from-raw');
  assert.equal(take.settings.reverbMix, e.settings.reverbMix);
  assert.equal(e.isRecording, false);
});

test('start/stop recording guards', async () => {
  const { e } = make();
  assert.throws(() => e.startRecording(), /microphone/i);
  await e.start(); assert.equal(await e.stopRecording(), null);
});

test('input meter reads peak level', async () => {
  const { e } = make(); await e.start();
  assert.ok(Math.abs(e.getInputPeakDb() - (-6.02)) < 0.05);
});

test('stop releases the microphone and closes the context', async () => {
  const { e } = make(); await e.start(); const ctx = e.ctx;
  e.startRecording(); await e.stop();
  assert.equal(ctx.closed, true); assert.equal(rawStream.stopped, true); assert.equal(e.ctx, null);
});

test('start fails clearly when the browser lacks audio support', async () => {
  const e = new VocalEngine({ AudioContextCtor: null, mediaDevices: null, MediaRecorderCtor: null });
  await assert.rejects(() => e.start(), /cannot capture audio/);
});
