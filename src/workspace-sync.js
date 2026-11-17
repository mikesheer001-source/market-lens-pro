const codeKey = 'market-lens-workspace-code';
const dirtyKey = 'market-lens-workspace-pending';
const prefix = 'ML1-';
const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, '');
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function mergeWorkspace(base, local, remote) {
  if (same(base, local)) return remote;
  if (same(base, remote) || same(local, remote)) return local;
  if (Array.isArray(local) && Array.isArray(remote) &&
      [...local, ...remote, ...(Array.isArray(base) ? base : [])].every(item => typeof item?.id === 'string')) {
    const records = list => Object.fromEntries((Array.isArray(list) ? list : []).map(item => [item.id, item]));
    return Object.values(mergeWorkspace(records(base), records(local), records(remote)));
  }
  if (object(local) && object(remote) && (base === undefined || object(base))) {
    const previous = base || {};
    const keys = new Set([...Object.keys(previous), ...Object.keys(local), ...Object.keys(remote)]);
    return Object.fromEntries([...keys].map(key => [key, mergeWorkspace(previous[key], local[key], remote[key])])
      .filter(([,value]) => value !== undefined));
  }
  return local;
}

async function codec(code) {
  const value = code.trim();
  if (!/^ML1-[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('Enter the complete workspace pairing code.');
  const bytes = Uint8Array.from(atob(value.slice(prefix.length).replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0));
  const tokenBytes = await crypto.subtle.digest('SHA-256', bytes);
  const token = Array.from(new Uint8Array(tokenBytes), b => b.toString(16).padStart(2,'0')).join('');
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt','decrypt']);
  const transform = async (blob, stream) => new Response(blob.stream().pipeThrough(stream)).arrayBuffer();
  return {
    token,
    async seal(name, value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const compressed = await transform(new Blob([JSON.stringify(value)]), new CompressionStream('gzip'));
      const encrypted = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:new TextEncoder().encode(name)}, key, compressed);
      return new Blob([iv, encrypted]);
    },
    async open(name, blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const clear = await crypto.subtle.decrypt({name:'AES-GCM', iv:bytes.slice(0,12), additionalData:new TextEncoder().encode(name)}, key, bytes.slice(12));
      return JSON.parse(new TextDecoder().decode(await transform(new Blob([clear]), new DecompressionStream('gzip'))));
    }
  };
}

export function workspaceSync({endpoint, names, read, write, notify}) {
  let code = localStorage.getItem(codeKey) || '';
  let pending;
  try { pending = new Set(JSON.parse(localStorage.getItem(dirtyKey) || '[]')); }
  catch { pending = new Set(); }
  const baselines = new Map();
  const applied = new Map();
  const mutations = new Map();
  let timer, inFlight, staged = false;
  const persist = () => localStorage.setItem(dirtyKey, JSON.stringify([...pending]));
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void flush(), 800); };

  function changed(name) {
    if (!code) return;
    mutations.set(name,(mutations.get(name) || 0)+1);
    pending.add(name);
    persist();
    schedule();
  }

  async function exchange(cipher, mode) {
    const request = (name, options = {}) => {
      const url = new URL(endpoint);
      if (name) url.searchParams.set('document', name);
      return fetch(url, {...options, cache:'no-store', signal:AbortSignal.timeout(12000),
        headers:{Authorization:'Bearer '+cipher.token, ...options.headers}});
    };
    const index = await request();
    if (!index.ok) throw new Error('Workspace server returned '+index.status+'.');
    const versions = await index.json();
    if (mode === 'join' && !Object.keys(versions).length) throw new Error('Workspace not found. Check the pairing code on your other device.');
    for (const name of names) {
      if (versions[name] === applied.get(name) && !pending.has(name)) continue;
      if (!versions[name] && !pending.has(name)) continue;
      const local = await read(name);
      const mutation = mutations.get(name);
      let finished = false;
      for (let attempt=0; attempt<4 && !finished; attempt++) {
        const response = await request(name);
        if (!response.ok && response.status !== 404) throw new Error('Could not read workspace '+name+'.');
        let version = Number(response.headers.get('ETag') || 0);
        const remote = version ? await cipher.open(name, await response.blob()) : undefined;
        let value = remote;
        if (pending.has(name) && mode !== 'join') {
          value = version ? mergeWorkspace(baselines.get(name), local, remote) : local;
          if (!same(value, remote)) {
            const saved = await request(name,{method:'PUT', headers:{'If-Match':String(version)}, body:await cipher.seal(name,value)});
            if (saved.status === 409) continue;
            if (saved.status === 413) throw new Error('Workspace '+name+' exceeds the 16 MB compressed limit.');
            if (!saved.ok) throw new Error('Could not sync workspace '+name+' ('+saved.status+').');
            version = Number(saved.headers.get('ETag'));
          }
        }
        const willStage = mode !== 'startup' && mode !== 'join' && !same(local,value);
        baselines.set(name,willStage ? local : value);
        if (mode !== 'startup' && mode !== 'join' && !same(local,value)) staged = true;
        else if (!same(local,value)) await write(name,value);
        if (mutation === mutations.get(name)) {
          if (!staged || mode === 'startup' || mode === 'join' || same(local,value)) applied.set(name,version);
          pending.delete(name);
          persist();
        }
        finished = true;
      }
      if (!finished) throw new Error('Another device is updating this workspace. Retrying shortly.');
    }
  }

  function flush(mode = 'background') {
    if (!code) return Promise.resolve(true);
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        await exchange(await codec(code),mode);
        notify(staged ? 'Updates ready on this device' : 'Workspace synced',staged);
        return true;
      } catch (error) {
        notify(error.message || 'Sync paused while offline.',staged);
        return false;
      }
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  async function connect(input) {
    const next = input ? input.trim() : prefix + encode(crypto.getRandomValues(new Uint8Array(32)));
    await inFlight;
    const previous = code;
    if (previous && previous !== next) throw new Error('Disconnect this device before pairing a different workspace.');
    const cipher = await codec(next);
    if (input) {
      await exchange(cipher,'join');
    } else {
      for (const name of names) {
        if (await read(name) !== undefined) pending.add(name);
      }
      await exchange(cipher,'startup');
    }
    code = next;
    localStorage.setItem(codeKey,code);
    return code;
  }

  async function disconnect() {
    clearTimeout(timer);
    await inFlight;
    code = '';
    pending.clear();
    localStorage.removeItem(codeKey);
    persist();
    baselines.clear();
    applied.clear();
    staged = false;
  }

  return {code:()=>code, changed, flush, connect, disconnect};
}
