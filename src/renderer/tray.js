// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', async () => {
  // Load initial status
  await loadStatus();

  // Setup button events
  document.getElementById('btnOpenLog').addEventListener('click', async () => {
    await window.electronAPI.openLog();
  });

  // Listen for client changes
  window.electronAPI.onClientsChanged((clients) => {
    updateClientList(clients);
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
    document.getElementById('port').textContent = status.port || '-';
    document.getElementById('defaultPrinter').textContent = status.defaultPrinter || '未设置';
    
    // Update clients
    updateClientList(status.clients || []);

    // Update printer list
    const printerList = document.getElementById('printerList');
    if (status.printers && status.printers.length > 0) {
      printerList.innerHTML = status.printers.map(printer => `
        <div class="list-item">
          <span class="icon">🖨</span>
          <span class="name">${escapeHtml(printer.name || '')}</span>
          ${printer.isDefault ? '<span class="tag">默认</span>' : ''}
        </div>
      `).join('');
    } else {
      printerList.innerHTML = `
        <div class="empty-state">未找到打印机</div>
      `;
    }
  } catch (error) {
    console.error('Failed to load status:', error);
    document.getElementById('printerList').innerHTML = `
      <div class="empty-state" style="color: #f44336;">加载失败</div>
    `;
  }
}

/**
 * Update the connected clients list UI
 * @param {Array<Object>} clients - List of client objects {id, title, url}
 */
function updateClientList(clients) {
  const clientBadgeEl = document.getElementById('clientBadge');
  const clientListEl = document.getElementById('clientList');
  
  const count = clients.length;
  
  // Update count and badge
  clientBadgeEl.textContent = count;
  
  if (count > 0) {
    clientBadgeEl.classList.add('active');
    clientListEl.innerHTML = clients.map(client => {
      // 优先使用 title，没有则使用 ID
      const displayName = client.title && client.title !== 'Unknown Client' 
        ? client.title 
        : `客户端 ${client.id.substring(0, 6)}`;
        
      const tooltip = client.url ? `title="${client.url}"` : '';
      // <div class="name" style="font-weight:500;">${escapeHtml(displayName)}</div>
      return `
      <div class="list-item client-item" ${tooltip}>
        <span class="icon">🌐</span>
        <div style="flex:1; overflow:hidden;">
          <div class="name" style="font-weight:500;">${client.id.substring(0,8)}</div>
          <div style="font-size:10px; color:#999; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${client.url ? escapeHtml(client.url) : 'ID: ' + client.id.substring(0,8)}
          </div>
        </div>
        <span class="tag" style="background: #4caf50;">在线</span>
      </div>
    `}).join('');
  } else {
    clientBadgeEl.classList.remove('active');
    clientListEl.innerHTML = `
      <div class="empty-state">暂无客户端连接</div>
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
