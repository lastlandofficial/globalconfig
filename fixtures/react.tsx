import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AsyncState, Button, EmptyState, Field, Stack, Status, type AsyncValue } from '../src/ui/react';
function App() {
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(0);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [state, setState] = useState<AsyncValue<string[]>>({ status: 'empty' });
  return <main><h1>glocon component workbench</h1><Stack style={{ maxWidth: 560 }}>
    <form onSubmit={event => { event.preventDefault(); setSubmitted(n => n + 1); }}><Stack>
      <Field label="Email address" type="email" autoComplete="email" value={value} onChange={event => setValue(event.target.value)} hint="Use your work email address." error={error} />
      <Button id="save" pending={pending} pendingLabel="Saving changes" onClick={() => { setPending(true); setSubmitted(n => n + 1); }}>Save changes</Button>
      <Status>Actions: {submitted}</Status>
    </Stack></form>
    <Button variant="secondary" onClick={() => setPending(false)}>Reset pending</Button>
    <Button variant="secondary" onClick={() => setError('Enter a valid work email address.')}>Show field error</Button>
    <Button variant="secondary" onClick={() => setState({ status: 'loading' })}>Load orders</Button>
    <Button variant="secondary" onClick={() => setState({ status: 'error', error: new Error('Could not load orders. Try again.') })}>Simulate failure</Button>
    <Button variant="secondary" onClick={() => setState({ status: 'success', data: ['Order 1'] })}>Show orders</Button>
    <AsyncState value={state} views={{ loading: <Status>Loading orders…</Status>, empty: <EmptyState title="No orders yet" description="Create your first order to get started." action={<Button onClick={() => setState({ status: 'success', data: ['Order 1'] })}>Create order</Button>} />, error: error => <><Status tone="error">{error.message}</Status><Button id="retry" onClick={() => setState({ status: 'loading' })}>Retry</Button></>, success: data => <ul>{data.map(item => <li key={item}>{item}</li>)}</ul> }} />
  </Stack></main>;
}
createRoot(document.getElementById('app')!).render(<App />);
