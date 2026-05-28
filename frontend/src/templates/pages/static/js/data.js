/**
 * Data panel editor: Monaco-backed SQL / NoSQL input wired to
 * /query-preview (preview) and /ingest (pull to local volume).
 *
 * Public API exposed on window (used by buttons in chat.html):
 *   - runDataPreview()         → streams query results into the overlay table
 *   - materializeDataQuery()   → pulls the query result to a local volume
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
            '-- Select a connection on the left and write a query.\n' +
            '-- Press Shift+Enter (or Ctrl/Cmd+Enter) to run a preview.\n' +
            '\n' +
            'SELECT *\n' +
            'FROM information_schema.tables\n' +
            'LIMIT 100;\n',
        json:
            '// NoSQL query — runs against the selected document store.\n' +
            '{\n' +
            '    "collection": "events",\n' +
            '    "filter": {},\n' +
            '    "limit": 100\n' +
            '}\n',
    };

    const PREVIEW_LIMIT = 200;

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
    }

    function renderColumns(cols) {
        const head = document.getElementById('data-result-head-row');
        if (!head) return;
        head.innerHTML = cols.map(c => `
            <th class="px-3 py-2 font-black text-slate-500 uppercase tracking-widest text-[9px]">${escapeHtml(c)}</th>
        `).join('');
    }

    function appendRows(rows) {
        const body = document.getElementById('data-result-tbody');
        if (!body) return;
        const html = rows.map(row => {
            const cells = Object.values(row).map(v =>
                `<td class="px-3 py-1.5">${
                    v === null || v === undefined
                        ? '<span class="text-slate-300 italic">null</span>'
                        : escapeHtml(String(v))
                }</td>`
            ).join('');
            return `<tr class="border-b border-slate-100 hover:bg-primary-soft/30">${cells}</tr>`;
        }).join('');
        body.insertAdjacentHTML('beforeend', html);
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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

        setStatus('Running…', 'running');
        clearResultTable();
        setResultMeta('— rows · — cols · — ms');

        const formData = new FormData();
        formData.append('query', query);
        formData.append('id', conn.id);

        let totalRows = 0;
        let dbTotalRows = null;
        let columnCount = 0;
        const t0 = performance.now();

        try {
            const response = await fetch('/query-preview', { method: 'POST', body: formData });
            if (!response.ok || !response.body) {
                setStatus(`HTTP ${response.status}`, 'error');
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
                        const prev = totalRows;
                        totalRows += data.content.length;
                        if (prev < PREVIEW_LIMIT) {
                            appendRows(data.content.slice(0, PREVIEW_LIMIT - prev));
                        }
                    } else if (data.type === 'error') {
                        setStatus(`Error: ${data.content}`, 'error');
                        setResultMeta('Query failed');
                        return;
                    }
                }
            }

            const elapsed = Math.round(performance.now() - t0);
            const rowsLabel = (dbTotalRows !== null && dbTotalRows !== 'unknown')
                ? Number(dbTotalRows).toLocaleString()
                : totalRows.toLocaleString();
            setResultMeta(`${rowsLabel} rows · ${columnCount} cols · ${elapsed} ms`);
            setStatus('Done', 'idle');
        } catch (e) {
            setStatus(`Failed: ${e.message || e}`, 'error');
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
