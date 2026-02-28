// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', async () => {
  // Load status
  await loadStatus();

  // Setup button events
  document.getElementById('btnOpenLog').addEventListener('click', async () => {
    await window.electronAPI.openLog();
  });

  document.getElementById('btnLogFolder').addEventListener('click', async () => {
    await window.electronAPI.openLogFolder();
  });
});

/**
 * Load and display service status
 */
async function loadStatus() {
  try {
    const status = await window.electronAPI.getStatus();

    // Update info
    document.getElementById('version').textContent = status.version || '1.0.0';
    document.getElementById('port').textContent = status.port || '8765';
    document.getElementById('defaultPrinter').textContent = status.defaultPrinter || '未设置';
    // document.getElementById('logPath').textContent = status.logPath || '-';

    // Update printer list
    const printerList = document.getElementById('printerList');
    if (status.printers && status.printers.length > 0) {
      printerList.innerHTML = status.printers.map(printer => `
        <div class="printer-item">
          <span class="icon">🖨</span>
          <span class="name">${escapeHtml(printer.name || '')}</span>
          ${printer.isDefault ? '<span class="default-badge">默认</span>' : ''}
        </div>
      `).join('');
    } else {
      printerList.innerHTML = `
        <div class="printer-item">
          <span class="icon">⚠️</span>
          <span class="name">未找到打印机</span>
        </div>
      `;
    }
  } catch (error) {
    console.error('Failed to load status:', error);
    document.getElementById('printerList').innerHTML = `
      <div class="printer-item">
        <span class="icon">❌</span>
        <span class="name">加载失败</span>
      </div>
    `;
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
