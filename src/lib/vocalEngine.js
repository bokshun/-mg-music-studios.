// Live vocal effects and recording, built only on standard browser APIs (Web Audio, getUserMedia, MediaRecorder).
// No third-party audio libraries, so there is nothing extra to license.
//
// Signal path:
//   mic -> inputGain -> lowCut -> warmth -> presence -> air -> compressor -> dry bus
//   dry bus -> (echo send -> delay <-> feedback) -> mix
//   dry bus -> (reverb send -> convolver)        -> mix
//   dry bus ------------------------------------> mix -> output -> recorder tap (processed take)
//                                                         \-> monitor gain -> speakers (off by default)
// A second recorder captures the raw, unprocessed mic stream (the "original" take) for later coaching.

import { FX_DEFAULTS, encodeWav, normalizeSettings, compressorParams, makeImpulseResponse, dbToGain, peakDb, pickRecorderMime } from './fxMath.js';

const SMOOTH = 0.02; // seconds of smoothing on parameter changes, to avoid clicks

export class VocalEngine {
  constructor({ AudioContextCtor, mediaDevices, MediaRecorderCtor } = {}) {
    this.AudioContextCtor = AudioContextCtor ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
    this.mediaDevices = mediaDevices ?? globalThis.navigator?.mediaDevices;
    this.MediaRecorderCtor = MediaRecorderCtor ?? globalThis.MediaRecorder;
    this.settings = normalizeSettings(FX_DEFAULTS);
    this.ctx = null;
    this.stream = null;
    this.nodes = null;
    this.rec = null;
    this._reverbSeconds = null;
  }

  static isSupported() {
    return Boolean(
      (globalThis.AudioContext || globalThis.webkitAudioContext) &&
      globalThis.navigator?.mediaDevices?.getUserMedia &&
      globalThis.MediaRecorder,
    );
  }

  async start(deviceId) {
    if (this.ctx) return;
    if (!this.AudioContextCtor || !this.mediaDevices?.getUserMedia) {
      throw new Error('This browser cannot capture audio. Try a current Chrome, Edge, Firefox or Safari.');
    }
    // Singing needs the raw signal: browser "voice call" processing would squash and colour it.
    this.stream = await this.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    const ctx = new this.AudioContextCtor({ latencyHint: 'interactive' });
    if (ctx.state === 'suspended') await ctx.resume();
    this.ctx = ctx;

    const n = {};
    n.source = ctx.createMediaStreamSource(this.stream);
    n.input = ctx.createGain();
    n.lowCut = ctx.createBiquadFilter(); n.lowCut.type = 'highpass'; n.lowCut.Q.value = 0.707;
    n.warmth = ctx.createBiquadFilter(); n.warmth.type = 'lowshelf'; n.warmth.frequency.value = 200;
    n.presence = ctx.createBiquadFilter(); n.presence.type = 'peaking'; n.presence.frequency.value = 3000; n.presence.Q.value = 0.9;
    n.air = ctx.createBiquadFilter(); n.air.type = 'highshelf'; n.air.frequency.value = 10000;
    n.comp = ctx.createDynamicsCompressor();
    n.dry = ctx.createGain();
    n.delaySend = ctx.createGain();
    n.delay = ctx.createDelay(1.0);
    n.feedback = ctx.createGain();
    n.reverbSend = ctx.createGain();
    n.reverb = ctx.createConvolver();
    n.mix = ctx.createGain();
    n.output = ctx.createGain();
    n.monitor = ctx.createGain(); n.monitor.gain.value = 0; // headphones only: off until the user turns it on
    n.analyser = ctx.createAnalyser(); n.analyser.fftSize = 2048;
    n.recordDest = ctx.createMediaStreamDestination();

    n.source.connect(n.input);
    n.input.connect(n.analyser);
    n.input.connect(n.lowCut); n.lowCut.connect(n.warmth); n.warmth.connect(n.presence);
    n.presence.connect(n.air); n.air.connect(n.comp); n.comp.connect(n.dry);
    n.dry.connect(n.mix);
    n.dry.connect(n.delaySend); n.delaySend.connect(n.delay); n.delay.connect(n.feedback); n.feedback.connect(n.delay); n.delay.connect(n.mix);
    n.dry.connect(n.reverbSend); n.reverbSend.connect(n.reverb); n.reverb.connect(n.mix);
    n.mix.connect(n.output);
    n.output.connect(n.recordDest);
    n.output.connect(n.monitor); n.monitor.connect(ctx.destination);
    this.nodes = n;
    this._meterBuf = new Float32Array(n.analyser.fftSize);
    this.setSettings(this.settings);
  }

  setSettings(partial) {
    this.settings = normalizeSettings({ ...this.settings, ...partial });
    const n = this.nodes; if (!n) return this.settings;
    const s = this.settings; const t = this.ctx.currentTime;
    const set = (param, v) => param.setTargetAtTime(v, t, SMOOTH);
    set(n.input.gain, dbToGain(s.inputGainDb));
    set(n.lowCut.frequency, s.lowCutHz);
    set(n.warmth.gain, s.warmthDb);
    set(n.presence.gain, s.presenceDb);
    set(n.air.gain, s.airDb);
    const c = compressorParams(s.compAmount);
    n.comp.threshold.value = c.threshold; n.comp.ratio.value = c.ratio; n.comp.knee.value = c.knee;
    n.comp.attack.value = c.attack; n.comp.release.value = c.release;
    set(n.delaySend.gain, s.delayMix);
    set(n.delay.delayTime, s.delayMs / 1000);
    set(n.feedback.gain, s.delayFeedback);
    set(n.reverbSend.gain, s.reverbMix);
    set(n.output.gain, dbToGain(s.outputDb));
    if (this._reverbSeconds !== s.reverbSeconds) {
      const [l, r] = makeImpulseResponse(this.ctx.sampleRate, s.reverbSeconds);
      const buf = this.ctx.createBuffer(2, l.length, this.ctx.sampleRate);
      buf.copyToChannel(l, 0); buf.copyToChannel(r, 1);
      n.reverb.buffer = buf;
      this._reverbSeconds = s.reverbSeconds;
    }
    return this.settings;
  }

  setMonitoring(on) {
    if (!this.nodes) return;
    this.nodes.monitor.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, SMOOTH);
  }

  // Peak level of the mic after the Mic level control, in dBFS. Above about -1 dB means it is clipping.
  getInputPeakDb() {
    if (!this.nodes) return -120;
    this.nodes.analyser.getFloatTimeDomainData(this._meterBuf);
    return peakDb(this._meterBuf);
  }

  get isRecording() { return Boolean(this.rec); }

  startRecording() {
    if (!this.nodes) throw new Error('Turn on the microphone first.');
    if (this.rec) return;
    const Rec = this.MediaRecorderCtor;
    const isSupported = (m) => (typeof Rec.isTypeSupported === 'function' ? Rec.isTypeSupported(m) : false);
    const mimeType = pickRecorderMime(isSupported);
    const make = (stream) => {
      const recorder = mimeType ? new Rec(stream, { mimeType }) : new Rec(stream);
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const done = new Promise((resolve, reject) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }));
        recorder.onerror = (e) => reject(e.error || new Error('Recording failed.'));
      });
      return { recorder, done };
    };
    const wet = make(this.nodes.recordDest.stream);
    const dry = make(this.stream);
    wet.recorder.start(); dry.recorder.start();
    this.rec = { wet, dry, startedAt: this.ctx.currentTime, settings: { ...this.settings } };
  }

  async stopRecording() {
    if (!this.rec) return null;
    const { wet, dry, startedAt, settings } = this.rec;
    this.rec = null;
    const seconds = this.ctx.currentTime - startedAt;
    wet.recorder.stop(); dry.recorder.stop();
    const [wetBlob, dryBlob] = await Promise.all([wet.done, dry.done]);
    return { wetBlob, dryBlob, seconds, settings, mimeType: wetBlob.type, createdAt: new Date().toISOString() };
  }

  async stop() {
    if (this.rec) await this.stopRecording();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) await this.ctx.close();
    this.ctx = null; this.nodes = null; this._reverbSeconds = null;
  }
}

// Decode a recorded blob and re-encode it as a 16-bit WAV, a format every editor and DistroKid-style tool accepts.
export async function blobToWav(blob, AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext) {
  const ctx = new AudioContextCtor();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    return new Blob([encodeWav(channels, audio.sampleRate)], { type: 'audio/wav' });
  } finally {
    await ctx.close();
  }
}
