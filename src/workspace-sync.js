const dirtyKey = 'market-lens-public-sync-pending';

async function transform(blob, stream) {
  return new Response(blob.stream().pipeThrough(stream)).blob();
}

async function encode(value) {
  return transform(new Blob([JSON.stringify(value)]), new CompressionStream('gzip'));
}

async function decode(blob) {
  let length = 0;
  const bounded = new TransformStream({
    transform(chunk, controller) {
      length += chunk.byteLength;
      if (length > 64 * 1024 * 1024) throw new Error('Shared data is too large.');
      controller.enqueue(chunk);
    }
  });
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip')).pipeThrough(bounded)).json();
}

const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const safeKeys = keys => [...keys].filter(key => !['__proto__','prototype','constructor'].includes(key));
const recordKey = item => item?.id ?? (Array.isArray(item?.bars) ? item.symbol : undefined);

export function mergeWorkspace(base, local, remote) {
  if (same(base, local)) return remote;
  if (same(base, remote) || same(local, remote)) return local;
  if (Array.isArray(local) && Array.isArray(remote) &&
      [...local, ...remote, ...(Array.isArray(base) ? base : [])].every(item => typeof recordKey(item) === 'string')) {
    const records = list => Object.fromEntries((Array.isArray(list) ? list : []).map(item => [recordKey(item), item]));
    return Object.values(mergeWorkspace(records(base), records(local), records(remote)));
  }
  if (object(local) && object(remote) && (base === undefined || object(base))) {
    const previous = base || {};
    const keys = new Set([...Object.keys(previous), ...Object.keys(local), ...Object.keys(remote)]);
    return Object.fromEntries(safeKeys(keys).map(key => [key, mergeWorkspace(previous[key], local[key], remote[key])])
      .filter(([,value]) => value !== undefined));
  }
  return local;
}

export function workspaceSync({endpoint, names, read, write, notify, backgroundDocuments = [], enabled = true}) {
  let pending;
  try { pending = new Set(JSON.parse(localStorage.getItem(dirtyKey) || '[]')); }
  catch { pending = new Set(); }
  const baselines = new Map();
  const applied = new Map();
  const deferred = new Map();
  const mutations = new Map();
  let timer, inFlight, staged = false;
  const persist = () => localStorage.setItem(dirtyKey, JSON.stringify([...pending]));
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void flush(), 800); };

  function changed(name, previous) {
    if (!enabled) return;
    if (!pending.has(name)) baselines.set(name, previous);
    mutations.set(name,(mutations.get(name) || 0)+1);
    pending.add(name);
    persist();
    schedule();
  }

  async function exchange(mode) {
    const request = (name, options = {}) => {
      const url = new URL(endpoint);
      if (name) url.searchParams.set('document', name);
      return fetch(url, {...options, cache:'no-store', signal:AbortSignal.timeout(12000)});
    };
    const index = await request();
    if (!index.ok) throw new Error('Workspace server returned '+index.status+'.');
    const versions = await index.json();
    for (const name of names) {
      if (!pending.has(name) && (versions[name] === applied.get(name) ||
        mode !== 'startup' && versions[name] === deferred.get(name))) continue;
      if (!versions[name] && !pending.has(name)) continue;
      const local = await read(name);
      const mutation = mutations.get(name);
      let finished = false;
      for (let attempt=0; attempt<4 && !finished; attempt++) {
        const response = await request(name);
        if (!response.ok && response.status !== 404) throw new Error('Could not read workspace '+name+'.');
        let version = Number(response.headers.get('ETag') || 0);
        let remote;
        if (version) {
          try {
            remote = await decode(await response.blob());
            const list = name === 'library' || name === 'imports';
            if (list ? !Array.isArray(remote) : remote!==null&&!object(remote)) throw new Error('Invalid workspace document.');
          } catch {
            if (!pending.has(name)) {
              applied.set(name,version);
              break;
            }
          }
        }
        const sending = pending.has(name);
        const receivedNewer = version > 0 && version !== applied.get(name);
        let value = remote;
        if (sending) {
          if (version && name === 'market' && local && remote) {
            value = local.session > remote.session || local.session === remote.session &&
              (local.id !== remote.id || local.next >= remote.next) ? local : remote;
          } else {
            const previous = baselines.get(name);
            const initial = Array.isArray(local) ? [] : object(local) ? {} : undefined;
            value = mergeWorkspace(previous, local, remote ?? initial);
          }
          if (!same(value, remote)) {
            const saved = await request(name,{method:'PUT', headers:{'If-Match':String(version)}, body:await encode(value)});
            if (saved.status === 409) continue;
            if (saved.status === 413) throw new Error('Workspace '+name+' exceeds the 16 MB compressed limit.');
            if (!saved.ok) throw new Error('Could not sync workspace '+name+' ('+saved.status+').');
            version = Number(saved.headers.get('ETag'));
          }
        }
        if (mutation === mutations.get(name)) {
          const willStage = mode !== 'startup' && !backgroundDocuments.includes(name) &&
            (!sending || receivedNewer) && !same(local,value);
          if (willStage) deferred.set(name,version);
          else {
            if ((!sending || receivedNewer || mode === 'startup') && !same(local,value)) await write(name,value);
            applied.set(name,version);
            deferred.delete(name);
          }
          baselines.set(name,willStage ? local : value);
          pending.delete(name);
          persist();
        }
        finished = true;
      }
      if (!finished) throw new Error('Another device is updating this workspace. Retrying shortly.');
    }
    staged = deferred.size > 0;
  }

  function flush(mode = 'background') {
    if (!enabled) return Promise.resolve(true);
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        await exchange(mode);
        notify(staged ? 'Updating shared workspace…' : 'Shared workspace saved',staged);
        return true;
      } catch (error) {
        notify(error.message || 'Sync paused while offline.',staged);
        return false;
      }
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  return {changed, flush};
}
