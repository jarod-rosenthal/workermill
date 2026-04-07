export const LIVE_VIEW_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WorkerMill Live View</title>
  <style>
    :root {
      --bg: #0e1116;
      --panel: #151a22;
      --panel-2: #1b2330;
      --border: #263246;
      --muted: #8ca1bd;
      --text: #e6edf7;
      --ok: #3fb950;
      --warn: #d29922;
      --danger: #f85149;
      --accent: #58a6ff;
      --added-bg: rgba(46, 160, 67, 0.22);
      --removed-bg: rgba(248, 81, 73, 0.22);
      --hunk-bg: rgba(56, 139, 253, 0.15);
      --code: #dce6f3;
      --sidebar-w: 180px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: "SF Pro Text", "Segoe UI", "Inter", system-ui, -apple-system, sans-serif;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      background: rgba(14, 17, 22, 0.95);
      backdrop-filter: blur(8px);
      flex-shrink: 0;
      z-index: 10;
    }

    .header-left { display: flex; align-items: center; gap: 14px; }
    .title { font-size: 15px; font-weight: 700; letter-spacing: 0.2px; white-space: nowrap; }

    .header-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

    .pill {
      font-size: 11px;
      padding: 4px 9px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--muted);
      white-space: nowrap;
      line-height: 1;
    }

    .status {
      font-size: 11px;
      color: var(--ok);
      background: rgba(63, 185, 80, 0.12);
      border: 1px solid rgba(63, 185, 80, 0.3);
      border-radius: 999px;
      padding: 4px 9px;
      white-space: nowrap;
    }

    .view-toggle {
      display: flex;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
    }
    .view-toggle button {
      appearance: none;
      border: none;
      background: var(--panel-2);
      color: var(--muted);
      font-size: 11px;
      padding: 5px 10px;
      cursor: pointer;
      transition: 100ms;
    }
    .view-toggle button:hover { color: var(--text); }
    .view-toggle button.active {
      background: rgba(88, 166, 255, 0.18);
      color: var(--accent);
    }
    .view-toggle button + button { border-left: 1px solid var(--border); }

    .btn {
      appearance: none;
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      background: var(--panel-2);
      padding: 5px 10px;
      font-size: 11px;
      cursor: pointer;
      transition: 100ms;
    }
    .btn:hover { border-color: #3f5677; background: #202b3b; }
    .btn.stop {
      border-color: rgba(248, 81, 73, 0.4);
      background: rgba(248, 81, 73, 0.14);
      color: #ffd1d1;
    }
    .btn.stop:hover {
      border-color: rgba(248, 81, 73, 0.65);
      background: rgba(248, 81, 73, 0.2);
    }

    /* ── Main layout ── */
    .main {
      display: flex;
      flex: 1;
      min-height: 0;
    }

    /* ── Sidebar ── */
    .sidebar {
      width: var(--sidebar-w);
      flex-shrink: 0;
      border-right: 1px solid var(--border);
      background: rgba(21, 26, 34, 0.5);
      overflow-y: auto;
      overflow-x: hidden;
    }

    .sidebar-item {
      display: block;
      width: 100%;
      text-align: left;
      border: none;
      background: none;
      color: var(--text);
      padding: 8px 10px;
      border-bottom: 1px solid rgba(38, 50, 70, 0.4);
      cursor: pointer;
      transition: background 80ms;
      font-family: inherit;
    }
    .sidebar-item:hover { background: rgba(88, 166, 255, 0.06); }
    .sidebar-item.selected {
      background: rgba(88, 166, 255, 0.1);
      border-left: 2px solid var(--accent);
      padding-left: 8px;
    }

    .sidebar-item .file-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .sidebar-item .file-icon {
      width: 12px;
      height: 12px;
      flex-shrink: 0;
      border-radius: 2px;
    }
    .sidebar-item .file-icon.write { color: var(--ok); }
    .sidebar-item .file-icon.edit { color: var(--warn); }

    .sidebar-item .file-name {
      font-family: "Cascadia Code", "SF Mono", Menlo, monospace;
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sidebar-item .file-persona {
      font-size: 10px;
      flex-shrink: 0;
    }

    .sidebar-item .file-dir {
      font-size: 10px;
      color: var(--muted);
      margin-top: 2px;
      padding-left: 18px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sidebar-item.all-files {
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      padding: 10px;
    }
    .sidebar-item.all-files .count {
      font-weight: 400;
      opacity: 0.7;
    }

    /* ── Stream panel ── */
    .stream-panel {
      flex: 1;
      min-width: 0;
      overflow-y: auto;
      padding: 16px;
    }

    .empty {
      border: 1px dashed var(--border);
      border-radius: 10px;
      padding: 32px 20px;
      text-align: center;
      color: var(--muted);
      background: rgba(21, 26, 34, 0.5);
      font-size: 13px;
    }

    .stream { display: flex; flex-direction: column; gap: 12px; }

    /* ── Change card ── */
    .change-card {
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      background: var(--panel);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.18);
    }

    .card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.015);
      flex-wrap: wrap;
    }

    .head-left, .head-right { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

    .path-btn {
      font-family: "Cascadia Code", "SF Mono", Menlo, monospace;
      font-size: 12px;
      color: #c7d7ef;
      background: rgba(88, 166, 255, 0.1);
      border: 1px solid rgba(88, 166, 255, 0.28);
      border-radius: 6px;
      padding: 2px 7px;
      cursor: pointer;
      transition: 80ms;
    }
    .path-btn:hover { background: rgba(88, 166, 255, 0.18); }

    .badge {
      font-size: 10px;
      border-radius: 999px;
      padding: 2px 7px;
      border: 1px solid transparent;
    }
    .badge.created { border-color: rgba(63, 185, 80, 0.4); background: rgba(63, 185, 80, 0.14); color: #b4f3be; }
    .badge.edited { border-color: rgba(210, 153, 34, 0.4); background: rgba(210, 153, 34, 0.13); color: #ffdca3; }
    .badge.persona { border-color: rgba(88, 166, 255, 0.4); background: rgba(88, 166, 255, 0.13); color: #cae2ff; }
    .badge.story { border-color: rgba(140, 161, 189, 0.35); background: rgba(140, 161, 189, 0.1); color: #c9d8ea; }
    .badge.time { color: var(--muted); }

    /* ── Diff table ── */
    .diff {
      overflow-x: auto;
      font-family: "Cascadia Code", "SF Mono", Menlo, monospace;
      font-size: 12px;
      line-height: 1.45;
    }

    .diff table { width: 100%; border-collapse: collapse; }
    .diff td { vertical-align: top; padding: 0; border: 0; }

    .diff td.num {
      width: 44px;
      min-width: 44px;
      text-align: right;
      color: rgba(140, 161, 189, 0.35);
      user-select: none;
      padding: 0 8px;
      border-right: 1px solid rgba(38, 50, 70, 0.5);
      background: rgba(14, 17, 22, 0.4);
    }

    .diff td.prefix {
      width: 18px;
      min-width: 18px;
      text-align: center;
      user-select: none;
    }
    .diff tr.add td.prefix { color: var(--ok); }
    .diff tr.del td.prefix { color: var(--danger); }
    .diff td.prefix { color: rgba(140, 161, 189, 0.25); }

    .diff td.code {
      color: var(--code);
      white-space: pre;
      padding: 0 10px;
    }

    .diff tr.context td.code { background: transparent; }
    .diff tr.add td.code { background: var(--added-bg); }
    .diff tr.del td.code { background: var(--removed-bg); }
    .diff tr.hunk td {
      background: var(--hunk-bg);
      color: #9ec4ff;
      padding: 2px 10px;
      border-top: 1px solid rgba(88, 166, 255, 0.2);
      border-bottom: 1px solid rgba(88, 166, 255, 0.2);
    }
    .diff tr.meta td { color: #7a8da5; background: rgba(21, 26, 34, 0.7); padding: 1px 10px; }
    .diff tr.empty-row td { height: 1.45em; }

    /* Split view */
    .split-wrap { display: flex; }
    .split-wrap .split-side { flex: 1; min-width: 0; overflow-x: auto; }
    .split-wrap .split-side + .split-side { border-left: 1px solid var(--border); }
    .split-wrap .split-side table { width: 100%; }

    .no-diff { padding: 12px; color: var(--muted); font-size: 12px; }

    /* ── Responsive ── */
    @media (max-width: 900px) {
      .sidebar { display: none; }
      .header { padding: 8px 12px; }
      .stream-panel { padding: 10px; }
    }

  </style>
  <link rel="stylesheet" href="/prism-theme.css">
</head>
<body>
  <div class="header">
    <div class="header-left">
      <span class="title">WorkerMill Live View</span>
      <span id="storyPill" class="pill" style="display:none"></span>
      <span id="status" class="status">Connecting...</span>
    </div>
    <div class="header-right">
      <div class="view-toggle">
        <button id="unifiedBtn" class="active" onclick="setViewMode('unified')">Unified</button>
        <button id="splitBtn" onclick="setViewMode('split')">Split</button>
      </div>
      <button id="followBtn" class="btn" onclick="toggleFollow()">Follow: ON</button>
      <button id="stopBtn" class="btn stop" onclick="abortRun()">Stop</button>
    </div>
  </div>

  <div class="main">
    <div id="sidebar" class="sidebar">
      <button class="sidebar-item all-files selected" onclick="selectFile(null)">
        All files <span class="count" id="allCount">(0)</span>
      </button>
    </div>

    <div id="streamPanel" class="stream-panel">
      <div id="empty" class="empty">Waiting for story execution and file changes...</div>
      <div id="stream" class="stream"></div>
    </div>
  </div>

  <script>
    /* ── State ── */
    var state = {
      stories: {},
      totalStories: 0,
      changes: [],
      files: {},        /* filePath -> { lastTouched, lastTool, persona, changeCount } */
      selectedFile: null,
      viewMode: 'unified',
      followLatest: true,
      runComplete: false,
      branch: '',
      commitCount: 0,
    };

    /* ── DOM refs ── */
    var statusEl     = document.getElementById('status');
    var storyPill    = document.getElementById('storyPill');
    var streamPanel  = document.getElementById('streamPanel');
    var streamEl     = document.getElementById('stream');
    var emptyEl      = document.getElementById('empty');
    var sidebarEl    = document.getElementById('sidebar');
    var allCountEl   = document.getElementById('allCount');

    /* ── Language map ── */
    var EXT_LANG = {
      ts:'typescript',tsx:'tsx',js:'javascript',jsx:'jsx',
      py:'python',rb:'ruby',rs:'rust',go:'go',java:'java',kt:'kotlin',swift:'swift',
      css:'css',scss:'scss',html:'markup',htm:'markup',
      json:'json',yaml:'yaml',yml:'yaml',toml:'toml',xml:'xml',graphql:'graphql',
      md:'markdown',sql:'sql',sh:'bash',bash:'bash',zsh:'bash',
      env:'bash',prisma:'javascript',
    };

    function getLang(filePath) {
      var base = filePath.split('/').pop() || '';
      var lower = base.toLowerCase();
      if (lower === 'dockerfile') return 'docker';
      if (lower === 'makefile') return 'makefile';
      var ext = base.split('.').pop();
      return ext ? (EXT_LANG[ext.toLowerCase()] || 'text') : 'text';
    }

    /* ── Syntax highlighting ── */
    function highlight(code, lang) {
      if (typeof Prism !== 'undefined' && Prism.languages[lang]) {
        try { return Prism.highlight(code, Prism.languages[lang], lang); }
        catch(e) { /* fallback */ }
      }
      return escapeHtml(code);
    }

    /* ── SSE / Polling (polling-first fail-safe) ── */
    var eventSource = null;
    var sseConnected = false;
    var pollingStarted = false;
    var pollingInterval = null;
    var lastPolledIndex = 0;

    function markConnected(label) {
      statusEl.textContent = label || 'Connected';
      statusEl.style.color = '#b4f3be';
    }

    function startPolling() {
      if (pollingStarted) return;
      pollingStarted = true;
      markConnected('Connected (polling)');
      pollingInterval = setInterval(function() {
        fetch('/events-snapshot')
          .then(function(r) { return r.json(); })
          .then(function(events) {
            for (var i = lastPolledIndex; i < events.length; i++) handleEvent(events[i]);
            lastPolledIndex = events.length;
          })
          .catch(function() {});
      }, 2000);
    }

    // Never remain in a perpetual "Connecting..." state.
    // Polling starts immediately; SSE is best-effort for lower latency.
    startPolling();

    try {
      eventSource = new EventSource('/events');
    } catch (e) {
      // Keep polling-only mode.
    }

    if (eventSource) {
      eventSource.onopen = function() { sseConnected = true; markConnected('Connected'); };

      eventSource.onerror = function() {
        if (sseConnected) {
          statusEl.textContent = 'Disconnected — reconnecting...';
          statusEl.style.color = '#ffdca3';
          setTimeout(function() { location.reload(); }, 1000);
        } else {
          try { eventSource.close(); } catch (e) {}
        }
      };

      eventSource.onmessage = function(e) {
        sseConnected = true;
        try {
          handleEvent(JSON.parse(e.data));
        } catch (err) {
          // Ignore malformed frames instead of freezing the live view.
        }
      };
    }

    // If SSE still hasn't opened after startup, stick to polling.
    // (No-op because polling is already active.)
    setTimeout(function() {
      if (!sseConnected && eventSource) {
        try { eventSource.close(); } catch (e) {}
      }
    }, 3000);

    /* ── Event handler ── */
    function handleEvent(event) {
      if (statusEl.textContent.indexOf('Connected') !== 0 && event.type !== 'ready') markConnected('Connected');

      if (event.type === 'ready') {
        statusEl.textContent = 'Connected — waiting for execution';
        statusEl.style.color = '#b4f3be';
        return;
      }

      if (event.type === 'story-start') {
        state.stories[event.storyIndex] = { title: event.storyTitle, persona: event.persona, status: 'active', elapsed: 0 };
        state.totalStories = event.total || state.totalStories;
        statusEl.textContent = 'Story ' + event.storyIndex + '/' + event.total + ' — ' + event.persona;
        statusEl.style.color = '#b4f3be';
        updateStoryPill();
        return;
      }

      if (event.type === 'story-complete') {
        if (state.stories[event.storyIndex]) {
          state.stories[event.storyIndex].status = 'done';
          state.stories[event.storyIndex].elapsed = event.elapsed || 0;
        }
        updateStoryPill();
        return;
      }

      if (event.type === 'file-changed') {
        var fp = event.filePath;
        state.changes.unshift({
          id: String(event.timestamp) + ':' + fp + ':' + state.changes.length,
          timestamp: event.timestamp,
          persona: event.persona,
          storyIndex: event.storyIndex,
          storyTitle: event.storyTitle,
          filePath: fp,
          tool: event.tool,
          parsed: parseUnifiedDiff(event.diff || ''),
          hasDiff: !!(event.diff && event.diff.trim().length > 0),
        });

        if (!state.files[fp]) {
          state.files[fp] = { lastTouched: event.timestamp, lastTool: event.tool, persona: event.persona, changeCount: 1 };
        } else {
          state.files[fp].lastTouched = event.timestamp;
          state.files[fp].lastTool = event.tool;
          state.files[fp].persona = event.persona;
          state.files[fp].changeCount += 1;
        }

        if (state.followLatest) state.selectedFile = null;

        renderSidebar();
        renderStream();
        return;
      }

      if (event.type === 'run-complete') {
        state.runComplete = true;
        state.branch = event.branch || '';
        state.commitCount = event.commitCount || 0;
        statusEl.textContent = 'Complete — ' + state.commitCount + ' commits on ' + state.branch;
        statusEl.style.color = '#9ec4ff';
        updateStoryPill();
        renderStream();
      }
    }

    /* ── Story pill ── */
    function updateStoryPill() {
      var completed = Object.values(state.stories).filter(function(s) { return s && s.status === 'done'; }).length;
      var total = state.totalStories || Object.keys(state.stories).length;
      if (total > 0) {
        storyPill.textContent = 'stories: ' + completed + '/' + total;
        storyPill.style.display = '';
      }
    }

    /* ── Sidebar rendering ── */
    function renderSidebar() {
      var sorted = Object.keys(state.files).sort(function(a, b) {
        return state.files[b].lastTouched - state.files[a].lastTouched;
      });

      allCountEl.textContent = '(' + state.changes.length + ')';

      var html = '<button class="sidebar-item all-files' + (!state.selectedFile ? ' selected' : '') + '" onclick="selectFile(null)">All files <span class="count">(' + state.changes.length + ')</span></button>';

      for (var i = 0; i < sorted.length; i++) {
        var fp = sorted[i];
        var info = state.files[fp];
        var basename = fp.split('/').pop() || fp;
        var dirParts = fp.split('/'); dirParts.pop();
        var dir = dirParts.join('/') || '.';
        var sel = state.selectedFile === fp ? ' selected' : '';
        var iconSvg = info.lastTool === 'created'
          ? '<svg class="file-icon write" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 14l3-1L13.5 4.5a1.4 1.4 0 00-2-2L3 11l-1 3z"/></svg>'
          : '<svg class="file-icon edit" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z"/></svg>';

        html += '<button class="sidebar-item' + sel + '" onclick="selectFile(' + JSON.stringify(fp) + ')">'
          + '<div class="file-row">' + iconSvg
          + '<span class="file-name">' + escapeHtml(basename) + '</span>'
          + (info.persona ? '<span class="file-persona">' + escapeHtml(info.persona.split('_').map(function(w){return w[0]||''}).join('').toUpperCase()) + '</span>' : '')
          + '</div>'
          + '<div class="file-dir">' + escapeHtml(dir) + '</div>'
          + '</button>';
      }

      sidebarEl.innerHTML = html;
    }

    /* ── Stream rendering ── */
    function renderStream() {
      var filtered = state.changes.filter(function(c) {
        return !state.selectedFile || c.filePath === state.selectedFile;
      });

      if (filtered.length === 0) {
        var active = Object.values(state.stories).filter(function(s) { return s && s.status === 'active'; }).length;
        var started = Object.keys(state.stories).length > 0;

        if (state.runComplete) emptyEl.textContent = 'Run complete — no diffs captured.';
        else if (active > 0) emptyEl.textContent = 'Story executing — waiting for the first file edit...';
        else if (started) emptyEl.textContent = 'Stories executed, but no diffs have arrived yet.';
        else emptyEl.textContent = 'Waiting for story execution and file changes...';
        emptyEl.style.display = 'block';
      } else {
        emptyEl.style.display = 'none';
      }

      streamEl.innerHTML = filtered.map(renderChangeCard).join('');
    }

    function renderChangeCard(change) {
      var time = new Date(change.timestamp).toLocaleTimeString();
      var lang = getLang(change.filePath);
      var diffHtml = state.viewMode === 'split'
        ? renderSplitDiff(change.parsed, lang)
        : renderUnifiedDiff(change.parsed, lang);

      if (!diffHtml) diffHtml = '<div class="no-diff">No textual diff available.</div>';

      return '<article class="change-card">'
        + '<div class="card-head">'
        + '<div class="head-left">'
        + '<button class="path-btn" onclick="selectFile(' + JSON.stringify(change.filePath) + ')">' + escapeHtml(change.filePath) + '</button>'
        + '<span class="badge ' + (change.tool === 'created' ? 'created' : 'edited') + '">' + escapeHtml(change.tool) + '</span>'
        + '<span class="badge persona">' + escapeHtml(change.persona) + '</span>'
        + '<span class="badge story">Story ' + change.storyIndex + '</span>'
        + '</div>'
        + '<div class="head-right"><span class="badge time">' + escapeHtml(time) + '</span></div>'
        + '</div>'
        + '<div class="diff">' + diffHtml + '</div>'
        + '</article>';
    }

    /* ── Unified diff rendering ── */
    function renderUnifiedDiff(parsed, lang) {
      if (!parsed || !parsed.length) return '';
      var html = '<table><tbody>';
      for (var i = 0; i < parsed.length; i++) {
        var row = parsed[i];
        if (row.type === 'hunk') {
          html += '<tr class="hunk"><td colspan="4">' + escapeHtml(row.text) + '</td></tr>';
          continue;
        }
        if (row.type === 'meta') {
          html += '<tr class="meta"><td colspan="4">' + escapeHtml(row.text) + '</td></tr>';
          continue;
        }
        var cls = row.type === 'add' ? 'add' : row.type === 'del' ? 'del' : 'context';
        var prefix = row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' ';
        html += '<tr class="' + cls + '">'
          + '<td class="num">' + (row.oldNum == null ? '' : row.oldNum) + '</td>'
          + '<td class="num">' + (row.newNum == null ? '' : row.newNum) + '</td>'
          + '<td class="prefix">' + prefix + '</td>'
          + '<td class="code">' + highlight(row.text, lang) + '</td>'
          + '</tr>';
      }
      html += '</tbody></table>';
      return html;
    }

    /* ── Split diff rendering ── */
    function renderSplitDiff(parsed, lang) {
      if (!parsed || !parsed.length) return '';

      /* Build left/right row pairs from the parsed unified diff.
         Consecutive del+add blocks are aligned side-by-side. */
      var left = [], right = [];
      var i = 0;
      while (i < parsed.length) {
        var row = parsed[i];

        if (row.type === 'hunk' || row.type === 'meta') {
          left.push(row); right.push(row); i++; continue;
        }
        if (row.type === 'context') {
          left.push(row); right.push(row); i++; continue;
        }

        if (row.type === 'del') {
          var delStart = i;
          while (i < parsed.length && parsed[i].type === 'del') i++;
          var addStart = i;
          while (i < parsed.length && parsed[i].type === 'add') i++;
          var delCount = addStart - delStart;
          var addCount = i - addStart;
          var maxCount = Math.max(delCount, addCount);
          for (var j = 0; j < maxCount; j++) {
            left.push(j < delCount ? parsed[delStart + j] : null);
            right.push(j < addCount ? parsed[addStart + j] : null);
          }
        } else if (row.type === 'add') {
          left.push(null);
          right.push(row);
          i++;
        } else {
          i++;
        }
      }

      var leftHtml = '<table>';
      var rightHtml = '<table>';
      for (var k = 0; k < left.length; k++) {
        var l = left[k], r = right[k];

        if (l && (l.type === 'hunk' || l.type === 'meta')) {
          var cls = l.type;
          leftHtml += '<tr class="' + cls + '"><td colspan="3">' + escapeHtml(l.text) + '</td></tr>';
          rightHtml += '<tr class="' + cls + '"><td colspan="3">' + escapeHtml(l.text) + '</td></tr>';
          continue;
        }

        /* Left side */
        if (l) {
          var lCls = l.type === 'del' ? 'del' : 'context';
          leftHtml += '<tr class="' + lCls + '"><td class="num">' + (l.oldNum == null ? '' : l.oldNum) + '</td><td class="prefix">' + (l.type === 'del' ? '-' : ' ') + '</td><td class="code">' + highlight(l.text, lang) + '</td></tr>';
        } else {
          leftHtml += '<tr class="empty-row"><td class="num"></td><td class="prefix"></td><td class="code"></td></tr>';
        }

        /* Right side */
        if (r) {
          var rCls = r.type === 'add' ? 'add' : 'context';
          rightHtml += '<tr class="' + rCls + '"><td class="num">' + (r.newNum == null ? '' : r.newNum) + '</td><td class="prefix">' + (r.type === 'add' ? '+' : ' ') + '</td><td class="code">' + highlight(r.text, lang) + '</td></tr>';
        } else {
          rightHtml += '<tr class="empty-row"><td class="num"></td><td class="prefix"></td><td class="code"></td></tr>';
        }
      }
      leftHtml += '</table>';
      rightHtml += '</table>';

      return '<div class="split-wrap"><div class="split-side">' + leftHtml + '</div><div class="split-side">' + rightHtml + '</div></div>';
    }

    /* ── Unified diff parser (kept from current implementation) ── */
    function parseUnifiedDiff(diffText) {
      if (!diffText || !diffText.trim()) return [];
      var lines = diffText.split(String.fromCharCode(10));
      var rows = [];
      var oldLine = 0, newLine = 0;

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.startsWith('@@')) {
          var m = /@@\\s+-(\\d+)(?:,\\d+)?\\s+\\+(\\d+)(?:,\\d+)?\\s+@@/.exec(line);
          if (m) { oldLine = parseInt(m[1], 10); newLine = parseInt(m[2], 10); }
          rows.push({ type: 'hunk', text: line });
          continue;
        }
        if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('new file mode') || line.startsWith('deleted file mode')) {
          rows.push({ type: 'meta', text: line });
          continue;
        }
        if (line.startsWith('+')) { rows.push({ type: 'add', oldNum: null, newNum: newLine, text: line.slice(1) }); newLine++; continue; }
        if (line.startsWith('-')) { rows.push({ type: 'del', oldNum: oldLine, newNum: null, text: line.slice(1) }); oldLine++; continue; }
        rows.push({ type: 'context', oldNum: oldLine, newNum: newLine, text: line.startsWith(' ') ? line.slice(1) : line });
        oldLine++; newLine++;
      }
      return rows;
    }

    /* ── Actions ── */
    function selectFile(filePath) {
      state.selectedFile = filePath;
      if (filePath) state.followLatest = false;
      updateFollowBtn();
      renderSidebar();
      renderStream();
    }

    function toggleFollow() {
      state.followLatest = !state.followLatest;
      if (state.followLatest) state.selectedFile = null;
      updateFollowBtn();
      renderSidebar();
      renderStream();
    }

    function updateFollowBtn() {
      document.getElementById('followBtn').textContent = 'Follow: ' + (state.followLatest ? 'ON' : 'OFF');
    }

    function setViewMode(mode) {
      state.viewMode = mode;
      document.getElementById('unifiedBtn').className = mode === 'unified' ? 'active' : '';
      document.getElementById('splitBtn').className = mode === 'split' ? 'active' : '';
      renderStream();
    }

    function abortRun() {
      fetch('/abort', { method: 'POST' })
        .then(function() {
          statusEl.textContent = 'Stopping...';
          statusEl.style.color = '#ffdca3';
          document.getElementById('stopBtn').disabled = true;
        })
        .catch(function(err) { console.error('abort failed', err); });
    }

    function escapeHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    /* Expose to onclick handlers */
    window.selectFile = selectFile;
    window.toggleFollow = toggleFollow;
    window.setViewMode = setViewMode;
    window.abortRun = abortRun;
  </script>
</body>
  <script src="/prism.js" async></script>
</html>`;
