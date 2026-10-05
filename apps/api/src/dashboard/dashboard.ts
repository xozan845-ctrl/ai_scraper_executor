/**
 * Dashboard FASE 9 — SPA en un solo HTML (sin build frontend).
 * Se sirve en /api/v1/dashboard y consume la API §42 con fetch relativo.
 * Muestra: jobs, estados, páginas, comandos, resultados, errores,
 * decisiones IA y métricas §56.
 */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>AI Scraping Executor — Dashboard</title>
<style>
:root { color-scheme: dark; }
body { font-family: system-ui, sans-serif; background: #0f1420; color: #e6e9f0; margin: 0; padding: 16px; }
h1 { font-size: 20px; margin: 0 0 4px; }
.sub { color: #8b93a7; font-size: 13px; margin-bottom: 16px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 16px; }
.card { background: #1a2133; border: 1px solid #2a3450; border-radius: 8px; padding: 10px 12px; }
.card .k { font-size: 11px; color: #8b93a7; text-transform: uppercase; }
.card .v { font-size: 22px; font-weight: 700; }
.panel { background: #1a2133; border: 1px solid #2a3450; border-radius: 8px; padding: 12px; margin-bottom: 16px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #2a3450; vertical-align: top; }
th { color: #8b93a7; font-weight: 600; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 700; }
.QUEUED { background: #3a3f1a; color: #e3d76a; } .PLANNING, .EXECUTING, .EXPLORING { background: #173a5e; color: #6ab8e3; }
.COMPLETED { background: #17452e; color: #6ae3a1; } .FAILED { background: #5e1a1a; color: #e36a6a; }
.CANCELLED { background: #3a3a3a; color: #aaa; } .OK { background: #17452e; color: #6ae3a1; }
.RECOVERED { background: #4a3a17; color: #e3b86a; }
button { background: #2f6fed; color: #fff; border: 0; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
button.ghost { background: transparent; border: 1px solid #2a3450; }
input, select, textarea { background: #0f1420; color: #e6e9f0; border: 1px solid #2a3450; border-radius: 6px; padding: 6px 8px; font-size: 13px; }
form.new { display: grid; grid-template-columns: 2fr 3fr auto; gap: 8px; }
pre { background: #0f1420; padding: 8px; border-radius: 6px; overflow: auto; max-height: 320px; font-size: 12px; }
.tabs button { margin-right: 6px; } .tabs button.active { background: #1d4fb8; }
.mono { font-family: monospace; font-size: 12px; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
</style>
</head>
<body>
<h1>AI Web Scraping Executor</h1>
<div class="sub">Dashboard FASE 9 · <span id="backend">—</span> · auto-refresh <input type="checkbox" id="auto" checked/></div>

<div class="cards" id="metrics"></div>

<div class="panel">
<h3>Nuevo job</h3>
<form class="new" id="newjob">
<input id="f-url" placeholder="https://sitio.com" required/>
<input id="f-ins" placeholder="Obtén todos los productos" required/>
<button type="submit">Ejecutar</button>
</form>
<div class="sub" id="newmsg"></div>
</div>

<div class="panel">
<h3>Jobs <button class="ghost" onclick="loadAll()">↻</button></h3>
<table><thead><tr><th>ID</th><th>URL</th><th>Estado</th><th>Proveedor</th><th>Creado</th><th></th></tr></thead>
<tbody id="jobs"></tbody></table>
</div>

<div class="panel" id="detail" style="display:none">
<h3>Detalle <span class="mono" id="did"></span> <span id="dstatus"></span></h3>
<div class="tabs" id="tabs"></div>
<div id="tbody"></div>
</div>

<script>
var current = null, tab = 'execution';
function apiKey() { try { return sessionStorage.getItem('apiKey') || ''; } catch (e) { return ''; } }
function api(p, opts) {
  opts = opts || {};
  var k = apiKey();
  opts.headers = Object.assign({}, opts.headers, k ? { 'x-api-key': k } : {});
  return fetch(p, opts).then(function(r) {
    if (r.status === 401) {
      var nk = window.prompt('API key requerida:');
      if (nk) { try { sessionStorage.setItem('apiKey', nk); } catch (e) {} return api(p, opts); }
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function badge(s) { return '<span class="badge ' + s + '">' + s + '</span>'; }

function loadMetrics() {
  api('metrics').then(function(m) {
    document.getElementById('backend').textContent = 'store=' + m.store + ' queue=' + m.queue + ' pending=' + m.pendingJobs;
    var s = m.stats, by = s.jobsByStatus || {};
    var cards = [['Jobs', s.jobsTotal], ['Queued', by.QUEUED || 0], ['Running', (by.PLANNING || 0) + (by.EXECUTING || 0) + (by.EXPLORING || 0)],
      ['Completed', by.COMPLETED || 0], ['Failed', by.FAILED || 0], ['Items', s.resultsTotal], ['Pages', s.pagesTotal],
      ['Commands', s.commandsTotal], ['Recovery rate', (m.aiRecoveryRate * 100).toFixed(1) + '%'],
      ['AI calls', s.aiCallsTotal], ['AI tokens', s.aiTokensTotal]];
    document.getElementById('metrics').innerHTML = cards.map(function(c) {
      return '<div class="card"><div class="k">' + c[0] + '</div><div class="v">' + c[1] + '</div></div>';
    }).join('');
  }).catch(function(e) { document.getElementById('backend').textContent = 'error: ' + e.message; });
}

function loadJobs() {
  api('jobs?limit=50').then(function(res) {
    var list = (res && res.items) ? res.items : res;
    document.getElementById('jobs').innerHTML = list.map(function(j) {
      return '<tr><td class="mono">' + esc(j.id) + '</td><td>' + esc((j.url || '').slice(0, 60)) + '<br/><span class="sub">' + esc((j.instruction || '').slice(0, 80)) + '</span></td>' +
        '<td>' + badge(j.status) + '</td><td class="mono">' + esc(j.aiProvider || '') + '</td><td class="mono">' + esc((j.createdAt || '').slice(0, 19).replace('T', ' ')) + '</td>' +
        '<td><button class="ghost" onclick="showDetail(\\'' + j.id + '\\')">ver</button> ' +
        '<button class="ghost" onclick="cancelJob(\\'' + j.id + '\\')">cancelar</button></td></tr>';
    }).join('');
  });
}

function cancelJob(id) { api('jobs/' + id + '/cancel', { method: 'POST' }).then(loadAll).catch(alert); }

function showDetail(id) {
  current = id; tab = 'execution';
  document.getElementById('detail').style.display = 'block';
  document.getElementById('did').textContent = id;
  renderTabs(); renderTab();
  api('jobs/' + id).then(function(j) { document.getElementById('dstatus').innerHTML = badge(j.status); });
}

function renderTabs() {
  var tabs = ['execution', 'results', 'ai'];
  document.getElementById('tabs').innerHTML = tabs.map(function(t) {
    return '<button class="' + (t === tab ? 'active' : 'ghost') + '" onclick="tab=\\'' + t + '\\';renderTabs();renderTab()">' + t + '</button>';
  }).join('');
}

function renderTab() {
  var box = document.getElementById('tbody');
  box.innerHTML = '<div class="sub">cargando…</div>';
  if (tab === 'execution') {
    api('jobs/' + current + '/execution').then(function(e) {
      var h = '<h4>Comandos (' + e.commands.length + ')</h4><table><tr><th>#</th><th>Tipo</th><th>Estado</th></tr>' +
        e.commands.map(function(c, i) { return '<tr><td>' + (i + 1) + '</td><td class="mono">' + esc(c.type) + '</td><td>' + badge(c.status) + '</td></tr>'; }).join('') + '</table>';
      h += '<h4>Páginas (' + e.pages.length + ')</h4>' + e.pages.map(function(p) { return '<div class="mono">' + esc(p.url) + '</div>'; }).join('');
      h += '<h4>Errores (' + e.errors.length + ')</h4><pre>' + esc(JSON.stringify(e.errors, null, 1).slice(0, 4000)) + '</pre>';
      box.innerHTML = h;
    }).catch(function(err) { box.textContent = String(err); });
  } else if (tab === 'results') {
    api('jobs/' + current + '/results').then(function(r) {
      box.innerHTML = '<h4>Items (' + r.count + ')</h4><pre>' + esc(JSON.stringify(r.items, null, 1).slice(0, 12000)) + '</pre>';
    }).catch(function(err) { box.textContent = String(err); });
  } else {
    api('jobs/' + current + '/ai').then(function(a) {
      box.innerHTML = '<h4>Proveedor: ' + esc(a.provider) + ' · Modelo: ' + esc(a.model || '-') + ' · Llamadas: ' + a.calls.length + '</h4>' +
        '<table><tr><th>Kind</th><th>Modelo</th><th>Tokens</th><th>Latencia ms</th></tr>' +
        a.calls.map(function(c) { return '<tr><td class="mono">' + esc(c.kind) + '</td><td class="mono">' + esc(c.model || '-') + '</td><td>' + (c.tokens == null ? '-' : c.tokens) + '</td><td>' + (c.latencyMs == null ? '-' : c.latencyMs) + '</td></tr>'; }).join('') + '</table>';
    }).catch(function(err) { box.textContent = String(err); });
  }
}

document.getElementById('newjob').addEventListener('submit', function(e) {
  e.preventDefault();
  var body = { url: document.getElementById('f-url').value, instruction: document.getElementById('f-ins').value };
  api('jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function(j) { document.getElementById('newmsg').textContent = 'Creado ' + j.id; loadAll(); showDetail(j.id); })
    .catch(function(err) { document.getElementById('newmsg').textContent = String(err); });
});

function loadAll() { loadMetrics(); loadJobs(); if (current) renderTab(); }
function tick() { if (document.getElementById('auto').checked) loadAll(); }
loadAll(); setInterval(tick, 5000);
</script>
</body>
</html>`;
