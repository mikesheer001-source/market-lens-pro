import {approvalDigest} from './options-approval.js';

export const deviceTokenPattern = /^[a-f0-9]{64}$/;
export const devicePath = '/internal/options-device';

export async function deviceDigest(value) {
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),byte => byte.toString(16).padStart(2,'0')).join('');
}

function registry(env) {
  return env.WORKSPACES.get(env.WORKSPACES.idFromName('market-lens-options-devices-v1'));
}

export async function enrollDevice(request, env) {
  if (!env.WORKSPACES) return 503;
  const code = request.headers.get('X-Options-Approval');
  if (!deviceTokenPattern.test(code ?? '') || await deviceDigest(code) !== approvalDigest) return 401;
  const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return 400;
  const device = await deviceDigest(token);
  const response = await registry(env).fetch('https://workspace.internal'+devicePath,{
    method:'POST',headers:{'X-Device-Digest':device}
  });
  return response.status;
}

export async function deviceAuthorized(header,env) {
  const token = header?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token || !env.WORKSPACES) return false;
  const response = await registry(env).fetch('https://workspace.internal'+devicePath,{
    headers:{'X-Device-Digest':await deviceDigest(token)}
  });
  return response.status === 204;
}

export function deviceRegistry(request,storage) {
  const device = request.headers.get('X-Device-Digest');
  if (!deviceTokenPattern.test(device ?? '')) return new Response(null,{status:400});
  const {sql} = storage;
  sql.exec('CREATE TABLE IF NOT EXISTS options_devices (approval TEXT PRIMARY KEY, device TEXT NOT NULL)');
  if (request.method === 'GET') {
    const approved = sql.exec('SELECT 1 FROM options_devices WHERE device = ?',device).toArray().length;
    return new Response(null,{status:approved ? 204 : 401});
  }
  if (request.method !== 'POST') return new Response(null,{status:400});
  // Keep the existing primary key and previously approved devices.
  sql.exec('INSERT OR IGNORE INTO options_devices (approval, device) VALUES (?, ?)',device,device);
  return new Response(null,{status:204});
}
