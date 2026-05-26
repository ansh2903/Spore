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

document.addEventListener('DOMContentLoaded', () => {
    setActiveView('data');
});
