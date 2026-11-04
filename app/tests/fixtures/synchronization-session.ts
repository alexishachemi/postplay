// Synthetic visible timing fixture only, not gameplay or model evidence.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export function createSynchronizationFixture(root: string) {
  const id = randomUUID(), path = join(root, id); mkdirSync(path);
  const fixture = (name: string) => readFileSync(new URL(`../../../contracts/fixtures/complete/${name}`, import.meta.url), 'utf8');
  const manifest = JSON.parse(fixture('session.json'));
  manifest.session_id = id; manifest.project.name = 'SYNTHETIC synchronization fixture — no model';
  manifest.capture.width = 64; manifest.capture.height = 48;
  manifest.synchronization = { status: 'unknown', anchor: null, estimated_error_ms: null, notes: [] };
  const events = fixture('events.jsonl').trim().split('\n').map(line => JSON.parse(line));
  const signal = events[2];
  signal.time.process_frame = 15; signal.time.simulation_ms = 500;
  signal.label = 'Visible fixture pulse <img src=x onerror=alert(1)>';
  const second = structuredClone(signal); second.id = 'evt-4'; second.sequence = 4;
  second.time = { wall_elapsed_ms: 3000, simulation_ms: 1500, process_frame: 45, physics_frame: 90 };
  events.push(second); manifest.telemetry.event_count = events.length;
  for (const event of events) event.session_id = id;
  writeFileSync(join(path, 'session.json'), JSON.stringify(manifest));
  writeFileSync(join(path, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');
  execFileSync('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', "color=c=black:s=64x48:r=30,drawbox=x=8:y=8:w=48:h=32:color=magenta:t=fill:enable='between(n,15,18)+between(n,45,48)'", '-t', '2', '-c:v', 'mjpeg', join(path, 'recording.avi')]);
  return { id, path, manifest };
}
