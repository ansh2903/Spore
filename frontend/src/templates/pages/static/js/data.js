/**
 * Data panel editor: Monaco-backed SQL / NoSQL input wired to
 * /query-preview (preview) and /ingest (pull to local volume).
 *
 * Public API exposed on window (used by buttons in chat.html):
 *   - runDataPreview()         → streams query results into the overlay table
 *   - materializeDataQuery()   → pulls the query result to a local volume
 *   - filterDataResults()      → client-side filter for the result table
 *   - clearDataResultsSearch() → clears the row filter
 *   - setDataPreviewTab(tab)   → switches between 'results' and 'history'
 *   - restoreHistoryEntry(id)  → loads a past query back into the editor
 *   - clearQueryHistory()      → wipes stored history (with confirm)
 */
(() => {
    // Source-type → editor language. Anything not listed falls back to SQL.
    const LANGUAGE_BY_SOURCE_TYPE = {
        postgresql: 'sql',
        bigquery: 'sql',
        snowflake: 'sql',
        mysql: 'sql',
        mssql: 'sql',
        redshift: 'sql',
        mongodb: 'json',
    };

    const DEFAULT_QUERIES = {
        sql:
            'SELECT *\n' +
            'FROM information_schema.tables\n' +
            'LIMIT 100;\n',
        json:
            '{\n' +
            '    "collection": "events",\n' +
            '    "filter": {},\n' +
            '    "limit": 100\n' +
            '}\n',
    };

    let editor = null;
    let currentLanguage = 'sql';

    // ── helpers ─────────────────────────────────────────────────────────────

    function getConnections() {
        return Array.isArray(window.SPORE_CONNECTIONS) ? window.SPORE_CONNECTIONS : [];
    }

    function getActiveConnection() {
        const select = document.getElementById('selected_db_id');
        if (!select) return null;
        const id = select.value;
        return getConnections().find(c => String(c.id) === String(id)) || null;
    }

    function languageForConnection(conn) {
        if (!conn) return 'sql';
        const sourceType = String(conn.source_type || conn.db_type || '').toLowerCase();
        return LANGUAGE_BY_SOURCE_TYPE[sourceType] || 'sql';
    }

    function setStatus(text, tone = 'idle') {
        const el = document.getElementById('data-editor-status');
        if (!el) return;
        el.textContent = text;
        el.classList.remove('text-slate-500', 'text-primary', 'text-amber-400', 'text-rose-400');
        if (tone === 'running') el.classList.add('text-primary');
        else if (tone === 'warn') el.classList.add('text-amber-400');
        else if (tone === 'error') el.classList.add('text-rose-400');
        else el.classList.add('text-slate-500');
    }

    function setLanguageLabel(lang) {
        const el = document.getElementById('data-editor-lang');
        if (el) el.textContent = lang === 'json' ? 'NoSQL' : 'SQL';
    }

    function setResultMeta(text) {
        const el = document.getElementById('data-result-meta');
        if (el) el.textContent = text;
    }

    function clearResultTable() {
        const head = document.getElementById('data-result-head-row');
        const body = document.getElementById('data-result-tbody');
        if (head) head.innerHTML = '';
        if (body) body.innerHTML = '';
        updateMatchCounter();
    }

    function renderColumns(cols) {
        const head = document.getElementById('data-result-head-row');
        if (!head) return;
        head.innerHTML = cols.map(c => `
            <th class="px-3 py-2 text-left text-[9px] font-black tracking-wider text-slate-500 whitespace-nowrap">${escapeHtml(c)}</th>
        `).join('');
    }

    function appendRows(rows) {
        const body = document.getElementById('data-result-tbody');
        if (!body) return;

        const startIndex = body.querySelectorAll('tr').length;

        const html = rows.map((row, i) => {
            const rowIndex = startIndex + i;
            const stripe = rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/50';
            const cells = Object.values(row).map((v) => {
                const cell = (v === null || v === undefined)
                    ? '<span class="text-slate-300 italic">null</span>'
                    : escapeHtml(String(v));
                return `<td class="px-3 py-1.5 text-[11px] text-slate-700 font-medium whitespace-nowrap border-b border-slate-100">${cell}</td>`;
            }).join('');
            return `<tr class="${stripe} hover:bg-primary-soft/30 transition-colors">${cells}</tr>`;
        }).join('');

        body.insertAdjacentHTML('beforeend', html);
        applyResultFilter();
    }

    function hasKnownTotal(dbTotalRows) {
        return dbTotalRows !== null
            && dbTotalRows !== undefined
            && dbTotalRows !== 'unknown'
            && !Number.isNaN(Number(dbTotalRows));
    }

    function formatStreamingMeta(limit, dbTotalRows) {
        const showing = `Showing ${Number(limit).toLocaleString()}`;
        if (!hasKnownTotal(dbTotalRows)) return showing;
        return `Total: ${Number(dbTotalRows).toLocaleString()} · ${showing}`;
    }

    function formatFinalMeta(streamedRows, dbTotalRows, columnCount, elapsedMs) {
        const parts = [];
        if (hasKnownTotal(dbTotalRows)) {
            parts.push(`Total: ${Number(dbTotalRows).toLocaleString()}`);
        }
        parts.push(`Showing ${Number(streamedRows).toLocaleString()}`);
        parts.push(`${columnCount} cols`);
        parts.push(`${elapsedMs.toLocaleString()} ms`);
        return parts.join(' · ');
    }

    // ── Limit input ─────────────────────────────────────────────────────────

    const LIMIT_MIN = 1;
    const LIMIT_MAX = 100_000;

    function readPreviewLimit() {
        const input = document.getElementById('data-row-limit');
        const raw = (input?.value ?? '').trim();
        const parsed = parseInt(raw, 10);
        if (!Number.isFinite(parsed)) return { ok: false, value: parsed, input };
        if (parsed < LIMIT_MIN || parsed > LIMIT_MAX) return { ok: false, value: parsed, input };
        return { ok: true, value: parsed, input };
    }

    // ── Result table client-side filter ─────────────────────────────────────

    function getResultSearchTerm() {
        const input = document.getElementById('data-result-search');
        return (input?.value || '').trim().toLowerCase();
    }

    function applyResultFilter() {
        const body = document.getElementById('data-result-tbody');
        if (!body) return;

        const term = getResultSearchTerm();
        const rows = body.querySelectorAll('tr');

        if (!term) {
            rows.forEach((tr) => { tr.style.display = ''; });
            updateMatchCounter(rows.length, rows.length);
            return;
        }

        let matched = 0;
        rows.forEach((tr) => {
            const text = (tr.textContent || '').toLowerCase();
            const hit = text.includes(term);
            tr.style.display = hit ? '' : 'none';
            if (hit) matched++;
        });
        updateMatchCounter(matched, rows.length);
    }

    function updateMatchCounter(matched, total) {
        const el = document.getElementById('data-result-match');
        if (!el) return;

        const body = document.getElementById('data-result-tbody');
        if (matched === undefined || total === undefined) {
            const all = body ? body.querySelectorAll('tr').length : 0;
            const visible = body ? body.querySelectorAll('tr:not([style*="display: none"])').length : 0;
            matched = visible;
            total = all;
        }

        if (total === 0) {
            el.textContent = '— matches';
            return;
        }
        if (matched === total) {
            el.textContent = `${total.toLocaleString()} rows`;
        } else {
            el.textContent = `${matched.toLocaleString()} / ${total.toLocaleString()} match`;
        }
    }

    function filterDataResults() {
        applyResultFilter();
    }

    function clearDataResultsSearch() {
        const input = document.getElementById('data-result-search');
        if (input) input.value = '';
        applyResultFilter();
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ── Query history ───────────────────────────────────────────────────────

    const HISTORY_KEY = 'spore_data_history';
    const HISTORY_LIMIT = 50;

    function loadHistory() {
        try {
            const raw = localStorage.getItem(HISTORY_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    function saveHistory(list) {
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_LIMIT)));
        } catch {
            // Storage quota or disabled — silently ignore; in-memory list still works.
        }
    }

    function pushHistoryEntry(entry) {
        const list = loadHistory();
        list.unshift({
            id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Date.now(),
            ...entry,
        });
        saveHistory(list);
        renderQueryHistory();
    }

    function relativeTime(ts) {
        const diff = Math.max(0, (Date.now() - ts) / 1000);
        if (diff < 45) return 'just now';
        if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
        if (diff < 604800) return `${Math.round(diff / 86400)}d ago`;
        return new Date(ts).toLocaleString();
    }

    function setHistoryCount(n) {
        const el = document.getElementById('data-history-count');
        if (!el) return;
        el.textContent = String(n);
        el.classList.toggle('bg-primary-soft', n > 0);
        el.classList.toggle('text-primary-dark', n > 0);
        el.classList.toggle('bg-slate-200', n === 0);
        el.classList.toggle('text-slate-600', n === 0);
    }

    function renderQueryHistory() {
        const list = document.getElementById('data-history-list');
        const empty = document.getElementById('data-history-empty');
        if (!list || !empty) return;

        const history = loadHistory();
        setHistoryCount(history.length);

        if (history.length === 0) {
            list.innerHTML = '';
            empty.classList.remove('hidden');
            empty.classList.add('flex');
            return;
        }
        empty.classList.add('hidden');
        empty.classList.remove('flex');

        list.innerHTML = history.map((h) => {
            const langLabel = h.language === 'json' ? 'NoSQL' : 'SQL';
            const isOk = h.status === 'success';
            const statusBadge = isOk
                ? `<span class="inline-flex items-center gap-1 h-5 px-2 rounded-pill bg-primary-soft border border-primary/20 text-[8px] font-black uppercase tracking-widest text-primary-dark">
                       <span class="w-1.5 h-1.5 rounded-pill bg-primary"></span>OK
                   </span>`
                : `<span class="inline-flex items-center gap-1 h-5 px-2 rounded-pill bg-rose-50 border border-rose-200 text-[8px] font-black uppercase tracking-widest text-rose-500">
                       <span class="w-1.5 h-1.5 rounded-pill bg-rose-500"></span>Error
                   </span>`;
            const shown = Number(h.rowCount ?? 0).toLocaleString();
            const rowsLabel = (h.totalRows !== null && h.totalRows !== undefined)
                ? `${shown} / ${Number(h.totalRows).toLocaleString()} rows`
                : `${shown} rows`;
            const stats = isOk
                ? `${rowsLabel} · ${h.colCount ?? 0} cols · ${(h.elapsedMs ?? 0).toLocaleString()} ms`
                : (h.errorMessage || 'Query failed');

            return `
                <div class="group flex flex-col gap-1.5 px-3 py-3 hover:bg-slate-50/80 transition-colors cursor-pointer"
                    onclick="restoreHistoryEntry('${h.id}')"
                    title="Click to restore in the editor">
                    <div class="flex items-center justify-between gap-2 min-w-0">
                        <div class="flex items-center gap-2 min-w-0">
                            ${statusBadge}
                            <span class="inline-flex items-center h-5 px-2 rounded-pill bg-slate-50 border border-slate-200 text-[8px] font-black uppercase tracking-widest text-slate-500">
                                ${langLabel}
                            </span>
                            <span class="text-[9px] font-mono text-slate-500 truncate">
                                ${escapeHtml(h.connectionLabel || '—')}
                            </span>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                            <span class="text-[9px] font-mono text-slate-400">${escapeHtml(relativeTime(h.timestamp))}</span>
                            <button type="button"
                                onclick="event.stopPropagation(); restoreHistoryEntry('${h.id}')"
                                class="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 h-6 px-2 rounded-pill bg-white border border-slate-200 text-[9px] font-black uppercase tracking-widest text-slate-600 hover:text-primary hover:border-primary/40 transition-all">
                                <span class="material-symbols-outlined text-[12px]">arrow_upward</span>
                                Restore
                            </button>
                        </div>
                    </div>
                    <pre class="text-[10.5px] font-mono text-slate-700 whitespace-pre-wrap line-clamp-2 leading-snug m-0">${escapeHtml(h.query || '')}</pre>
                    <span class="text-[9px] font-mono ${isOk ? 'text-slate-400' : 'text-rose-400'}">${escapeHtml(stats)}</span>
                </div>
            `;
        }).join('');
    }

    function restoreHistoryEntry(id) {
        const entry = loadHistory().find((h) => h.id === id);
        if (!entry || !editor) return;
        editor.setValue(entry.query || '');
        editor.focus();
        setDataPreviewTab('results');
        setStatus('Query restored', 'idle');
    }

    function clearQueryHistory() {
        if (!window.confirm('Clear all saved query history?')) return;
        try { localStorage.removeItem(HISTORY_KEY); } catch { /* noop */ }
        renderQueryHistory();
    }

    function setDataPreviewTab(tab) {
        const showResults = tab !== 'history';

        const resultsPane = document.getElementById('data-results-pane');
        const historyPane = document.getElementById('data-history-pane');
        const resultsCtrl = document.getElementById('data-tab-controls-results');
        const historyCtrl = document.getElementById('data-tab-controls-history');

        if (resultsPane) resultsPane.classList.toggle('hidden', !showResults);
        if (historyPane) historyPane.classList.toggle('hidden', showResults);
        if (resultsCtrl) {
            resultsCtrl.classList.toggle('hidden', !showResults);
            resultsCtrl.classList.toggle('flex', showResults);
        }
        if (historyCtrl) {
            historyCtrl.classList.toggle('hidden', showResults);
            historyCtrl.classList.toggle('flex', !showResults);
        }

        document.querySelectorAll('.data-preview-tab').forEach((btn) => {
            const isActive = btn.dataset.dataTab === (showResults ? 'results' : 'history');
            btn.classList.toggle('bg-primary', isActive);
            btn.classList.toggle('text-white', isActive);
            btn.classList.toggle('shadow-tactile', isActive);
            btn.classList.toggle('text-slate-500', !isActive);
            btn.classList.toggle('hover:text-slate-900', !isActive);
            btn.classList.toggle('hover:bg-white', !isActive);
        });

        if (!showResults) renderQueryHistory();
    }

    // ── Monaco setup ────────────────────────────────────────────────────────

    function defineDataTheme(monaco) {
        if (window.__sporeDataThemeReady) return;
        window.__sporeDataThemeReady = true;
        monaco.editor.defineTheme('spore-data', {
            base: 'vs-dark',
            inherit: true,
            rules: [
                { token: 'keyword', foreground: '34d399', fontStyle: 'bold' },
                { token: 'keyword.sql', foreground: '34d399', fontStyle: 'bold' },
                { token: 'string', foreground: 'a7f3d0' },
                { token: 'string.sql', foreground: 'a7f3d0' },
                { token: 'number', foreground: 'fde68a' },
                { token: 'operator', foreground: '94a3b8' },
                { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
                { token: 'identifier', foreground: 'e2e8f0' },
                { token: 'predefined.sql', foreground: '7dd3fc' },
            ],
            colors: {
                'editor.background': '#0f172a',
                'editor.foreground': '#e2e8f0',
                'editorCursor.foreground': '#00A36C',
                'editor.lineHighlightBackground': '#1e293b',
                'editorLineNumber.foreground': '#475569',
                'editorLineNumber.activeForeground': '#94a3b8',
                'editor.selectionBackground': '#065f46',
                'editor.inactiveSelectionBackground': '#064e3b',
                'editorIndentGuide.background': '#1e293b',
                'editorIndentGuide.activeBackground': '#334155',
                'editorWidget.background': '#0f172a',
                'editorWidget.border': '#1e293b',
                'editorSuggestWidget.background': '#0f172a',
                'editorSuggestWidget.border': '#1e293b',
                'editorSuggestWidget.foreground': '#e2e8f0',
                'editorSuggestWidget.selectedBackground': '#065f46',
            },
        });
    }

    function initEditor(monaco) {
        const mount = document.getElementById('data-editor-mount');
        if (!mount) return;

        defineDataTheme(monaco);

        const lang = languageForConnection(getActiveConnection());
        currentLanguage = lang;
        setLanguageLabel(lang);

        editor = monaco.editor.create(mount, {
            value: DEFAULT_QUERIES[lang],
            language: lang === 'json' ? 'json' : 'sql',
            theme: 'spore-data',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            fontSize: 12,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            lineNumbers: 'on',
            renderLineHighlight: 'line',
            wordWrap: 'on',
            padding: { top: 10, bottom: 10 },
            tabSize: 2,
            smoothScrolling: true,
            scrollbar: { vertical: 'auto', horizontal: 'auto' },
        });

        editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => runDataPreview());
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runDataPreview());

        // Stash globally for any debugging / external integrations.
        window.dataEditor = editor;
    }

    function setEditorLanguage(lang) {
        if (!editor || !window.monaco) {
            currentLanguage = lang;
            setLanguageLabel(lang);
            return;
        }
        if (currentLanguage === lang) return;

        const model = editor.getModel();
        if (!model) return;

        window.monaco.editor.setModelLanguage(model, lang === 'json' ? 'json' : 'sql');

        // Swap the default boilerplate if the user hasn't started typing.
        const current = (model.getValue() || '').trim();
        const previousDefault = (DEFAULT_QUERIES[currentLanguage] || '').trim();
        if (!current || current === previousDefault) {
            editor.setValue(DEFAULT_QUERIES[lang]);
        }

        currentLanguage = lang;
        setLanguageLabel(lang);
    }

    function syncEditorWithConnection() {
        const conn = getActiveConnection();
        setEditorLanguage(languageForConnection(conn));
    }

    // ── Run / materialize ───────────────────────────────────────────────────

    async function runDataPreview() {
        if (!editor) return;

        const conn = getActiveConnection();
        if (!conn) {
            setStatus('Pick a connection first', 'warn');
            return;
        }

        const query = (editor.getValue() || '').trim();
        if (!query) {
            setStatus('Editor is empty', 'warn');
            return;
        }

        const { ok, value: limit, input: limitInput } = readPreviewLimit();
        if (!ok) {
            setStatus(`Limit must be a whole number between ${LIMIT_MIN} and ${LIMIT_MAX.toLocaleString()}`, 'warn');
            limitInput?.focus();
            limitInput?.select?.();
            return;
        }
        // Snap the input back to the parsed value so the user sees what we sent.
        if (limitInput) limitInput.value = String(limit);

        setStatus('Running…', 'running');
        clearResultTable();
        setResultMeta('— rows · — cols · — ms');

        // Reset any active row filter so new rows aren't hidden by stale text.
        const searchInput = document.getElementById('data-result-search');
        if (searchInput) searchInput.value = '';
        updateMatchCounter(0, 0);

        const formData = new FormData();
        formData.append('query', query);
        formData.append('id', conn.id);
        formData.append('limit', String(limit));

        let streamedRows = 0;
        let dbTotalRows = null;
        let columnCount = 0;
        const t0 = performance.now();

        // Snapshot connection/language for the history entry — these can change
        // mid-run if the user switches the dropdown.
        const historyBase = {
            query,
            limit,
            language: currentLanguage,
            connectionId: conn.id,
            connectionLabel: conn.display_name || conn.name || conn.alias || conn.id,
        };

        try {
            const response = await fetch('/query-preview', { method: 'POST', body: formData });
            if (!response.ok || !response.body) {
                setStatus(`HTTP ${response.status}`, 'error');
                pushHistoryEntry({
                    ...historyBase,
                    status: 'error',
                    errorMessage: `HTTP ${response.status}`,
                    elapsedMs: Math.round(performance.now() - t0),
                });
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    let data;
                    try { data = JSON.parse(line.slice(6)); } catch { continue; }

                    if (data.type === 'columns') {
                        renderColumns(data.content);
                        columnCount = data.content.length;
                    } else if (data.type === 'metadata') {
                        dbTotalRows = data.total_rows;
                    } else if (data.type === 'rows') {
                        appendRows(data.content);
                    } else if (data.type === 'error') {
                        setStatus(`Error: ${data.content}`, 'error');
                        setResultMeta('Query failed');
                        pushHistoryEntry({
                            ...historyBase,
                            status: 'error',
                            errorMessage: String(data.content || 'Query failed'),
                            elapsedMs: Math.round(performance.now() - t0),
                        });
                        return;
                    }
                }
            }

            const elapsed = Math.round(performance.now() - t0);
            setResultMeta(formatFinalMeta(limit, dbTotalRows, columnCount, elapsed));
            setStatus('Done', 'idle');

            pushHistoryEntry({
                ...historyBase,
                status: 'success',
                rowCount: streamedRows,
                totalRows: hasKnownTotal(dbTotalRows) ? Number(dbTotalRows) : null,
                colCount: columnCount,
                elapsedMs: elapsed,
            });
        } catch (e) {
            const message = e?.message || String(e);
            setStatus(`Failed: ${message}`, 'error');
            pushHistoryEntry({
                ...historyBase,
                status: 'error',
                errorMessage: message,
                elapsedMs: Math.round(performance.now() - t0),
            });
        }
    }

    async function materializeDataQuery() {
        if (!editor) return;

        const conn = getActiveConnection();
        if (!conn) {
            setStatus('Pick a connection first', 'warn');
            return;
        }
        
        const query = (editor.getValue() || '').trim();
        if (!query) {
            setStatus('Editor is empty', 'warn');
            return;
        }

        const streamInput = document.getElementById('data-stream-name');
        const streamName = (streamInput?.value || `stream_${conn.id}`).trim() || `stream_${conn.id}`;

        setStatus(`Pulling → ${streamName}…`, 'running');

        const formData = new FormData();
        formData.append('query', query);
        formData.append('id', conn.id);
        formData.append('stream_name', streamName);

        try {
            const response = await fetch('/ingest', { method: 'POST', body: formData });
            const result = await response.json().catch(() => ({}));

            if (response.ok && result.status === 'success') {
                setStatus(`Pulled → ${result.path || streamName}`, 'idle');
                if (typeof window.loadStreams === 'function') {
                    try { window.loadStreams(); } catch { /* noop */ }
                }
            } else {
                setStatus(`Pull failed: ${result.message || `HTTP ${response.status}`}`, 'error');
            }
        } catch (e) {
            setStatus(`Pull failed: ${e.message || e}`, 'error');
        }
    }

    // ── boot ────────────────────────────────────────────────────────────────

    function boot() {
        // Render the history badge + list immediately so the count reflects
        // anything persisted from a previous session even before Monaco loads.
        renderQueryHistory();

        if (!window.monacoReady) {
            // Loader script not present; nothing to do.
            return;
        }

        window.monacoReady.then((monaco) => {
            initEditor(monaco);

            const select = document.getElementById('selected_db_id');
            if (select) {
                select.addEventListener('change', () => syncEditorWithConnection());
            }
            // Hydrate language from whatever was preselected.
            syncEditorWithConnection();
        });
    }

    // Expose the API for inline button onclick handlers in chat.html.
    window.runDataPreview = runDataPreview;
    window.materializeDataQuery = materializeDataQuery;
    window.filterDataResults = filterDataResults;
    window.clearDataResultsSearch = clearDataResultsSearch;
    window.setDataPreviewTab = setDataPreviewTab;
    window.restoreHistoryEntry = restoreHistoryEntry;
    window.clearQueryHistory = clearQueryHistory;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
