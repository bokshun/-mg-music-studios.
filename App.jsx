import { useEffect, useState } from 'react';
import { supabase, hasSupabaseConfig, forceMock } from './lib/supabase.js';
import { mockProjects } from './lib/mock.js';
import SignIn from './components/SignIn.jsx';
import Lobby from './components/Lobby.jsx';

export default function App() {
  const mock = forceMock;
  const [session, setSession] = useState(null);
  const [authError, setAuthError] = useState("");
  const [ready, setReady] = useState(mock || !hasSupabaseConfig);

  useEffect(() => {
    if (mock) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    }).catch((error) => {
      setAuthError(error.message || "Unable to restore your session.");
    }).finally(() => setReady(true));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [mock]);

  if (!ready) return <div className="center muted">Opening the studio…</div>;
  if (mock) return <Lobby mock projects={mockProjects} onSignOut={null} email="demo" />;
  if (!hasSupabaseConfig) return <div className="center"><div className="card signin"><h1>Studio configuration needed</h1><p className="error" role="alert">Supabase URL or public publishable key is missing. Set both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to access your real projects.</p><p className="muted">Demo mode is available only with ?mock=1.</p></div></div>;
  if (authError) return <div className="center"><p className="error" role="alert">{authError}</p></div>;
  if (!session) return <SignIn />;
  return (
    <Lobby
      email={session.user.email}
      onSignOut={() => supabase.auth.signOut()}
    />
  );
}
