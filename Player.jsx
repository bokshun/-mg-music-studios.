import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { signedUrl } from '../lib/data.js';

function fmt(s) {
  const n = Math.floor(s || 0);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

export default function Player({ asset }) {
  const box = useRef(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(asset.duration_seconds ?? 0);
  const ws = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError('');
    (async () => {
      try {
        const url = await signedUrl(asset);
        if (cancelled) return;
        const w = WaveSurfer.create({
          container: box.current,
          url,
          height: 96,
          waveColor: '#7d6a9c',
          progressColor: '#e0a43b',
          cursorColor: '#ffffff',
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          normalize: true,
        });
        ws.current = w;
        w.on('ready', (d) => { setDur(d); setStatus('ready'); });
        w.on('timeupdate', setTime);
        w.on('play', () => setPlaying(true));
        w.on('pause', () => setPlaying(false));
        w.on('finish', () => setPlaying(false));
        w.on('error', (e) => { setStatus('error'); setError(String(e?.message || e)); });
      } catch (e) {
        if (!cancelled) { setStatus('error'); setError(e.message || 'Could not open this recording.'); }
      }
    })();
    return () => { cancelled = true; ws.current?.destroy(); ws.current = null; };
  }, [asset]);

  return (
    <div className="card player">
      <div className="row">
        <strong>{asset.file_name}</strong>
        <span className="muted">{fmt(time)} / {fmt(dur)}</span>
      </div>
      <div ref={box} className="wave" />
      {status === 'loading' && <p className="muted">Fetching from private storage… large WAV files can take a moment.</p>}
      {status === 'error' && <p className="error" role="alert">Could not play this file: {error}</p>}
      <button className="primary" disabled={status !== 'ready'} onClick={() => ws.current?.playPause()}>
        {playing ? '⏸ Pause' : '▶ Play'}
      </button>
    </div>
  );
}
