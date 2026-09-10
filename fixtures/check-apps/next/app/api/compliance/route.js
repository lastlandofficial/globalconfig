import { createDemoService } from '../../compliance-service.js';
export const runtime = 'nodejs';
// The example stores snapshots in SQLite so module reloads do not reset sequences.
export async function POST(request) {
  const service = createDemoService();
  try { return Response.json(service.execute(await request.json())); }
  catch { return Response.json({ error: 'Review the request or remaining invoice quantity.' }, { status: 400 }); }
  finally { service.close(); }
}
