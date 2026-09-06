import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AsyncState, Button, EmptyState, Field, Status } from '../src/ui/react';
describe('React primitives render safely on the server', () => {
  it('links visible labels, help, and errors with unique IDs', () => {
    const html = renderToStaticMarkup(<><Field label="Email" hint="Work email" error="Enter a valid address" /><Field label="Name" /></>);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby=');
    expect(html).toContain('<label');
  });
  it('defaults to a non-submitting button and exposes pending state', () => {
    expect(renderToStaticMarkup(<Button>Save</Button>)).toContain('type="button"');
    const html = renderToStaticMarkup(<Button pending pendingLabel="Saving">Save</Button>);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('Saving');
  });
  it('renders each async view and exposes empty-state meaning', () => {
    const views = { loading: <Status>Loading orders</Status>, empty: <EmptyState title="No orders" description="New orders will appear here." />, error: (error: Error) => <Status tone="error">{error.message}</Status>, success: (data: string[]) => <p>{data.join(', ')}</p> };
    expect(renderToStaticMarkup(<AsyncState value={{ status: 'loading' }} views={views} />)).toContain('role="status"');
    expect(renderToStaticMarkup(<AsyncState value={{ status: 'empty' }} views={views} />)).toContain('No orders');
    expect(renderToStaticMarkup(<AsyncState value={{ status: 'error', error: new Error('Offline') }} views={views} />)).toContain('Offline');
    expect(renderToStaticMarkup(<AsyncState value={{ status: 'success', data: ['Order 1'] }} views={views} />)).toContain('Order 1');
  });
});
