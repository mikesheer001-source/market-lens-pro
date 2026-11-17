export async function scanMarket(base, state, signal, onProgress) {
  const endpoint = new URL('/api/stocks/market', base);
  async function read(params = {}) {
    endpoint.search = new URLSearchParams(params);
    const response = await fetch(endpoint, { signal, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(data.error || 'U.S. scan request failed (HTTP ' + response.status + ').'),
        { status: response.status });
    }
    return data;
  }
  const { id, session, requested, batches } = await read();
  if (state.session !== session || state.id !== id) {
    Object.assign(state, { session, id, checked: 0, next: 0, rows: new Map() });
  }
  state.requested = requested;
  while (state.next < batches && !signal.aborted) {
    const began = performance.now();
    let batch;
    try {
      batch = await read({ id, session, batch: state.next });
    } catch (error) {
      if (error.status !== 429) throw error;
      onProgress('Rate limit reached. Retrying in one minute.');
      await delay(60_000, signal);
      continue;
    }
    for (const row of batch.rows) state.rows.set(row.symbol, row);
    state.checked += batch.checked;
    state.next++;
    onProgress();
    if (state.next < batches) await delay(Math.max(0, 4500 - (performance.now() - began)), signal);
  }
}

function delay(ms, signal) {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}
