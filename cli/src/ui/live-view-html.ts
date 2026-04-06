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
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: radial-gradient(circle at top right, rgba(88, 166, 255, 0.14), transparent 35%), var(--bg);
      color: var(--text);
      font-family: "SF Pro Text", "Segoe UI", "Inter", system-ui, -apple-system, sans-serif;
      min-height: 100vh;
    }

    .header {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 20px;
      border-bottom: 1px solid var(--border);
      background: rgba(14, 17, 22, 0.92);
      backdrop-filter: blur(8px);
    }

    .title-wrap { display: flex; flex-direction: column; gap: 2px; }
    .title { font-size: 16px; font-weight: 700; letter-spacing: 0.2px; }
    .subtitle { font-size: 12px; color: var(--muted); }

    .header-right {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .status {
      font-size: 12px;
      color: var(--ok);
      background: rgba(63, 185, 80, 0.14);
      border: 1px solid rgba(63, 185, 80, 0.36);
      border-radius: 999px;
      padding: 5px 10px;
      white-space: nowrap;
    }

    .btn {
      appearance: none;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      background: var(--panel-2);
      padding: 7px 11px;
      font-size: 12px;
      cursor: pointer;
      transition: 120ms ease;
    }

    .btn:hover {
      border-color: #3f5677;
      background: #202b3b;
    }

    .btn.stop {
      border-color: rgba(248, 81, 73, 0.46);
      background: rgba(248, 81, 73, 0.16);
      color: #ffd1d1;
    }

    .btn.stop:hover {
      border-color: rgba(248, 81, 73, 0.7);
      background: rgba(248, 81, 73, 0.22);
    }

    .meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 10px 20px;
      border-bottom: 1px solid var(--border);
      background: rgba(21, 26, 34, 0.86);
    }

    .pill {
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--muted);
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      line-height: 1;
      cursor: default;
    }

    .pill.clickable { cursor: pointer; }
    .pill.clickable:hover { border-color: #3f5677; color: var(--text); }
    .pill.active { border-color: var(--accent); color: #d5e8ff; background: rgba(88, 166, 255, 0.14); }

    .stream-wrap {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      width: 100%;
    }

    .empty {
      border: 1px dashed var(--border);
      border-radius: 12px;
      padding: 28px 24px;
      text-align: center;
      color: var(--muted);
      background: rgba(21, 26, 34, 0.6);
    }

    .stream {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .change-card {
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      background: var(--panel);
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.22);
    }

    .card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.02);
      flex-wrap: wrap;
    }

    .head-left, .head-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .path {
      font-family: "Cascadia Code", "SF Mono", Menlo, monospace;
      font-size: 12px;
      color: #c7d7ef;
      background: rgba(88, 166, 255, 0.12);
      border: 1px solid rgba(88, 166, 255, 0.34);
      border-radius: 8px;
      padding: 3px 8px;
      cursor: pointer;
    }

    .path:hover { background: rgba(88, 166, 255, 0.2); }

    .badge {
      font-size: 11px;
      border-radius: 999px;
      padding: 3px 8px;
      border: 1px solid transparent;
      color: #e4ecf8;
    }

    .badge.created {
      border-color: rgba(63, 185, 80, 0.45);
      background: rgba(63, 185, 80, 0.16);
      color: #b4f3be;
    }

    .badge.edited {
      border-color: rgba(210, 153, 34, 0.48);
      background: rgba(210, 153, 34, 0.15);
      color: #ffdca3;
    }

    .badge.persona {
      border-color: rgba(88, 166, 255, 0.45);
      background: rgba(88, 166, 255, 0.16);
      color: #cae2ff;
    }

    .badge.story {
      border-color: rgba(140, 161, 189, 0.44);
      background: rgba(140, 161, 189, 0.14);
      color: #c9d8ea;
    }

    .badge.time {
      border-color: rgba(140, 161, 189, 0.36);
      color: var(--muted);
      background: rgba(140, 161, 189, 0.06);
    }

    .diff {
      overflow-x: auto;
      font-family: "Cascadia Code", "SF Mono", Menlo, monospace;
      font-size: 12px;
      line-height: 1.45;
    }

    table.diff-table {
      width: 100%;
      border-collapse: collapse;
      min-width: 820px;
    }

    .diff-table td {
      vertical-align: top;
      padding: 0;
      border: 0;
    }

    .diff-table td.num {
      width: 52px;
      text-align: right;
      color: #5f7392;
      user-select: none;
      padding: 0 10px;
      border-right: 1px solid rgba(38, 50, 70, 0.6);
      background: rgba(14, 17, 22, 0.5);
    }

    .diff-table td.code {
      color: var(--code);
      white-space: pre;
      padding: 0 12px;
    }

    .diff-table tr.context td.code { background: transparent; }
    .diff-table tr.add td.code { background: var(--added-bg); }
    .diff-table tr.del td.code { background: var(--removed-bg); }
    .diff-table tr.hunk td {
      background: var(--hunk-bg);
      color: #9ec4ff;
      border-top: 1px solid rgba(88, 166, 255, 0.25);
      border-bottom: 1px solid rgba(88, 166, 255, 0.25);
    }

    .diff-table tr.meta td {
      color: #92a7c5;
      background: rgba(21, 26, 34, 0.8);
    }

    .no-diff {
      padding: 12px;
      color: var(--muted);
      border-top: 1px solid var(--border);
      font-size: 12px;
    }

    @media (max-width: 900px) {
      .header { padding: 12px; }
      .meta { padding: 10px 12px; }
      .stream-wrap { padding: 12px; }
      .status { order: 3; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title-wrap">
      <div class="title">WorkerMill Live Diff</div>
      <div class="subtitle">Inline stream of line-level edits from active workers</div>
    </div>
    <div class="header-right">
      <div id="status" class="status">Connecting...</div>
      <button id="followBtn" class="btn" onclick="toggleFollow()">Follow latest: ON</button>
      <button id="stopBtn" class="btn stop" onclick="abortRun()">Stop</button>
    </div>
  </div>

  <div id="meta" class="meta"></div>

  <div class="stream-wrap">
    <div id="empty" class="empty">Waiting for story execution and file changes...</div>
    <div id="stream" class="stream"></div>
  </div>

  <script>
    var state = {
      stories: {},
      totalStories: 0,
      changes: [],
      activeFile: null,
      followLatest: true,
      runComplete: false,
      branch: "",
      commitCount: 0,
    };

    var statusEl = document.getElementById('status');
    var metaEl = document.getElementById('meta');
    var streamEl = document.getElementById('stream');
    var emptyEl = document.getElementById('empty');
    var followBtn = document.getElementById('followBtn');

    var eventSource = new EventSource('/events');
    var sseConnected = false;
    var pollingInterval = null;
    var lastPolledIndex = 0;

    function markConnected(label) {
      statusEl.textContent = label || 'Connected';
      statusEl.style.color = '#b4f3be';
    }

    eventSource.onopen = function() {
      sseConnected = true;
      markConnected('Connected');
    };

    eventSource.onerror = function() {
      if (sseConnected) {
        statusEl.textContent = 'Disconnected — reconnecting...';
        statusEl.style.color = '#ffdca3';
        setTimeout(function() { location.reload(); }, 1000);
      }
      // If never connected, let the polling fallback handle it.
    };

    eventSource.onmessage = function(e) {
      sseConnected = true;
      var event = JSON.parse(e.data);
      handleEvent(event);
    };

    // Polling fallback — if SSE doesn't connect within 3 seconds
    // (common on WSL2 where long-lived HTTP responses stall),
    // silently switch to polling /events-snapshot every 2 seconds.
    setTimeout(function() {
      if (!sseConnected) {
        eventSource.close();
        markConnected('Connected');
        pollingInterval = setInterval(function() {
          fetch('/events-snapshot')
            .then(function(r) { return r.json(); })
            .then(function(events) {
              for (var i = lastPolledIndex; i < events.length; i++) {
                handleEvent(events[i]);
              }
              lastPolledIndex = events.length;
            })
            .catch(function() {});
        }, 2000);
      }
    }, 3000);

    function handleEvent(event) {
      if (statusEl.textContent.indexOf('Connected') !== 0) {
        markConnected('Connected');
      }

      if (event.type === 'ready') {
        statusEl.textContent = 'Connected — waiting for story execution';
        statusEl.style.color = '#b4f3be';
        return;
      }

      if (event.type === 'story-start') {
        state.stories[event.storyIndex] = {
          title: event.storyTitle,
          persona: event.persona,
          status: 'active',
          startedAt: event.timestamp,
          elapsed: 0,
        };
        state.totalStories = event.total || state.totalStories;
        statusEl.textContent = 'Story ' + event.storyIndex + '/' + event.total + ' — ' + event.persona;
        statusEl.style.color = '#b4f3be';
        renderMeta();
        renderStream();
        return;
      }

      if (event.type === 'story-complete') {
        if (state.stories[event.storyIndex]) {
          state.stories[event.storyIndex].status = 'done';
          state.stories[event.storyIndex].elapsed = event.elapsed || 0;
        }
        renderMeta();
        renderStream();
        return;
      }

      if (event.type === 'file-changed') {
        state.changes.unshift({
          id: String(event.timestamp) + ':' + event.filePath + ':' + String(state.changes.length),
          timestamp: event.timestamp,
          persona: event.persona,
          storyIndex: event.storyIndex,
          storyTitle: event.storyTitle,
          filePath: event.filePath,
          tool: event.tool,
          parsed: parseUnifiedDiff(event.diff || ''),
          hasDiff: !!(event.diff && event.diff.trim().length > 0),
        });

        if (state.followLatest) {
          state.activeFile = null;
        }

        renderMeta();
        renderStream();
        return;
      }

      if (event.type === 'run-complete') {
        state.runComplete = true;
        state.branch = event.branch || '';
        state.commitCount = event.commitCount || 0;
        statusEl.textContent = 'Run complete — ' + state.commitCount + ' commits on ' + state.branch;
        statusEl.style.color = '#9ec4ff';
        renderMeta();
        renderStream();
      }
    }

    function renderMeta() {
      var completed = Object.values(state.stories).filter(function(s) { return s && s.status === 'done'; }).length;
      var active = Object.values(state.stories).filter(function(s) { return s && s.status === 'active'; }).length;
      var files = [];
      for (var i = 0; i < state.changes.length; i++) {
        var fp = state.changes[i].filePath;
        if (files.indexOf(fp) === -1) files.push(fp);
      }

      var html = '';
      html += '<span class="pill">changes: ' + state.changes.length + '</span>';
      html += '<span class="pill">stories: ' + completed + '/' + (state.totalStories || Object.keys(state.stories).length || 0) + ' done</span>';
      if (active > 0) html += '<span class="pill">active: ' + active + '</span>';
      if (state.activeFile) {
        html += '<span class="pill active clickable" onclick="clearFileFilter()">filter: ' + escapeHtml(state.activeFile) + ' ×</span>';
      }

      var maxFiles = 8;
      for (var j = 0; j < files.length && j < maxFiles; j++) {
        var file = files[j];
        var activeClass = state.activeFile === file ? ' active' : '';
        html += '<span class="pill clickable' + activeClass + '" onclick="toggleFileFilter(' + JSON.stringify(file) + ')">' + escapeHtml(file.split('/').pop()) + '</span>';
      }
      if (files.length > maxFiles) {
        html += '<span class="pill">+' + (files.length - maxFiles) + ' files</span>';
      }

      metaEl.innerHTML = html;
    }

    function renderStream() {
      var filtered = state.changes.filter(function(change) {
        return !state.activeFile || change.filePath === state.activeFile;
      });

      if (filtered.length === 0) {
        var storiesStarted = Object.keys(state.stories).length > 0;
        var activeStories = Object.values(state.stories).filter(function(s) { return s && s.status === 'active'; }).length;
        var completedStories = Object.values(state.stories).filter(function(s) { return s && s.status === 'done'; }).length;

        if (state.runComplete) {
          emptyEl.textContent = 'Run complete — no file-level diffs were captured for this session.';
        } else if (activeStories > 0) {
          emptyEl.textContent = 'Story execution is active — waiting for the first file edit...';
        } else if (storiesStarted || completedStories > 0) {
          emptyEl.textContent = 'Stories executed, but no file-level diffs have arrived yet.';
        } else {
          emptyEl.textContent = 'Waiting for story execution and file changes...';
        }
        emptyEl.style.display = 'block';
      } else {
        emptyEl.style.display = 'none';
      }
      streamEl.innerHTML = filtered.map(renderChangeCard).join('');
    }

    function renderChangeCard(change) {
      var time = new Date(change.timestamp).toLocaleTimeString();
      var rows = renderDiffRows(change.parsed);
      var diffHtml = rows || '<div class="no-diff">No textual diff available for this update yet.</div>';

      return '' +
        '<article class="change-card">' +
          '<div class="card-head">' +
            '<div class="head-left">' +
              '<button class="path" onclick="toggleFileFilter(' + JSON.stringify(change.filePath) + ')">' + escapeHtml(change.filePath) + '</button>' +
              '<span class="badge ' + (change.tool === 'created' ? 'created' : 'edited') + '">' + escapeHtml(change.tool) + '</span>' +
              '<span class="badge persona">' + escapeHtml(change.persona) + '</span>' +
              '<span class="badge story">Story ' + change.storyIndex + '</span>' +
            '</div>' +
            '<div class="head-right">' +
              '<span class="badge time">' + escapeHtml(time) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="diff">' + diffHtml + '</div>' +
        '</article>';
    }

    function renderDiffRows(parsed) {
      if (!parsed || !parsed.length) return '';
      var html = '<table class="diff-table"><tbody>';
      for (var i = 0; i < parsed.length; i++) {
        var row = parsed[i];
        if (row.type === 'hunk') {
          html += '<tr class="hunk"><td class="num"></td><td class="num"></td><td class="code">' + escapeHtml(row.text) + '</td></tr>';
          continue;
        }
        if (row.type === 'meta') {
          html += '<tr class="meta"><td class="num"></td><td class="num"></td><td class="code">' + escapeHtml(row.text) + '</td></tr>';
          continue;
        }
        var cls = row.type === 'add' ? 'add' : row.type === 'del' ? 'del' : 'context';
        var oldNum = row.oldNum == null ? '' : String(row.oldNum);
        var newNum = row.newNum == null ? '' : String(row.newNum);
        var prefix = row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' ';
        html += '<tr class="' + cls + '">' +
          '<td class="num">' + oldNum + '</td>' +
          '<td class="num">' + newNum + '</td>' +
          '<td class="code">' + escapeHtml(prefix + row.text) + '</td>' +
          '</tr>';
      }
      html += '</tbody></table>';
      return html;
    }

    function parseUnifiedDiff(diffText) {
      if (!diffText || !diffText.trim()) return [];

      var lines = diffText.split(String.fromCharCode(10));
      var rows = [];
      var oldLine = 0;
      var newLine = 0;

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];

        if (line.startsWith('@@')) {
          var m = /@@\\s+-(\\d+)(?:,\\d+)?\\s+\\+(\\d+)(?:,\\d+)?\\s+@@/.exec(line);
          if (m) {
            oldLine = parseInt(m[1], 10);
            newLine = parseInt(m[2], 10);
          }
          rows.push({ type: 'hunk', text: line });
          continue;
        }

        if (
          line.startsWith('diff --git') ||
          line.startsWith('index ') ||
          line.startsWith('--- ') ||
          line.startsWith('+++ ') ||
          line.startsWith('new file mode') ||
          line.startsWith('deleted file mode')
        ) {
          rows.push({ type: 'meta', text: line });
          continue;
        }

        if (line.startsWith('+')) {
          rows.push({ type: 'add', oldNum: null, newNum: newLine, text: line.slice(1) });
          newLine += 1;
          continue;
        }

        if (line.startsWith('-')) {
          rows.push({ type: 'del', oldNum: oldLine, newNum: null, text: line.slice(1) });
          oldLine += 1;
          continue;
        }

        rows.push({ type: 'context', oldNum: oldLine, newNum: newLine, text: line.startsWith(' ') ? line.slice(1) : line });
        oldLine += 1;
        newLine += 1;
      }

      return rows;
    }

    function toggleFileFilter(filePath) {
      state.activeFile = state.activeFile === filePath ? null : filePath;
      renderMeta();
      renderStream();
    }

    function clearFileFilter() {
      state.activeFile = null;
      renderMeta();
      renderStream();
    }

    function toggleFollow() {
      state.followLatest = !state.followLatest;
      followBtn.textContent = 'Follow latest: ' + (state.followLatest ? 'ON' : 'OFF');
      if (state.followLatest) {
        state.activeFile = null;
        renderMeta();
        renderStream();
      }
    }

    function abortRun() {
      fetch('/abort', { method: 'POST' })
        .then(function() {
          statusEl.textContent = 'Stopping run...';
          statusEl.style.color = '#ffdca3';
          document.getElementById('stopBtn').disabled = true;
        })
        .catch(function(err) {
          console.error('Failed to abort run', err);
        });
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    window.toggleFileFilter = toggleFileFilter;
    window.clearFileFilter = clearFileFilter;
    window.toggleFollow = toggleFollow;
    window.abortRun = abortRun;
  </script>
</body>
</html>`;
