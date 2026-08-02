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
    googleClientId = cfg.google_client_id || '';
  } catch (e) {
    console.warn('Config load failed, Google Sign-In may not work');
    googleClientId = '';
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
  setInterval(() => {
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
  // Wire up Google GSI if library is ready
  initGoogleSignIn();

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

function initGoogleSignIn() {
  const GOOGLE_CLIENT_ID = googleClientId;  // loaded from /api/config → env var

  // Wire up the custom fallback button click regardless of GSI state
  const customBtn = document.getElementById('custom-google-btn');
  if (customBtn) {
    customBtn.onclick = () => triggerGoogleSignIn();
  }

  function triggerGoogleSignIn() {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
      try {
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleSignIn,
          auto_select: false,
          cancel_on_tap_outside: true
        });
        google.accounts.id.prompt((notification) => {
          // If One Tap is suppressed/unavailable, show the GSI popup via oauth2
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            openGoogleOAuth2Popup();
          }
        });
      } catch (err) {
        console.warn('GSI prompt error, falling back to popup:', err);
        openGoogleOAuth2Popup();
      }
    } else {
      // GSI not loaded yet — open manual OAuth popup
      openGoogleOAuth2Popup();
    }
  }

  function openGoogleOAuth2Popup() {
    // Use Google OAuth2 token endpoint (implicit/popup flow) which doesn't need server-side exchange
    const redirectUri = encodeURIComponent(window.location.origin + '/api/auth/google/callback');
    const scope = encodeURIComponent('openid email profile');
    const url = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
      `&redirect_uri=${redirectUri}` +
      `&response_type=token` +
      `&scope=${scope}` +
      `&prompt=select_account`;

    const w = 500, h = 600;
    const left = (screen.width / 2) - (w / 2);
    const top  = (screen.height / 2) - (h / 2);
    window.open(url, 'googleOAuth', `width=${w},height=${h},top=${top},left=${left}`);
  }

  // Attempt to render the official GSI button in the container
  function tryRenderGSI(attempts) {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
      try {
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleSignIn,
          auto_select: false
        });
        const container = document.getElementById('google-signin-btn');
        if (container) {
          // Replace the custom button with the real GSI button
          google.accounts.id.renderButton(container, {
            theme: 'outline',
            size: 'large',
            text: 'continue_with',
            width: 340
          });
        }
      } catch (err) {
        console.warn('GSI renderButton error:', err);
      }
    } else if (attempts > 0) {
      setTimeout(() => tryRenderGSI(attempts - 1), 600);
    }
  }

  tryRenderGSI(25); // Retry for up to 15 seconds
}

async function handleGoogleSignIn(response) {
  try {
    const token   = response.credential;
    const parts   = token.split('.');
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const res     = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: payload.email, name: payload.name, picture: payload.picture })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      onAuthSuccess(data.token, data.user);
    } else {
      alert(data.error || 'Google Sign-In failed. Please try again.');
    }
  } catch (err) {
    console.error('Google Sign-In error:', err);
    alert('Google Sign-In failed. Please try email/password login.');
  }
}

// Handle access_token from OAuth2 implicit flow (popup redirect)
async function handleGoogleAccessToken(accessToken) {
  try {
    // Fetch user profile from Google's userinfo endpoint
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!profileRes.ok) throw new Error('Failed to fetch Google profile');
    const profile = await profileRes.json();

    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email:   profile.email,
        name:    profile.name || profile.email.split('@')[0],
        picture: profile.picture || ''
      })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      onAuthSuccess(data.token, data.user);
    } else {
      console.error('Google auth failed:', data.error);
    }
  } catch (err) {
    console.error('handleGoogleAccessToken error:', err);
  }
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
      adminElements.forEach(el => el.style.display = 'flex');
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
    fetchBacklinks();
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

    if (type === 'niche')  { filterNiche  = val; filterStatus = 'All'; filterRel = 'All'; }
    if (type === 'status') { filterStatus = val; filterRel = 'All';    filterNiche = 'All'; resetNicheActive(); }
    if (type === 'rel')    { filterRel    = val; filterStatus = 'All'; filterNiche = 'All'; resetNicheActive(); }
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
async function fetchBacklinks() {
  try {
    const params = new URLSearchParams({
      search: searchQuery,
      niche:  filterNiche,
      status: filterStatus,
      rel:    filterRel,
      acq:    filterAcq,
      limit:  100,
      offset: 0
    });
    const res   = await fetch(`/api/backlinks?${params}`, { headers: getHeaders() });
    const links = await res.json();
    renderVaultTable(Array.isArray(links) ? links : []);
  } catch (err) {
    console.error('fetchBacklinks error:', err);
    renderVaultTable([]);
  }
}

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

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="display:flex; flex-direction:column; gap:2px;">
          <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener"
             style="font-weight:600; color:var(--text-main); text-decoration:none;"
             title="${escapeHtml(item.url)}">
            ${escapeHtml(truncate(titleText, 45))}
          </a>
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
        ${canDelete
          ? `<button class="btn btn-secondary" onclick="deleteLink(${item.id})"
               style="padding:4px 8px; font-size:11px; color:var(--accent-rose);" title="Delete">✕</button>`
          : ''}
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
