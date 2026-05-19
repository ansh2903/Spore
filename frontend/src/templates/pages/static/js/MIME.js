const MIME_RENDERERS = [
  {
    mimeType: 'application/vnd.plotly.v1+json',
    priority: 100,
    render(data, container) {
      const wrapper = document.createElement('div');
      wrapper.className = 'p-3 border-t border-slate-100';
      const plotDiv = document.createElement('div');
      plotDiv.style.width = '100%';
      plotDiv.style.minHeight = '400px';
      wrapper.appendChild(plotDiv);
      container.appendChild(wrapper);

      // If Plotly isn't loaded yet, show a helpful message instead of crashing
      if (typeof Plotly === 'undefined') {
        plotDiv.innerHTML = `<p class="text-[10px] text-red-400 font-mono">Error: Plotly.js not found in frontend.</p>`;
        return;
      }

      // Logic: Notebooks sometimes send strings, sometimes objects. 
      // Handle both so the 'JSON.parse' doesn't kill the script.
      const spec = typeof data === 'string' ? JSON.parse(data) : data;

      Plotly.newPlot(plotDiv, spec.data, spec.layout ?? {}, {
        responsive: true,
        displayModeBar: true,
      });
    }
  }, {
    mimeType: 'application/vnd.jupyter.widget-view+json',
    priority: 90,
    render(data, container) {
      // Stub — wire up ipywidgets here if needed
      const parsed = JSON.parse(data);
      container.insertAdjacentHTML('beforeend', `
        <pre class="font-mono text-[11px] p-3 text-amber-600 border-t border-slate-100">
          [Widget: ${parsed.model_id} — ipywidgets not yet connected]
        </pre>`);
    }
  },
  {
    mimeType: 'text/html',
    priority: 50,
    render(data, container) {
      // Use includes('<table>') instead of '<div>' to be more specific to dataframes
      const isTable = data.includes('<table'); 
      const componentId = `comp-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      if (isTable) {
          // Call the standalone functions directly without 'this'
          container.insertAdjacentHTML('beforeend', buildDataShell(componentId));
          
          // Use a timeout or requestAnimationFrame to ensure the DOM has rendered the shell
          // before we try to find the ID to inject the table
          setTimeout(() => initializeSmartTable(data, componentId), 0);
      } else {
          container.insertAdjacentHTML('beforeend', `
              <div class="p-4 border-t border-slate-100 prose prose-sm max-w-none">
                  ${data}
              </div>`);
      }
    }
  },
  {
    mimeType: 'image/png',
    priority: 40,
    render(data, container) {
      container.insertAdjacentHTML('beforeend', `
        <div class="p-3 border-t border-slate-100">
          <img src="data:image/png;base64,${data}"
               class="max-w-full rounded-lg shadow-sm" />
        </div>`);
    }
  },
  {
    mimeType: 'image/svg+xml',
    priority: 45,
    render(data, container) {
      container.insertAdjacentHTML('beforeend', `
        <div class="p-3 border-t border-slate-100 overflow-x-auto">
          ${data}
        </div>`);
    }
  },
  {
    mimeType: 'text/plain',
    priority: 10, // lowest — fallback only
    render(data, container) {
      container.insertAdjacentHTML('beforeend', `
        <pre class="font-mono text-[11px] p-3 text-slate-600 border-t border-slate-100 whitespace-pre-wrap m-0">${data}</pre>`);
    }
  },
  {
    mimeType: 'text/latex',
    priority: 70,
    render(data, container) {
      const wrapper = document.createElement('div');
      wrapper.className = 'p-3 border-t border-slate-100 text-[13px] text-slate-700';
      wrapper.innerHTML = data;
      container.appendChild(wrapper);

      // CRITICAL: The Offline Trigger
      if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([wrapper]).catch((err) => console.log(err));
      }
    }
  },
  {
    mimeType: 'application/json',
    priority: 60,
    render(data, container) {
      const json = typeof data === 'string' ? JSON.parse(data) : data;
      container.insertAdjacentHTML('beforeend', `
        <div class="p-3 border-t border-slate-100 bg-slate-50/50">
          <details class="cursor-pointer">
            <summary class="text-[10px] font-black text-slate-400 uppercase tracking-widest">View JSON Object</summary>
            <pre class="text-[11px] font-mono mt-2 text-blue-600">${JSON.stringify(json, null, 2)}</pre>
          </details>
        </div>`);
    }
  }
];
