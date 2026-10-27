// MOCK DATA - demo only. Used when Supabase is not configured or ?mock=1 is set.
// Never shown as real music; the UI labels it "Demo data".

function toneWavUrl(freq, seconds = 6, rate = 22050) {
  const n = rate * seconds;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 2000) * Math.min(1, (n - i) / 4000);
    const s = Math.sin((2 * Math.PI * freq * i) / rate) * 0.3 * env * (0.6 + 0.4 * Math.sin(i / 3000));
    v.setInt16(44 + i * 2, s * 32767, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export const mockProjects = [
  {
    id: 'mock-1',
    title: 'Demo Song (mock)',
    creator_name: 'Demo Artist',
    status: 'draft',
    version: '0.1',
    bpm: 92,
    musical_key: 'A minor',
    created_at: new Date().toISOString(),
    mgp_assets: [
      { id: 'm-a1', kind: 'master_audio', file_name: 'demo-tone-a.wav', object_path: 'mock/a.wav', mime_type: 'audio/wav', size_bytes: 264644, duration_seconds: 6, _mockUrl: () => toneWavUrl(220) },
      { id: 'm-a2', kind: 'master_audio', file_name: 'demo-tone-b.wav', object_path: 'mock/b.wav', mime_type: 'audio/wav', size_bytes: 264644, duration_seconds: 6, _mockUrl: () => toneWavUrl(330) },
      { id: 'm-a3', kind: 'artwork', file_name: 'demo-cover.svg', object_path: 'mock/cover.svg', mime_type: 'image/svg+xml', size_bytes: 900, duration_seconds: null,
        _mockUrl: () => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#2a1f3d"/><circle cx="200" cy="200" r="110" fill="#e0a43b"/><text x="200" y="210" text-anchor="middle" font-size="28" fill="#2a1f3d" font-family="sans-serif">DEMO</text></svg>') },
    ],
  },
];
