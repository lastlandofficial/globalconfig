'use client';
import { useEffect, useState } from 'react';
export default function ProjectForm() {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  const [name, setName] = useState('');
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('');
  async function save() {
    setState('loading'); setMessage('Saving…');
    try {
      const response = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
      if (!response.ok) throw Error('Unavailable');
      const result = await response.json();
      setState('success'); setMessage(result.message);
    } catch { setState('error'); setMessage('Could not save. Try again.'); }
  }
  return <form onSubmit={event => { event.preventDefault(); void save(); }}>
    <label htmlFor="name">Project name</label>
    <input id="name" disabled={!ready} value={name} onChange={event => setName(event.target.value)} />
    <button id="save" disabled={!ready || state === 'loading'}>Save project</button>
    {state === 'error' ? <button id="retry" type="button" onClick={save}>Try again</button> : null}
    <p id="status" role="status">{message}</p>
  </form>;
}
