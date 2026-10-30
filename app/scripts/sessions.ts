import { SessionLibrary } from '../src/server/session-library.ts';

const [command, id, ...extra] = process.argv.slice(2);
if (!['list', 'inspect'].includes(command ?? '') || (command === 'inspect' ? !id : id !== undefined) || extra.length) {
  console.error('Usage: sessions.ts list | inspect SESSION_UUID (configure POSTPLAY_SESSION_ROOT)');
  process.exitCode = 1;
} else {
  let library: SessionLibrary | undefined;
  try {
    library = await SessionLibrary.create();
    if (command === 'list') console.log(JSON.stringify({ ok: true, ...await library.discover() }, null, 2));
    else {
      const result = await library.inspect(id);
      // No host paths, raw telemetry payloads or credentials in this CLI summary.
      console.log(JSON.stringify(result.ok ? { ok: true, session_id: result.session.session_id, project: result.session.project,
        capture_status: result.session.status, synchronization: result.session.synchronization.status,
        event_count: result.events.length, media: result.media, diagnostics: result.diagnostics } : result, null, 2));
      if (!result.ok) process.exitCode = 1;
    }
  } catch {
    console.log(JSON.stringify({ ok: false, error: { code: 'storage_unavailable', message: 'Cannot use local storage or list its entries. Check POSTPLAY_SESSION_ROOT, permissions and the 1,000-entry limit.' } }));
    process.exitCode = 1;
  } finally { await library?.close(); }
}
