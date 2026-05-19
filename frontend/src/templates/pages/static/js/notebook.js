let notebookOpen = false;
let cellCounter = 0;
const cells = {};

const SPORE_CONNECTIONS = window.SPORE_CONNECTIONS || [];

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

  cells[cellId] = {
    type: isSql ? 'sql' : 'python',
    outputEl: document.getElementById(`${cellId}-output`),
    countEl: document.getElementById(`${cellId}-count`),
    inputEl: document.getElementById(`${cellId}-input`),
    connEl: isSql ? document.getElementById(`${cellId}-conn`) : null,
    statusEl: isSql ? document.getElementById(`${cellId}-status`) : null,
    materialized: opts.materialized || null,
    relationId: opts.relationId || null,
    streamName: opts.streamName || null,
  };

  if (cells[cellId].inputEl) {
    cells[cellId].inputEl.focus();
    autoResizeCell(cells[cellId].inputEl);
  }
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
        <div class="bg-slate-50 border border-slate-100 p-2.5 rounded-lg">
            <textarea id="${cellId}-input"
                class="w-full bg-transparent border-none outline-none focus:outline-none focus:ring-0 p-0 m-0 resize-none overflow-hidden font-mono text-[11px] text-slate-700 leading-relaxed block"
                placeholder="# Reads materialized Parquet from /data/streams/..."
                onkeydown="handleCellKeydown(event, '${cellId}')"
                oninput="this.style.height = 'auto'; this.style.height = this.scrollHeight + 'px';"
                spellcheck="false"
                rows="1">${code}</textarea>
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
        <div class="bg-slate-900 border border-slate-700 p-2.5 rounded-lg">
            <textarea id="${cellId}-input"
                class="w-full bg-transparent border-none outline-none focus:outline-none focus:ring-0 p-0 m-0 resize-none overflow-hidden font-mono text-[11px] text-slate-200 leading-relaxed block"
                placeholder="SELECT * FROM ..."
                onkeydown="handleSqlCellKeydown(event, '${cellId}')"
                oninput="this.style.height = 'auto'; this.style.height = this.scrollHeight + 'px';"
                spellcheck="false"
                rows="3">${initialCode}</textarea>
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

  const code = cell.inputEl.value.trim();
  if (!code) return;

  if (code.includes('Materialize a SQL cell first')) {
    alert('Materialize a SQL query first, then add a Python cell from the SQL cell.');
    return;
  }

  cell.outputEl.innerHTML = '';
  cell.outputEl.classList.remove('hidden');
  cell.countEl.textContent = 'In [*] — Running...';

  socket.emit('kernel_execute', { cell_id: cellId, code });
}

async function runSqlCell(cellId) {
  const cell = cells[cellId];
  if (!cell || cell.type !== 'sql') return;

  const sql = cell.inputEl.value.trim();
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

if (SPORE_CONNECTIONS.length) {
  addCell('sql', 'SELECT 1 AS ok;');
} else {
  addCell('python');
}

const socket = io();

socket.on('connect', () => console.log('Kernel socket connected'));
socket.on('kernel_output', (chunk) => handleKernelOutput(chunk));

function interruptKernel() {
  socket.emit('kernel_interrupt');
}

function restartKernel(kernelName = 'python3') {
  socket.emit('kernel_restart', { kernel_name: kernelName });
}
