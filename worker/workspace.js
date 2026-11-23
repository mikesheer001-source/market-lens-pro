import {devicePath,deviceRegistry} from './options-device.js';

const documents = new Set(['settings', 'library', 'draft', 'memory', 'signals', 'analysis', 'portfolio', 'imports', 'market']);
const limit = 16 * 1024 * 1024;
const chunkSize = 256 * 1024;

export class Workspace {
  constructor(state) {
    this.storage = state.storage;
    this.sql = this.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS revisions (name TEXT PRIMARY KEY, version INTEGER)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS chunks (name TEXT, position INTEGER, body BLOB, PRIMARY KEY (name, position))');
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === devicePath) return deviceRegistry(request,this.storage);
    const name = url.searchParams.get('document');
    if (request.method === 'GET' && !name) {
      return Response.json(Object.fromEntries([...this.sql.exec('SELECT name, version FROM revisions')].map(row => [row.name, row.version])));
    }
    if (!documents.has(name)) return new Response(null, {status:400});
    const version = () => this.sql.exec('SELECT version FROM revisions WHERE name = ?', name).toArray()[0]?.version ?? 0;
    if (request.method === 'GET') {
      const current = version();
      if (!current) return new Response(null, {status:404});
      const chunks = this.sql.exec('SELECT body FROM chunks WHERE name = ? ORDER BY position', name);
      return new Response(new Blob([...chunks].map(row => row.body)), {headers:{ETag:String(current)}});
    }

    const expected = request.headers.get('If-Match');
    if (expected !== String(version())) return new Response(null, {status:409});
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, {status:400});
    const pieces = [];
    let length = 0;
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); return new Response(null, {status:413}); }
      pieces.push(value);
    }
    if (!length) return new Response(null, {status:400});
    const bytes = new Uint8Array(await new Blob(pieces).arrayBuffer());
    // Another request may commit while the upload is streaming.
    return this.storage.transactionSync(() => {
      const current = version();
      if (expected !== String(current)) return new Response(null, {status:409});
      this.sql.exec('DELETE FROM chunks WHERE name = ?', name);
      for (let i = 0; i < length; i += chunkSize) {
        this.sql.exec('INSERT INTO chunks VALUES (?, ?, ?)', name, i, bytes.slice(i, i + chunkSize).buffer);
      }
      this.sql.exec('INSERT OR REPLACE INTO revisions VALUES (?, ?)', name, current + 1);
      return new Response(null, {status:204, headers:{ETag:String(current + 1)}});
    });
  }
}

export function workspaceRequest(request, env) {
  const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return new Response(null, {status:401});
  if (!env.WORKSPACES) return new Response(null, {status:503});
  return env.WORKSPACES.get(env.WORKSPACES.idFromName(token)).fetch(request);
}

export function publicWorkspaceRequest(request, env) {
  if (!env.WORKSPACES) return new Response(null, {status:503});
  const id = env.WORKSPACES.idFromName('market-lens-public-workspace-v1');
  return env.WORKSPACES.get(id).fetch(request);
}
