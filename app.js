// App State
let currentTab = 'vault';
let filterNiche = 'All';
let filterStatus = 'All';
let filterRel = 'All';
let filterAcq = 'All';
let searchQuery = '';
let botState = 'running';

let currentUser = null;
let authToken = localStorage.getItem('vault_token') || '';

let personalProjectFilter = '';
let currentCMSPage = 'about-us';
let currentCMSTab = 'pages';

let nicheChartInstance = null;
let daChartInstance = null;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initNavigation();
  initSearchAndFilters();
  initModals();
  initFileUpload();
  initPersonalTracker();
  initCMS();
  initCookieBanner();
  loadCMSSettings();
  
  checkAuthUser();

  // Polling Loop (3.5 seconds)
  setInterval(() => {
    if (currentUser && currentUser.role === 'admin') {
      fetchBotStatus();
      fetchAdminApprovals();
    }
    if (currentTab === 'vault') {
      fetchBacklinks();
      fetchStats();
    } else if (currentTab === 'personal') {
      fetchPersonalBacklinks();
    }
  }, 3500);
});

// Helper Headers
function getHeaders(custom = {}) {
  const headers = { 'Content-Type': 'application/json', ...custom };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

// Authentication Check & Profile Handling
async function checkAuthUser() {
  if (!authToken) {
    updateUserUI(null);
    fetchBacklinks();
    fetchStats();
    return;
  }

  try {
    const res = await fetch('/api/auth/me', { headers: getHeaders() });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      updateUserUI(currentUser);
    } else {
      localStorage.removeItem('vault_token');
      authToken = '';
      updateUserUI(null);
    }
  } catch (err) {
    console.error('Auth check error:', err);
  }

  fetchBacklinks();
  fetchStats();
}

function updateUserUI(user) {
  const profileContainer = document.getElementById('user-profile-container');
  const adminElements = document.querySelectorAll('.admin-only');

  if (user) {
    const roleBadge = user.role === 'admin' ? '<span class="badge badge-admin">Admin</span>' : '<span class="badge badge-niche">User</span>';
    const name = user.name || user.email.split('@')[0];

    profileContainer.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 13px; font-weight: 600;">${escapeHtml(name)}</span>
        ${roleBadge}
        <button class="btn btn-secondary" onclick="logout()" style="padding: 4px 10px; font-size: 11px; margin-left: 6px;">Log Out</button>
      </div>
    `;

    if (user.role === 'admin') {
      adminElements.forEach(el => el.style.display = 'flex');
      fetchAdminApprovals();
      fetchBotStatus();
    } else {
      adminElements.forEach(el => el.style.display = 'none');
    }
  } else {
    profileContainer.innerHTML = `
      <button class="btn btn-secondary" id="open-auth-btn" onclick="document.getElementById('auth-modal').classList.add('active')">Log In / Sign Up</button>
    `;
    adminElements.forEach(el => el.style.display = 'none');
  }
}

// Auth Forms & Google Sign-In Initialization
function initAuth() {
  const tabLogin = document.getElementById('tab-btn-login');
  const tabRegister = document.getElementById('tab-btn-register');
  const loginForm = document.getElementById('login-form');
  const regForm = document.getElementById('register-form');

  tabLogin.addEventListener('click', () => {
    tabLogin.style.borderBottom = '2px solid var(--accent-cyan)';
    tabLogin.style.color = 'var(--text-main)';
    tabRegister.style.borderBottom = 'none';
    tabRegister.style.color = 'var(--text-muted)';
    loginForm.style.display = 'block';
    regForm.style.display = 'none';
  });

  tabRegister.addEventListener('click', () => {
    tabRegister.style.borderBottom = '2px solid var(--accent-cyan)';
    tabRegister.style.color = 'var(--text-main)';
    tabLogin.style.borderBottom = 'none';
    tabLogin.style.color = 'var(--text-muted)';
    regForm.style.display = 'block';
    loginForm.style.display = 'none';
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (res.ok && data.token) {
      localStorage.setItem('vault_token', data.token);
      authToken = data.token;
      currentUser = data.user;
      document.getElementById('auth-modal').classList.remove('active');
      updateUserUI(currentUser);
      fetchBacklinks();
      fetchStats();
    } else {
      alert(data.error || 'Login failed');
    }
  });

  regForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });

    const data = await res.json();
    if (res.ok && data.token) {
      localStorage.setItem('vault_token', data.token);
      authToken = data.token;
      currentUser = data.user;
      document.getElementById('auth-modal').classList.remove('active');
      updateUserUI(currentUser);
      fetchBacklinks();
      fetchStats();
    } else {
      alert(data.error || 'Registration failed');
    }
  });

  // Fetch Google OAuth Config
  fetch('/api/config')
    .then(res => res.json())
    .then(config => {
      if (config.google_client_id && window.google) {
        google.accounts.id.initialize({
          client_id: config.google_client_id,
          callback: handleGoogleSignIn
        });
        const btnContainer = document.getElementById("google-signin-btn");
        if (btnContainer) {
          google.accounts.id.renderButton(btnContainer, {
            theme: "outline",
            size: "large",
            text: "continue_with"
          });
        }
      }
    })
    .catch(err => console.error('Failed to load Google OAuth config:', err));
}

async function handleGoogleSignIn(response) {
  try {
    const token = response.credential;
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    const profile = JSON.parse(jsonPayload);

    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: profile.email, name: profile.name, picture: profile.picture })
    });

    const data = await res.json();
    if (res.ok && data.token) {
      localStorage.setItem('vault_token', data.token);
      authToken = data.token;
      currentUser = data.user;
      document.getElementById('auth-modal').classList.remove('active');
      updateUserUI(currentUser);
      fetchBacklinks();
      fetchStats();
    } else {
      alert(data.error || 'Google Sign-In failed');
    }
  } catch (err) {
    console.error('Google Sign In Error:', err);
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', headers: getHeaders() });
  localStorage.removeItem('vault_token');
  authToken = '';
  currentUser = null;
  updateUserUI(null);
  fetchBacklinks();
  fetchStats();
}

// Navigation & Tab Switching
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      const targetTab = item.getAttribute('data-tab');
      currentTab = targetTab;

      document.querySelectorAll('.tab-page').forEach(page => {
        page.style.display = 'none';
      });

      const activePage = document.getElementById(`tab-${targetTab}`);
      if (activePage) {
        activePage.style.display = 'block';
      }

      if (targetTab === 'analytics') renderAnalytics();
      if (targetTab === 'approvals') fetchAdminApprovals();
      if (targetTab === 'personal') fetchPersonalBacklinks();
      if (targetTab === 'pages') loadCMSPage(currentCMSPage);
      if (targetTab === 'cms') loadCMSEditorPage(document.getElementById('cms-editor-slug').value);
    });
  });
}

// Search & Filter Logic
function initSearchAndFilters() {
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    fetchBacklinks();
  });

  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('pill') && e.target.hasAttribute('data-filter-type')) {
      const filterType = e.target.getAttribute('data-filter-type');
      const val = e.target.getAttribute('data-value');

      const container = e.target.parentElement;
      container.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      e.target.classList.add('active');

      if (filterType === 'niche') filterNiche = val;
      if (filterType === 'status') filterStatus = val;
      if (filterType === 'rel') filterRel = val;
      if (filterType === 'acq') filterAcq = val;

      fetchBacklinks();
    }
  });

  const exportBtn = document.getElementById('export-csv-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      window.location.href = '/api/export/csv';
    });
  }

  const toggleBtn = document.getElementById('toggle-bot-btn');
  const mainToggleBtn = document.getElementById('bot-toggle-main-btn');
  if (toggleBtn) toggleBtn.addEventListener('click', toggleBot);
  if (mainToggleBtn) mainToggleBtn.addEventListener('click', toggleBot);
}

// Fetch Vault Links
async function fetchBacklinks() {
  try {
    const url = `/api/backlinks?search=${encodeURIComponent(searchQuery)}&niche=${encodeURIComponent(filterNiche)}&status=${encodeURIComponent(filterStatus)}&rel=${encodeURIComponent(filterRel)}&acq=${encodeURIComponent(filterAcq)}&limit=100&offset=0`;
    const response = await fetch(url, { headers: getHeaders() });
    const links = await response.json();

    renderVaultTable(links);
  } catch (err) {
    console.error('Error fetching backlinks:', err);
    renderVaultTable([]);
  }
}

// Render Vault Table
function renderVaultTable(links) {
  const tbody = document.getElementById('vault-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!Array.isArray(links) || links.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; padding: 40px; color: var(--text-muted);">
          No backlinks found in vault matching current filters.
        </td>
      </tr>
    `;
    return;
  }

  links.forEach(item => {
    const tr = document.createElement('tr');
    const titleText = item.site_title || item.url;
    const domain = getDomain(item.url);
    const ownerName = item.owner_name || 'System / Admin';

    let scoreClass = 'score-low';
    if (item.value_score >= 75) scoreClass = 'score-high';
    else if (item.value_score >= 50) scoreClass = 'score-mid';

    let statusBadge = `<span class="badge badge-pending">Pending Approval</span>`;
    if (item.status === 'Active') statusBadge = `<span class="badge badge-active">HTTP ${item.http_code || 200}</span>`;
    else if (item.status === 'Approved') statusBadge = `<span class="badge badge-active">Approved</span>`;
    else if (item.status === 'Broken') statusBadge = `<span class="badge badge-broken">HTTP ${item.http_code || 404}</span>`;
    else if (item.status === 'Rejected') statusBadge = `<span class="badge badge-broken" title="${escapeHtml(item.rejection_note)}">Rejected</span>`;

    let relBadge = `<span class="badge badge-nofollow">${item.rel_type || 'Unknown'}</span>`;
    if (item.rel_type === 'DoFollow' || item.rel_type === 'Domain Indexed') {
      relBadge = `<span class="badge badge-dofollow">DoFollow</span>`;
    }

    let acqBadge = `<span class="badge badge-acq-easy">Easy Do-Follow</span>`;
    if (item.acquisition_type === 'Persuasion / Outreach') acqBadge = `<span class="badge badge-acq-outreach">Outreach / Guest</span>`;
    else if (item.acquisition_type === 'Paid / Sponsored') acqBadge = `<span class="badge badge-acq-paid">Paid / Sponsored</span>`;
    else if (item.acquisition_type === 'Directory / Profile') acqBadge = `<span class="badge badge-acq-directory">Directory</span>`;

    const canDelete = currentUser && (currentUser.role === 'admin' || currentUser.id === item.user_id);

    tr.innerHTML = `
      <td>
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <a href="${escapeHtml(item.url)}" target="_blank" style="font-weight: 600; color: var(--text-main); text-decoration: none;" title="${escapeHtml(titleText)}">
            ${escapeHtml(truncate(titleText, 45))}
          </a>
          <span style="font-size: 11px; color: var(--text-dim);">${escapeHtml(domain)} ${item.target_url ? '→ ' + escapeHtml(truncate(item.target_url, 22)) : ''}</span>
        </div>
      </td>
      <td><span style="font-size: 12px; color: var(--text-muted);">${escapeHtml(ownerName)}</span></td>
      <td><span class="badge badge-niche">${escapeHtml(item.niche)}</span></td>
      <td>${acqBadge}</td>
      <td><span style="font-weight: 600; color: var(--accent-cyan);">${item.da_score || 0}</span></td>
      <td>${relBadge}</td>
      <td>${statusBadge}</td>
      <td><div class="score-badge ${scoreClass}">${item.value_score || 0}</div></td>
      <td>
        <div style="display: flex; gap: 8px;">
          ${canDelete ? `<button class="btn btn-secondary" onclick="deleteLink(${item.id})" style="padding: 4px 8px; font-size: 11px; color: var(--accent-rose);" title="Delete link">✕</button>` : ''}
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

// Fetch Admin Approvals Queue (Admin Only)
async function fetchAdminApprovals() {
  if (!currentUser || currentUser.role !== 'admin') return;

  try {
    const res = await fetch('/api/admin/approvals?limit=100', { headers: getHeaders() });
    const links = await res.json();

    const badge = document.getElementById('pending-approval-badge');
    const pendingSub = document.getElementById('stat-pending-sub');
    
    if (badge) badge.innerText = links.length || 0;
    if (pendingSub) pendingSub.innerText = `${links.length || 0} Pending Admin Approval`;

    const tbody = document.getElementById('approvals-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (!Array.isArray(links) || links.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 30px; color: var(--text-muted);">No pending link submissions awaiting approval.</td></tr>`;
      return;
    }

    links.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <a href="${escapeHtml(item.url)}" target="_blank" style="color: var(--accent-cyan); font-weight: 600;">
            ${escapeHtml(truncate(item.url, 50))}
          </a>
        </td>
        <td><span style="font-size: 12px; color: var(--text-muted);">${escapeHtml(item.target_url || 'N/A')}</span></td>
        <td><span style="font-size: 12px; font-weight: 600;">${escapeHtml(item.owner_name || item.owner_email)}</span></td>
        <td><span style="font-size: 12px; color: var(--text-dim);">${escapeHtml(item.created_at)}</span></td>
        <td>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-primary" onclick="approveLink(${item.id})" style="padding: 4px 12px; font-size: 12px;">Approve</button>
            <button class="btn btn-secondary" onclick="rejectLink(${item.id})" style="padding: 4px 10px; font-size: 12px; color: var(--accent-rose);">Reject</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error fetching admin approvals:', err);
  }
}

// Approve / Reject Actions
async function approveLink(id) {
  const res = await fetch(`/api/admin/backlinks/${id}/approve`, { method: 'POST', headers: getHeaders() });
  if (res.ok) {
    fetchAdminApprovals();
    fetchBacklinks();
    fetchStats();
  }
}

async function rejectLink(id) {
  const note = prompt('Reason for rejection (optional):', 'Does not meet backlink quality requirements');
  if (note !== null) {
    const res = await fetch(`/api/admin/backlinks/${id}/reject`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ note })
    });
    if (res.ok) {
      fetchAdminApprovals();
      fetchBacklinks();
      fetchStats();
    }
  }
}

// Stats & Analytics
async function fetchStats() {
  try {
    const res = await fetch('/api/stats', { headers: getHeaders() });
    const data = await res.json();

    const totalEl = document.getElementById('stat-total');
    const activeEl = document.getElementById('stat-active');
    const avgDaEl = document.getElementById('stat-avg-da');
    const avgValEl = document.getElementById('stat-avg-val');

    if (totalEl) totalEl.innerText = (data.total || 0).toLocaleString();
    if (activeEl) activeEl.innerText = (data.active || 0).toLocaleString();
    if (avgDaEl) avgDaEl.innerText = data.avg_da || 0;
    if (avgValEl) avgValEl.innerText = data.avg_value || 0;

    renderNichePills(data.niche_distribution || {});
  } catch (err) {
    console.error('Error fetching stats:', err);
  }
}

function renderNichePills(nicheMap) {
  const pillsContainer = document.getElementById('niche-pills');
  if (!pillsContainer) return;
  const activeVal = filterNiche;
  pillsContainer.innerHTML = `<div class="pill ${activeVal === 'All' ? 'active' : ''}" data-filter-type="niche" data-value="All">All Niches</div>`;

  Object.keys(nicheMap).forEach(niche => {
    const pill = document.createElement('div');
    pill.className = `pill ${activeVal === niche ? 'active' : ''}`;
    pill.setAttribute('data-filter-type', 'niche');
    pill.setAttribute('data-value', niche);
    pill.innerText = `${niche} (${nicheMap[niche]})`;
    pillsContainer.appendChild(pill);
  });
}

// Bot Control & Status
async function fetchBotStatus() {
  if (!currentUser || currentUser.role !== 'admin') return;

  try {
    const res = await fetch('/api/bot/status', { headers: getHeaders() });
    const data = await res.json();

    botState = data.status;

    const dot = document.getElementById('bot-status-dot');
    const text = document.getElementById('bot-status-text');
    const summary = document.getElementById('bot-queue-summary');
    const toggleBtn = document.getElementById('toggle-bot-btn');
    const mainToggleBtn = document.getElementById('bot-toggle-main-btn');

    if (botState === 'running') {
      if (dot) dot.className = 'dot';
      if (text) text.innerText = 'Bot Active';
      if (toggleBtn) toggleBtn.innerText = 'Pause';
      if (mainToggleBtn) mainToggleBtn.innerText = 'Pause Bot';
    } else {
      if (dot) dot.className = 'dot paused';
      if (text) text.innerText = 'Bot Paused';
      if (toggleBtn) toggleBtn.innerText = 'Resume';
      if (mainToggleBtn) mainToggleBtn.innerText = 'Resume Bot';
    }

    if (summary) summary.innerText = `Queue: ${(data.queue_count || 0).toLocaleString()} links queued`;
    if (currentTab === 'bot') renderTerminalLogs(data.logs || []);
  } catch (err) {
    console.error('Error fetching bot status:', err);
  }
}

function renderTerminalLogs(logs) {
  const terminal = document.getElementById('bot-terminal');
  if (!terminal) return;

  terminal.innerHTML = '';
  logs.forEach(l => {
    const div = document.createElement('div');
    div.className = 'log-line';
    div.innerHTML = `
      <span class="log-time">[${escapeHtml(l.timestamp)}]</span>
      <span class="log-${l.level}">${escapeHtml(l.message)}</span>
    `;
    terminal.appendChild(div);
  });
}

async function toggleBot() {
  const nextStatus = botState === 'running' ? 'paused' : 'running';
  await fetch('/api/bot/settings', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ status: nextStatus })
  });
  fetchBotStatus();
}

// Modal Handlers
function initModals() {
  const addModal = document.getElementById('add-modal');
  const openAddBtn = document.getElementById('open-add-modal-btn');
  if (openAddBtn) {
    openAddBtn.addEventListener('click', () => {
      if (!currentUser) {
        alert('🔒 Please sign up or log in first to submit backlinks.');
        document.getElementById('auth-modal').classList.add('active');
        return;
      }
      addModal.classList.add('active');
    });
  }

  const saveLinkBtn = document.getElementById('save-link-btn');
  if (saveLinkBtn) {
    saveLinkBtn.addEventListener('click', async () => {
      const url = document.getElementById('modal-url').value;
      const targetUrl = document.getElementById('modal-target-url').value;
      const anchor = document.getElementById('modal-anchor').value;

      if (!url) return alert('Please enter a valid URL');

      const res = await fetch('/api/backlinks', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ url, target_url: targetUrl, anchor_text: anchor })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        addModal.classList.remove('active');
        document.getElementById('modal-url').value = '';
        alert(data.message || 'Link submitted successfully!');
        fetchBacklinks();
        fetchStats();
        if (currentUser && currentUser.role === 'admin') fetchAdminApprovals();
      } else {
        alert(data.error || 'Failed to submit link');
      }
    });
  }
}

// File Upload & Bulk URLs
function initFileUpload() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) handleFile(e.target.files[0]);
    });
  }

  const submitBulkBtn = document.getElementById('submit-bulk-btn');
  if (submitBulkBtn) {
    submitBulkBtn.addEventListener('click', async () => {
      if (!currentUser) {
        alert('Please log in to upload links.');
        document.getElementById('auth-modal').classList.add('active');
        return;
      }

      const text = document.getElementById('bulk-urls-input').value;
      if (!text.trim()) return alert('Please enter URLs to submit');

      submitBulkText(text, 'pasted text');
    });
  }
}

function handleFile(file) {
  if (!currentUser) {
    alert('Please log in to upload links.');
    document.getElementById('auth-modal').classList.add('active');
    return;
  }

  const fileName = file.name.toLowerCase();
  const reader = new FileReader();

  if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const csvText = XLSX.utils.sheet_to_csv(worksheet);

        submitBulkText(csvText, file.name);
      } catch (err) {
        alert('Error reading Excel file. Please ensure it is a valid .xlsx or .csv file.');
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    reader.onload = async (e) => {
      submitBulkText(e.target.result, file.name);
    };
    reader.readAsText(file);
  }
}

async function submitBulkText(text, sourceName) {
  const res = await fetch('/api/backlinks/bulk', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ urls_text: text })
  });

  const data = await res.json();
  if (res.ok && data.success) {
    if (currentUser.role === 'admin') {
      alert(`Approved and queued ${data.added_count} links from ${sourceName}!`);
    } else {
      alert(`Submitted ${data.added_count} links from ${sourceName}! Sent to Admin for final approval.`);
    }
    document.getElementById('bulk-urls-input').value = '';
    fetchBacklinks();
    fetchStats();
    if (currentUser.role === 'admin') fetchAdminApprovals();
  } else {
    alert(data.error || 'Failed to process link submission');
  }
}

// Delete Link
async function deleteLink(id) {
  if (confirm('Delete this backlink from vault?')) {
    await fetch(`/api/backlinks/${id}`, { method: 'DELETE', headers: getHeaders() });
    fetchBacklinks();
    fetchStats();
    if (currentUser && currentUser.role === 'admin') fetchAdminApprovals();
  }
}

// Personal Backlink Progress Tracker Functions
function initPersonalTracker() {
  const openModalBtn = document.getElementById('open-personal-modal-btn');
  if (openModalBtn) {
    openModalBtn.addEventListener('click', () => {
      if (!currentUser) {
        alert('Please log in to use your Personal Progress Tracker.');
        document.getElementById('auth-modal').classList.add('active');
        return;
      }
      document.getElementById('personal-modal-title').innerText = 'Add Tracked Backlink';
      document.getElementById('pmodal-id').value = '';
      document.getElementById('pmodal-project').value = '';
      document.getElementById('pmodal-url').value = '';
      document.getElementById('pmodal-target').value = '';
      document.getElementById('pmodal-anchor').value = '';
      document.getElementById('pmodal-notes').value = '';
      document.getElementById('personal-modal').classList.add('active');
    });
  }

  const saveBtn = document.getElementById('save-personal-link-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', savePersonalLink);
  }

  const projSelect = document.getElementById('personal-project-select');
  if (projSelect) {
    projSelect.addEventListener('change', (e) => {
      personalProjectFilter = e.target.value;
      fetchPersonalBacklinks();
    });
  }
}

async function fetchPersonalBacklinks() {
  if (!currentUser) return;
  try {
    const url = `/api/personal-backlinks?project=${encodeURIComponent(personalProjectFilter)}`;
    const res = await fetch(url, { headers: getHeaders() });
    const links = await res.json();

    renderPersonalTable(links);
  } catch (err) {
    console.error('Error fetching personal backlinks:', err);
  }
}

function renderPersonalTable(links) {
  const tbody = document.getElementById('personal-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!Array.isArray(links) || links.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 40px; color: var(--text-muted);">No tracked backlinks found for selected project. Click "+ Add Tracked Link" to start tracking!</td></tr>`;
    return;
  }

  // Populate project selector dropdown options
  const projects = Array.from(new Set(links.map(l => l.project_name).filter(Boolean)));
  const projSelect = document.getElementById('personal-project-select');
  if (projSelect) {
    const currentVal = projSelect.value;
    projSelect.innerHTML = `<option value="">All Projects</option>`;
    projects.forEach(p => {
      projSelect.innerHTML += `<option value="${escapeHtml(p)}" ${p === currentVal ? 'selected' : ''}>${escapeHtml(p)}</option>`;
    });
  }

  // Stats calculation
  let liveCount = 0;
  let indexedCount = 0;
  let daSum = 0;

  links.forEach(item => {
    if (item.status === 'Live') liveCount++;
    if (item.status === 'Indexed') indexedCount++;
    daSum += (item.da_score || 0);

    let statusBadge = `<span class="badge badge-active">${escapeHtml(item.status)}</span>`;
    if (item.status === 'Lost') statusBadge = `<span class="badge badge-broken">Lost</span>`;
    else if (item.status === 'Pending') statusBadge = `<span class="badge badge-pending">Pending</span>`;

    let acqBadge = `<span class="badge badge-acq-easy">${escapeHtml(item.acquisition_type || 'Easy Do-Follow')}</span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="badge badge-niche">${escapeHtml(item.project_name)}</span></td>
      <td>
        <a href="${escapeHtml(item.backlink_url)}" target="_blank" style="color: var(--accent-cyan); font-weight: 600; text-decoration: none;">
          ${escapeHtml(truncate(item.backlink_url, 40))}
        </a>
      </td>
      <td><span style="font-size: 12px; color: var(--text-muted);">${escapeHtml(truncate(item.target_url, 30) || 'N/A')}</span></td>
      <td><span style="font-size: 12px;">${escapeHtml(item.anchor_text || '-')}</span></td>
      <td>${acqBadge}</td>
      <td>${statusBadge}</td>
      <td><span style="font-weight: 600; color: var(--accent-cyan);">${item.da_score || 0}</span></td>
      <td><span style="font-size: 11px; color: var(--text-dim);">${escapeHtml(truncate(item.notes, 25))}</span></td>
      <td>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-secondary" onclick="editPersonalLink(${item.id})" style="padding: 4px 8px; font-size: 11px;">Edit</button>
          <button class="btn btn-secondary" onclick="deletePersonalLink(${item.id})" style="padding: 4px 8px; font-size: 11px; color: var(--accent-rose);">✕</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('pstat-total').innerText = links.length;
  document.getElementById('pstat-live').innerText = liveCount;
  document.getElementById('pstat-indexed').innerText = indexedCount;
  document.getElementById('pstat-avg-da').innerText = links.length ? Math.round(daSum / links.length) : 0;
}

async function savePersonalLink() {
  const p_id = document.getElementById('pmodal-id').value;
  const project_name = document.getElementById('pmodal-project').value;
  const backlink_url = document.getElementById('pmodal-url').value;
  const target_url = document.getElementById('pmodal-target').value;
  const anchor_text = document.getElementById('pmodal-anchor').value;
  const acq_type = document.getElementById('pmodal-acq').value;
  const status = document.getElementById('pmodal-status').value;
  const da_score = document.getElementById('pmodal-da').value || 0;
  const notes = document.getElementById('pmodal-notes').value;

  if (!backlink_url || !project_name) return alert('Project Name and Backlink URL are required');

  const res = await fetch('/api/personal-backlinks', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ id: p_id, project_name, backlink_url, target_url, anchor_text, acquisition_type: acq_type, status, da_score, notes })
  });

  if (res.ok) {
    document.getElementById('personal-modal').classList.remove('active');
    fetchPersonalBacklinks();
  } else {
    alert('Failed to save personal backlink');
  }
}

async function deletePersonalLink(id) {
  if (confirm('Delete this tracked personal backlink?')) {
    await fetch(`/api/personal-backlinks/${id}`, { method: 'DELETE', headers: getHeaders() });
    fetchPersonalBacklinks();
  }
}

// CMS & WordPress Admin Editor Functions
function initCMS() {
  const savePageBtn = document.getElementById('save-cms-page-btn');
  if (savePageBtn) savePageBtn.addEventListener('click', saveCMSPage);

  const saveSettingsBtn = document.getElementById('save-cms-settings-btn');
  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveCMSSettings);
}

async function loadCMSPage(slug) {
  currentCMSPage = slug;
  const display = document.getElementById('cms-page-display');
  if (!display) return;

  // Update tabs active state
  document.querySelectorAll('#cms-page-tabs .pill').forEach(p => p.classList.remove('active'));

  try {
    const res = await fetch(`/api/cms/pages?slug=${slug}`);
    if (res.ok) {
      const data = await res.json();
      display.innerHTML = `
        <h2>${escapeHtml(data.title)}</h2>
        <div>${data.content_html}</div>
      `;
    } else {
      display.innerHTML = `<p style="color: var(--text-muted);">Page content not available.</p>`;
    }
  } catch (err) {
    console.error('Error loading CMS page:', err);
  }
}

function switchPageTab(slug) {
  const pageTabNav = document.querySelector('.nav-item[data-tab="pages"]');
  if (pageTabNav) pageTabNav.click();
  loadCMSPage(slug);
}

async function loadCMSEditorPage(slug) {
  if (!currentUser || currentUser.role !== 'admin') return;

  try {
    const res = await fetch(`/api/cms/pages?slug=${slug}`);
    if (res.ok) {
      const data = await res.json();
      document.getElementById('cms-editor-slug').value = slug;
      document.getElementById('cms-editor-title').value = data.title || '';
      document.getElementById('cms-editor-content').value = data.content_html || '';
    }
  } catch (err) {
    console.error('Error loading editor page:', err);
  }
}

async function saveCMSPage() {
  if (!currentUser || currentUser.role !== 'admin') return;

  const slug = document.getElementById('cms-editor-slug').value;
  const title = document.getElementById('cms-editor-title').value;
  const content_html = document.getElementById('cms-editor-content').value;

  const res = await fetch('/api/cms/pages', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ slug, title, content_html })
  });

  if (res.ok) {
    alert('Page updated successfully!');
    if (currentCMSPage === slug) loadCMSPage(slug);
  } else {
    alert('Failed to save page content');
  }
}

async function loadCMSSettings() {
  try {
    const res = await fetch('/api/cms/settings');
    if (res.ok) {
      const settings = await res.json();

      // Populate admin editor inputs
      if (document.getElementById('set-ga-id')) document.getElementById('set-ga-id').value = settings.ga_tracking_id || '';
      if (document.getElementById('set-gtm-id')) document.getElementById('set-gtm-id').value = settings.gtm_id || '';
      if (document.getElementById('set-cookie-text')) document.getElementById('set-cookie-text').value = settings.cookie_notice_text || '';

      if (document.getElementById('set-ad-header')) document.getElementById('set-ad-header').value = settings.ad_header_html || '';
      if (document.getElementById('set-ad-sidebar')) document.getElementById('set-ad-sidebar').value = settings.ad_sidebar_html || '';
      if (document.getElementById('set-ad-content')) document.getElementById('set-ad-content').value = settings.ad_content_html || '';
      if (document.getElementById('set-ad-footer')) document.getElementById('set-ad-footer').value = settings.ad_footer_html || '';

      // Render Ad slots if enabled
      if (settings.ads_enabled === '1') {
        renderAdSlot('ad-slot-header', settings.ad_header_html);
        renderAdSlot('ad-slot-sidebar', settings.ad_sidebar_html);
        renderAdSlot('ad-slot-content', settings.ad_content_html);
        renderAdSlot('ad-slot-footer', settings.ad_footer_html);
      }
    }
  } catch (err) {
    console.error('Error loading CMS settings:', err);
  }
}

function renderAdSlot(elementId, htmlContent) {
  const el = document.getElementById(elementId);
  if (el && htmlContent) {
    el.innerHTML = htmlContent;
  }
}

async function saveCMSSettings() {
  if (!currentUser || currentUser.role !== 'admin') return;

  const data = {
    ga_tracking_id: document.getElementById('set-ga-id').value,
    gtm_id: document.getElementById('set-gtm-id').value,
    cookie_notice_text: document.getElementById('set-cookie-text').value,
    ad_header_html: document.getElementById('set-ad-header').value,
    ad_sidebar_html: document.getElementById('set-ad-sidebar').value,
    ad_content_html: document.getElementById('set-ad-content').value,
    ad_footer_html: document.getElementById('set-ad-footer').value
  };

  const res = await fetch('/api/cms/settings', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(data)
  });

  if (res.ok) {
    alert('Settings & Ads saved successfully!');
    loadCMSSettings();
  } else {
    alert('Failed to save settings');
  }
}

function switchCMSTab(tab) {
  currentCMSTab = tab;
  const btnPages = document.getElementById('cms-tab-btn-pages');
  const btnSettings = document.getElementById('cms-tab-btn-settings');
  const secPages = document.getElementById('cms-sec-pages');
  const secSettings = document.getElementById('cms-sec-settings');

  if (tab === 'pages') {
    btnPages.classList.add('active');
    btnSettings.classList.remove('active');
    secPages.style.display = 'block';
    secSettings.style.display = 'none';
  } else {
    btnSettings.classList.add('active');
    btnPages.classList.remove('active');
    secSettings.style.display = 'block';
    secPages.style.display = 'none';
  }
}

// Cookie Consent Banner
function initCookieBanner() {
  const accepted = localStorage.getItem('vault_cookies_accepted');
  if (!accepted) {
    const banner = document.getElementById('cookie-banner');
    if (banner) banner.style.display = 'flex';
  }
}

function acceptCookies() {
  localStorage.setItem('vault_cookies_accepted', '1');
  const banner = document.getElementById('cookie-banner');
  if (banner) banner.style.display = 'none';
}

// Analytics Charts
async function renderAnalytics() {
  if (!currentUser || currentUser.role !== 'admin') return;

  try {
    const res = await fetch('/api/stats', { headers: getHeaders() });
    const data = await res.json();

    const niches = Object.keys(data.niche_distribution || {});
    const counts = Object.values(data.niche_distribution || {});

    const ctxNicheEl = document.getElementById('nicheChart');
    if (ctxNicheEl) {
      const ctxNiche = ctxNicheEl.getContext('2d');
      if (nicheChartInstance) nicheChartInstance.destroy();
      nicheChartInstance = new Chart(ctxNiche, {
        type: 'doughnut',
        data: {
          labels: niches.length ? niches : ['No Data'],
          datasets: [{
            data: counts.length ? counts : [1],
            backgroundColor: ['#22d3ee', '#10b981', '#a855f7', '#fbbf24', '#f43f5e', '#60a5fa', '#34d399']
          }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af' } } } }
      });
    }

    const ctxDaEl = document.getElementById('daChart');
    if (ctxDaEl) {
      const ctxDa = ctxDaEl.getContext('2d');
      if (daChartInstance) daChartInstance.destroy();
      daChartInstance = new Chart(ctxDa, {
        type: 'bar',
        data: {
          labels: ['0-20 DA', '21-40 DA', '41-60 DA', '61-80 DA', '81-100 DA'],
          datasets: [{ label: 'Domain Authority Distribution', data: [2, 5, 8, 4, 1], backgroundColor: '#22d3ee' }]
        },
        options: {
          responsive: true,
          scales: { x: { ticks: { color: '#9ca3af' } }, y: { ticks: { color: '#9ca3af' } } },
          plugins: { legend: { labels: { color: '#9ca3af' } } }
        }
      });
    }
  } catch (err) {
    console.error('Error rendering analytics:', err);
  }
}

// Helpers
function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); }
  catch (e) { return url; }
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
