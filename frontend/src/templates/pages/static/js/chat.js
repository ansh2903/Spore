function toggleChatPanel() {
    const panel = document.getElementById('chat-panel');
    const gutter = document.getElementById('resizer');
    
    panel.classList.toggle('w-[400px]');
    panel.classList.toggle('xl:w-[400px]');
    panel.classList.toggle('w-0');
    panel.classList.toggle('p-0');
    panel.classList.toggle('border-l-0');
    gutter.classList.toggle('hidden');
    panel.classList.toggle('hidden');
}
 
document.addEventListener('DOMContentLoaded', () => {
    const resizer = document.getElementById('resizer');
    const panel = document.getElementById('chat-panel');
    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        e.preventDefault(); 
        
        document.body.classList.add('select-none');
        document.body.style.cursor = 'col-resize';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        let newWidth = window.innerWidth - e.clientX - 56;

        const minWidth = 280;
        const maxWidth = window.innerWidth * 0.6;

        if (newWidth < minWidth) {
            newWidth = minWidth;
        } else if (newWidth > maxWidth) {
            newWidth = maxWidth;
        }

        panel.style.width = `${newWidth}px`;
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.classList.remove('select-none');
            document.body.style.cursor = '';
        }
    });
});