/**
 * Workspace view switching (Data / Notebook / Dashboard / Export)
 */
function setActiveView(view) {
    const panelMap = {
        data: 'dataPanel',
        analyze: 'notebookPanel',
        dashboard: 'dashboardPanel',
        export: 'exportPanel',
    };

    Object.entries(panelMap).forEach(([name, id]) => {
        const panel = document.getElementById(id);
        if (!panel) return;
        const show = name === view;
        panel.classList.toggle('hidden', !show);
        if (show) {
            panel.classList.add('flex', 'flex-col', 'flex-1', 'min-h-0', 'overflow-hidden');
        }
    });

    document.querySelectorAll('.view-tab').forEach((btn) => {
        const on = btn.dataset.view === view;
        btn.classList.toggle('bg-primary', on);
        btn.classList.toggle('text-white', on);
        btn.classList.toggle('shadow-tactile', on);
        btn.classList.toggle('text-slate-500', !on);
        btn.classList.toggle('hover:text-slate-900', !on);
        btn.classList.toggle('hover:bg-white', !on);
    });
}

function openDataPanel() {
    setActiveView('data');
}

function openNotebookPanel() {
    setActiveView('analyze');
}

function openDashboardPanel() {
    setActiveView('dashboard');
}

function openExportPanel() {
    setActiveView('export');
}

function resolveDataKind(connOrKind) {
    const kindAliasMap = {
        database: 'database',
        databases: 'database',
        db: 'database',
        warehouse: 'warehouse',
        warehouses: 'warehouse',
        'data warehouse': 'warehouse',
        'data warehouses': 'warehouse',
        api: 'api',
        apis: 'api',
        file: 'file',
        files: 'file',
        'local file': 'file',
        'local files': 'file',
        postgresql: 'database',
        mongodb: 'database',
        mysql: 'database',
        mssql: 'database',
        bigquery: 'warehouse',
        snowflake: 'warehouse',
        redshift: 'warehouse',
        rest_api: 'api',
        graphql_api: 'api',
        csv_file: 'file',
        excel_file: 'file',
        json_file: 'file',
        parquet_file: 'file',
    };

    const rawKind = typeof connOrKind === 'string'
        ? connOrKind
        : (connOrKind?.kind || connOrKind?.metadata?.kind || connOrKind?.source_type || connOrKind?.db_type || '');
    const normalized = String(rawKind).trim().toLowerCase();

    if (kindAliasMap[normalized]) return kindAliasMap[normalized];

    const sourceType = typeof connOrKind === 'string'
        ? ''
        : String(connOrKind?.source_type || connOrKind?.db_type || '').trim().toLowerCase();
    return kindAliasMap[sourceType] || 'database';
}

function setDataKind(connOrKind) {
    const kind = resolveDataKind(connOrKind);
    const map = {
        database: 'sql-data',
        warehouse: 'sql-data',
        api: 'api-data',
        file: 'files-data',
    };
    const showId = map[kind] || 'sql-data';

    ['sql-data', 'api-data', 'files-data'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        const show = id === showId;
        el.classList.toggle('hidden', !show);
        el.style.display = show ? 'flex' : 'none';
    });
}

function updateDataHeader(conn) {
    const nameEl = document.getElementById('data-header-name');
    const extEl = document.getElementById('data-header-ext');
    const vendorEl = document.getElementById('data-header-vendor');
    const contextEl = document.getElementById('data-header-context');
    const modeEl = document.getElementById('data-header-mode');

    if (!nameEl || !vendorEl || !contextEl || !modeEl) return;

    const label = conn?.display_name || conn?.name || 'Workspace';
    const kind = resolveDataKind(conn);
    const sourceType = (conn?.source_type || conn?.db_type || '').toString();

    nameEl.textContent = label;
    if (extEl) {
        extEl.textContent = kind === 'api' ? '.api' : kind === 'file' ? '.file' : '.db';
    }

    vendorEl.textContent = sourceType || '—';

    // Context: schema/dataset/path depending on kind.
    const meta = conn?.metadata || {};
    if (kind === 'database') contextEl.textContent = meta.schema || 'public';
    else if (kind === 'warehouse') contextEl.textContent = meta.dataset || meta.schema || 'default';
    else if (kind === 'api') contextEl.textContent = 'Requests';
    else if (kind === 'file') contextEl.textContent = 'Preview';
    else contextEl.textContent = '—';

    modeEl.textContent = kind === 'api' ? 'Request' : kind === 'file' ? 'Preview' : 'Query';
}

/**
 * Data panel sub-tabs: query | preview | filters
 */
function setDataTab(tab) {
    ['query', 'preview', 'filters'].forEach((name) => {
        const pane = document.getElementById('data-tab-' + name);
        if (pane) pane.classList.toggle('hidden', name !== tab);
    });

    const queryActions = document.getElementById('data-tab-query-actions');
    if (queryActions) queryActions.classList.toggle('hidden', tab !== 'query');

    document.querySelectorAll('.data-work-tab').forEach((btn) => {
        const on = btn.dataset.tab === tab;
        btn.classList.toggle('bg-primary', on);
        btn.classList.toggle('text-white', on);
        btn.classList.toggle('shadow-tactile', on);
        btn.classList.toggle('text-slate-500', !on);
        btn.classList.toggle('hover:text-slate-900', !on);
        btn.classList.toggle('hover:bg-white', !on);
    });
}

/**
 * Make the preview overlay's top edge draggable so the user can shrink/grow
 * the result table while the SQL/NoSQL editor flexes underneath.
 */
function initPreviewResize() {
    const handle = document.getElementById('preview-resize-handle');
    const preview = document.getElementById('data-tab-preview');
    if (!handle || !preview) return;

    const container = preview.parentElement;
    if (!container) return;

    let dragging = false;

    const onMove = (clientY) => {
        const rect = container.getBoundingClientRect();
        const relative = clientY - rect.top;
        // Clamp so the editor and the preview each keep a sensible minimum.
        const minTop = 80;
        const maxTop = rect.height - 80;
        const clamped = Math.max(minTop, Math.min(maxTop, relative));
        const pct = (clamped / rect.height) * 100;
        preview.style.top = `${pct}%`;
    };

    handle.addEventListener('mousedown', (e) => {
        dragging = true;
        e.preventDefault();
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        onMove(e.clientY);
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        document.body.style.userSelect = '';
    });

    handle.addEventListener('touchstart', (e) => {
        dragging = true;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!dragging || !e.touches[0]) return;
        onMove(e.touches[0].clientY);
    }, { passive: true });

    document.addEventListener('touchend', () => {
        dragging = false;
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setActiveView('data');
    initPreviewResize();
});
