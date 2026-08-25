const socket = io();
  let availableCommands = [];
  let allBlacklistEntries = [];
  let currentEditingUser = null;
  let allLogs = [];

  // ========== Navigation ==========
  function showTab(tab) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('[id^="nav-"]').forEach(el => el.classList.remove('active'));
    document.getElementById('content-' + tab).classList.add('active');
    document.getElementById('nav-' + tab).classList.add('active');
    if (tab === 'statistics') loadStatistics();
    if (tab === 'permissions') loadPermissions();
    if (tab === 'blacklist') loadBlacklistUI();
    if (tab === 'settings') loadSettings();
    if (tab === 'fkdr') loadFkdrTab();
    if (tab === 'dashboard') loadDashboard();
  }

  // ========== Toast Notifications ==========
  function toast(msg, type='info') {
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    const icons = {success:'✅', error:'❌', info:'ℹ️', warning:'⚠️'};
    t.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
    container.appendChild(t);
    setTimeout(() => {
      t.style.animation = 'slideOut 0.3s forwards';
      setTimeout(() => t.remove(), 300);
    }, 3500);
  }

  // ========== Socket Events ==========
  socket.on('minecraft-chat', d => {
    const chat = document.getElementById('chat');
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="time">[${d.time}]</span>${escapeHtml(d.message)}`;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    if (chat.children.length > 200) chat.removeChild(chat.firstChild);
  });

  socket.on('bot-log', d => {
    const entry = { time: d.time, type: d.type, msg: d.msg };
    allLogs.unshift(entry);
    if (allLogs.length > 200) allLogs.pop();
    renderLogs();
    updateNavBlacklistBadge();
  });

  socket.on('stats-update', s => {
    document.getElementById('uptime').textContent = s.uptime;
    document.getElementById('commands').textContent = s.commands;
    document.getElementById('messages').textContent = s.messages;
  });

  socket.on('bot-status', status => {
    const el = document.getElementById('botStatusLabel');
    const sb = document.getElementById('sidebarStatus');
    const sbText = document.getElementById('sidebarStatusText');
    const colors = { online:'#34d399', offline:'#f87171', connecting:'#fbbf24' };
    const labels = { online:'ONLINE', offline:'OFFLINE', connecting:'CONNECTING' };
    el.style.color = colors[status] || '#fbbf24';
    el.textContent = labels[status] || status.toUpperCase();
    sb.className = 'status-badge ' + (status === 'online' ? 'online' : status === 'offline' ? 'offline' : 'connecting');
    sbText.textContent = labels[status] || status.toUpperCase();
  });

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ========== Chat ==========
  async function sendMsg() {
    const input = document.getElementById('msgInput');
    const msg = input.value.trim();
    if (!msg) return;
    const res = await fetch('/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({message:msg}) });
    const d = await res.json();
    if (d.success) { input.value = ''; toast('Message sent!', 'success'); }
    else toast('Bot not ready: ' + d.message, 'error');
  }

  async function sendChatMsg() {
    const input = document.getElementById('chatMsgInput');
    const msg = input.value.trim();
    if (!msg) return;
    const res = await fetch('/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({message:msg}) });
    const d = await res.json();
    if (d.success) { input.value = ''; toast('Sent!', 'success'); }
    else toast('Bot not ready', 'error');
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeEditModal();
    if (e.key === 'Enter' && document.activeElement.id === 'msgInput') sendMsg();
    if (e.key === 'Enter' && document.activeElement.id === 'chatMsgInput') sendChatMsg();
  });

  // ========== Bot Control ==========
  async function botAction(action) {
    const labels = { start:'Starting bot...', disconnect:'Disconnecting...', reconnect:'Reconnecting...' };
    toast(labels[action] || action, 'info');
    const res = await fetch('/api/bot/' + action, { method:'POST' });
    const d = await res.json();
    if (d.success) toast(d.message, 'success');
    else toast(d.message, 'error');
  }

  async function clearCache() {
    const res = await fetch('/api/cache/clear', { method:'POST' });
    const d = await res.json();
    toast('Cache cleared', 'success');
    document.getElementById('cacheSize').textContent = '0 items';
  }

  // ========== Dashboard ==========
  async function loadDashboard() {
    document.getElementById('lastRefresh').textContent = 'Refreshed ' + new Date().toLocaleTimeString();
    try {
      const [statsRes, activityRes, sysRes] = await Promise.all([
        fetch('/api/stats'), fetch('/api/activity'), fetch('/api/system-info')
      ]);
      const stats = await statsRes.json();
      const activity = await activityRes.json();
      const sys = await sysRes.json();

      document.getElementById('cacheSize').textContent = (stats.cacheSize || 0) + ' items';
      document.getElementById('reconnectCount').textContent = (stats.reconnectAttempts || 0) + ' reconnects';
      document.getElementById('apiCallsStat').textContent = stats.apiCallCount || 0;
      document.getElementById('apiQueueStat').textContent = 'Queue: ' + (stats.queueLength || 0);

      const upHrs = stats.uptimeMs ? stats.uptimeMs / 3600000 : 0;
      document.getElementById('commandsPerHour').textContent = (upHrs > 0 ? Math.round(stats.commandCount / upHrs) : 0) + '/hr';
      document.getElementById('messagesPerHour').textContent = (upHrs > 0 ? Math.round(stats.messageCount / upHrs) : 0) + '/hr';

      renderMiniCommandChart(stats.topCommands || []);
      renderActivityList(activity.recent || [], 'dashActivity', 8);

      document.getElementById('sysMemory').textContent = sys.memoryUsed + ' MB';
      document.getElementById('sysPid').textContent = sys.pid;
      document.getElementById('sysNode').textContent = sys.nodeVersion;
    } catch(err) { console.error(err); }
  }

  function renderMiniCommandChart(topCmds) {
    const el = document.getElementById('dashCommandChart');
    if (!topCmds.length) { el.innerHTML = '<div style="color:var(--text3);text-align:center;padding:12px;">No data yet</div>'; return; }
    const max = Math.max(...topCmds.map(c => c.count));
    el.innerHTML = topCmds.slice(0, 7).map(cmd => `
      <div style="display:flex;align-items:center;gap:8px;">
        <code style="width:70px;text-align:right;">!${cmd.command}</code>
        <div class="prog-bar" style="flex:1;">
          <div class="prog-fill" style="width:${max>0?(cmd.count/max)*100:0}%;background:linear-gradient(90deg,#7c3aed,#a78bfa);"></div>
        </div>
        <span style="font-size:12px;color:var(--text2);width:30px;text-align:right;">${cmd.count}</span>
      </div>
    `).join('');
  }

  function renderActivityList(activity, containerId, limit=15) {
    const list = document.getElementById(containerId);
    if (!activity.length) { list.innerHTML = '<div style="color:var(--text3);text-align:center;padding:12px;">No activity yet</div>'; return; }
    const typeColors = {command:'rgba(37,99,235,0.2)',blacklist:'rgba(220,38,38,0.2)',fkdr:'rgba(217,119,6,0.2)',permission:'rgba(124,58,237,0.2)',system:'rgba(100,116,139,0.2)'};
    const icons = {command:'⚡',blacklist:'🚫',fkdr:'📊',permission:'🔒',system:'⚙️'};
    list.innerHTML = activity.slice(0, limit).map(act => {
      const time = new Date(act.timestamp).toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit'});
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg3);border-radius:8px;border:1px solid var(--border);">
        <div class="act-icon" style="background:${typeColors[act.type]||'rgba(100,116,139,0.2)'}">${icons[act.type]||'•'}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(act.description)}</div>
          <div style="font-size:10px;color:var(--text3);">${time}</div>
        </div>
      </div>`;
    }).join('');
  }

  // ========== Settings ==========
  async function loadSettings() {
    try {
      const [settingsRes, promptRes, welcomeRes] = await Promise.all([
        fetch('/api/settings'), fetch('/api/gpt-prompt'), fetch('/api/welcome-messages')
      ]);
      const settings = await settingsRes.json();
      const prompt = await promptRes.json();
      const welcome = await welcomeRes.json();

      document.getElementById('tog-autoReconnect').checked = !!settings.autoReconnect;
      document.getElementById('tog-welcomeMessages').checked = !!settings.welcomeMessages;

      const cooldown = settings.commandCooldown || 45;
      document.getElementById('rng-commandCooldown').value = cooldown;
      document.getElementById('val-cooldown').textContent = cooldown;

      const tokens = settings.maxTokens || 100;
      document.getElementById('rng-maxTokens').value = tokens;
      document.getElementById('val-tokens').textContent = tokens;

      const delay = (settings.performance && settings.performance.messageDelay) || 300;
      document.getElementById('rng-messageDelay').value = delay;
      document.getElementById('val-delay').textContent = delay;

      document.getElementById('gptPromptInput').value = prompt.prompt || '';

      renderWelcomeMessages(welcome.messages || []);
    } catch(err) { toast('Failed to load settings', 'error'); }
  }

  function renderWelcomeMessages(msgs) {
    const list = document.getElementById('welcomeMsgList');
    list.innerHTML = msgs.map((msg, i) => `
      <div class="wm-item" id="wm-${i}">
        <input type="text" value="${escapeHtml(msg)}" id="wmInput-${i}" placeholder="Welcome message...">
        <button class="btn btn-red btn-sm" onclick="removeWelcomeMsg(${i})">✕</button>
      </div>
    `).join('') || '<div style="color:var(--text3);font-size:13px;">No welcome messages set</div>';
  }

  function addWelcomeMsg() {
    const list = document.getElementById('welcomeMsgList');
    const idx = list.querySelectorAll('.wm-item').length;
    const div = document.createElement('div');
    div.className = 'wm-item'; div.id = 'wm-' + idx;
    div.innerHTML = `<input type="text" id="wmInput-${idx}" placeholder="Welcome message... use {username}"><button class="btn btn-red btn-sm" onclick="this.parentElement.remove()">✕</button>`;
    list.appendChild(div);
  }

  function removeWelcomeMsg(idx) { document.getElementById('wm-' + idx)?.remove(); }

  async function saveWelcomeMessages() {
    const inputs = document.querySelectorAll('[id^="wmInput-"]');
    const messages = Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
    const res = await fetch('/api/welcome-messages', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({messages}) });
    const d = await res.json();
    if (d.success) { toast('Welcome messages saved!', 'success'); renderWelcomeMessages(d.messages); }
    else toast('Error saving', 'error');
  }

  async function saveGptPrompt() {
    const prompt = document.getElementById('gptPromptInput').value.trim();
    if (!prompt) { toast('Prompt cannot be empty', 'warning'); return; }
    const res = await fetch('/api/gpt-prompt', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({prompt}) });
    const d = await res.json();
    if (d.success) toast('GPT prompt saved!', 'success');
    else toast('Error saving prompt', 'error');
  }

  async function saveBoolSetting(key, value) {
    const body = { [key]: value };
    await fetch('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    toast(key + ' ' + (value ? 'enabled' : 'disabled'), 'info');
  }

  async function saveRangeSetting(key, value) {
    const body = { [key]: parseInt(value) };
    await fetch('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    toast(key + ' set to ' + value, 'info');
  }

  async function savePerfSetting(key, value) {
    const res = await fetch('/api/settings');
    const s = await res.json();
    const perf = s.performance || {};
    perf[key] = parseInt(value);
    await fetch('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ performance: perf }) });
    toast(key + ' set to ' + value + 'ms', 'info');
  }

  // ========== Logs ==========
  function renderLogs() {
    const filter = document.getElementById('logFilter')?.value || 'all';
    const logs = document.getElementById('logs');
    const filtered = filter === 'all' ? allLogs : allLogs.filter(l => l.type === filter);
    if (!filtered.length) { logs.innerHTML = '<div style="color:var(--text3);text-align:center;padding:20px;">No logs</div>'; return; }
    logs.innerHTML = filtered.slice(0, 150).map(d => `
      <div class="log-entry ${d.type}">
        <span style="color:var(--text3);font-size:10px;white-space:nowrap;">${d.time}</span>
        <span class="log-badge ${d.type}">${d.type.toUpperCase()}</span>
        <span style="flex:1;color:var(--text2);">${escapeHtml(d.msg)}</span>
      </div>
    `).join('');
  }

  function filterLogs() { renderLogs(); }
  function clearLogs() { allLogs = []; renderLogs(); toast('Logs cleared', 'info'); }

  // socket pushes into allLogs and calls renderLogs - override the socket handler to batch
  socket.off('bot-log');
  socket.on('bot-log', d => {
    allLogs.unshift({ time: d.time, type: d.type, msg: d.msg });
    if (allLogs.length > 300) allLogs.pop();
    if (!document.getElementById('content-logs').classList.contains('active')) return;
    renderLogs();
  });

  // ========== Statistics ==========
  async function loadStatistics() {
    try {
      const [statsRes, blRes, permsRes, fkdrRes, actRes] = await Promise.all([
        fetch('/api/stats'), fetch('/api/blacklist'), fetch('/api/permissions'),
        fetch('/api/fkdr-tracking'), fetch('/api/activity')
      ]);
      const stats = await statsRes.json();
      const bl = await blRes.json();
      const fkdr = await fkdrRes.json();
      const activity = await actRes.json();

      document.getElementById('totalCommands').textContent = stats.commandCount || 0;
      document.getElementById('totalMessages').textContent = stats.messageCount || 0;
      document.getElementById('apiCalls').textContent = stats.apiCallCount || 0;
      document.getElementById('apiQueue').textContent = 'Queue: ' + (stats.queueLength || 0);

      const upHrs = stats.uptimeMs ? stats.uptimeMs / 3600000 : 0;
      document.getElementById('stat-cmdhr').textContent = (upHrs > 0 ? Math.round(stats.commandCount / upHrs) : 0) + '/hr';
      document.getElementById('stat-msghr').textContent = (upHrs > 0 ? Math.round(stats.messageCount / upHrs) : 0) + '/hr';
      document.getElementById('statCache').textContent = stats.cacheSize || 0;
      document.getElementById('statFkdr').textContent = fkdr.count || 0;
      document.getElementById('statBlacklist').textContent = bl.total || 0;
      document.getElementById('statReconnects').textContent = stats.reconnectAttempts || 0;

      renderCommandChart(stats.topCommands || []);
      renderUserChart(stats.topUsers || []);
      renderActivityList(activity.recent || [], 'recentActivity', 20);
    } catch(err) { console.error('Failed to load statistics:', err); }
  }

  function renderCommandChart(topCmds) {
    const chart = document.getElementById('commandChart');
    if (!topCmds.length) { chart.innerHTML = '<div style="color:var(--text3);text-align:center;padding:16px;">No command data yet</div>'; return; }
    const max = Math.max(...topCmds.map(c => c.count));
    chart.innerHTML = topCmds.slice(0, 10).map(cmd => `
      <div style="display:flex;align-items:center;gap:10px;">
        <code style="width:70px;text-align:right;font-size:11px;">!${cmd.command}</code>
        <div class="prog-bar" style="flex:1;">
          <div class="prog-fill" style="width:${max>0?(cmd.count/max)*100:0}%;background:linear-gradient(90deg,#7c3aed,#a78bfa);"></div>
        </div>
        <span style="font-size:12px;color:var(--text2);width:28px;text-align:right;">${cmd.count}</span>
      </div>
    `).join('');
  }

  function renderUserChart(topUsers) {
    const chart = document.getElementById('userChart');
    if (!topUsers.length) { chart.innerHTML = '<div style="color:var(--text3);text-align:center;padding:16px;">No user data yet</div>'; return; }
    const max = Math.max(...topUsers.map(u => u.count));
    chart.innerHTML = topUsers.slice(0, 10).map(user => `
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:12px;color:var(--text2);width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(user.username)}</span>
        <div class="prog-bar" style="flex:1;">
          <div class="prog-fill" style="width:${max>0?(user.count/max)*100:0}%;background:linear-gradient(90deg,#059669,#34d399);"></div>
        </div>
        <span style="font-size:12px;color:var(--text2);width:28px;text-align:right;">${user.count}</span>
      </div>
    `).join('');
  }

  // ========== Permissions ==========
  async function loadPermissions() {
    const res = await fetch('/api/permissions');
    const data = await res.json();
    availableCommands = data.availableCommands;
    renderCommandCheckboxes();
    renderPermissionsList(data.permissions);
  }

  function renderCommandCheckboxes() {
    const list = document.getElementById('commandsList');
    list.innerHTML = availableCommands.map(cmd => `
      <label style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:12px;color:var(--text);font-weight:400;">
        <input type="checkbox" value="${cmd}" class="perm-checkbox" style="width:auto;cursor:pointer;">
        <code>!${cmd}</code>
      </label>
    `).join('');
  }

  function renderPermissionsList(permissions) {
    const list = document.getElementById('permissionsList');
    if (!permissions.length) { list.innerHTML = '<div style="color:var(--text3);text-align:center;padding:20px;">No custom permissions set</div>'; return; }
    list.innerHTML = permissions.map(p => {
      const mode = p.allowedCommands ? '✅ Whitelist' : '🚫 Blacklist';
      const commands = p.allowedCommands || p.bannedCommands || [];
      const modeColor = p.allowedCommands ? '#34d399' : '#f87171';
      return `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-weight:700;font-size:14px;">${escapeHtml(p.username)}</span>
          <button onclick="removePermission('${escapeHtml(p.username)}')" class="btn btn-red btn-sm">Remove</button>
        </div>
        <div style="font-size:11px;color:${modeColor};margin-bottom:4px;">${mode}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">${commands.map(c => '<code>' + c + '</code>').join('')}</div>
      </div>`;
    }).join('');
  }

  async function savePermissions() {
    const username = document.getElementById('permUser').value.trim();
    if (!username) { toast('Enter a username', 'warning'); return; }
    const mode = document.getElementById('permMode').value;
    const checked = Array.from(document.querySelectorAll('.perm-checkbox:checked')).map(cb => cb.value);
    if (!checked.length) { toast('Select at least one command', 'warning'); return; }
    const payload = { username };
    if (mode === 'allow') payload.allowedCommands = checked;
    else payload.bannedCommands = checked;
    const res = await fetch('/api/permissions/set', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const d = await res.json();
    if (d.success) { toast('Permissions saved for ' + username, 'success'); loadPermissions(); document.getElementById('permUser').value = ''; document.querySelectorAll('.perm-checkbox').forEach(cb => cb.checked = false); }
    else toast('Error: ' + d.message, 'error');
  }

  async function resetPermissions() {
    const username = document.getElementById('permUser').value.trim();
    if (!username) { toast('Enter a username', 'warning'); return; }
    if (!confirm('Reset all permissions for ' + username + '?')) return;
    const res = await fetch('/api/permissions/remove', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username}) });
    const d = await res.json();
    toast(d.message, d.success ? 'success' : 'error');
    loadPermissions();
    document.getElementById('permUser').value = '';
  }

  async function removePermission(username) {
    if (!confirm('Remove permissions for ' + username + '?')) return;
    const res = await fetch('/api/permissions/remove', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username}) });
    const d = await res.json();
    toast(d.message, d.success ? 'success' : 'error');
    loadPermissions();
  }

  // ========== Blacklist ==========
  async function loadBlacklistUI() {
    try {
      const res = await fetch('/api/blacklist');
      const data = await res.json();
      allBlacklistEntries = data.entries || [];
      updateBlacklistCount(data.total);
      renderBlacklist(allBlacklistEntries);
    } catch(err) { toast('Failed to load blacklist', 'error'); }
  }

  function updateBlacklistCount(n) {
    const el = document.getElementById('blacklistCount');
    if (el) el.textContent = n;
    const badge = document.getElementById('navBlacklistCount');
    if (badge) badge.textContent = n;
  }

  async function updateNavBlacklistBadge() {
    try {
      const res = await fetch('/api/blacklist');
      const d = await res.json();
      updateBlacklistCount(d.total);
    } catch(e) {}
  }

  function getTimeAgo(ts) {
    const d = Date.now() - new Date(ts).getTime();
    const days=Math.floor(d/86400000),hours=Math.floor(d/3600000),mins=Math.floor(d/60000);
    if(days>0)return days+'d ago';if(hours>0)return hours+'h ago';if(mins>0)return mins+'m ago';return 'just now';
  }

  function renderBlacklist(entries) {
    const list = document.getElementById('blacklistList');
    if (!entries.length) { list.innerHTML = '<div style="color:var(--text3);text-align:center;padding:30px;">No users in blacklist</div>'; return; }
    list.innerHTML = entries.map(entry => {
      const date = new Date(entry.addedOn).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});
      return `<div class="bl-card">
        <div style="display:flex;gap:10px;align-items:flex-start;">
          <img class="mc-head" src="https://mc-heads.net/avatar/${entry.username}/64" onerror="this.src='https://mc-heads.net/avatar/Steve/64'" alt="${entry.username}">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">
              <span style="font-weight:700;color:#f87171;">${escapeHtml(entry.username)}</span>
              <div style="display:flex;gap:4px;">
                <button onclick="editBlacklistEntry('${escapeHtml(entry.username)}')" class="btn btn-blue btn-sm">✏️</button>
                <button onclick="removeFromBlacklistUI('${escapeHtml(entry.username)}')" class="btn btn-red btn-sm">🗑️</button>
              </div>
            </div>
            <div style="font-size:10px;color:var(--text3);font-family:monospace;">ID: ${entry.id||'N/A'} • ${getTimeAgo(entry.addedOn)} • ${date}</div>
            <div style="font-size:12px;color:var(--text2);margin-top:6px;background:var(--bg2);padding:6px 8px;border-radius:6px;">${escapeHtml(entry.reason)}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:5px;">Added by <code>${escapeHtml(entry.addedBy)}</code></div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  function filterBlacklist(q) {
    const filtered = q ? allBlacklistEntries.filter(e =>
      e.username.toLowerCase().includes(q.toLowerCase()) ||
      e.reason.toLowerCase().includes(q.toLowerCase()) ||
      (e.addedBy||'').toLowerCase().includes(q.toLowerCase())
    ) : allBlacklistEntries;
    renderBlacklist(filtered);
  }

  async function addToBlacklistUI() {
    const username = document.getElementById('blacklistUser').value.trim();
    const reason = document.getElementById('blacklistReason').value.trim();
    const addedBy = document.getElementById('blacklistAddedBy').value.trim();
    if (!username || !reason || !addedBy) { toast('All fields required', 'warning'); return; }
    if (!confirm('Add ' + username + ' to blacklist?\\n\\nReason: ' + reason)) return;
    const res = await fetch('/api/blacklist/add', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,reason,addedBy}) });
    const d = await res.json();
    if (d.success) {
      toast(username + ' added to blacklist', 'success');
      document.getElementById('blacklistUser').value = '';
      document.getElementById('blacklistReason').value = '';
      loadBlacklistUI();
    } else toast('Error: ' + d.message, 'error');
  }

  async function removeFromBlacklistUI(username) {
    if (!confirm('Remove ' + username + ' from blacklist?')) return;
    const res = await fetch('/api/blacklist/remove', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username}) });
    const d = await res.json();
    toast(d.message, d.success ? 'success' : 'error');
    if (d.success) loadBlacklistUI();
  }

  async function editBlacklistEntry(username) {
    const res = await fetch('/api/blacklist');
    const data = await res.json();
    const entry = data.entries.find(e => e.username.toLowerCase() === username.toLowerCase());
    if (!entry) { toast('Entry not found', 'error'); return; }
    currentEditingUser = username;
    document.getElementById('editPlayerHead').src = 'https://mc-heads.net/avatar/' + entry.username + '/64';
    document.getElementById('editPlayerName').textContent = entry.username;
    document.getElementById('editPlayerID').textContent = 'ID: ' + (entry.id || 'N/A');
    document.getElementById('editPlayerDate').textContent = 'Added: ' + new Date(entry.addedOn).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
    document.getElementById('editReason').value = entry.reason;
    document.getElementById('editAddedBy').value = entry.addedBy;
    document.getElementById('editModal').classList.add('open');
  }

  function closeEditModal() {
    document.getElementById('editModal').classList.remove('open');
    currentEditingUser = null;
  }

  async function saveEdit() {
    if (!currentEditingUser) return;
    const reason = document.getElementById('editReason').value.trim();
    const addedBy = document.getElementById('editAddedBy').value.trim();
    if (!reason || !addedBy) { toast('Fields cannot be empty', 'warning'); return; }
    const res = await fetch('/api/blacklist/update', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:currentEditingUser,reason,addedBy}) });
    const d = await res.json();
    if (d.success) { toast('Updated!', 'success'); closeEditModal(); loadBlacklistUI(); }
    else toast('Error: ' + d.message, 'error');
  }

  // ========== FKDR Tracking ==========
  async function loadFkdrTab() {
    try {
      const res = await fetch('/api/fkdr-tracking');
      const data = await res.json();
      document.getElementById('fkdrCount').textContent = data.count || 0;
      const list = document.getElementById('fkdrList');
      if (!data.tracking || !data.tracking.length) {
        list.innerHTML = '<div style="color:var(--text3);text-align:center;padding:30px;">No players tracked yet. Use !fkdr start [player] in guild chat.</div>';
        return;
      }
      list.innerHTML = data.tracking.map(t => {
        const progress = t.progress;
        const latest = progress ? progress.current : null;
        return `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <img src="https://mc-heads.net/avatar/${t.username}/48" style="width:36px;height:36px;border-radius:6px;image-rendering:pixelated;" onerror="this.src='https://mc-heads.net/avatar/Steve/48'">
              <div>
                <span style="font-size:15px;font-weight:700;">${escapeHtml(t.username)}</span>
                <div style="font-size:11px;color:var(--text3);">Tracking since ${new Date(t.startDate).toLocaleDateString()}</div>
              </div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              ${latest ? `<span style="font-size:18px;font-weight:800;color:#a78bfa;">${latest.fkdr} FKDR</span>` : ''}
              <button onclick="removeFkdrTracking('${escapeHtml(t.username)}')" class="btn btn-red btn-sm">Remove</button>
            </div>
          </div>
          ${progress ? `
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
            ${renderFkdrPeriod('Daily', progress.daily)}
            ${renderFkdrPeriod('Weekly', progress.weekly)}
            ${renderFkdrPeriod('Monthly', progress.monthly)}
          </div>` : '<div style="font-size:12px;color:var(--text3);">Need more snapshots for progress data</div>'}
        </div>`;
      }).join('');
    } catch(err) { toast('Failed to load FKDR data', 'error'); }
  }

  function renderFkdrPeriod(label, data) {
    if (!data) return `<div style="background:var(--bg2);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:10px;color:var(--text3);">${label.toUpperCase()}</div><div style="font-size:12px;color:var(--text3);margin-top:4px;">No data</div></div>`;
    const fkdrNum = parseFloat(data.fkdr);
    const isPos = fkdrNum >= 0;
    return `<div style="background:var(--bg2);border-radius:8px;padding:8px;text-align:center;">
      <div style="font-size:10px;color:var(--text3);">${label.toUpperCase()}</div>
      <span class="fkdr-badge ${isPos?'fkdr-pos':'fkdr-neg'}" style="margin-top:4px;display:inline-block;">${isPos?'+':''}${data.fkdr} FKDR</span>
      <div style="font-size:11px;color:var(--text3);margin-top:4px;">${data.finals} finals</div>
    </div>`;
  }

  async function removeFkdrTracking(username) {
    if (!confirm('Stop tracking FKDR for ' + username + '?')) return;
    const res = await fetch('/api/fkdr-tracking/remove', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username}) });
    const d = await res.json();
    toast(d.message, d.success ? 'success' : 'error');
    if (d.success) loadFkdrTab();
  }

  // ========== Data Management ==========
  async function exportData(type) { window.location.href = '/api/export/' + type; }

  async function importData() {
    const type = document.getElementById('importType').value;
    const fileInput = document.getElementById('importFile');
    const file = fileInput.files[0];
    if (!file) { toast('Please select a file', 'warning'); return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const res = await fetch('/api/import/' + type, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({data: type === 'all' ? data.data : data})
        });
        const result = await res.json();
        const status = document.getElementById('importStatus');
        if (result.success) {
          toast(result.message, 'success');
          status.innerHTML = `<div style="background:rgba(5,150,105,0.1);border:1px solid rgba(5,150,105,0.3);border-radius:8px;padding:10px;color:#34d399;font-size:12px;">✅ ${result.message}</div>`;
          setTimeout(() => status.innerHTML = '', 5000);
        } else {
          toast(result.message, 'error');
          status.innerHTML = `<div style="background:rgba(220,38,38,0.1);border:1px solid rgba(220,38,38,0.3);border-radius:8px;padding:10px;color:#f87171;font-size:12px;">❌ ${result.message}</div>`;
        }
      } catch(err) { toast('Invalid file: ' + err.message, 'error'); }
    };
    reader.readAsText(file);
  }

  // ========== Auto-refresh ==========
  setInterval(() => {
    const active = document.querySelector('.tab-content.active');
    if (!active) return;
    const id = active.id.replace('content-', '');
    if (id === 'statistics') loadStatistics();
    if (id === 'dashboard') loadDashboard();
  }, 15000);

  // ========== Init ==========
  loadDashboard();
  updateNavBlacklistBadge();

  // System info interval
  setInterval(async () => {
    try {
      const res = await fetch('/api/system-info');
      const sys = await res.json();
      document.getElementById('sysMemory').textContent = sys.memoryUsed + ' MB';
    } catch(e) {}
  }, 30000);

/* =========================================================
   RUMONIUM // EXECUTIVE CONTROL EXTENSIONS
   Frontend-only enhancements; existing API contracts remain intact.
   ========================================================= */

// Extend tab loading without replacing the existing control surface.
const __rumoniumOriginalShowTab = showTab;
showTab = function(tab) {
  __rumoniumOriginalShowTab(tab);
  if (tab === 'intel') {
    setTimeout(() => document.getElementById('intelPlayerInput')?.focus(), 60);
  }
  if (tab === 'activity-intel') loadActivityIntel();
};

let paletteIndex = 0;
const paletteActions = [
  { icon:'⌂', title:'Open Mission Dashboard', hint:'Overview and live telemetry', run:()=>showTab('dashboard') },
  { icon:'◈', title:'Player Intelligence', hint:'Correlate blacklist, FKDR and activity', run:()=>showTab('intel') },
  { icon:'⌁', title:'Activity Intelligence', hint:'Inspect live tracking streams', run:()=>showTab('activity-intel') },
  { icon:'▶', title:'Start Bot', hint:'Enable auto-reconnect and start the bot', run:()=>botAction('start') },
  { icon:'↻', title:'Reconnect Bot', hint:'Force a fresh Minecraft session', run:()=>botAction('reconnect') },
  { icon:'■', title:'Disconnect Bot', hint:'Stop the current bot session', run:()=>botAction('disconnect') },
  { icon:'⌫', title:'Clear Cache', hint:'Flush player and guild cache', run:()=>clearCache() },
  { icon:'▣', title:'Live Chat', hint:'Open the guild chat stream', run:()=>showTab('chat') },
  { icon:'!', title:'Blacklist Manager', hint:'Review and edit restricted identities', run:()=>showTab('blacklist') },
  { icon:'⚙', title:'Bot Settings', hint:'Tune cooldowns, AI and welcome messages', run:()=>showTab('settings') },
  { icon:'↥', title:'System Logs', hint:'Inspect the live event stream', run:()=>showTab('logs') },
  { icon:'⇩', title:'Export Full Backup', hint:'Download a complete JSON backup', run:()=>exportData('all') }
];

function openCommandPalette() {
  const overlay = document.getElementById('commandPalette');
  if (!overlay) return;
  overlay.classList.add('open');
  const input = document.getElementById('paletteInput');
  input.value = '';
  paletteIndex = 0;
  renderPalette('');
  setTimeout(() => input.focus(), 40);
}
function closeCommandPalette() { document.getElementById('commandPalette')?.classList.remove('open'); }
function renderPalette(query='') {
  const q = query.toLowerCase().trim();
  const items = paletteActions.filter(a => !q || (a.title+' '+a.hint).toLowerCase().includes(q));
  const el = document.getElementById('paletteResults');
  if (!items.length) { el.innerHTML='<div style="padding:25px;text-align:center;color:#49655a;font:10px JetBrains Mono,monospace;">NO MATCHING OPERATIONS</div>'; return; }
  paletteIndex = Math.max(0, Math.min(paletteIndex, items.length-1));
  el.innerHTML = items.map((a,i)=>`<div class="palette-item ${i===paletteIndex?'selected':''}" data-index="${i}" onclick="executePalette(${i})"><span class="picon">${a.icon}</span><div><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(a.hint)}</small></div></div>`).join('');
  el.__items = items;
}
function filterPalette(q) { paletteIndex=0; renderPalette(q); }
function executePalette(index) {
  const el=document.getElementById('paletteResults');
  const item=el.__items?.[index];
  if (!item) return;
  closeCommandPalette();
  setTimeout(item.run, 30);
}

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault(); openCommandPalette(); return;
  }
  const palette=document.getElementById('commandPalette');
  if (!palette?.classList.contains('open')) return;
  const el=document.getElementById('paletteResults');
  const items=el?.__items || [];
  if (e.key === 'Escape') { e.preventDefault(); closeCommandPalette(); }
  if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex=Math.min(items.length-1,paletteIndex+1); renderPalette(document.getElementById('paletteInput').value); }
  if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex=Math.max(0,paletteIndex-1); renderPalette(document.getElementById('paletteInput').value); }
  if (e.key === 'Enter' && items.length) { e.preventDefault(); executePalette(paletteIndex); }
});

function toggleFocusMode() {
  document.body.classList.toggle('focus-mode');
  toast(document.body.classList.contains('focus-mode') ? 'Focus mode enabled' : 'Focus mode disabled', 'info');
}
async function hardRefresh() {
  toast('Refreshing control plane…','info');
  try {
    await Promise.all([loadDashboard(), loadStatistics(), updateNavBlacklistBadge()]);
    const active=document.querySelector('.tab-content.active')?.id;
    if(active==='content-activity-intel') await loadActivityIntel();
    if(active==='content-fkdr') await loadFkdrTab();
    if(active==='content-blacklist') await loadBlacklistUI();
    toast('Control plane synchronized','success');
  } catch(e) { toast('Refresh failed','error'); }
}

function updateClock() {
  const el=document.getElementById('liveClock');
  if(el) el.textContent=new Date().toLocaleTimeString('en-GB',{hour12:false});
}
setInterval(updateClock,1000); updateClock();

function setTelemetry(id, value, percent) {
  const v=document.getElementById(id), bar=document.getElementById(id+'Bar');
  if(v) v.textContent=value;
  if(bar) bar.style.width=Math.max(0,Math.min(100,percent||0))+'%';
}

function refreshExecutiveTelemetry(stats, sys, activity) {
  const memoryPct = sys.memoryTotal ? (sys.memoryUsed/sys.memoryTotal)*100 : 0;
  const queuePct = Math.min(100,(stats.queueLength||0)*12);
  const cachePct = Math.min(100,(stats.cacheSize||0)*2);
  const bot = !!stats.botReady;
  const score = Math.max(0, Math.min(100, Math.round((bot?45:15) + (memoryPct<75?20:8) + (queuePct<40?15:5) + (stats.urchinEnabled?10:5) + (stats.reconnectAttempts<3?10:2))));
  document.getElementById('healthScore').textContent=score;
  document.getElementById('healthScore').style.color=score>=80?'var(--accent)':score>=55?'var(--yellow)':'var(--red)';
  setTelemetry('telemetryBot', bot?'ONLINE':'OFFLINE', bot?100:12);
  setTelemetry('telemetryMemory', Math.round(memoryPct)+'%', memoryPct);
  setTelemetry('telemetryQueue', String(stats.queueLength||0), queuePct);
  setTelemetry('telemetryCache', String(stats.cacheSize||0), cachePct);
  document.getElementById('telemetryNode').textContent=sys.nodeVersion||'--';
  document.getElementById('telemetryPid').textContent=sys.pid||'--';
  document.getElementById('threatSurface').textContent=document.getElementById('blacklistCount')?.textContent||'0';
  document.getElementById('trackingSurface').textContent='—';
  const hours=stats.uptimeMs?stats.uptimeMs/3600000:0;
  document.getElementById('commandVelocity').innerHTML=(hours>0?Math.round((stats.commandCount||0)/hours):0)+'<span>/hr</span>';
  if(activity?.recent?.length) document.getElementById('signalMarquee').textContent='LIVE EVENT // '+activity.recent[0].description.toUpperCase();
}

// Patch the existing dashboard loader by observing its normal data flow on a lightweight interval.
const __rumoniumTelemetryTimer=setInterval(async()=>{
  try {
    const [s,sys,a]=await Promise.all([fetch('/api/stats').then(r=>r.json()),fetch('/api/system-info').then(r=>r.json()),fetch('/api/activity').then(r=>r.json())]);
    refreshExecutiveTelemetry(s,sys,a);
  } catch(e) {}
},10000);

async function runPlayerIntel() {
  const input=document.getElementById('intelPlayerInput');
  const username=input.value.trim();
  if(!username) { toast('Enter a Minecraft username','warning'); input.focus(); return; }
  const empty=document.getElementById('intelEmpty'), result=document.getElementById('intelResult');
  empty.style.display='none'; result.style.display='block';
  document.getElementById('intelName').textContent=username;
  document.getElementById('intelAvatar').src='https://mc-heads.net/avatar/'+encodeURIComponent(username)+'/96';
  document.getElementById('intelSignals').innerHTML='<div class="signal-line"><span class="marker"></span>Correlating local intelligence streams…</div>';
  try {
    const [blRes,fkRes,actRes]=await Promise.all([fetch('/api/blacklist'),fetch('/api/fkdr-tracking'),fetch('/api/activity-tracking')]);
    const bl=await blRes.json(), fk=await fkRes.json(), act=await actRes.json();
    const entries=(bl.entries||[]);
    const tracked=(fk.tracking||[]).find(x=>x.username?.toLowerCase()===username.toLowerCase());
    const activity=(act.tracking||[]).find(x=>x.username?.toLowerCase()===username.toLowerCase());
    const black=entries.find(x=>x.username?.toLowerCase()===username.toLowerCase());
    let risk=0; const signals=[];
    if(black){risk+=75;signals.push({c:'danger',t:'BLACKLIST MATCH',d:black.reason||'Local blacklist entry detected'});}
    else signals.push({c:'good',t:'BLACKLIST CLEAR',d:'No local blacklist match'});
    if(tracked){risk+=10;signals.push({c:'warn',t:'FKDR TRACK ACTIVE',d:(tracked.progress?.current?.fkdr||'—')+' FKDR observed'});}
    else signals.push({c:'good',t:'FKDR TRACK NONE',d:'No FKDR stream attached'});
    if(activity){risk+=10;const det=activity.detection||'Tracked';signals.push({c:'warn',t:'ACTIVITY STREAM',d:String(det)});}
    else signals.push({c:'good',t:'ACTIVITY CLEAR',d:'No activity stream attached'});
    const observations=(activity?.snapshots?.length || activity?.history?.length || 0);
    risk=Math.min(100,risk);
    document.getElementById('intelRisk').textContent=risk;
    const disposition=risk>=75?'HIGH RISK':risk>=40?'ELEVATED':'LOW RISK';
    const disp=document.getElementById('intelDisposition'); disp.textContent=disposition; disp.style.color=risk>=75?'var(--red)':risk>=40?'var(--yellow)':'var(--accent)';
    document.getElementById('intelBlacklist').textContent=black?'MATCH':'CLEAR';
    document.getElementById('intelBlacklist').style.color=black?'var(--red)':'var(--accent)';
    document.getElementById('intelFkdr').textContent=tracked?(tracked.progress?.current?.fkdr||'TRACKED'):'NONE';
    document.getElementById('intelActivity').textContent=activity?'TRACKED':'NONE';
    document.getElementById('intelObservations').textContent=observations;
    document.getElementById('intelSignals').innerHTML=signals.map(x=>`<div class="signal-line ${x.c}"><span class="marker"></span><div><strong>${escapeHtml(x.t)}</strong><div style="margin-top:3px;color:#4d695e;font-size:9px;">${escapeHtml(x.d)}</div></div></div>`).join('');
    document.getElementById('intelRecommendation').textContent=black?'This identity matches a local blacklist record. Review the stored reason and operator history before taking action.':activity?'This identity has an active monitoring stream. Review snapshots and detection output in Activity Intelligence.':'No elevated local signal was found. This is not a global verdict; it only reflects data available to this control plane.';
    toast('Identity analysis complete','success');
  } catch(e) {
    document.getElementById('intelSignals').innerHTML='<div class="signal-line danger"><span class="marker"></span>Correlation failed. Check API availability.</div>';
    toast('Intel query failed','error');
  }
}

async function loadActivityIntel() {
  const list=document.getElementById('activityIntelList');
  if(!list) return;
  list.innerHTML='<div style="padding:25px;text-align:center;color:#49655a;font:10px JetBrains Mono,monospace;">SYNCHRONIZING ACTIVITY STREAMS…</div>';
  try {
    const data=await fetch('/api/activity-tracking').then(r=>r.json());
    const rows=data.tracking||[];
    document.getElementById('activityTrackedCount').textContent=rows.length;
    let signals=0, hot=0;
    rows.forEach(x=>{
      const snap=x.snapshots||x.history||[]; signals+=Array.isArray(snap)?snap.length:0;
      const det=String(x.detection||'').toLowerCase(); if(det && !['none','neutral','unknown'].includes(det)) hot++;
    });
    document.getElementById('activitySignalsCount').textContent=signals;
    document.getElementById('activityHotCount').textContent=hot;
    if(!rows.length){list.innerHTML='<div style="padding:35px;text-align:center;color:#49655a;font:10px JetBrains Mono,monospace;">NO ACTIVE ACTIVITY STREAMS</div>';return;}
    list.innerHTML=rows.map(x=>{
      const det=String(x.detection||'No detection');
      const cls=/warn|suspicious|high|active/i.test(det)?'hot':'good';
      return `<div class="matrix-row"><div><div class="matrix-name">${escapeHtml(x.username||'unknown')}</div><div class="matrix-meta">identity</div></div><div><div class="matrix-meta">status</div><div class="matrix-value">TRACKING</div></div><div><div class="matrix-meta">snapshots</div><div class="matrix-value">${Array.isArray(x.snapshots)?x.snapshots.length:'—'}</div></div><div><div class="matrix-meta">detection</div><div class="matrix-value">${escapeHtml(det)}</div></div><span class="matrix-chip ${cls}">${cls==='hot'?'ATTENTION':'NOMINAL'}</span></div>`;
    }).join('');
  } catch(e) { list.innerHTML='<div style="padding:25px;color:var(--red);font:10px JetBrains Mono,monospace;">ACTIVITY ENDPOINT UNAVAILABLE</div>'; }
}

// Keep the executive counters in sync after blacklist refreshes.
const __oldUpdateNavBlacklistBadge = updateNavBlacklistBadge;
updateNavBlacklistBadge = async function() {
  await __oldUpdateNavBlacklistBadge();
  const source=document.getElementById('navBlacklistCount')?.textContent||'0';
  const target=document.getElementById('threatSurface');
  if(target) target.textContent=source;
};
