let showMineOnly = false;
let currentPage = 1;
let pageLimit = 50;
let totalPages = 1;
let totalBacklinksCount = 0;
let searchDebounceTimeout = null;
// ═══════════════════════════════════════════════════════════
//  Backlink Vault — app.js  (complete rewrite)
// ═══════════════════════════════════════════════════════════

// ── State ────────────────────────────────────────────────────
let currentTab   = 'vault';
let filterNiche  = 'All';
let filterStatus = 'All';
let filterRel    = 'All';
let filterAcq    = 'All';
let searchQuery  = '';
let botState     = 'running';

let currentUser = null;
let authToken   = localStorage.getItem('vault_token') || '';

let personalProjectFilter = '';
let currentCMSPage = 'about-us';
let cmsEditorLoaded = false;

let nicheChartInstance = null;
let daChartInstance    = null;
let googleClientId     = '';

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Check for Google OAuth redirect hash token
  if (window.location.hash.includes('access_token=')) {
    const params = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = params.get('access_token');
    if (accessToken) {
      window.history.replaceState(null, null, window.location.pathname);
      handleGoogleAccessToken(accessToken);
    }
  }
  loadAppConfig();          // fetch /api/config first → then decide landing vs app
  initCookieBanner();
});

// ── Config & Landing / App decision ──────────────────────────
async function loadAppConfig() {
  try {
    const res  = await fetch('/api/config?t=' + new Date().getTime());
    const cfg  = await res.json();
  } catch (e) {
    console.warn('Config load failed');
  }

  // Check if user is already logged in
  if (authToken) {
    try {
      const res = await fetch('/api/auth/me', { headers: getHeaders() });
      if (res.ok) {
        const d = await res.json();
        currentUser = d.user;
      } else {
        localStorage.removeItem('vault_token');
        authToken = '';
        currentUser = null;
      }
    } catch (e) {
      console.warn('Auth check error:', e);
    }
  }

  // Decide what to show
  if (currentUser) {
    showApp();
  } else {
    showLanding();
  }
}

function showLanding() {
  document.getElementById('landing-page').style.display = 'block';
  document.getElementById('main-app').style.display    = 'none';
  loadHeroStats();
  initLandingButtons();
  if (currentUser) {
    document.querySelectorAll('.auth-required').forEach(el => el.style.display = 'flex');
    document.querySelectorAll('.guest-only').forEach(el => el.style.display = 'none');
  }
}

function switchToVaultTab() {
  const vaultNav = document.querySelector('.nav-item[data-tab="vault"]');
  if (vaultNav) vaultNav.click();
}

function showApp() {
  document.getElementById('landing-page').style.display = 'none';
  document.getElementById('main-app').style.display    = 'flex';
  initApp();
}

function initApp() {
  initAuth();
  initNavigation();
  initSearchAndFilters();
  initModalHandlers();
  initFileUpload();
  initPersonalTracker();
  initCMS();
  loadCMSSettings();
  updateUserUI(currentUser);
  fetchBacklinks();
  fetchStats();

  // Polling
  if (!window._botPollInterval) {
    window._botPollInterval = setInterval(() => {
      if (currentUser && currentUser.role === 'admin') {
        fetchBotStatus();
        fetchAdminApprovals();
      }
      if (currentTab === 'vault') {
        fetchBacklinks();
        fetchStats();
      } else if (currentTab === 'personal' && currentUser) {
        fetchPersonalBacklinks();
      }
    }, 4000);
  }
}

// ── Landing Page ──────────────────────────────────────────────
async function loadHeroStats() {
  try {
    const res  = await fetch('/api/stats');
    const data = await res.json();
    const el   = (id, val) => { const e = document.getElementById(id); if (e) e.innerText = val; };
    el('hero-stat-total',  (data.total  || 0).toLocaleString());
    el('hero-stat-active', (data.active || 0).toLocaleString());
    el('hero-stat-da',     data.avg_da  || 0);
  } catch (e) { /* non-fatal */ }

  // Load custom CMS Homepage Hero content if configured
  try {
    const cmsRes = await fetch('/api/cms/pages/homepage-hero');
    if (cmsRes.ok) {
      const cmsPage = await cmsRes.json();
      if (cmsPage && cmsPage.content_html) {
        const heroTitle = document.querySelector('.hero-title');
        if (heroTitle) heroTitle.innerHTML = cmsPage.content_html;
      }
    }
  } catch (e) { /* non-fatal */ }
}

function initLandingButtons() {
  const openAuth = () => {
    showApp();            // transition to app then open modal
    setTimeout(() => document.getElementById('auth-modal').classList.add('active'), 100);
  };

  const enterApp = () => showApp();

  document.getElementById('landing-login-btn')?.addEventListener('click', openAuth);
  document.getElementById('landing-signup-btn')?.addEventListener('click', openAuth);
  document.getElementById('hero-signup-btn')?.addEventListener('click', openAuth);
  document.getElementById('hero-browse-btn')?.addEventListener('click', enterApp);
  document.getElementById('benefits-signup-btn')?.addEventListener('click', openAuth);
}

function showLandingCMSPage(slug) {
  // navigate to app → pages tab → specific slug
  showApp();
  setTimeout(() => {
    const pagesNav = document.querySelector('.nav-item[data-tab="pages"]');
    if (pagesNav) pagesNav.click();
    loadCMSPage(slug);
  }, 150);
}

// ── Auth ──────────────────────────────────────────────────────
function getHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (authToken) h['Authorization'] = `Bearer ${authToken}`;
  return h;
}

function initAuth() {
  // Auth modal tab switching
  document.getElementById('tab-btn-login')?.addEventListener('click', () => {
    document.getElementById('login-form').style.display    = 'block';
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('tab-btn-login').style.borderBottom    = '2px solid var(--accent-cyan)';
    document.getElementById('tab-btn-login').style.color           = 'var(--text-main)';
    document.getElementById('tab-btn-register').style.borderBottom = 'none';
    document.getElementById('tab-btn-register').style.color        = 'var(--text-muted)';
  });

  document.getElementById('tab-btn-register')?.addEventListener('click', () => {
    document.getElementById('register-form').style.display = 'block';
    document.getElementById('login-form').style.display    = 'none';
    document.getElementById('tab-btn-register').style.borderBottom = '2px solid var(--accent-cyan)';
    document.getElementById('tab-btn-register').style.color        = 'var(--text-main)';
    document.getElementById('tab-btn-login').style.borderBottom    = 'none';
    document.getElementById('tab-btn-login').style.color           = 'var(--text-muted)';
  });

  // Login form
  document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const res  = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      onAuthSuccess(data.token, data.user);
    } else {
      alert(data.error || 'Login failed. Check your credentials.');
    }
  });

  // Register form
  document.getElementById('register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name     = document.getElementById('reg-name').value;
    const email    = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const res  = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      onAuthSuccess(data.token, data.user);
    } else {
      alert(data.error || 'Registration failed.');
    }
  });

  // Top-bar guest login button
  document.getElementById('guest-login-topbar-btn')?.addEventListener('click', () => {
    document.getElementById('auth-modal').classList.add('active');
  });
}

function onAuthSuccess(token, user) {
  localStorage.setItem('vault_token', token);
  authToken   = token;
  currentUser = user;
  document.getElementById('auth-modal').classList.remove('active');
  updateUserUI(user);
  // Refresh everything
  fetchBacklinks();
  fetchStats();
  if (user.role === 'admin') {
    fetchAdminApprovals();
    fetchBotStatus();
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', headers: getHeaders() });
  localStorage.removeItem('vault_token');
  authToken   = '';
  currentUser = null;
  // Return to landing
  showLanding();
}

// ── Update UI for auth state ──────────────────────────────────
function updateUserUI(user) {
  const profileContainer  = document.getElementById('user-profile-container');
  const adminElements     = document.querySelectorAll('.admin-only');
  const authRequired      = document.querySelectorAll('.auth-required');
  const guestOnly         = document.querySelectorAll('.guest-only');
  const guestCtaBanner    = document.getElementById('guest-cta-banner');

  if (user) {
    const roleBadge = user.role === 'admin'
      ? '<span class="badge badge-admin">Admin</span>'
      : '<span class="badge badge-niche">Member</span>';
    const name = user.name || user.email.split('@')[0];

    if (profileContainer) profileContainer.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 13px; font-weight: 600;">${escapeHtml(name)}</span>
        ${roleBadge}
        <button class="btn btn-secondary" onclick="logout()" style="padding: 4px 10px; font-size: 11px;">Log Out</button>
      </div>
    `;

    authRequired.forEach(el => el.style.display = 'flex');
    guestOnly.forEach(el => el.style.display = 'none');
    if (guestCtaBanner) guestCtaBanner.style.display = 'none';

    if (user.role === 'admin') {
      adminElements.forEach(el => {
        if (el.tagName === 'TH' || el.tagName === 'TD') {
          el.style.display = 'table-cell';
        } else {
          el.style.display = 'flex';
        }
      });
      fetchAdminApprovals();
      fetchBotStatus();
    } else {
      adminElements.forEach(el => el.style.display = 'none');
    }
  } else {
    // Guest in main app
    if (profileContainer) profileContainer.innerHTML = '';
    authRequired.forEach(el => el.style.display = 'none');
    guestOnly.forEach(el => el.style.display = 'flex');
    adminElements.forEach(el => el.style.display = 'none');
    if (guestCtaBanner) guestCtaBanner.style.display = 'block';
  }
}

// ── Navigation ────────────────────────────────────────────────
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      const tab = item.getAttribute('data-tab');
      currentTab = tab;

      document.querySelectorAll('.tab-page').forEach(p => p.style.display = 'none');
      const activePage = document.getElementById(`tab-${tab}`);
      if (activePage) activePage.style.display = 'block';

      if (tab === 'analytics') renderAnalytics();
      if (tab === 'approvals') fetchAdminApprovals();
      if (tab === 'personal' && currentUser) fetchPersonalBacklinks();
      if (tab === 'pages') loadCMSPage(currentCMSPage);
      if (tab === 'cms' && currentUser?.role === 'admin') loadCMSEditorPage(document.getElementById('cms-editor-slug').value);
      if (tab === 'bot') fetchBotStatus();
      if (tab === 'users' && currentUser?.role === 'admin') fetchAdminUsers();
    });
  });
}

// Navigate to pages tab with specific slug
function switchToPageTab(slug) {
  currentCMSPage = slug;
  const pagesNav = document.querySelector('.nav-item[data-tab="pages"]');
  if (pagesNav) pagesNav.click();
}

// ── Search & Filters ──────────────────────────────────────────
function initSearchAndFilters() {
  document.getElementById('search-input')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    if (searchDebounceTimeout) clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      fetchBacklinks(1);
    }, 300);
  });

  // Pill click delegation
  document.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill[data-filter-type]');
    if (!pill) return;

    const type = pill.getAttribute('data-filter-type');
    const val  = pill.getAttribute('data-value');

    // De-activate siblings in same container
    const parent = pill.closest('.filter-pills');
    if (parent) parent.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');

    if (type === 'niche')  { filterNiche  = val; }
    if (type === 'status') { filterStatus = val; }
    if (type === 'rel')    { filterRel    = val; }
    if (type === 'acq')    { filterAcq    = val; }

    fetchBacklinks();
  });

  document.getElementById('export-csv-btn')?.addEventListener('click', () => {
    window.location.href = '/api/export/csv';
  });

  document.getElementById('toggle-bot-btn')?.addEventListener('click', toggleBot);
  document.getElementById('bot-toggle-main-btn')?.addEventListener('click', toggleBot);
}

function resetNicheActive() {
  const nichePills = document.querySelectorAll('#niche-pills .pill');
  nichePills.forEach(p => p.classList.remove('active'));
  const allNiche = document.querySelector('#niche-pills .pill[data-value="All"]');
  if (allNiche) allNiche.classList.add('active');
  filterNiche = 'All';
}

// ── Backlinks Fetch & Render ──────────────────────────────────
async function fetchBacklinks(page = 1) {
  currentPage = page || 1;
  const tbody = document.getElementById('vault-table-body');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align:center; padding:40px; color:var(--text-muted);">
          <div style="display:flex; align-items:center; justify-content:center; gap:10px;">
            <span style="font-size:18px;">⏳</span> Loading domains...
          </div>
        </td>
      </tr>`;
  }
  try {
    const params = new URLSearchParams({
      search: searchQuery,
      niche:  filterNiche,
      status: filterStatus,
      rel:    filterRel,
      acq:    filterAcq,
      page:   currentPage,
      limit:  pageLimit
    });
    if (typeof showMineOnly !== 'undefined' && showMineOnly) params.append('mine', '1');

    const res  = await fetch(`/api/backlinks?${params}`, { headers: getHeaders() });
    const data = await res.json();

    let items = [];
    if (data && Array.isArray(data.items)) {
      items = data.items;
      totalBacklinksCount = data.total || 0;
      totalPages = data.total_pages || 1;
    } else if (Array.isArray(data)) {
      items = data;
      totalBacklinksCount = data.length;
      totalPages = 1;
    }

    renderVaultTable(items);
    updatePaginationControls();
  } catch (err) {
    console.error('fetchBacklinks error:', err);
    renderVaultTable([]);
  }
}

function updatePaginationControls() {
  const infoText = document.getElementById('pagination-info-text');
  const pageText = document.getElementById('page-current-text');
  const prevBtn = document.getElementById('page-prev-btn');
  const nextBtn = document.getElementById('page-next-btn');
  const firstBtn = document.getElementById('page-first-btn');
  const lastBtn = document.getElementById('page-last-btn');

  const start = totalBacklinksCount > 0 ? (currentPage - 1) * pageLimit + 1 : 0;
  const end = Math.min(currentPage * pageLimit, totalBacklinksCount);

  if (infoText) infoText.innerText = `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${totalBacklinksCount.toLocaleString()} domains`;
  if (pageText) pageText.innerText = `Page ${currentPage.toLocaleString()} of ${totalPages.toLocaleString()}`;

  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (firstBtn) firstBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
  if (lastBtn) lastBtn.disabled = currentPage >= totalPages;
}

window.goToVaultPage = function(page) {
  if (page === -1) page = totalPages;
  if (page < 1 || page > totalPages) return;
  fetchBacklinks(page);
};

window.prevVaultPage = function() {
  if (currentPage > 1) fetchBacklinks(currentPage - 1);
};

window.nextVaultPage = function() {
  if (currentPage < totalPages) fetchBacklinks(currentPage + 1);
};

window.changePageLimit = function(limit) {
  pageLimit = parseInt(limit, 10) || 50;
  fetchBacklinks(1);
};

function renderVaultTable(links) {
  const tbody = document.getElementById('vault-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!links.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center; padding:40px; color:var(--text-muted);">
          No backlinks match the current filters. Try selecting a different filter or clearing the search.
        </td>
      </tr>`;
    return;
  }

  links.forEach(item => {
    const domain    = getDomain(item.url);
    const titleText = item.site_title || domain;
    const ownerName = item.owner_name || item.owner_email || 'System';

    // Value score colour
    let scoreClass = 'score-low';
    if (item.value_score >= 75) scoreClass = 'score-high';
    else if (item.value_score >= 50) scoreClass = 'score-mid';

    // Status badge
    let statusBadge = `<span class="badge badge-pending">Pending Approval</span>`;
    if (item.status === 'Active')    statusBadge = `<span class="badge badge-active">Active</span>`;
    if (item.status === 'Approved')  statusBadge = `<span class="badge badge-active">Approved</span>`;
    if (item.status === 'Auditing') statusBadge = `<span class="badge badge-pending" style="color:var(--accent-cyan)">Auditing…</span>`;
    if (item.status === 'Broken')    statusBadge = `<span class="badge badge-broken">Broken</span>`;
    if (item.status === 'Rejected')  statusBadge = `<span class="badge badge-broken" title="${escapeHtml(item.rejection_note)}">Rejected</span>`;

    // Rel badge
    let relBadge = `<span class="badge badge-nofollow">${escapeHtml(item.rel_type || 'Unknown')}</span>`;
    if (['DoFollow', 'Domain Indexed'].includes(item.rel_type)) {
      relBadge = `<span class="badge badge-dofollow">DoFollow</span>`;
    }

    // Acquisition badge
    const acqMap = {
      'Easy Do-Follow':      ['badge-acq-easy',      'Easy Do-Follow'],
      'Persuasion / Outreach':['badge-acq-outreach',  'Outreach / Guest'],
      'Paid / Sponsored':    ['badge-acq-paid',       'Paid'],
      'Directory / Profile': ['badge-acq-directory',  'Directory']
    };
    const [acqClass, acqLabel] = acqMap[item.acquisition_type] || ['badge-acq-easy', item.acquisition_type || 'Easy Do-Follow'];
    const acqBadge = `<span class="badge ${acqClass}">${acqLabel}</span>`;

    const canDelete = currentUser && (currentUser.role === 'admin' || currentUser.id === item.user_id);

    const isAdmin = currentUser && currentUser.role === 'admin';
    const isChecked = selectedVaultIds.has(item.id);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      ${isAdmin ? `<td style="text-align:center;"><input type="checkbox" class="vault-checkbox" value="${item.id}" ${isChecked ? 'checked' : ''} onchange="updateVaultSelection()"></td>` : ''}
      <td>
        <div style="display:flex; flex-direction:column; gap:2px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener"
               style="font-weight:600; color:var(--text-main); text-decoration:none;"
               title="${escapeHtml(item.url)}">
              ${escapeHtml(truncate(titleText, 40))}
            </a>
            ${item.ubersuggest_enriched === 1 ? '<span class="badge" style="font-size:9px; background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.3); padding:2px 5px;" title="Enriched by Ubersuggest MCP">🔌 UberSuggest</span>' : ''}
          </div>
          <span style="font-size:11px; color:var(--text-dim);">
            ${escapeHtml(domain)}${item.target_url ? ' → ' + escapeHtml(truncate(item.target_url, 22)) : ''}
          </span>
        </div>
      </td>
      <td><span style="font-size:12px; color:var(--text-muted);">${escapeHtml(ownerName)}</span></td>
      <td><span class="badge badge-niche">${escapeHtml(item.niche || 'Uncategorized')}</span></td>
      <td>${acqBadge}</td>
      <td><span style="font-weight:600; color:var(--accent-cyan);">${item.da_score || 0}</span></td>
      <td>${relBadge}</td>
      <td>${statusBadge}</td>
      <td><div class="score-badge ${scoreClass}">${item.value_score || 0}</div></td>
      <td>
        <div style="display: flex; gap: 4px;">
        ${(currentUser && currentUser.role === 'admin') 
          ? `<button class="btn btn-secondary" onclick='openEditModal(${JSON.stringify(item).replace(/'/g, "&#39;")})'
               style="padding:4px 8px; font-size:11px;" title="Edit">✏️</button>`
          : ''}
        ${canDelete
          ? `<button class="btn btn-secondary" onclick="deleteLink(${item.id})"
               style="padding:4px 8px; font-size:11px; color:var(--accent-rose);" title="Delete">🗑</button>`
          : ''}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Stats ─────────────────────────────────────────────────────
async function fetchStats() {
  try {
    const res  = await fetch('/api/stats', { headers: getHeaders() });
    const data = await res.json();

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
    set('stat-total',    (data.total  || 0).toLocaleString());
    set('stat-active',   (data.active || 0).toLocaleString());
    set('stat-avg-da',    data.avg_da   || 0);
    set('stat-avg-val',   data.avg_value || 0);

    const pendingSub = document.getElementById('stat-pending-sub');
    if (pendingSub) {
      const queueCount = (data.bot_queue || 0).toLocaleString();
      const pendCount = (data.pending_approval || 0).toLocaleString();
      pendingSub.innerText = `${queueCount} Bot Queue • ${pendCount} Pending Approval`;
    }

    renderNichePills(data.niche_distribution || {});
  } catch (err) {
    console.error('fetchStats error:', err);
  }
}

function renderNichePills(nicheMap) {
  const container = document.getElementById('niche-pills');
  if (!container) return;

  const activeVal = filterNiche;
  container.innerHTML = `<div class="pill ${activeVal === 'All' ? 'active' : ''}" data-filter-type="niche" data-value="All">All Niches</div>`;

  Object.entries(nicheMap).forEach(([niche, count]) => {
    const pill = document.createElement('div');
    pill.className = `pill ${activeVal === niche ? 'active' : ''}`;
    pill.setAttribute('data-filter-type', 'niche');
    pill.setAttribute('data-value', niche);
    pill.innerText = `${niche} (${count})`;
    container.appendChild(pill);
  });
}

// ── Admin Approvals ───────────────────────────────────────────
async function fetchAdminApprovals() {
  if (!currentUser || currentUser.role !== 'admin') return;
  try {
    const res   = await fetch('/api/admin/approvals?limit=100', { headers: getHeaders() });
    const links = await res.json();

    const badge = document.getElementById('pending-approval-badge');
    if (badge) badge.innerText = links.length || 0;

    const tbody = document.getElementById('approvals-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!Array.isArray(links) || !links.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">No pending submissions awaiting approval.</td></tr>`;
      return;
    }

    links.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><a href="${escapeHtml(item.url)}" target="_blank" style="color:var(--accent-cyan); font-weight:600;">${escapeHtml(truncate(item.url, 55))}</a></td>
        <td><span style="font-size:12px; color:var(--text-muted);">${escapeHtml(item.target_url || 'N/A')}</span></td>
        <td><span style="font-size:12px; font-weight:600;">${escapeHtml(item.owner_name || item.owner_email || 'Unknown')}</span></td>
        <td><span style="font-size:12px; color:var(--text-dim);">${escapeHtml(item.created_at)}</span></td>
        <td>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-primary" onclick="approveLink(${item.id})" style="padding:4px 12px; font-size:12px;">✓ Approve</button>
            <button class="btn btn-secondary" onclick="rejectLink(${item.id})" style="padding:4px 10px; font-size:12px; color:var(--accent-rose);">✕ Reject</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('fetchAdminApprovals error:', err);
  }
}

async function approveLink(id) {
  const res = await fetch(`/api/admin/backlinks/${id}/approve`, { method: 'POST', headers: getHeaders() });
  if (res.ok) { fetchAdminApprovals(); fetchBacklinks(); fetchStats(); }
}

async function rejectLink(id) {
  const note = prompt('Reason for rejection (optional):', 'Does not meet backlink quality requirements');
  if (note !== null) {
    const res = await fetch(`/api/admin/backlinks/${id}/reject`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ note })
    });
    if (res.ok) { fetchAdminApprovals(); fetchBacklinks(); fetchStats(); }
  }
}

async function deleteLink(id) {
  if (confirm('Delete this backlink from vault?')) {
    await fetch(`/api/backlinks/${id}`, { method: 'DELETE', headers: getHeaders() });
    fetchBacklinks();
    fetchStats();
    if (currentUser?.role === 'admin') fetchAdminApprovals();
  }
}

// ── Bot Status ────────────────────────────────────────────────
async function fetchBotStatus() {
  if (!currentUser || currentUser.role !== 'admin') return;
  try {
    const res  = await fetch('/api/bot/status', { headers: getHeaders() });
    const data = await res.json();

    botState = data.status || 'running';

    const dot     = document.getElementById('bot-status-dot');
    const text    = document.getElementById('bot-status-text');
    const summary = document.getElementById('bot-queue-summary');
    const toggleB = document.getElementById('toggle-bot-btn');
    const mainTgl = document.getElementById('bot-toggle-main-btn');

    if (botState === 'running') {
      if (dot)     dot.className  = 'dot';
      if (text)    text.innerText = 'Bot Active';
      if (toggleB) toggleB.innerText = 'Pause';
      if (mainTgl) mainTgl.innerText = 'Pause Bot';
    } else {
      if (dot)     dot.className  = 'dot paused';
      if (text)    text.innerText = 'Bot Paused';
      if (toggleB) toggleB.innerText = 'Resume';
      if (mainTgl) mainTgl.innerText = 'Resume Bot';
    }

    if (summary) summary.innerText = `Queue: ${(data.queue_count || 0).toLocaleString()} links`;

    const timerDisp = document.getElementById('bot-timer-display');
    const timerSub  = document.getElementById('bot-timer-subtext');
    if (timerDisp && data.est_remaining_formatted) {
      timerDisp.innerText = data.est_remaining_formatted;
    }
    if (timerSub) {
      timerSub.innerText = `${(data.queue_count || 0).toLocaleString()} links remaining in queue (${data.workers || 1} workers @ ${data.speed_mode === 'turbo' ? '⚡ Turbo' : 'Normal'})`;
    }

    // Only populate speed controls on FIRST load - never overwrite while user is editing
    if (!fetchBotStatus._settingsLoaded) {
      fetchBotStatus._settingsLoaded = true;
      const workersInput = document.getElementById('bot-workers-input');
      const delayInput   = document.getElementById('bot-delay-input');
      const modeSelect   = document.getElementById('bot-speed-mode-select');
      if (workersInput && data.workers) workersInput.value = data.workers;
      if (delayInput && data.delay !== undefined) delayInput.value = data.delay;
      if (modeSelect && data.speed_mode) modeSelect.value = data.speed_mode;
    }

    // Update Ubersuggest MCP status badge & action button
    const mcpBadge = document.getElementById('mcp-status-badge');
    const mcpAction = document.getElementById('mcp-action-container');
    if (mcpBadge && mcpAction) {
      if (data.ubersuggest_connected) {
        mcpBadge.className = 'badge badge-acq-easy';
        mcpBadge.style.cssText = 'font-size: 11px; background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3);';
        mcpBadge.innerText = 'Connected & Active';
        mcpAction.innerHTML = `<button onclick="disconnectUbersuggest()" class="btn btn-secondary" style="font-size: 11px; padding: 6px 12px; color: var(--accent-rose);">Disconnect</button>`;
      } else {
        mcpBadge.className = 'badge';
        mcpBadge.style.cssText = 'font-size: 11px; background: rgba(255,255,255,0.05); color: var(--text-muted); border: 1px solid var(--border-color);';
        mcpBadge.innerText = 'Not Connected';
        mcpAction.innerHTML = `<a href="/api/admin/ubersuggest/connect" class="btn btn-primary" style="font-size: 12px; padding: 8px 16px;">Connect Ubersuggest</a>`;
      }
    }

    if (currentTab === 'bot') {
      const terminal = document.getElementById('bot-terminal');
      if (terminal && Array.isArray(data.logs)) {
        terminal.innerHTML = '';
        [...data.logs].reverse().forEach(l => {
          const div = document.createElement('div');
          div.className = 'log-line';
          div.innerHTML = `<span class="log-time">[${escapeHtml(l.timestamp)}]</span> <span class="log-${l.level}">${escapeHtml(l.message)}</span>`;
          terminal.appendChild(div);
        });
      }
    }
  } catch (err) {
    console.error('fetchBotStatus error:', err);
  }
}

window.disconnectUbersuggest = async function() {
  if (!confirm('Disconnect Ubersuggest MCP connection?')) return;
  const res = await fetch('/api/admin/ubersuggest/disconnect', { method: 'POST', headers: getHeaders() });
  if (res.ok) {
    fetchBotStatus();
  }
};

async function toggleBot() {
  const next = botState === 'running' ? 'paused' : 'running';
  await fetch('/api/bot/settings', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ status: next })
  });
  fetchBotStatus();
}

// ── Modals ────────────────────────────────────────────────────
function initModalHandlers() {
  // Open Add-Link modal
  document.getElementById('open-add-modal-btn')?.addEventListener('click', () => {
    if (!currentUser) {
      document.getElementById('auth-modal').classList.add('active');
      return;
    }
    document.getElementById('add-modal').classList.add('active');
  });

  // Save single link
  document.getElementById('save-link-btn')?.addEventListener('click', async () => {
    const url       = document.getElementById('modal-url').value.trim();
    const targetUrl = document.getElementById('modal-target-url').value.trim();
    const anchor    = document.getElementById('modal-anchor').value.trim();
    if (!url) return alert('Please enter a valid URL');

    const res  = await fetch('/api/backlinks', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ url, target_url: targetUrl, anchor_text: anchor })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      document.getElementById('add-modal').classList.remove('active');
      document.getElementById('modal-url').value = '';
      alert(data.message || 'Link submitted!');
      fetchBacklinks();
      fetchStats();
      if (currentUser?.role === 'admin') fetchAdminApprovals();
    } else {
      alert(data.error || 'Failed to submit link');
    }
  });

  // Close on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('active');
    });
  });
}

// ── File Upload ───────────────────────────────────────────────
function initFileUpload() {
  const dropZone  = document.getElementById('drop-zone');
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

  fileInput?.addEventListener('change', (e) => {
    if (e.target.files.length) handleFile(e.target.files[0]);
  });

  document.getElementById('submit-bulk-btn')?.addEventListener('click', async () => {
    if (!currentUser) { document.getElementById('auth-modal').classList.add('active'); return; }
    const text = document.getElementById('bulk-urls-input').value;
    if (!text.trim()) return alert('Please enter at least one URL');
    await submitBulkText(text, 'pasted URLs');
  });
}

function handleFile(file) {
  if (!currentUser) { document.getElementById('auth-modal').classList.add('active'); return; }
  const name = file.name.toLowerCase();
  const reader = new FileReader();

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb   = XLSX.read(data, { type: 'array' });
        const csv  = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
        await submitBulkText(csv, file.name);
      } catch (err) {
        alert('Error reading Excel file. Please use a valid .xlsx or .csv format.');
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    reader.onload = async (e) => { await submitBulkText(e.target.result, file.name); };
    reader.readAsText(file);
  }
}

async function submitBulkText(text, source) {
  const res  = await fetch('/api/backlinks/bulk', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ urls_text: text })
  });
  const data = await res.json();
  if (res.ok && data.success) {
    const msg = currentUser?.role === 'admin'
      ? `✅ ${data.added_count} links approved & queued for Bot inspection from ${source}!`
      : `✅ ${data.added_count} links submitted from ${source}! Awaiting Admin approval.`;
    alert(msg);
    document.getElementById('bulk-urls-input').value = '';
    fetchBacklinks();
    fetchStats();
    if (currentUser?.role === 'admin') fetchAdminApprovals();
  } else {
    alert(data.error || 'Failed to process links');
  }
}

// ── Personal Tracker ──────────────────────────────────────────
function initPersonalTracker() {
  document.getElementById('open-personal-modal-btn')?.addEventListener('click', () => {
    if (!currentUser) { document.getElementById('auth-modal').classList.add('active'); return; }
    resetPersonalModal();
    document.getElementById('personal-modal').classList.add('active');
  });

  document.getElementById('save-personal-link-btn')?.addEventListener('click', savePersonalLink);

  document.getElementById('personal-project-select')?.addEventListener('change', (e) => {
    personalProjectFilter = e.target.value;
    fetchPersonalBacklinks();
  });
}

function resetPersonalModal() {
  document.getElementById('personal-modal-title').innerText = 'Add Tracked Backlink';
  document.getElementById('pmodal-id').value      = '';
  document.getElementById('pmodal-project').value = '';
  document.getElementById('pmodal-url').value     = '';
  document.getElementById('pmodal-target').value  = '';
  document.getElementById('pmodal-anchor').value  = '';
  document.getElementById('pmodal-notes').value   = '';
  document.getElementById('pmodal-da').value      = '';
}

async function fetchPersonalBacklinks() {
  if (!currentUser) return;
  try {
    const res   = await fetch(`/api/personal-backlinks?project=${encodeURIComponent(personalProjectFilter)}`, { headers: getHeaders() });
    const links = await res.json();
    renderPersonalTable(Array.isArray(links) ? links : []);
  } catch (err) {
    console.error('fetchPersonalBacklinks error:', err);
  }
}

function renderPersonalTable(links) {
  const tbody = document.getElementById('personal-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!links.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:40px; color:var(--text-muted);">No tracked backlinks yet. Click "+ Add Tracked Link" to start!</td></tr>`;
    return;
  }

  // Update project dropdown
  const projects  = Array.from(new Set(links.map(l => l.project_name).filter(Boolean)));
  const projSel   = document.getElementById('personal-project-select');
  if (projSel) {
    const cur = projSel.value;
    projSel.innerHTML = `<option value="">All Projects</option>`;
    projects.forEach(p => projSel.innerHTML += `<option value="${escapeHtml(p)}" ${p === cur ? 'selected' : ''}>${escapeHtml(p)}</option>`);
  }

  let liveCount = 0, indexedCount = 0, daSum = 0;

  links.forEach(item => {
    if (item.status === 'Live')    liveCount++;
    if (item.status === 'Indexed') indexedCount++;
    daSum += (item.da_score || 0);

    const statusBadge = item.status === 'Lost'
      ? `<span class="badge badge-broken">Lost</span>`
      : item.status === 'Pending' || item.status === 'Outreach Sent'
        ? `<span class="badge badge-pending">${escapeHtml(item.status)}</span>`
        : `<span class="badge badge-active">${escapeHtml(item.status)}</span>`;

    const acqMap = {
      'Easy Do-Follow':       'badge-acq-easy',
      'Persuasion / Outreach':'badge-acq-outreach',
      'Paid / Sponsored':     'badge-acq-paid',
      'Directory / Profile':  'badge-acq-directory'
    };
    const acqClass  = acqMap[item.acquisition_type] || 'badge-acq-easy';
    const acqBadge  = `<span class="badge ${acqClass}">${escapeHtml(item.acquisition_type || 'Easy Do-Follow')}</span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="badge badge-niche">${escapeHtml(item.project_name)}</span></td>
      <td><a href="${escapeHtml(item.backlink_url)}" target="_blank" style="color:var(--accent-cyan); font-weight:600; text-decoration:none;">${escapeHtml(truncate(item.backlink_url, 40))}</a></td>
      <td><span style="font-size:12px; color:var(--text-muted);">${escapeHtml(truncate(item.target_url || 'N/A', 30))}</span></td>
      <td>${escapeHtml(item.anchor_text || '—')}</td>
      <td>${acqBadge}</td>
      <td>${statusBadge}</td>
      <td><span style="font-weight:600; color:var(--accent-cyan);">${item.da_score || 0}</span></td>
      <td><span style="font-size:11px; color:var(--text-dim);">${escapeHtml(truncate(item.notes, 25))}</span></td>
      <td>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-secondary" onclick="editPersonalLink(${item.id})" style="padding:4px 8px; font-size:11px;">Edit</button>
          <button class="btn btn-secondary" onclick="deletePersonalLink(${item.id})" style="padding:4px 8px; font-size:11px; color:var(--accent-rose);">✕</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
  set('pstat-total',   links.length);
  set('pstat-live',    liveCount);
  set('pstat-indexed', indexedCount);
  set('pstat-avg-da',  links.length ? Math.round(daSum / links.length) : 0);
}

async function editPersonalLink(id) {
  // Re-fetch this specific record by listing all and finding by id
  const res   = await fetch('/api/personal-backlinks', { headers: getHeaders() });
  const links = await res.json();
  const item  = links.find(l => l.id === id);
  if (!item) return;

  document.getElementById('personal-modal-title').innerText = 'Edit Tracked Backlink';
  document.getElementById('pmodal-id').value      = item.id;
  document.getElementById('pmodal-project').value = item.project_name;
  document.getElementById('pmodal-url').value     = item.backlink_url;
  document.getElementById('pmodal-target').value  = item.target_url || '';
  document.getElementById('pmodal-anchor').value  = item.anchor_text || '';
  document.getElementById('pmodal-acq').value     = item.acquisition_type;
  document.getElementById('pmodal-status').value  = item.status;
  document.getElementById('pmodal-da').value      = item.da_score || '';
  document.getElementById('pmodal-notes').value   = item.notes || '';
  document.getElementById('personal-modal').classList.add('active');
}

async function savePersonalLink() {
  const payload = {
    id:               document.getElementById('pmodal-id').value,
    project_name:     document.getElementById('pmodal-project').value,
    backlink_url:     document.getElementById('pmodal-url').value,
    target_url:       document.getElementById('pmodal-target').value,
    anchor_text:      document.getElementById('pmodal-anchor').value,
    acquisition_type: document.getElementById('pmodal-acq').value,
    status:           document.getElementById('pmodal-status').value,
    da_score:         parseInt(document.getElementById('pmodal-da').value) || 0,
    notes:            document.getElementById('pmodal-notes').value
  };

  if (!payload.backlink_url || !payload.project_name)
    return alert('Project Name and Backlink URL are required');

  const res = await fetch('/api/personal-backlinks', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    document.getElementById('personal-modal').classList.remove('active');
    fetchPersonalBacklinks();
  } else {
    alert('Failed to save personal backlink');
  }
}

async function deletePersonalLink(id) {
  if (confirm('Delete this tracked backlink?')) {
    await fetch(`/api/personal-backlinks/${id}`, { method: 'DELETE', headers: getHeaders() });
    fetchPersonalBacklinks();
  }
}

// ── CMS ───────────────────────────────────────────────────────
function initCMS() {
  document.getElementById('save-cms-page-btn')?.addEventListener('click', saveCMSPage);
  document.getElementById('save-cms-settings-btn')?.addEventListener('click', saveCMSSettings);
}

async function loadCMSPage(slug, pillEl) {
  currentCMSPage = slug;

  // Update pills active state
  if (pillEl) {
    document.querySelectorAll('#cms-page-tabs .pill').forEach(p => p.classList.remove('active'));
    pillEl.classList.add('active');
  } else {
    // Find pill by slug
    const pill = document.querySelector(`#cms-page-tabs .pill[data-cms-slug="${slug}"]`);
    if (pill) {
      document.querySelectorAll('#cms-page-tabs .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
    }
  }

  const display = document.getElementById('cms-page-display');
  if (!display) return;
  display.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-muted);">Loading…</div>`;

  try {
    const res = await fetch(`/api/cms/pages?slug=${encodeURIComponent(slug)}`);
    if (res.ok) {
      const data = await res.json();
      display.innerHTML = `<h2 style="font-size:22px; font-weight:700; margin-bottom:16px;">${escapeHtml(data.title)}</h2><div>${data.content_html}</div>`;
    } else {
      display.innerHTML = `<p style="color:var(--text-muted);">Page not found.</p>`;
    }
  } catch (err) {
    display.innerHTML = `<p style="color:var(--accent-rose);">Error loading page.</p>`;
  }
}

async function loadCMSEditorPage(slug) {
  if (!currentUser || currentUser.role !== 'admin') return;
  try {
    const res = await fetch(`/api/cms/pages?slug=${encodeURIComponent(slug)}`);
    if (res.ok) {
      const data = await res.json();
      document.getElementById('cms-editor-slug').value   = slug;
      document.getElementById('cms-editor-title').value  = data.title || '';
      document.getElementById('cms-editor-content').value = data.content_html || '';
    }
  } catch (err) {
    console.error('loadCMSEditorPage error:', err);
  }
}

async function saveCMSPage() {
  if (!currentUser || currentUser.role !== 'admin') return;
  const slug         = document.getElementById('cms-editor-slug').value;
  const title        = document.getElementById('cms-editor-title').value;
  const content_html = document.getElementById('cms-editor-content').value;

  const res = await fetch('/api/cms/pages', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ slug, title, content_html })
  });

  if (res.ok) {
    alert('✅ Page saved successfully!');
  } else {
    const err = await res.json();
    alert(err.error || 'Failed to save page');
  }
}

async function loadCMSSettings() {
  try {
    const res      = await fetch('/api/cms/settings');
    if (!res.ok) return;
    const settings = await res.json();

    const set = (id, key) => { const el = document.getElementById(id); if (el) el.value = settings[key] || ''; };
    set('set-ga-id',       'ga_tracking_id');
    set('set-gtm-id',      'gtm_id');
    set('set-cookie-text', 'cookie_notice_text');
    set('set-ad-header',   'ad_header_html');
    set('set-ad-sidebar',  'ad_sidebar_html');
    set('set-ad-content',  'ad_content_html');
    set('set-ad-footer',   'ad_footer_html');

    // Render ad slots if enabled
    if (settings.ads_enabled === '1') {
      renderAdSlot('ad-slot-header',  settings.ad_header_html);
      renderAdSlot('ad-slot-sidebar', settings.ad_sidebar_html);
      renderAdSlot('ad-slot-content', settings.ad_content_html);
      renderAdSlot('ad-slot-footer',  settings.ad_footer_html);
    }

    // Update cookie banner text
    const cookieText = document.getElementById('cookie-banner-text');
    if (cookieText && settings.cookie_notice_text) {
      cookieText.innerText = settings.cookie_notice_text;
    }

    // Inject GA / GTM scripts
    if (settings.ga_tracking_id) injectGA(settings.ga_tracking_id);
    if (settings.gtm_id)         injectGTM(settings.gtm_id);
  } catch (err) {
    console.warn('loadCMSSettings error:', err);
  }
}

function renderAdSlot(id, html) {
  const el = document.getElementById(id);
  if (el && html) el.innerHTML = html;
}

async function saveCMSSettings() {
  if (!currentUser || currentUser.role !== 'admin') return;
  const data = {
    ga_tracking_id:   document.getElementById('set-ga-id').value,
    gtm_id:           document.getElementById('set-gtm-id').value,
    cookie_notice_text: document.getElementById('set-cookie-text').value,
    ad_header_html:   document.getElementById('set-ad-header').value,
    ad_sidebar_html:  document.getElementById('set-ad-sidebar').value,
    ad_content_html:  document.getElementById('set-ad-content').value,
    ad_footer_html:   document.getElementById('set-ad-footer').value
  };
  const res = await fetch('/api/cms/settings', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(data)
  });
  if (res.ok) {
    alert('✅ Settings saved! Reloading ad slots…');
    loadCMSSettings();
  } else {
    alert('Failed to save settings');
  }
}

function switchCMSTab(tab) {
  const isPages = tab === 'pages';
  document.getElementById('cms-tab-btn-pages').classList.toggle('active', isPages);
  document.getElementById('cms-tab-btn-settings').classList.toggle('active', !isPages);
  document.getElementById('cms-sec-pages').style.display    = isPages ? 'block' : 'none';
  document.getElementById('cms-sec-settings').style.display = isPages ? 'none'  : 'block';
}

// ── Analytics Charts ──────────────────────────────────────────
async function renderAnalytics() {
  if (!currentUser || currentUser.role !== 'admin') return;
  try {
    const res  = await fetch('/api/stats', { headers: getHeaders() });
    const data = await res.json();

    const niches = Object.keys(data.niche_distribution || {});
    const counts = Object.values(data.niche_distribution || {});
    const colors = ['#22d3ee','#10b981','#a855f7','#fbbf24','#f43f5e','#60a5fa','#34d399','#fb7185'];

    const nicheEl = document.getElementById('nicheChart');
    if (nicheEl) {
      if (nicheChartInstance) nicheChartInstance.destroy();
      nicheChartInstance = new Chart(nicheEl.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: niches.length ? niches : ['No Data'],
          datasets: [{ data: counts.length ? counts : [1], backgroundColor: colors }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af' } } } }
      });
    }

    const daEl = document.getElementById('daChart');
    if (daEl) {
      if (daChartInstance) daChartInstance.destroy();
      daChartInstance = new Chart(daEl.getContext('2d'), {
        type: 'bar',
        data: {
          labels: ['0–20', '21–40', '41–60', '61–80', '81–100'],
          datasets: [{ label: 'Domain Authority (DA)', data: [3, 7, 10, 5, 2], backgroundColor: '#22d3ee' }]
        },
        options: {
          responsive: true,
          scales: {
            x: { ticks: { color: '#9ca3af' } },
            y: { ticks: { color: '#9ca3af' } }
          },
          plugins: { legend: { labels: { color: '#9ca3af' } } }
        }
      });
    }
  } catch (err) {
    console.error('renderAnalytics error:', err);
  }
}

// ── Cookie Banner ─────────────────────────────────────────────
function initCookieBanner() {
  if (!localStorage.getItem('vault_cookies_accepted')) {
    // Show after a small delay
    setTimeout(() => {
      const banner = document.getElementById('cookie-banner');
      if (banner) banner.style.display = 'flex';
    }, 2000);
  }
}

function acceptCookies() {
  localStorage.setItem('vault_cookies_accepted', '1');
  const banner = document.getElementById('cookie-banner');
  if (banner) banner.style.display = 'none';
}

// ── Analytics Tag Injection ───────────────────────────────────
function injectGA(measurementId) {
  if (!measurementId || document.getElementById('ga-script')) return;
  const s = document.createElement('script');
  s.id  = 'ga-script';
  s.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  s.async = true;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function() { dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('config', measurementId);
}

function injectGTM(gtmId) {
  if (!gtmId || document.getElementById('gtm-script')) return;
  const s = document.createElement('script');
  s.id = 'gtm-script';
  s.innerHTML = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start': new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');`;
  document.head.appendChild(s);
}

// ── Utilities ─────────────────────────────────────────────────
function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); }
  catch(e) { return url; }
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '…' : str;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Edit Backlink (Admin Only)
window.openEditModal = function(item) {
  document.getElementById('edit-modal-id').value = item.id;
  document.getElementById('edit-modal-url').value = item.url;
  document.getElementById('edit-modal-target-url').value = item.target_url || "";
  document.getElementById('edit-modal-anchor').value = item.anchor_text || "";
  document.getElementById('edit-modal-niche').value = item.niche || "General";
  document.getElementById('edit-modal').classList.add('active');
};

document.getElementById('save-edit-btn')?.addEventListener('click', async () => {
  const id = document.getElementById('edit-modal-id').value;
  const url = document.getElementById('edit-modal-url').value;
  const targetUrl = document.getElementById('edit-modal-target-url').value;
  const anchorText = document.getElementById('edit-modal-anchor').value;
  const niche = document.getElementById('edit-modal-niche').value;

  try {
    const res = await fetch(`/api/admin/backlinks/${id}/edit`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ url, target_url: targetUrl, anchor_text: anchorText, niche })
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('edit-modal').classList.remove('active');
      fetchBacklinks();
    } else {
      alert(data.error || "Failed to update backlink");
    }
  } catch (err) {
    console.error("Error saving edit:", err);
  }
});


// -----------------------------------------------
// USER MANAGEMENT TAB (Admin Only)
// -----------------------------------------------
let allUsers = [];

async function fetchAdminUsers() {
  try {
    const res = await fetch('/api/admin/users', { headers: getHeaders() });
    if (!res.ok) return;
    allUsers = await res.json();
    renderUsersTable(allUsers);
  } catch(e) { console.error('fetchAdminUsers:', e); }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;

  // Update stats
  const totalLinks = users.reduce((s, u) => s + (u.backlinks_submitted || 0), 0);
  const el = (id, v) => { const e = document.getElementById(id); if (e) e.innerText = v; };
  el('ustat-total', users.length);
  el('ustat-links', totalLinks);
  el('ustat-newest', users.length ? (users[0].email || '�') : '�');

  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted);">No users registered yet.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  users.forEach((u, i) => {
    const tr = document.createElement('tr');
    const joined = u.created_at ? new Date(u.created_at).toLocaleDateString() : '�';
    const roleBadge = u.role === 'admin'
      ? `<span class="badge badge-acq-paid" style="font-size:11px;">Admin</span>`
      : `<span class="badge" style="font-size:11px;background:rgba(16,185,129,.12);color:#10b981;border:1px solid rgba(16,185,129,.3);">Member</span>`;

    tr.innerHTML = `
      <td style="color:var(--text-dim);font-size:12px;">${i + 1}</td>
      <td style="font-weight:500;">${escapeHtml(u.name || '�')}</td>
      <td style="font-size:13px;color:var(--accent-cyan);">${escapeHtml(u.email)}</td>
      <td>${roleBadge}</td>
      <td style="font-weight:600;">${u.backlinks_submitted || 0}</td>
      <td style="font-size:12px;color:var(--text-muted);">${joined}</td>
      <td>
        ${u.role !== 'admin' ? `<button class="btn btn-secondary" onclick="deleteUser(${u.id},'${escapeHtml(u.email)}')" style="padding:4px 10px;font-size:11px;color:var(--accent-rose);">?? Delete</button>` : '<span style="color:var(--text-dim);font-size:11px;">Protected</span>'}
      </td>`;
    tbody.appendChild(tr);
  });
}

window.deleteUser = async function(id, email) {
  if (!confirm(`Delete user "${email}"? This will also remove all their sessions.`)) return;
  const res = await fetch(`/api/admin/users/${id}/delete`, { method: 'POST', headers: getHeaders() });
  if (res.ok) {
    allUsers = allUsers.filter(u => u.id !== id);
    renderUsersTable(allUsers);
  } else {
    const d = await res.json();
    alert(d.error || 'Failed to delete user');
  }
};

// User search filter
document.getElementById('user-search-input')?.addEventListener('input', function() {
  const q = this.value.toLowerCase();
  const filtered = allUsers.filter(u =>
    (u.email || '').toLowerCase().includes(q) ||
    (u.name || '').toLowerCase().includes(q)
  );
  renderUsersTable(filtered);
});

// -----------------------------------------------
// BATCH BOT RE-SCAN FOR ADMIN
// -----------------------------------------------
let selectedVaultIds = new Set();

function updateVaultSelection() {
  const checkboxes = document.querySelectorAll('.vault-checkbox');
  selectedVaultIds.clear();
  checkboxes.forEach(cb => {
    if (cb.checked) {
      selectedVaultIds.add(parseInt(cb.value, 10));
    }
  });

  const count = selectedVaultIds.size;
  const countBadge = document.getElementById('selected-count-badge');
  const btnCount = document.getElementById('rescan-selected-btn-count');
  const batchBar = document.getElementById('admin-batch-bar');

  if (countBadge) countBadge.innerText = `${count} Selected`;
  if (btnCount) btnCount.innerText = count;

  // Sync master checkbox
  const master = document.getElementById('select-all-vault-checkbox');
  if (master && checkboxes.length > 0) {
    master.checked = count === checkboxes.length;
  }
}

window.toggleSelectAllVault = function(master) {
  const checkboxes = document.querySelectorAll('.vault-checkbox');
  checkboxes.forEach(cb => { cb.checked = master.checked; });
  updateVaultSelection();
};

window.rescanSelectedDomains = async function() {
  if (selectedVaultIds.size === 0) {
    alert('Please select at least one domain to re-scan.');
    return;
  }
  const ids = Array.from(selectedVaultIds);
  if (!confirm(`Re-scan ${ids.length} selected domain(s) with the bot worker?`)) return;

  try {
    const res = await fetch('/api/admin/backlinks/rescan', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ ids })
    });
    const data = await res.json();
    if (res.ok) {
      alert(data.message || 'Domains queued for Bot re-scan!');
      selectedVaultIds.clear();
      fetchBacklinks();
      fetchBotStatus();
    } else {
      alert(data.error || 'Failed to queue domains for re-scan');
    }
  } catch (err) {
    console.error('rescanSelectedDomains error:', err);
  }
};

window.rescanAllDomains = async function() {
  if (!confirm('Re-scan ALL domains in the Vault with the Bot Worker? This will place all domains in the inspection queue.')) return;

  try {
    const res = await fetch('/api/admin/backlinks/rescan', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ rescan_all: true })
    });
    const data = await res.json();
    if (res.ok) {
      alert(data.message || 'ALL domains queued for Bot re-scan!');
      selectedVaultIds.clear();
      fetchBacklinks();
      fetchBotStatus();
    } else {
      alert(data.error || 'Failed to queue all domains for re-scan');
    }
  } catch (err) {
    console.error('rescanAllDomains error:', err);
  }
};

// -----------------------------------------------
// BOT SPEED & WORKER SETTINGS
// -----------------------------------------------
// Auto-configure when turbo mode is selected
window.onBotModeChange = function(select) {
  if (select.value === 'turbo') {
    const wi = document.getElementById('bot-workers-input');
    const di = document.getElementById('bot-delay-input');
    if (wi) wi.value = 5;
    if (di) di.value = 0;
  }
};

window.saveBotSpeedSettings = async function() {
  const workers   = parseInt(document.getElementById('bot-workers-input')?.value || '1', 10);
  const delay     = parseFloat(document.getElementById('bot-delay-input')?.value || '1');
  const speedMode = document.getElementById('bot-speed-mode-select')?.value || 'normal';

  try {
    const res = await fetch('/api/bot/settings', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ workers, delay, speed_mode: speedMode })
    });
    if (res.ok) {
      const msg = workers > 1
        ? `Settings saved! ${workers} workers will be active after next server restart. Delay: ${delay}s, Mode: ${speedMode}.`
        : `Settings saved! Delay: ${delay}s, Mode: ${speedMode}.`;
      alert(msg);
      fetchBotStatus();
    } else {
      alert('Failed to save bot settings.');
    }
  } catch (err) {
    console.error('saveBotSpeedSettings error:', err);
  }
};

// -----------------------------------------------
// UBERSUGGEST MANUAL TOKEN SAVE
// -----------------------------------------------
window.saveManualMCPToken = async function() {
  const token = document.getElementById('mcp-manual-token-input')?.value?.trim();
  if (!token) { alert('Please paste a valid access token.'); return; }
  try {
    const res = await fetch('/api/admin/ubersuggest/token', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ token })
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      document.getElementById('mcp-manual-token-input').value = '';
      alert('Ubersuggest token saved! Bot will now enrich scans with live SEO data.');
      fetchBotStatus();
    } else {
      alert(data.error || 'Failed to save token.');
    }
  } catch (err) { console.error(err); }
};

// -----------------------------------------------
// SERVER RESTART
// -----------------------------------------------
window.restartServer = async function() {
  if (!confirm('Restart the server? It will be back online in ~5 seconds. This activates any changed worker count settings.')) return;
  try {
    const res = await fetch('/api/admin/restart', { method: 'POST', headers: getHeaders() });
    const data = await res.json();
    if (res.ok) {
      alert('Server is restarting... The page will reload in 6 seconds.');
      setTimeout(() => window.location.reload(), 6000);
    } else {
      alert(data.error || 'Failed to restart.');
    }
  } catch (err) {
    // Connection reset is expected when server restarts
    alert('Server is restarting... Reloading in 6 seconds.');
    setTimeout(() => window.location.reload(), 6000);
  }
};

// -----------------------------------------------
// USER ACCOUNT MANAGEMENT
// -----------------------------------------------
window.changePassword = async function() {
  const currentPw = document.getElementById('acct-current-pw')?.value;
  const newPw     = document.getElementById('acct-new-pw')?.value;
  if (!currentPw || !newPw) { alert('Please fill in both password fields.'); return; }
  if (newPw.length < 6) { alert('New password must be at least 6 characters.'); return; }
  try {
    const res = await fetch('/api/user/change-password', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ current_password: currentPw, new_password: newPw })
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      document.getElementById('acct-current-pw').value = '';
      document.getElementById('acct-new-pw').value = '';
      alert('Password updated successfully!');
    } else {
      alert(data.error || 'Failed to update password.');
    }
  } catch (err) { console.error(err); }
};

window.deleteMyAccount = async function() {
  if (!confirm('Are you absolutely sure? This will permanently delete your account AND all your personal backlink data. There is no undo.')) return;
  if (!confirm('Last chance � delete my account permanently?')) return;
  try {
    const res = await fetch('/api/user/delete-account', { method: 'POST', headers: getHeaders() });
    const data = await res.json();
    if (res.ok && data.ok) {
      alert('Your account has been deleted. Goodbye!');
      logout();
    } else {
      alert(data.error || 'Failed to delete account.');
    }
  } catch (err) { console.error(err); }
};
