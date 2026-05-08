'use strict';

// ════════════════════════════════════════════════════════
//  RPC Client
// ════════════════════════════════════════════════════════
class RPC {
  constructor() { this.sessionId = ''; this.url = '/transmission/rpc'; }

  async call(method, args = {}) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Transmission-Session-Id': this.sessionId },
      body: JSON.stringify({ method, arguments: args }),
    });
    if (res.status === 409) {
      this.sessionId = res.headers.get('X-Transmission-Session-Id') || '';
      return this.call(method, args);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.result !== 'success') throw new Error(json.result || 'RPC error');
    return json.arguments;
  }

  getTorrents() {
    return this.call('torrent-get', { fields: [
      'id','name','status','percentDone','rateDownload','rateUpload',
      'eta','totalSize','uploadRatio','error','errorString',
      'isFinished','peersConnected','downloadedEver','uploadedEver',
      'downloadDir','addedDate','magnetLink',
    ]});
  }

  getDetails(id) {
    return this.call('torrent-get', { ids: [id], fields: [
      'id','name','hashString','magnetLink','totalSize','downloadDir',
      'percentDone','uploadRatio','rateDownload','rateUpload',
      'downloadedEver','uploadedEver','peersConnected',
      'peersSendingToUs','peersGettingFromUs',
      'addedDate','dateDone','error','errorString',
      'comment','creator','dateCreated',
      'files','fileStats','trackers','trackerStats','peers',
    ]});
  }

  getSession()  { return this.call('session-get'); }
  getStats()    { return this.call('session-stats'); }

  startTorrent(ids)  { return this.call('torrent-start',  { ids }); }
  stopTorrent(ids)   { return this.call('torrent-stop',   { ids }); }
  verifyTorrent(ids) { return this.call('torrent-verify', { ids }); }

  removeTorrent(ids, deleteData) {
    return this.call('torrent-remove', { ids, 'delete-local-data': deleteData });
  }
  addByUrl(filename, opts)  { return this.call('torrent-add', { filename, ...opts }); }
  addByFile(metainfo, opts) { return this.call('torrent-add', { metainfo, ...opts }); }

  setAltSpeed(enabled) { return this.call('session-set', { 'alt-speed-enabled': enabled }); }

  setSpeedLimit(dir, limitKBs) {
    return this.call('session-set', {
      [`speed-limit-${dir}-enabled`]: limitKBs > 0,
      [`speed-limit-${dir}`]: limitKBs,
    });
  }

  setSession(opts) { return this.call('session-set', opts); }

  setFilePriority(id, fileIndex, priority, wanted) {
    const opts = { ids: [id] };
    if (!wanted) {
      opts['files-unwanted'] = [fileIndex];
    } else {
      opts['files-wanted'] = [fileIndex];
      if (priority === 1)       opts['priority-high']   = [fileIndex];
      else if (priority === -1) opts['priority-low']    = [fileIndex];
      else                      opts['priority-normal'] = [fileIndex];
    }
    return this.call('torrent-set', opts);
  }
}

// ════════════════════════════════════════════════════════
//  Formatters
// ════════════════════════════════════════════════════════
function fmtBytes(n) {
  if (n == null || n < 0) return '—';
  const u = ['B','KB','MB','GB','TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? Math.round(n) : n.toFixed(i < 2 ? 1 : 2)) + ' ' + u[i];
}
function fmtSpeed(bps)  { return (!bps || bps <= 0) ? '—' : fmtBytes(bps) + '/s'; }
function fmtETA(secs) {
  if (!secs || secs < 0) return '—';
  if (secs < 60)    return `${secs}s`;
  if (secs < 3600)  return `${Math.floor(secs/60)}m`;
  if (secs < 86400) return `${Math.floor(secs/3600)}h ${Math.floor((secs%3600)/60)}m`;
  return `${Math.floor(secs/86400)}d`;
}
function fmtRatio(r) {
  if (r == null || r < 0) return '—';
  return r >= 100 ? '∞' : r.toFixed(2);
}
function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ════════════════════════════════════════════════════════
//  Status helpers
// ════════════════════════════════════════════════════════
const STATUS_MAP = {
  0: { label:'Stopped',     dot:'s-paused',      icon:'⏸', bar:'pf-paused', filter:'paused' },
  1: { label:'Queued',      dot:'s-waiting',     icon:'…',  bar:'pf-check',  filter:'checking' },
  2: { label:'Checking',    dot:'s-checking',    icon:'↻',  bar:'pf-check',  filter:'checking' },
  3: { label:'Queued',      dot:'s-waiting',     icon:'…',  bar:'pf-down',   filter:'downloading' },
  4: { label:'Downloading', dot:'s-downloading', icon:'↓',  bar:'pf-down',   filter:'downloading' },
  5: { label:'Queued',      dot:'s-waiting',     icon:'…',  bar:'pf-seed',   filter:'seeding' },
  6: { label:'Seeding',     dot:'s-seeding',     icon:'↑',  bar:'pf-seed',   filter:'seeding' },
};

function getStatus(t) {
  if (t.error && t.error !== 0)
    return { label: t.errorString || 'Error', dot:'s-error', icon:'!', bar:'pf-error', filter:'error' };
  if (t.isFinished && t.status === 0)
    return { label:'Finished', dot:'s-finished', icon:'✓', bar:'pf-seed', filter:'finished' };
  return STATUS_MAP[t.status] ?? STATUS_MAP[0];
}

function subtitleText(t) {
  const s = getStatus(t);
  if (s.filter === 'error')       return t.errorString || 'Error';
  if (s.filter === 'downloading') return `${s.label} · ${t.peersConnected ?? 0} peers`;
  if (s.filter === 'seeding')     return `Seeding · Ratio ${fmtRatio(t.uploadRatio)} · ${t.peersConnected ?? 0} peers`;
  return s.label;
}

// ════════════════════════════════════════════════════════
//  State
// ════════════════════════════════════════════════════════
const rpc = new RPC();
let torrents        = [];
let activeFilter    = 'all';
let searchQuery     = '';
let sortField       = 'addedDate';
let sortDir         = 'desc';
let selectedIds     = new Set();
let lastClickIdx    = -1;
let pendingRemoveIds = [];
let ctxTorrentId    = null;
let pollTimer       = null;
let altSpeedOn      = false;
let bwDown = 0, bwUp = 0;
let sessionCache    = {};

const BW_PRESETS = [
  { label:'∞',        val:0     },
  { label:'100 KB/s', val:100   },
  { label:'500 KB/s', val:500   },
  { label:'1 MB/s',   val:1024  },
  { label:'5 MB/s',   val:5120  },
  { label:'10 MB/s',  val:10240 },
];

// ════════════════════════════════════════════════════════
//  Theme
// ════════════════════════════════════════════════════════
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('tr-theme', t);
  const dark = t === 'dark';
  document.getElementById('themeIconDark').style.display  = dark ? '' : 'none';
  document.getElementById('themeIconLight').style.display = dark ? 'none' : '';
}
document.getElementById('themeBtn').addEventListener('click', () =>
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
);
applyTheme(localStorage.getItem('tr-theme') || 'dark');

// ════════════════════════════════════════════════════════
//  Sort & filter
// ════════════════════════════════════════════════════════
function getSortValue(t, f) {
  switch (f) {
    case 'name':        return (t.name || '').toLowerCase();
    case 'totalSize':   return t.totalSize   ?? 0;
    case 'percentDone': return t.percentDone ?? 0;
    case 'rateDownload':return t.rateDownload ?? 0;
    case 'rateUpload':  return t.rateUpload   ?? 0;
    case 'eta':         return (t.eta < 0 || t.eta == null) ? Infinity : t.eta;
    case 'uploadRatio': return t.uploadRatio  ?? -1;
    default:            return t.addedDate    ?? 0;
  }
}

function sortedFiltered() {
  const q = searchQuery.toLowerCase();
  const list = torrents.filter((t) => {
    if (activeFilter !== 'all' && getStatus(t).filter !== activeFilter) return false;
    if (q && !(t.name || '').toLowerCase().includes(q)) return false;
    return true;
  });
  list.sort((a, b) => {
    const av = getSortValue(a, sortField), bv = getSortValue(b, sortField);
    if (av < bv) return sortDir === 'asc' ? -1 :  1;
    if (av > bv) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });
  return list;
}

function countFilter(f) {
  if (f === 'all') return torrents.length;
  return torrents.filter((t) => getStatus(t).filter === f).length;
}

function updateSortArrows() {
  document.querySelectorAll('th[data-sort]').forEach((h) => {
    if (h.dataset.sort === sortField) h.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
    else h.removeAttribute('aria-sort');
  });
}

// Sort click handlers
document.querySelectorAll('th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const f = th.dataset.sort;
    sortDir = (sortField === f) ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
    sortField = f;
    updateSortArrows();
    render();
  });
});

// ════════════════════════════════════════════════════════
//  Row HTML
// ════════════════════════════════════════════════════════
function rowHTML(t, selected) {
  const s      = getStatus(t);
  const pct    = Math.round(t.percentDone * 100);
  const isDown = t.rateDownload > 0;
  const isUp   = t.rateUpload   > 0;
  const stopped = t.status === 0;

  return `
<tr class="torrent-row${selected ? ' selected' : ''}" data-id="${t.id}">
  <td><input type="checkbox" class="row-check" ${selected ? 'checked' : ''} /></td>
  <td><div class="status-dot ${s.dot}">${s.icon}</div></td>
  <td>
    <div class="name-cell">
      <span class="torrent-name" title="${escHtml(t.name)}">${escHtml(t.name)}</span>
      <span class="torrent-subtitle">${escHtml(subtitleText(t))}</span>
      <div class="card-meta">
        ${isDown ? `<span class="cdn">↓ ${fmtSpeed(t.rateDownload)}</span>` : ''}
        ${isUp   ? `<span class="cup">↑ ${fmtSpeed(t.rateUpload)}</span>`   : ''}
        <span>${fmtBytes(t.totalSize)}</span>
      </div>
    </div>
  </td>
  <td class="num hide-xs">${fmtBytes(t.totalSize)}</td>
  <td>
    <div class="progress-wrap">
      <div class="progress-track"><div class="progress-fill ${s.bar}" style="width:${pct}%"></div></div>
      <span class="progress-pct">${pct}%</span>
    </div>
  </td>
  <td class="num hide-sm${isDown ? ' dn' : ''}">${isDown ? fmtSpeed(t.rateDownload) : '—'}</td>
  <td class="num hide-sm${isUp   ? ' up' : ''}">${isUp   ? fmtSpeed(t.rateUpload)   : '—'}</td>
  <td class="num hide-md">${t.status === 4 ? fmtETA(t.eta) : '—'}</td>
  <td class="num hide-md">${fmtRatio(t.uploadRatio)}</td>
  <td>
    <div class="actions">
      ${stopped
        ? `<button class="act-btn js-start" title="Start"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></button>`
        : `<button class="act-btn js-stop"  title="Pause"><svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg></button>`}
      <button class="act-btn js-info" title="Details">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </button>
      <button class="act-btn danger js-remove" title="Remove">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14a2,2,0,0,1-2,2H8a2,2,0,0,1-2-2L5,6m3,0V4a1,1,0,0,1,1-1h4a1,1,0,0,1,1,1v2"/></svg>
      </button>
    </div>
  </td>
</tr>`;
}

// ════════════════════════════════════════════════════════
//  Render
// ════════════════════════════════════════════════════════
const tbody      = document.getElementById('torrentList');
const emptyRow   = document.getElementById('emptyRow');
const selectAllCb = document.getElementById('selectAll');

function render() {
  const list = sortedFiltered();

  // Filter counts
  ['all','downloading','seeding','paused','finished','checking','error'].forEach((f) => {
    const el = document.getElementById(`count-${f}`);
    if (el) el.textContent = countFilter(f);
  });

  // Select-all state
  const visIds = list.map((t) => t.id);
  const allSel  = visIds.length > 0 && visIds.every((id) => selectedIds.has(id));
  const someSel = visIds.some((id) => selectedIds.has(id));
  selectAllCb.checked       = allSel;
  selectAllCb.indeterminate = !allSel && someSel;

  // Bulk bar
  const hasSel = selectedIds.size > 0;
  document.getElementById('bulkBar').classList.toggle('visible', hasSel);
  document.getElementById('listWrap').classList.toggle('bulk-visible', hasSel);
  document.getElementById('bulkCount').textContent = `${selectedIds.size} selected`;

  // Empty state
  emptyRow.style.display = list.length === 0 ? '' : 'none';

  // Rebuild rows in sorted order
  tbody.querySelectorAll('.torrent-row').forEach((r) => r.remove());
  if (!list.length) return;

  const frag = document.createDocumentFragment();
  list.forEach((t) => {
    const tpl = document.createElement('table');
    tpl.innerHTML = `<tbody>${rowHTML(t, selectedIds.has(t.id))}</tbody>`;
    frag.appendChild(tpl.querySelector('tr'));
  });
  tbody.insertBefore(frag, emptyRow);
}

// ════════════════════════════════════════════════════════
//  Polling
// ════════════════════════════════════════════════════════
async function poll() {
  try {
    const [td, stats] = await Promise.all([rpc.getTorrents(), rpc.getStats()]);
    torrents = td.torrents || [];
    render();
    updateGlobalStats(stats);
    document.getElementById('connectionStatus').textContent = 'Connected';
  } catch (err) {
    document.getElementById('connectionStatus').textContent = 'Disconnected — retrying…';
    console.error('[poll]', err);
  }
  pollTimer = setTimeout(poll, 3000);
}

function quickRefresh() { clearTimeout(pollTimer); poll(); }

function updateGlobalStats(stats) {
  if (!stats) return;
  const cur = stats['current-stats']    || {};
  const cum = stats['cumulative-stats'] || {};
  document.getElementById('globalDown').textContent = `↓ ${fmtSpeed(cur.downloadSpeed)}`;
  document.getElementById('globalUp').textContent   = `↑ ${fmtSpeed(cur.uploadSpeed)}`;
  document.getElementById('torrentCount').textContent =
    `${torrents.length} torrent${torrents.length !== 1 ? 's' : ''}`;
  document.getElementById('totalDown').textContent = `↓ ${fmtBytes(cum.downloadedBytes)}`;
  document.getElementById('totalUp').textContent   = `↑ ${fmtBytes(cum.uploadedBytes)}`;
}

async function loadSession() {
  try {
    const s = await rpc.getSession();
    sessionCache = s;
    if (s['download-dir-free-space'] != null)
      document.getElementById('freeSpace').textContent = `Free: ${fmtBytes(s['download-dir-free-space'])}`;
    if (s['download-dir'])
      document.getElementById('downloadDir').placeholder = s['download-dir'];
    altSpeedOn = s['alt-speed-enabled'] || false;
    document.getElementById('altSpeedBtn').classList.toggle('active', altSpeedOn);
    bwDown = s['speed-limit-down-enabled'] ? (s['speed-limit-down'] || 0) : 0;
    bwUp   = s['speed-limit-up-enabled']   ? (s['speed-limit-up']   || 0) : 0;
    renderBwPresets();
  } catch {}
}

// ════════════════════════════════════════════════════════
//  Selection
// ════════════════════════════════════════════════════════
tbody.addEventListener('click', (e) => {
  if (e.target.closest('.actions') || e.target.classList.contains('row-check')) return;
  const row = e.target.closest('.torrent-row');
  if (!row) return;
  const list = sortedFiltered();
  const idx  = list.findIndex((t) => String(t.id) === row.dataset.id);
  if (idx === -1) return;
  const id = list[idx].id;

  if (e.shiftKey && lastClickIdx !== -1) {
    const lo = Math.min(idx, lastClickIdx), hi = Math.max(idx, lastClickIdx);
    for (let i = lo; i <= hi; i++) selectedIds.add(list[i].id);
  } else if (e.ctrlKey || e.metaKey) {
    selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
    lastClickIdx = idx;
  } else {
    if (selectedIds.size === 1 && selectedIds.has(id)) { selectedIds.clear(); lastClickIdx = -1; }
    else { selectedIds.clear(); selectedIds.add(id); lastClickIdx = idx; }
  }
  render();
});

tbody.addEventListener('change', (e) => {
  if (!e.target.classList.contains('row-check')) return;
  const row = e.target.closest('.torrent-row');
  if (!row) return;
  const id = +row.dataset.id;
  e.target.checked ? selectedIds.add(id) : selectedIds.delete(id);
  render();
});

selectAllCb.addEventListener('change', () => {
  const list = sortedFiltered();
  if (selectAllCb.checked) list.forEach((t) => selectedIds.add(t.id));
  else selectedIds.clear();
  render();
});

// ════════════════════════════════════════════════════════
//  Row action buttons
// ════════════════════════════════════════════════════════
tbody.addEventListener('click', async (e) => {
  if (!e.target.closest('.actions')) return;
  const row = e.target.closest('.torrent-row');
  if (!row) return;
  const id = +row.dataset.id;

  if (e.target.closest('.js-start'))  { await rpc.startTorrent([id]).catch(err => toast(err.message,'error')); quickRefresh(); }
  else if (e.target.closest('.js-stop'))   { await rpc.stopTorrent([id]).catch(err => toast(err.message,'error')); quickRefresh(); }
  else if (e.target.closest('.js-info'))   { openDetails(id); }
  else if (e.target.closest('.js-remove')) { openRemoveModal([id]); }
});

// ════════════════════════════════════════════════════════
//  Context menu
// ════════════════════════════════════════════════════════
const ctxMenu = document.getElementById('ctxMenu');

function openCtxMenu(x, y, torrentId) {
  ctxTorrentId = torrentId;
  const t = torrents.find((t) => t.id === torrentId);
  if (t) {
    const stopped = t.status === 0;
    document.getElementById('ctxToggle').textContent = stopped ? '▶ Start' : '⏸ Pause';
  }

  // Position within viewport
  ctxMenu.style.left = '0'; ctxMenu.style.top = '0';
  ctxMenu.classList.add('open');
  const rect = ctxMenu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  ctxMenu.style.left = Math.min(x, vw - rect.width  - 8) + 'px';
  ctxMenu.style.top  = Math.min(y, vh - rect.height - 8) + 'px';
}

function closeCtxMenu() { ctxMenu.classList.remove('open'); ctxTorrentId = null; }

tbody.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.torrent-row');
  if (!row) return;
  e.preventDefault();
  // Add to selection if not already selected
  const id = +row.dataset.id;
  if (!selectedIds.has(id)) { selectedIds.clear(); selectedIds.add(id); render(); }
  openCtxMenu(e.clientX, e.clientY, id);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#ctxMenu')) closeCtxMenu();
});
document.addEventListener('scroll', closeCtxMenu, true);

document.getElementById('ctxToggle').addEventListener('click', async () => {
  if (!ctxTorrentId) return;
  const t = torrents.find((t) => t.id === ctxTorrentId);
  if (!t) return;
  if (t.status === 0) await rpc.startTorrent([ctxTorrentId]).catch(err => toast(err.message,'error'));
  else                await rpc.stopTorrent([ctxTorrentId]).catch(err => toast(err.message,'error'));
  closeCtxMenu(); quickRefresh();
});

document.getElementById('ctxVerify').addEventListener('click', async () => {
  if (!ctxTorrentId) return;
  await rpc.verifyTorrent([ctxTorrentId]).catch(err => toast(err.message,'error'));
  toast('Recheck started', 'info');
  closeCtxMenu(); quickRefresh();
});

document.getElementById('ctxInfo').addEventListener('click', () => {
  if (ctxTorrentId) openDetails(ctxTorrentId);
  closeCtxMenu();
});

document.getElementById('ctxMagnet').addEventListener('click', () => {
  const t = torrents.find((t) => t.id === ctxTorrentId);
  if (t?.magnetLink) {
    navigator.clipboard.writeText(t.magnetLink).then(() => toast('Magnet link copied','success'));
  }
  closeCtxMenu();
});

document.getElementById('ctxRemoveKeep').addEventListener('click', () => {
  const id = ctxTorrentId;
  closeCtxMenu();
  if (id) openRemoveModal([id], false);
});

document.getElementById('ctxRemoveDel').addEventListener('click', () => {
  const id = ctxTorrentId;
  closeCtxMenu();
  if (id) openRemoveModal([id], true);
});

// ════════════════════════════════════════════════════════
//  Filter tabs
// ════════════════════════════════════════════════════════
document.getElementById('filterTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.filter-tab');
  if (!tab) return;
  document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');
  activeFilter = tab.dataset.filter;
  render();
});

document.getElementById('searchInput').addEventListener('input', (e) => {
  searchQuery = e.target.value;
  render();
});

// ════════════════════════════════════════════════════════
//  Bulk actions
// ════════════════════════════════════════════════════════
document.getElementById('startAllBtn').addEventListener('click', async () => {
  const ids = torrents.filter((t) => t.status === 0).map((t) => t.id);
  if (ids.length) { await rpc.startTorrent(ids).catch(err => toast(err.message,'error')); quickRefresh(); }
});
document.getElementById('stopAllBtn').addEventListener('click', async () => {
  const ids = torrents.filter((t) => t.status !== 0).map((t) => t.id);
  if (ids.length) { await rpc.stopTorrent(ids).catch(err => toast(err.message,'error')); quickRefresh(); }
});

document.getElementById('bulkStart').addEventListener('click', async () => {
  const ids = [...selectedIds];
  await rpc.startTorrent(ids).catch(err => toast(err.message,'error'));
  toast(`Started ${ids.length} torrent${ids.length !== 1?'s':''}`, 'success');
  quickRefresh();
});
document.getElementById('bulkStop').addEventListener('click', async () => {
  const ids = [...selectedIds];
  await rpc.stopTorrent(ids).catch(err => toast(err.message,'error'));
  toast(`Paused ${ids.length} torrent${ids.length !== 1?'s':''}`, 'success');
  quickRefresh();
});
document.getElementById('bulkFinish').addEventListener('click', async () => {
  const ids = [...selectedIds];
  await rpc.stopTorrent(ids).catch(err => toast(err.message,'error'));
  toast(`Finished ${ids.length} torrent${ids.length !== 1?'s':''}`, 'success');
  quickRefresh();
});
document.getElementById('bulkVerify').addEventListener('click', async () => {
  const ids = [...selectedIds];
  await rpc.verifyTorrent(ids).catch(err => toast(err.message,'error'));
  toast(`Verifying ${ids.length} torrent${ids.length !== 1?'s':''}`, 'info');
  quickRefresh();
});
document.getElementById('bulkRemove').addEventListener('click', () => {
  openRemoveModal([...selectedIds]);
});
document.getElementById('bulkDeselect').addEventListener('click', () => {
  selectedIds.clear(); lastClickIdx = -1; render();
});

// ════════════════════════════════════════════════════════
//  Alt Speed
// ════════════════════════════════════════════════════════
document.getElementById('altSpeedBtn').addEventListener('click', async () => {
  altSpeedOn = !altSpeedOn;
  try {
    await rpc.setAltSpeed(altSpeedOn);
    document.getElementById('altSpeedBtn').classList.toggle('active', altSpeedOn);
    toast(altSpeedOn ? 'Turtle mode ON' : 'Turtle mode OFF', 'info');
  } catch (err) { altSpeedOn = !altSpeedOn; toast(err.message,'error'); }
});

// ════════════════════════════════════════════════════════
//  Bandwidth presets
// ════════════════════════════════════════════════════════
const bwBtn = document.getElementById('bwBtn');
const bwPanel = document.getElementById('bwPanel');
bwBtn.addEventListener('click', (e) => { e.stopPropagation(); bwPanel.classList.toggle('open'); });
document.addEventListener('click', (e) => { if (!e.target.closest('#bwWrap')) bwPanel.classList.remove('open'); });

function renderBwPresets() {
  ['Down','Up'].forEach((dir) => {
    const lc  = dir.toLowerCase();
    const cur = lc === 'down' ? bwDown : bwUp;
    document.getElementById(`bw${dir}Current`).textContent =
      cur === 0 ? 'Unlimited' : (BW_PRESETS.find(p => p.val === cur)?.label ?? `${cur} KB/s`);
    document.getElementById(`bw${dir}Presets`).innerHTML = BW_PRESETS.map((p) =>
      `<button class="bw-preset${p.val === cur?' active':''}" data-dir="${lc}" data-val="${p.val}">${escHtml(p.label)}</button>`
    ).join('');
  });
}

document.getElementById('bwPanel').addEventListener('click', async (e) => {
  const btn = e.target.closest('.bw-preset');
  if (!btn) return;
  const dir = btn.dataset.dir, val = +btn.dataset.val;
  try {
    await rpc.setSpeedLimit(dir, val);
    if (dir === 'down') bwDown = val; else bwUp = val;
    renderBwPresets();
    toast(val === 0 ? `${dir==='down'?'Download':'Upload'} unlimited` : `${dir==='down'?'Download':'Upload'} → ${btn.textContent}`, 'info');
  } catch (err) { toast(err.message,'error'); }
});

// ════════════════════════════════════════════════════════
//  Details modal
// ════════════════════════════════════════════════════════
const detailsModal = document.getElementById('detailsModal');
let detailsTorrentId = null;
let detailsTab = 'general';

async function openDetails(id) {
  detailsTorrentId = id;
  detailsTab = 'general';
  const t = torrents.find((t) => t.id === id);
  document.getElementById('detailsTitle').textContent = t ? t.name : 'Torrent Details';
  document.getElementById('detailsBody').innerHTML = '<div class="details-loading">Loading…</div>';
  document.querySelectorAll('[data-dtab]').forEach((b) => b.classList.toggle('active', b.dataset.dtab === 'general'));
  detailsModal.classList.add('open');
  await loadDetails(id, 'general');
}

async function loadDetails(id, tab) {
  try {
    const data = await rpc.getDetails(id);
    const t = data.torrents?.[0];
    if (!t) { document.getElementById('detailsBody').innerHTML = '<div class="details-loading">Not found.</div>'; return; }
    renderDetailsTab(t, tab);
  } catch (err) {
    document.getElementById('detailsBody').innerHTML = `<div class="details-loading">Error: ${escHtml(err.message)}</div>`;
  }
}

function renderDetailsTab(t, tab) {
  const body = document.getElementById('detailsBody');
  if (tab === 'general') {
    body.innerHTML = `
      <div class="detail-section-title">Transfer</div>
      <div class="detail-grid">
        <div class="detail-row"><span>Status</span><span>${escHtml(getStatus(t).label)}</span></div>
        <div class="detail-row"><span>Progress</span><span>${Math.round(t.percentDone*100)}% of ${fmtBytes(t.totalSize)}</span></div>
        <div class="detail-row"><span>Downloaded</span><span>${fmtBytes(t.downloadedEver)}</span></div>
        <div class="detail-row"><span>Uploaded</span><span>${fmtBytes(t.uploadedEver)}</span></div>
        <div class="detail-row"><span>Ratio</span><span>${fmtRatio(t.uploadRatio)}</span></div>
        <div class="detail-row"><span>↓ Speed</span><span>${fmtSpeed(t.rateDownload)}</span></div>
        <div class="detail-row"><span>↑ Speed</span><span>${fmtSpeed(t.rateUpload)}</span></div>
        <div class="detail-row"><span>ETA</span><span>${fmtETA(t.eta)}</span></div>
        <div class="detail-row"><span>Peers</span><span>${t.peersConnected ?? 0} connected (${t.peersSendingToUs ?? 0} sending, ${t.peersGettingFromUs ?? 0} getting)</span></div>
      </div>
      <div class="detail-section-title">Info</div>
      <div class="detail-grid">
        <div class="detail-row"><span>Name</span><span>${escHtml(t.name)}</span></div>
        <div class="detail-row"><span>Hash</span><span>${escHtml(t.hashString || '—')}</span></div>
        <div class="detail-row"><span>Location</span><span>${escHtml(t.downloadDir || '—')}</span></div>
        <div class="detail-row"><span>Added</span><span>${fmtDate(t.addedDate)}</span></div>
        <div class="detail-row"><span>Completed</span><span>${t.dateDone ? fmtDate(t.dateDone) : '—'}</span></div>
        <div class="detail-row"><span>Comment</span><span>${escHtml(t.comment || '—')}</span></div>
        ${t.error && t.error !== 0 ? `<div class="detail-row"><span>Error</span><span style="color:var(--error)">${escHtml(t.errorString)}</span></div>` : ''}
      </div>`;
  } else if (tab === 'files') {
    const files = t.files || [], stats = t.fileStats || [];
    if (!files.length) { body.innerHTML = '<div class="details-loading">No file info available.</div>'; return; }
    body.innerHTML = `<div class="file-list" id="fileList"></div>`;
    const list = document.getElementById('fileList');
    files.forEach((f, i) => {
      const st  = stats[i] || {};
      const pct = f.length > 0 ? Math.round((f.bytesCompleted / f.length) * 100) : 0;
      const name = (f.name || '').split('/').pop() || f.name;
      const pri = !st.wanted ? 'skip' : (st.priority === 1 ? 'high' : st.priority === -1 ? 'low' : 'normal');

      const row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML = `
        <div class="file-info">
          <span class="file-name" title="${escHtml(f.name)}">${escHtml(name)}</span>
          <div class="file-prog">
            <div class="progress-track"><div class="progress-fill pf-down" style="width:${pct}%"></div></div>
            <span class="file-meta">${pct}% · ${fmtBytes(f.length)}</span>
          </div>
        </div>
        <select class="priority-select" data-file-idx="${i}">
          <option value="skip"   ${pri==='skip'  ?'selected':''}>Skip</option>
          <option value="low"    ${pri==='low'   ?'selected':''}>Low</option>
          <option value="normal" ${pri==='normal'?'selected':''}>Normal</option>
          <option value="high"   ${pri==='high'  ?'selected':''}>High</option>
        </select>`;
      list.appendChild(row);
    });

    // Priority change
    list.addEventListener('change', async (e) => {
      const sel = e.target.closest('.priority-select');
      if (!sel) return;
      const idx = +sel.dataset.fileIdx, val = sel.value;
      const wanted   = val !== 'skip';
      const priority = val === 'high' ? 1 : val === 'low' ? -1 : 0;
      try {
        await rpc.setFilePriority(t.id, idx, priority, wanted);
        toast('Priority updated', 'success');
      } catch (err) { toast(err.message,'error'); }
    });
  } else if (tab === 'peers') {
    const peers = t.peers || [];
    if (!peers.length) { body.innerHTML = '<div class="details-loading">No peers connected.</div>'; return; }
    body.innerHTML = `
      <table class="peers-table">
        <thead><tr><th>Address</th><th>Progress</th><th>↓</th><th>↑</th><th>Flags</th></tr></thead>
        <tbody>${peers.map((p) => `
          <tr>
            <td>${escHtml(p.address)}:${p.port}</td>
            <td>${Math.round((p.progress||0)*100)}%</td>
            <td style="color:var(--down)">${fmtSpeed(p.rateToClient)}</td>
            <td style="color:var(--up)">${fmtSpeed(p.rateToPeer)}</td>
            <td><code>${escHtml(p.flagStr||'')}</code></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } else if (tab === 'trackers') {
    const trackers = t.trackerStats || t.trackers || [];
    if (!trackers.length) { body.innerHTML = '<div class="details-loading">No trackers.</div>'; return; }
    body.innerHTML = `
      <table class="trackers-table">
        <thead><tr><th>Tracker</th><th>Status</th><th>Seeders</th><th>Leechers</th><th>Last announce</th></tr></thead>
        <tbody>${trackers.map((tr) => {
          const ok  = tr.lastAnnounceSucceeded;
          const url = tr.announce || tr.host || '—';
          return `<tr>
            <td style="word-break:break-all">${escHtml(url)}</td>
            <td class="${ok?'tracker-ok':'tracker-err'}">${ok ? '✓ OK' : (tr.lastAnnounceResult || '—')}</td>
            <td>${tr.seederCount ?? '—'}</td>
            <td>${tr.leecherCount ?? '—'}</td>
            <td>${tr.lastAnnounceTime ? fmtDate(tr.lastAnnounceTime) : '—'}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`;
  }
}

// Details tab switching
document.querySelectorAll('[data-dtab]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    detailsTab = btn.dataset.dtab;
    document.querySelectorAll('[data-dtab]').forEach((b) => b.classList.toggle('active', b.dataset.dtab === detailsTab));
    document.getElementById('detailsBody').innerHTML = '<div class="details-loading">Loading…</div>';
    if (detailsTorrentId) await loadDetails(detailsTorrentId, detailsTab);
  });
});

function closeDetails() { detailsModal.classList.remove('open'); detailsTorrentId = null; }
document.getElementById('detailsModalClose').addEventListener('click', closeDetails);
detailsModal.addEventListener('click', (e) => { if (e.target === detailsModal) closeDetails(); });

// Double-click row → open details
tbody.addEventListener('dblclick', (e) => {
  const row = e.target.closest('.torrent-row');
  if (row && !e.target.closest('.actions')) openDetails(+row.dataset.id);
});

// ════════════════════════════════════════════════════════
//  Settings modal
// ════════════════════════════════════════════════════════
const settingsModal = document.getElementById('settingsModal');
let settingsTab = 'downloading';
let settingsDraft = {};

const SETTINGS_TABS = {
  downloading: [
    { key:'download-dir',           label:'Download directory',        type:'text' },
    { key:'start-added-torrents',   label:'Start torrents when added', type:'bool' },
    { key:'rename-partial-files',   label:'Append .part to incomplete files', type:'bool' },
    { key:'incomplete-dir-enabled', label:'Use incomplete directory',  type:'bool' },
    { key:'incomplete-dir',         label:'Incomplete directory',      type:'text' },
  ],
  speed: [
    { key:'speed-limit-down-enabled', label:'Limit download speed',  type:'bool' },
    { key:'speed-limit-down',         label:'Download limit (KB/s)', type:'num'  },
    { key:'speed-limit-up-enabled',   label:'Limit upload speed',    type:'bool' },
    { key:'speed-limit-up',           label:'Upload limit (KB/s)',   type:'num'  },
    { key:'alt-speed-enabled',        label:'Enable turtle mode',    type:'bool' },
    { key:'alt-speed-down',           label:'Turtle download (KB/s)','type':'num'  },
    { key:'alt-speed-up',             label:'Turtle upload (KB/s)',  type:'num'  },
  ],
  seeding: [
    { key:'seedRatioLimited',           label:'Stop seeding at ratio',      type:'bool' },
    { key:'seedRatioLimit',             label:'Seeding ratio limit',         type:'num'  },
    { key:'idle-seeding-limit-enabled', label:'Stop seeding when idle',     type:'bool' },
    { key:'idle-seeding-limit',         label:'Idle time limit (minutes)',   type:'num'  },
  ],
  peers: [
    { key:'peer-limit-per-torrent', label:'Max peers per torrent', type:'num' },
    { key:'peer-limit-global',      label:'Max peers total',       type:'num' },
    { key:'pex-enabled',            label:'Enable peer exchange',  type:'bool' },
    { key:'dht-enabled',            label:'Enable DHT',            type:'bool' },
    { key:'lpd-enabled',            label:'Enable local peer discovery', type:'bool' },
  ],
};

async function openSettings() {
  settingsTab = 'downloading';
  document.querySelectorAll('[data-stab]').forEach((b) => b.classList.toggle('active', b.dataset.stab === 'downloading'));
  settingsModal.classList.add('open');
  document.getElementById('settingsBody').innerHTML = '<div class="details-loading">Loading…</div>';
  try {
    const s = await rpc.getSession();
    sessionCache = s;
    settingsDraft = { ...s };
    renderSettingsTab('downloading');
  } catch (err) {
    document.getElementById('settingsBody').innerHTML = `<div class="details-loading">Error: ${escHtml(err.message)}</div>`;
  }
}

function renderSettingsTab(tab) {
  const fields = SETTINGS_TABS[tab] || [];
  const body   = document.getElementById('settingsBody');
  body.innerHTML = `<div class="settings-section">${fields.map((f) => {
    const val = settingsDraft[f.key];
    if (f.type === 'bool') {
      return `<div class="settings-row">
        <span class="settings-label">${escHtml(f.label)}</span>
        <input type="checkbox" class="toggle-checkbox" data-skey="${f.key}" ${val ? 'checked' : ''} />
      </div>`;
    } else if (f.type === 'num') {
      return `<div class="settings-row">
        <span class="settings-label">${escHtml(f.label)}</span>
        <input type="number" class="input input-sm" data-skey="${f.key}" value="${val ?? 0}" min="0" />
      </div>`;
    } else {
      return `<div class="settings-row">
        <span class="settings-label">${escHtml(f.label)}</span>
        <input type="text" class="input" style="max-width:220px" data-skey="${f.key}" value="${escHtml(val ?? '')}" />
      </div>`;
    }
  }).join('')}</div>`;

  // Collect changes live
  body.querySelectorAll('[data-skey]').forEach((el) => {
    el.addEventListener('change', () => {
      const key = el.dataset.skey;
      if (el.type === 'checkbox') settingsDraft[key] = el.checked;
      else if (el.type === 'number') settingsDraft[key] = parseFloat(el.value);
      else settingsDraft[key] = el.value;
    });
  });
}

document.querySelectorAll('[data-stab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    settingsTab = btn.dataset.stab;
    document.querySelectorAll('[data-stab]').forEach((b) => b.classList.toggle('active', b.dataset.stab === settingsTab));
    renderSettingsTab(settingsTab);
  });
});

document.getElementById('settingsBtn').addEventListener('click', openSettings);

function closeSettings() { settingsModal.classList.remove('open'); }
document.getElementById('settingsModalClose').addEventListener('click', closeSettings);
document.getElementById('settingsCancelBtn').addEventListener('click', closeSettings);
settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettings(); });

document.getElementById('settingsSaveBtn').addEventListener('click', async () => {
  // Only send keys that exist in the current session
  const toSave = {};
  Object.keys(settingsDraft).forEach((k) => {
    if (sessionCache.hasOwnProperty(k) && settingsDraft[k] !== sessionCache[k])
      toSave[k] = settingsDraft[k];
  });
  try {
    if (Object.keys(toSave).length) await rpc.setSession(toSave);
    toast('Settings saved', 'success');
    closeSettings();
    loadSession();
  } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
});

// ════════════════════════════════════════════════════════
//  Add modal
// ════════════════════════════════════════════════════════
const addModal = document.getElementById('addModal');
let selectedFile = null;

function openAdd() { addModal.classList.add('open'); setTimeout(() => document.getElementById('torrentUrl').focus(), 50); }
function closeAdd() {
  addModal.classList.remove('open');
  document.getElementById('torrentUrl').value = '';
  selectedFile = null;
  document.getElementById('fileDropLabel').textContent = 'Drop .torrent file here or click to browse';
  document.getElementById('fileDrop').style.borderColor = '';
  document.getElementById('torrentFile').value = '';
  addModal.querySelectorAll('.modal-tab').forEach((b, i) => b.classList.toggle('active', i === 0));
  addModal.querySelectorAll('.tab-pane').forEach((p, i) => p.classList.toggle('active', i === 0));
}

document.getElementById('addBtn').addEventListener('click', openAdd);
document.getElementById('addModalClose').addEventListener('click', closeAdd);
document.getElementById('addCancelBtn').addEventListener('click', closeAdd);
addModal.addEventListener('click', (e) => { if (e.target === addModal) closeAdd(); });

addModal.addEventListener('click', (e) => {
  const tab = e.target.closest('.modal-tab');
  if (!tab) return;
  addModal.querySelectorAll('.modal-tab').forEach((b) => b.classList.remove('active'));
  addModal.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
  tab.classList.add('active');
  document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
});

const fileDrop  = document.getElementById('fileDrop');
const fileInput = document.getElementById('torrentFile');
fileDrop.addEventListener('click', () => fileInput.click());
fileDrop.addEventListener('dragover', (e) => { e.preventDefault(); fileDrop.classList.add('dragover'); });
fileDrop.addEventListener('dragleave', () => fileDrop.classList.remove('dragover'));
fileDrop.addEventListener('drop', (e) => { e.preventDefault(); fileDrop.classList.remove('dragover'); if (e.dataTransfer.files[0]) attachFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) attachFile(fileInput.files[0]); });

function attachFile(file) {
  selectedFile = file;
  document.getElementById('fileDropLabel').textContent = `✓ ${file.name}`;
  fileDrop.style.borderColor = 'var(--up)';
}
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

document.getElementById('addConfirmBtn').addEventListener('click', async () => {
  const activeTab = addModal.querySelector('.modal-tab.active')?.dataset.tab;
  const dir = document.getElementById('downloadDir').value.trim() || undefined;
  const opts = {};
  if (dir) opts['download-dir'] = dir;
  if (document.getElementById('startPaused').checked) opts['paused'] = true;
  try {
    if (activeTab === 'url') {
      const url = document.getElementById('torrentUrl').value.trim();
      if (!url) { toast('Enter a URL or magnet link', 'error'); return; }
      await rpc.addByUrl(url, opts);
    } else {
      if (!selectedFile) { toast('Select a .torrent file', 'error'); return; }
      await rpc.addByFile(await fileToBase64(selectedFile), opts);
    }
    toast('Torrent added', 'success');
    closeAdd(); quickRefresh();
  } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
});

// ════════════════════════════════════════════════════════
//  Remove modal
// ════════════════════════════════════════════════════════
const removeModal = document.getElementById('removeModal');

function openRemoveModal(ids, presetDelete) {
  pendingRemoveIds = ids;
  const t = ids.length === 1 ? torrents.find((t) => t.id === ids[0]) : null;
  document.getElementById('removeModalText').textContent =
    t ? `Remove "${t.name}"?` : `Remove ${ids.length} torrents?`;
  document.getElementById('deleteData').checked = presetDelete ?? false;
  removeModal.classList.add('open');
}
function closeRemove() { removeModal.classList.remove('open'); pendingRemoveIds = []; }
document.getElementById('removeModalClose').addEventListener('click', closeRemove);
document.getElementById('removeCancelBtn').addEventListener('click', closeRemove);
removeModal.addEventListener('click', (e) => { if (e.target === removeModal) closeRemove(); });

document.getElementById('removeConfirmBtn').addEventListener('click', async () => {
  if (!pendingRemoveIds.length) return;
  const del = document.getElementById('deleteData').checked;
  try {
    await rpc.removeTorrent(pendingRemoveIds, del);
    pendingRemoveIds.forEach((id) => selectedIds.delete(id));
    toast(pendingRemoveIds.length === 1 ? 'Torrent removed' : `${pendingRemoveIds.length} torrents removed`, 'success');
    closeRemove(); quickRefresh();
  } catch (err) { toast(`Failed: ${err.message}`, 'error'); }
});

// ════════════════════════════════════════════════════════
//  Global drag & drop
// ════════════════════════════════════════════════════════
const dragOverlay = document.getElementById('dragOverlay');
let dragCounter = 0;
window.addEventListener('dragenter', (e) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); dragCounter++; dragOverlay.classList.add('active'); });
window.addEventListener('dragleave', () => { if (--dragCounter <= 0) { dragCounter = 0; dragOverlay.classList.remove('active'); } });
window.addEventListener('dragover',  (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', async (e) => {
  e.preventDefault(); dragCounter = 0; dragOverlay.classList.remove('active');
  const files = [...e.dataTransfer.files].filter((f) => f.name.endsWith('.torrent'));
  if (!files.length) return;
  let added = 0;
  for (const f of files) {
    try { await rpc.addByFile(await fileToBase64(f), {}); added++; }
    catch (err) { toast(`Failed: ${f.name}`, 'error'); }
  }
  if (added) { toast(added === 1 ? 'Torrent added' : `${added} torrents added`, 'success'); quickRefresh(); }
});

// ════════════════════════════════════════════════════════
//  Toast
// ════════════════════════════════════════════════════════
const toastContainer = document.getElementById('toastContainer');
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ════════════════════════════════════════════════════════
//  Keyboard shortcuts
// ════════════════════════════════════════════════════════
document.addEventListener('keydown', (e) => {
  const inInput = e.target.matches('input, textarea, select');
  if (e.key === 'Escape') {
    if (detailsModal.classList.contains('open')) { closeDetails(); return; }
    if (settingsModal.classList.contains('open')) { closeSettings(); return; }
    if (addModal.classList.contains('open'))     { closeAdd();      return; }
    if (removeModal.classList.contains('open'))  { closeRemove();   return; }
    if (ctxMenu.classList.contains('open'))      { closeCtxMenu();  return; }
    if (selectedIds.size > 0) { selectedIds.clear(); lastClickIdx = -1; render(); return; }
  }
  if (inInput) return;
  if (e.key === 'a' || e.key === 'A') openAdd();
  if (e.key === '/') { e.preventDefault(); document.getElementById('searchInput').focus(); }
  if (e.key === 'Delete' && selectedIds.size > 0) openRemoveModal([...selectedIds]);
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); sortedFiltered().forEach((t) => selectedIds.add(t.id)); render(); }
});

// ════════════════════════════════════════════════════════
//  Init
// ════════════════════════════════════════════════════════
renderBwPresets();
loadSession();
poll();
