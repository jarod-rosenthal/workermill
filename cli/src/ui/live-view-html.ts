export const LIVE_VIEW_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WorkerMill Live View</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1e1e1e; color: #d4d4d4; height: 100vh; overflow: hidden; }
    .header { background: #252526; padding: 12px 16px; border-bottom: 1px solid #3e3e42; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { font-size: 16px; font-weight: 600; color: #569cd6; }
    .header .status { font-size: 14px; color: #6a9955; }
    .header button { background: #dc3545; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 14px; }
    .header button:hover { background: #c82333; }
    .container { display: flex; height: calc(100vh - 57px); }
    .sidebar { width: 300px; background: #252526; border-right: 1px solid #3e3e42; overflow-y: auto; }
    .sidebar .story { padding: 8px 16px; border-bottom: 1px solid #3e3e42; }
    .sidebar .story.active { background: #37373d; }
    .sidebar .story .title { font-weight: 500; margin-bottom: 4px; }
    .sidebar .story .files { margin-left: 16px; }
    .sidebar .story .file { padding: 2px 0; cursor: pointer; color: #cccccc; }
    .sidebar .story .file:hover { color: #ffffff; }
    .sidebar .story .file.active { color: #4ec9b0; font-weight: 500; }
    .main { flex: 1; display: flex; flex-direction: column; }
    .diff-header { background: #252526; padding: 8px 16px; border-bottom: 1px solid #3e3e42; font-size: 14px; color: #cccccc; }
    .diff { flex: 1; overflow-y: auto; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 13px; line-height: 1.4; }
    .diff pre { margin: 0; white-space: pre-wrap; word-wrap: break-word; }
    .diff .added { background: rgba(156, 204, 101, 0.2); color: #6a9955; }
    .diff .removed { background: rgba(255, 99, 71, 0.2); color: #f44747; }
    .diff .context { color: #d4d4d4; }
  </style>
</head>
<body>
  <div class="header">
    <h1>WorkerMill Live View</h1>
    <div class="status" id="status">Connecting...</div>
    <button id="stopBtn" onclick="abortRun()">Stop</button>
  </div>
  <div class="container">
    <div class="sidebar" id="sidebar">
      <!-- Stories and files will be inserted here -->
    </div>
    <div class="main">
      <div class="diff-header" id="diffHeader">Select a file to view its diff</div>
      <div class="diff" id="diff">
        <pre id="diffContent"></pre>
      </div>
    </div>
  </div>

  <script>
    const eventSource = new EventSource('/events');
    const sidebar = document.getElementById('sidebar');
    const diffHeader = document.getElementById('diffHeader');
    const diffContent = document.getElementById('diffContent');
    const statusEl = document.getElementById('status');

    let currentFile = null;
    let stories = [];
    let files = new Map();

    eventSource.onmessage = function(event) {
      const data = JSON.parse(event.data);
      handleEvent(data);
    };

    eventSource.onerror = function() {
      statusEl.textContent = 'Disconnected — reconnecting...';
      setTimeout(() => location.reload(), 1000);
    };

    eventSource.onopen = function() {
      statusEl.textContent = 'Connected';
    };

    function handleEvent(event) {
      switch (event.type) {
        case 'story-start':
          stories[event.storyIndex] = {
            title: event.storyTitle,
            persona: event.persona,
            status: 'active',
            files: []
          };
          updateSidebar();
          updateStatus(\`Story \${event.storyIndex}/\${event.total} — \${event.persona}\`);
          break;
        case 'story-complete':
          if (stories[event.storyIndex]) {
            stories[event.storyIndex].status = 'completed';
          }
          updateSidebar();
          break;
        case 'file-changed':
          const story = stories[event.storyIndex];
          if (story) {
            if (!story.files.includes(event.filePath)) {
              story.files.push(event.filePath);
            }
            files.set(event.filePath, {
              storyIndex: event.storyIndex,
              storyTitle: event.storyTitle,
              tool: event.tool,
              diff: event.diff
            });
            updateSidebar();
            if (!currentFile) {
              selectFile(event.filePath);
            }
          }
          break;
        case 'run-complete':
          statusEl.textContent = \`Run complete — \${event.commitCount} commits on \${event.branch}\`;
          break;
      }
    }

    function updateSidebar() {
      sidebar.innerHTML = '';
      stories.forEach((story, index) => {
        if (!story) return;
        const storyDiv = document.createElement('div');
        storyDiv.className = \`story \${story.status === 'active' ? 'active' : ''}\`;
        storyDiv.innerHTML = \`
          <div class="title">\${story.status === 'completed' ? '✓' : story.status === 'active' ? '●' : '○'} \${story.title}</div>
          <div class="files">
            \${story.files.map(file => \`<div class="file \${file === currentFile ? 'active' : ''}" onclick="selectFile('\${file}')">\${file.split('/').pop()}</div>\`).join('')}
          </div>
        \`;
        sidebar.appendChild(storyDiv);
      });
    }

    function selectFile(filePath) {
      currentFile = filePath;
      const fileData = files.get(filePath);
      if (fileData) {
        diffHeader.textContent = \`\${filePath} (\${fileData.tool})\`;
        const diffHtml = formatDiff(fileData.diff);
        diffContent.innerHTML = diffHtml;
      }
      updateSidebar();
    }

    function formatDiff(diff) {
      if (!diff) return '<span class="context">No diff available</span>';
      const lines = diff.split('\n');
      return lines.map(line => {
        if (line.startsWith('+')) {
          return \`<span class="added">\${escapeHtml(line)}</span>\`;
        } else if (line.startsWith('-')) {
          return \`<span class="removed">\${escapeHtml(line)}</span>\`;
        } else {
          return \`<span class="context">\${escapeHtml(line)}</span>\`;
        }
      }).join('\n');
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function updateStatus(text) {
      statusEl.textContent = text;
    }

    function abortRun() {
      fetch('/abort', { method: 'POST' })
        .then(() => {
          statusEl.textContent = 'Stopping run...';
          document.getElementById('stopBtn').disabled = true;
        })
        .catch(err => console.error('Failed to abort:', err));
    }

    window.selectFile = selectFile;
  </script>
</body>
</html>`;