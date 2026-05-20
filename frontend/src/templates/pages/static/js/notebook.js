let notebookOpen = false;
let cellCounter = 0;
const cells = {};
let activeCellId = null;
let isCommandMode = true;
let lastKeyPress = { key: null, time: 0 };

const SPORE_CONNECTIONS = window.SPORE_CONNECTIONS || [];
const socket = io();

socket.on('connect', () => console.log('Kernel socket connected'));
socket.on('kernel_output', (chunk) => handleKernelOutput(chunk));

function interruptKernel() {
  socket.emit('kernel_interrupt');
}

function restartKernel(kernelName = 'python3') {
  socket.emit('kernel_restart', { kernel_name: kernelName });
}

if (SPORE_CONNECTIONS.length) {
  addCell('sql', 'SELECT 1 AS ok;');
} else {
  addCell('python');
}


function connectionOptionsHtml(selectedId = '') {
  if (!SPORE_CONNECTIONS.length) {
    return '<option value="" disabled selected>No connections — add one first</option>';
  }
  return SPORE_CONNECTIONS.map(c => {
    const sel = String(c.id) === String(selectedId) ? 'selected' : '';
    const label = `${c.source_type || c.db_type || 'db'} — ${c.name || c.id}`;
    return `<option value="${c.id}" ${sel}>${label}</option>`;
  }).join('');
}

function addCell(type = 'python', initialCode = '', opts = {}) {
  cellCounter++;
  const cellId = `cell-${cellCounter}`;
  const isSql = type === 'sql';

  const cellHtml = isSql
    ? buildSqlCellHtml(cellId, initialCode, opts)
    : buildPythonCellHtml(cellId, initialCode, opts);

  document.getElementById('notebook-cells').insertAdjacentHTML('beforeend', cellHtml);

  // Initialize base cell object
  cells[cellId] = {
    type: isSql ? 'sql' : 'python',
    outputEl: document.getElementById(`${cellId}-output`),
    countEl: document.getElementById(`${cellId}-count`),
    editor: null, // We will attach Monaco here
    connEl: isSql ? document.getElementById(`${cellId}-conn`) : null,
    statusEl: isSql ? document.getElementById(`${cellId}-status`) : null,
    // ... keep your materialized opts
  };

  // Instantiate Monaco safely
  window.monacoReady.then(monaco => {
    setupMonacoPython(monaco)
    const editorContainer = document.getElementById(`${cellId}-editor`);
    monaco.editor.defineTheme('spore-theme', {
      base: 'vs', // Start with a light base
      inherit: true,
      rules: [
        // Map to your text-primary (#00A36C) and bold
        { token: 'keyword', foreground: '00A36C', fontStyle: 'bold' },
        // Map to your text-primary-dark (#065f46) and bold
        { token: 'string', foreground: '065f46', fontStyle: 'bold' },
        // Map to your text-slate-500 (#64748b) and italic
        { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
        // General text color text-slate-700 (#334155)
        { token: 'identifier', foreground: '334155' },
        // Map numbers/booleans to text-slate-900 (#0f172a)
        { token: 'number', foreground: '0f172a', fontStyle: 'bold' },
      ],
      colors: {
        'editor.background': '#f8fafc', // Matches bg-slate-50
        'editor.foreground': '#334155', // Matches text-slate-700
        'editor.lineHighlightBackground': '#f1f5f9', // bg-slate-100 for current line
        'editorLineNumber.foreground': '#94a3b8', // text-slate-400
        'editorIndentGuide.background': '#e2e8f0', // text-slate-200
        'editor.selectionBackground': '#bbf7d0', // Subtle green selection (green-200)
      }
    });
    // Ensure your container has a base style so it doesn't collapse
    editorContainer.style.minHeight = '40px';

    const editor = monaco.editor.create(editorContainer, {
      value: type === 'python' && opts.requireMaterialized && !opts.materialized
        ? '# Materialize a SQL cell first...' : initialCode,
      language: type === 'sql' ? 'sql' : 'python',
      theme: 'spore-theme', // Use your sleek new custom theme!
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      lineNumbers: "off",
      renderLineHighlight: "all",
      wordWrap: 'on',

      // --- NEW SETTINGS FOR NOTEBOOK FEEL ---
      padding: { top: 12, bottom: 12 }, // Mimics p-2.5
      overviewRulerLanes: 0, // Removes the right-side ruler
      hideCursorInOverviewRuler: true,
      scrollbar: {
        vertical: 'hidden', // Force hide vertical scrollbar
        alwaysConsumeMouseWheel: false // Allows the page to scroll when mouse is over the editor
      }
    });

    // --- DYNAMIC HEIGHT RESIZING ---
    // Listen for content size changes (typing, deleting, pasting)
    editor.onDidContentSizeChange((e) => {
      if (e.contentHeightChanged) {
        // e.contentHeight is the exact pixel height of all lines + padding
        editorContainer.style.height = `${e.contentHeight}px`;
        editor.layout();
      }
    });

    // Force an initial height calculation immediately after creation
    setTimeout(() => {
      editorContainer.style.height = `${editor.getContentHeight()}px`;
      editor.layout();
    }, 0);
    cells[cellId].editor = editor;

    // --- MONACO KEYBINDS ---
    // 1. Shift + Enter to run
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
      if (type === 'sql') runSqlCell(cellId);
      else runCell(cellId);
      // Optionally add a new cell below automatically here if it's the last cell
    });

    // 2. Escape to enter Command Mode
    editor.addCommand(monaco.KeyCode.Escape, () => {
      document.activeElement.blur(); // Remove focus from Monaco
      isCommandMode = true;
      highlightActiveCell();
    });

    // 3. Track Focus
    editor.onDidFocusEditorText(() => {
      activeCellId = cellId;
      isCommandMode = false;
      highlightActiveCell();
    });

    // Auto-focus the new cell
    editor.focus();
  });
}

function buildPythonCellHtml(cellId, initialCode, opts) {
  const blocked = opts.requireMaterialized && !opts.materialized;
  const code = blocked
    ? '# Materialize a SQL cell first, then add a Python cell from it.'
    : (initialCode || '');

  return `
    <div id="${cellId}" class="heavy-card p-3 bg-white border-slate-100" data-cell-type="python">
        <div class="flex justify-between mb-2">
            <span id="${cellId}-count" class="text-[9px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 px-2 py-0.5 rounded-pill border border-slate-100">
                In [ ] — Python (local)
            </span>
            <div class="flex items-center gap-1">
                <button onclick="runCell('${cellId}')"
                    class="flex items-center gap-1 px-2 py-1 bg-primary text-white text-[9px] font-black rounded hover:opacity-90 transition-all">
                    <span class="material-symbols-outlined text-[11px]" style="font-variation-settings:'FILL' 1">play_arrow</span>
                    RUN
                </button>
                <button onclick="deleteCell('${cellId}')"
                    class="p-1 text-slate-300 hover:text-red-400 transition-colors rounded">
                    <span class="material-symbols-outlined text-[13px]">delete</span>
                </button>
            </div>
        </div>
        <div class="bg-slate-50 border border-slate-100 p-2 rounded-lg">
            <div id="${cellId}-editor" class="w-full min-h-[60px]"></div>
        </div>
        <div id="${cellId}-output" class="hidden border-t border-slate-100 mt-2"></div>
    </div>`;
}

function buildSqlCellHtml(cellId, initialCode, opts) {
  const connId = opts.connectionId || (SPORE_CONNECTIONS[0] && SPORE_CONNECTIONS[0].id) || '';
  return `
    <div id="${cellId}" class="heavy-card p-3 bg-white border-slate-100 border-l-4 border-l-primary" data-cell-type="sql">
        <div class="flex justify-between mb-2 flex-wrap gap-2 items-center">
            <span id="${cellId}-count" class="text-[9px] font-black text-primary uppercase tracking-widest bg-primary-soft px-2 py-0.5 rounded-pill border border-primary/20">
                SQL — Remote pushdown
            </span>
            <select id="${cellId}-conn" class="text-[9px] font-black text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-0.5 uppercase">
                ${connectionOptionsHtml(connId)}
            </select>
            <div class="flex items-center gap-1 ml-auto">
                <button onclick="askSqlCell('${cellId}')"
                    class="flex items-center gap-1 px-2 py-1 bg-slate-800 text-white text-[9px] font-black rounded hover:opacity-90">
                    <span class="material-symbols-outlined text-[11px]">auto_awesome</span> ASK AI
                </button>
                <button onclick="runSqlCell('${cellId}')"
                    class="flex items-center gap-1 px-2 py-1 bg-primary text-white text-[9px] font-black rounded hover:opacity-90">
                    <span class="material-symbols-outlined text-[11px]">play_arrow</span> RUN
                </button>
                <button onclick="materializeSqlCell('${cellId}')"
                    class="flex items-center gap-1 px-2 py-1 bg-emerald-600 text-white text-[9px] font-black rounded hover:opacity-90">
                    <span class="material-symbols-outlined text-[11px]">save</span> MATERIALIZE
                </button>
                <button onclick="deleteCell('${cellId}')"
                    class="p-1 text-slate-300 hover:text-red-400 transition-colors rounded">
                    <span class="material-symbols-outlined text-[13px]">delete</span>
                </button>
            </div>
        </div>
        <span id="${cellId}-status" class="text-[9px] text-slate-400 font-bold block mb-1">Preview on remote source</span>
<div class="bg-slate-900 border border-slate-700 p-2 rounded-lg">
    <div id="${cellId}-editor" class="w-full min-h-[80px]"></div>
</div>
        <div id="${cellId}-output" class="mt-2"></div>
    </div>`;
}

function addPythonFromMaterialized(kernelPath, streamName, relationId) {
  const preamble = `import pandas as pd\n\ndf = pd.read_parquet("${kernelPath}")\nprint(f"Loaded {len(df)} rows from materialized stream '${streamName}'")\ndf.head()`;
  addCell('python', preamble, { materialized: kernelPath, streamName, relationId });
}

function deleteCell(cellId) {
  document.getElementById(cellId)?.remove();
  delete cells[cellId];
}

function autoResizeCell(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.max(80, textarea.scrollHeight) + 'px';
}

function handleCellKeydown(e, cellId) {
  if (e.key === 'Enter' && (e.ctrlKey || e.shiftKey)) {
    e.preventDefault();
    runCell(cellId);
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    const ta = e.target;
    const start = ta.selectionStart;
    ta.value = ta.value.slice(0, start) + '    ' + ta.value.slice(ta.selectionEnd);
    ta.selectionStart = ta.selectionEnd = start + 4;
  }
}

function handleSqlCellKeydown(e, cellId) {
  if (e.key === 'Enter' && (e.ctrlKey || e.shiftKey)) {
    e.preventDefault();
    runSqlCell(cellId);
  }
}

function runCell(cellId) {
  const cell = cells[cellId];
  if (!cell || cell.type !== 'python') return;

  const code = cell.editor.getValue().trim();
  if (!code) return;

  if (code.includes('Materialize a SQL cell first')) {
    alert('Materialize a SQL query first, then add a Python cell from the SQL cell.');
    return;
  }

  cell.outputEl.innerHTML = '';
  cell.outputEl.classList.remove('hidden');
  cell.countEl.textContent = 'In [*] — Running...';

  socket.emit('kernel_execute', { cell_id: cellId, code });
  addCell()
}

async function runSqlCell(cellId) {
  const cell = cells[cellId];
  if (!cell || cell.type !== 'sql') return;

  const code = cell.editor.getValue().trim();
  const dbId = cell.connEl?.value;
  if (!sql || !dbId) return;

  cell.statusEl.textContent = 'Running preview on remote...';
  cell.outputEl.innerHTML = buildSqlResultShell(cellId);

  const thead = document.getElementById(`thead-${cellId}`);
  const tbody = document.getElementById(`tbody-${cellId}`);
  const rowcount = document.getElementById(`rowcount-${cellId}`);

  const formData = new FormData();
  formData.append('query', sql);
  formData.append('id', dbId);

  try {
    const response = await fetch('/query-preview', { method: 'POST', body: formData });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalRows = 0;
    let dbTotalRows = null;
    const PREVIEW_LIMIT = 100;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = JSON.parse(line.slice(6));

        if (data.type === 'columns') {
          thead.innerHTML = `<tr>${data.content.map(col =>
            `<th class="px-3 py-2 text-left text-[9px] font-black uppercase text-slate-500 whitespace-nowrap">${col}</th>`
          ).join('')}</tr>`;
        }
        if (data.type === 'metadata') {
          dbTotalRows = data.total_rows;
        }
        if (data.type === 'rows') {
          const prev = totalRows;
          totalRows += data.content.length;
          let label = `Showing ${Math.min(totalRows, PREVIEW_LIMIT)}`;
          if (dbTotalRows !== null && dbTotalRows !== 'unknown') {
            label = `Total: ${Number(dbTotalRows).toLocaleString()} | ${label}`;
          }
          rowcount.textContent = label;

          if (prev < PREVIEW_LIMIT) {
            const slice = data.content.slice(0, PREVIEW_LIMIT - prev);
            tbody.insertAdjacentHTML('beforeend', slice.map((row, i) => `
              <tr class="${(prev + i) % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}">
                ${Object.values(row).map(val =>
              `<td class="px-3 py-1.5 text-[11px] border-b border-slate-100 whitespace-nowrap">${val === null ? '<span class="text-slate-300 italic">null</span>' : val}</td>`
            ).join('')}
              </tr>`).join(''));
          }
        }
        if (data.type === 'error') {
          tbody.innerHTML = `<tr><td colspan="99" class="px-3 py-3 text-red-500 font-bold">${data.content}</td></tr>`;
        }
      }
    }
    cell.statusEl.textContent = 'Preview (remote) — materialize to use in Python';
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="99" class="px-3 py-3 text-red-500 font-bold">Connection lost.</td></tr>`;
    cell.statusEl.textContent = 'Preview failed';
  }
}

function buildSqlResultShell(cellId) {
  return `
    <div class="rounded-xl border border-slate-200 overflow-hidden bg-white">
      <div class="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-100">
        <span class="material-symbols-outlined text-[13px] text-primary">table</span>
        <span class="text-[9px] font-black uppercase text-slate-500">Query preview</span>
        <span id="rowcount-${cellId}" class="ml-auto text-[9px] font-black text-slate-400"></span>
      </div>
      <div class="overflow-x-auto max-h-64 overflow-y-auto">
        <table class="w-full text-[11px]">
          <thead id="thead-${cellId}" class="sticky top-0 bg-slate-50 border-b"></thead>
          <tbody id="tbody-${cellId}"></tbody>
        </table>
      </div>
    </div>`;
}

async function askSqlCell(cellId) {
  const cell = cells[cellId];
  if (!cell) return;
  const prompt = window.prompt('Ask AI to write or refine SQL:', '');
  if (!prompt) return;

  const dbId = cell.connEl?.value;
  if (!dbId) return;

  cell.statusEl.textContent = 'AI generating SQL...';

  const formData = new FormData();
  formData.append('message', prompt);
  formData.append('selected_db_id', dbId);
  formData.append('context_sql', cell.inputEl.value);

  try {
    const response = await fetch('/chat/ask', { method: 'POST', body: formData });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = JSON.parse(line.slice(6));
        if (data.type === 'token') full += data.content;
      }
    }

    const match = full.match(/<query>([\s\S]*?)<\/query>/);
    if (match && match[1].trim()) {
      cell.inputEl.value = match[1].trim();
      autoResizeCell(cell.inputEl);
      cell.statusEl.textContent = 'SQL updated — run preview or materialize';
    } else {
      cell.statusEl.textContent = 'AI did not return SQL';
    }
  } catch (e) {
    cell.statusEl.textContent = 'AI request failed';
  }
}

async function materializeSqlCell(cellId) {
  const cell = cells[cellId];
  if (!cell) return;

  const sql = cell.inputEl.value.trim();
  const dbId = cell.connEl?.value;
  if (!sql || !dbId) return;

  const streamName = cell.streamName || `stream_${cellId.replace('cell-', '')}`;
  cell.statusEl.textContent = 'Materializing to local volume...';

  const formData = new FormData();
  formData.append('query', sql);
  formData.append('id', dbId);
  formData.append('stream_name', streamName);
  if (cell.relationId) formData.append('relation_id', cell.relationId);

  try {
    const response = await fetch('/materialize', { method: 'POST', body: formData });
    const result = await response.json();

    if (result.status === 'success') {
      cell.materialized = result.kernel_path;
      cell.relationId = result.relation_id;
      cell.streamName = result.stream_name;
      cell.statusEl.innerHTML = `<span class="text-emerald-600">Materialized</span> → <code class="text-[9px]">${result.kernel_path}</code>
        <button onclick="addPythonFromMaterialized('${result.kernel_path}', '${result.stream_name}', '${result.relation_id}')"
          class="ml-2 px-2 py-0.5 bg-primary text-white text-[8px] font-black rounded">+ PYTHON CELL</button>`;
    } else {
      cell.statusEl.textContent = `Materialize failed: ${result.message || 'unknown error'}`;
    }
  } catch (e) {
    cell.statusEl.textContent = 'Materialize failed';
  }
}

function renderMimeBundle(dataBundle, container) {
  if (typeof MIME_RENDERERS === 'undefined') return;
  const available = MIME_RENDERERS
    .filter(r => dataBundle[r.mimeType] !== undefined)
    .sort((a, b) => b.priority - a.priority);
  if (available.length === 0) return;
  available[0].render(dataBundle[available[0].mimeType], container);
}

function handleKernelOutput(chunk) {
  const cell = cells[chunk.cell_id];
  if (!cell) return;
  const out = cell.outputEl;

  if (chunk.type === 'stream') {
    let streamEl = out.querySelector(`.stream-output[data-stream="${chunk.stream}"]`);
    if (!streamEl) {
      out.insertAdjacentHTML('beforeend', `
        <pre class="stream-output font-mono text-[11px] p-3 leading-relaxed whitespace-pre-wrap m-0
             ${chunk.stream === 'stderr' ? 'text-amber-600 bg-amber-50' : 'text-slate-700'}"
             data-stream="${chunk.stream}"></pre>`);
      streamEl = out.querySelector(`.stream-output[data-stream="${chunk.stream}"]`);
    }
    streamEl.textContent += chunk.content;
  } else if (chunk.type === 'display' || chunk.type === 'result') {
    renderMimeBundle(chunk.data, out);
    if (chunk.type === 'result') {
      cell.countEl.textContent = `Out [${chunk.execution_count}]`;
    }
  } else if (chunk.type === 'error') {
    const clean = chunk.traceback.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
    out.insertAdjacentHTML('beforeend', `
      <pre class="font-mono text-[11px] p-3 text-red-500 bg-red-50 border-t border-red-100 whitespace-pre-wrap m-0">${clean}</pre>`);
    cell.countEl.textContent = 'In [!] — Error';
  } else if (chunk.type === 'done') {
    if (cell.countEl.textContent.includes('*')) {
      cell.countEl.textContent = 'In [✓] — Complete';
    }
  }
}

function buildDataShell(componentId) {
  return `
    <div id="${componentId}-wrapper" class="my-3 rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white">
        <div class="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
            <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-[14px] text-primary">dataset</span>
                <span class="text-[10px] font-black uppercase tracking-wider text-slate-600">Local DataFrame</span>
            </div>
            <div class="flex items-center gap-3">
                <span id="${componentId}-rowcount" class="text-[10px] font-bold text-slate-400"></span>
                <div class="relative">
                    <span class="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-slate-400">search</span>
                    <input type="text" id="${componentId}-search" placeholder="Filter rows..." 
                           class="pl-6 pr-2 py-0.5 text-[10px] border border-slate-200 rounded-md bg-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary w-32 transition-all">
                </div>
            </div>
        </div>
        <div class="overflow-x-auto overflow-y-auto" style="max-height: 400px;">
            <table id="${componentId}-table" class="w-full text-left border-collapse">
                <thead id="${componentId}-thead" class="sticky top-0 bg-slate-100/95 backdrop-blur z-10 shadow-sm">
                </thead>
                <tbody id="${componentId}-tbody" class="divide-y divide-slate-100">
                </tbody>
            </table>
        </div>
    </div>`;
}

function initializeSmartTable(rawHtml, componentId) {
  // 1. Parse the ugly pandas HTML silently in memory
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');
  const sourceTable = doc.querySelector('table');

  if (!sourceTable) {
    document.getElementById(`${componentId}-wrapper`).innerHTML = `<div class="p-3 text-red-500">Failed to parse table data.</div>`;
    return;
  }

  // 2. Extract Headers
  const thead = document.getElementById(`${componentId}-thead`);
  const sourceHeaders = Array.from(sourceTable.querySelectorAll('thead th'));

  let headerHtml = '<tr>';
  sourceHeaders.forEach((th, index) => {
    // Pandas usually leaves the top-left index header blank. Let's name it 'idx'
    const colName = th.innerText.trim() || (index === 0 ? 'idx' : `col_${index}`);
    headerHtml += `
            <th class="px-4 py-2 text-[10px] font-black text-slate-500 uppercase tracking-wider whitespace-nowrap border-b border-slate-200">
                ${colName}
            </th>`;
  });
  headerHtml += '</tr>';
  thead.innerHTML = headerHtml;

  // 3. Extract Rows
  const tbody = document.getElementById(`${componentId}-tbody`);
  const sourceRows = Array.from(sourceTable.querySelectorAll('tbody tr'));

  // Update Row Count
  document.getElementById(`${componentId}-rowcount`).innerText = `${sourceRows.length} rows`;

  let bodyHtml = '';
  sourceRows.forEach((tr, rowIndex) => {
    const cells = Array.from(tr.querySelectorAll('th, td'));

    bodyHtml += `<tr class="hover:bg-blue-50/50 transition-colors group">`;
    cells.forEach((cell, cellIndex) => {
      const val = cell.innerText.trim();
      // Style numbers slightly differently for that Kaggle data-science feel
      const isNumber = !isNaN(val) && val !== '';
      const textClass = isNumber ? 'font-mono text-blue-600' : 'text-slate-700';
      const bgClass = (rowIndex % 2 === 0) ? 'bg-white' : 'bg-slate-50/30';

      bodyHtml += `
                <td class="px-4 py-1.5 text-[11px] whitespace-nowrap ${textClass} ${bgClass} group-hover:bg-transparent">
                    ${val === 'NaN' || val === 'None' ? '<span class="text-slate-300 italic">null</span>' : val}
                </td>`;
    });
    bodyHtml += `</tr>`;
  });

  tbody.innerHTML = bodyHtml;

  // 4. (Optional) Wire up the quick filter search bar
  const searchInput = document.getElementById(`${componentId}-search`);
  searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
      const text = row.innerText.toLowerCase();
      row.style.display = text.includes(term) ? '' : 'none';
    });
  });
}

// Visual Feedback for Command Mode
function highlightActiveCell() {
  Object.keys(cells).forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    // Reset styles
    el.style.borderLeft = id.includes('sql') ? '4px solid #0ea5e9' : '4px solid transparent';

    if (id === activeCellId) {
      // Give a visual cue for the active cell
      el.style.borderLeft = isCommandMode ? '4px solid #94a3b8' : '4px solid #22c55e'; // Grey for command, Green for edit
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
}

// Global Command Mode Listener
document.addEventListener('keydown', (e) => {
  // If we are typing in Monaco or an input field, do nothing!
  if (!isCommandMode) return;
  if (!activeCellId) return;

  const cellIds = Object.keys(cells);
  const currentIndex = cellIds.indexOf(activeCellId);

  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault();
      if (currentIndex > 0) activeCellId = cellIds[currentIndex - 1];
      highlightActiveCell();
      break;

    case 'ArrowDown':
      e.preventDefault();
      if (currentIndex < cellIds.length - 1) activeCellId = cellIds[currentIndex + 1];
      highlightActiveCell();
      break;

    case 'Enter':
      e.preventDefault();
      // Enter edit mode
      cells[activeCellId].editor.focus();
      break;

    case 'a':
    case 'A':
      // Fast add Python cell
      e.preventDefault();
      addCell('python');
      break;

    case 'd':
    case 'D':
      // Check for double tap 'dd'
      const now = Date.now();
      if (lastKeyPress.key === 'd' && now - lastKeyPress.time < 500) {
        deleteCell(activeCellId);
        // Move focus up if possible
        if (currentIndex > 0) {
          activeCellId = cellIds[currentIndex - 1];
        } else if (cellIds.length > 1) {
          activeCellId = cellIds[currentIndex + 1];
        } else {
          activeCellId = null;
        }
        highlightActiveCell();
        lastKeyPress.key = null; // Reset
      } else {
        lastKeyPress = { key: 'd', time: now };
      }
      break;
  }
});

function setupMonacoPython(monaco) {
  // Prevent registering multiple times if called again
  if (window.monacoPythonSetupDone) return;
  window.monacoPythonSetupDone = true;

  const pythonKeywords = [
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
    'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
    'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda',
    'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'
  ];

  const commonDataScienceLibs = [
    'pandas', 'numpy', 'matplotlib', 'matplotlib.pyplot', 'seaborn',
    'scipy', 'sklearn', 'tensorflow', 'torch', 'math', 'os', 'sys', 'json', 'datetime'
  ];

  const commonSnippets = [
    { label: 'pd', text: 'import pandas as pd' },
    { label: 'np', text: 'import numpy as np' },
    { label: 'plt', text: 'import matplotlib.pyplot as plt' }
  ];

  monaco.languages.registerCompletionItemProvider('python', {
    provideCompletionItems: function (model, position) {
      // Get the current word being typed
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      };

      const suggestions = [];

      // 1. Add Keywords (import, as, def, etc.)
      pythonKeywords.forEach(kw => {
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range: range
        });
      });

      // 2. Add Modules (pandas, numpy, etc.)
      commonDataScienceLibs.forEach(lib => {
        suggestions.push({
          label: lib,
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: lib,
          range: range
        });
      });

      // 3. Add Magic Snippets
      commonSnippets.forEach(snip => {
        suggestions.push({
          label: snip.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: snip.text,
          documentation: `Standard import for ${snip.label}`,
          range: range
        });
      });

      return { suggestions: suggestions };
    }
  });
}