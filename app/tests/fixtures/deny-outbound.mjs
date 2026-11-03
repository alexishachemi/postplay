// Test-process-only isolation. The production server must reopen saved reports
// without fetch or outbound TCP; incoming loopback HTTP remains available.
import net from 'node:net';
import assert from 'node:assert/strict';
globalThis.fetch = async () => { throw new Error('Test isolation: outbound fetch denied'); };
net.Socket.prototype.connect = function () { throw new Error('Test isolation: outbound TCP denied'); };
await assert.rejects(fetch('https://api.meta.ai'), /outbound fetch denied/);
assert.throws(() => new net.Socket().connect(443, 'api.meta.ai'), /outbound TCP denied/);
