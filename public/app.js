let state = { leads: [], outreach: [] }, ef = 'all', selected = new Set(), pending = [];
let authToken = localStorage.getItem('vcode_auth_token') || sessionStorage.getItem('vcode_auth_token') || '';

const $ = s => document.querySelector(s);
const esc = s => String(s || '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

// Authenticated API client
async function api(url, o = {}) {
  const headers = {
    'content-type': 'application/json',
    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
  };
  const r = await fetch(url, { headers, ...o });
  
  if (r.status === 401) {
    showActivationScreen();
    throw Error('Activation key required or expired.');
  }
  
  const d = await r.json();
  if (!r.ok) throw Error(d.error || 'Request failed');
  return d;
}

// ============================================================================
// 💬 MASCOT MESSAGES & SPEECH CONFIGURATION (EDIT YOUR TEXTS HERE!)
// ============================================================================
const MASCOT_MESSAGES = {
  // 1. Messages shown when clicking the mascot
  clickQuotes: [
    { state: 'curious', text: "ACH HAD L9LAWI" },
    { state: 'exited', text: "khdm aw9" },
    { state: 'listening', text: "sir t9hwa " },
    { state: 'searching', text: "Tip: Use 'Copy AI Prompt' on the Leads tab to research targets!copy lprompt " }
  ],

  // 2. Ambient idle messages shown periodically (عشوائيا)
  ambientThoughts: [
    { state: 'curious', text: "Tip: Check out the interested leads first!" },
    { state: 'bored', text: "Waiting for fresh responses to roll in..." },
    { state: 'listening', text: "All systems live and connected." },
    { state: 'exited', text: "VCode is on fire! Let’s close some deals." }
  ],

  // 3. Drag and Drop flight messages
  flying: "I'm flying! 🚀",
  landed: "Landed safely! 🎯",

  // 4. Action reactions
  unlocked: "Workspace unlocked! Welcome to VCode.",
  accessDenied: "Access Denied! Incorrect activation key.",
  syncing: "Connecting to Instantly and syncing leads...",
  syncComplete: "Instantly leads sync complete!",
  syncError: msg => "Sync error: " + msg,
  leadUpdated: "Lead updated successfully!",
  leadAdded: "New lead added to workspace!",
  leadDeleted: count => `Deleted ${count} lead(s) from workspace.`,
  subscribed: email => `Subscribed ${email} for real-time alerts!`,
  promptCopied: "AI lead-gen prompt copied to clipboard! Ready to research.",
  viewingMail: "Reviewing lead conversation and messages..."
};

// ============================================================================
// 🤖 INTERACTIVE MASCOT MANAGER (RED DASHBOARD + WHITE LOGIN)
// ============================================================================
const mascotManager = {
  activeTimer: null,
  bubbleTimer: null,
  currentState: 'idle',
  isColorShifting: false,
  clickCount: 0,
  
  states: {
    red: {
      idle: 'avatar/red/idle.gif',
      angry: 'avatar/red/angry.gif',
      bored: 'avatar/red/bored.gif',
      curious: 'avatar/red/curious.gif',
      exited: 'avatar/red/exited.gif',
      listening: 'avatar/red/listening.gif',
      searching: 'avatar/red/searching.gif',
      svg: 'avatar/red/mascot-red.svg'
    },
    white: {
      idle: 'avatar/white/idle.gif',
      angry: 'avatar/white/angry.gif',
      bored: 'avatar/white/bored.gif',
      curious: 'avatar/white/curious.gif',
      exited: 'avatar/white/exited.gif',
      listening: 'avatar/white/listening.gif',
      searching: 'avatar/white/searching.gif',
      svg: 'avatar/white/mascot-white.svg'
    }
  },

  // 1. Bottom-Right Companion (Red Theme)
  set(stateName, message = null, durationMs = 4500) {
    if (this.isColorShifting) return;
    const src = this.states.red[stateName] || this.states.red.idle;
    this.currentState = stateName;

    const companionImg = $('#mascotImg');
    if (companionImg) companionImg.src = src;

    if (message) {
      this.say(message, durationMs);
    }

    if (this.activeTimer) clearTimeout(this.activeTimer);
    if (stateName !== 'idle' && durationMs > 0) {
      this.activeTimer = setTimeout(() => {
        this.resetToIdle();
      }, durationMs);
    }
  },

  // 2. Login Screen Mascot (White Theme)
  setAuth(stateName) {
    const authMascotImg = $('#authMascotImg');
    const wrap = $('#authMascotWrap');
    const src = this.states.white[stateName] || this.states.white.idle;
    if (authMascotImg) authMascotImg.src = src;
    if (wrap) {
      if (stateName === 'angry') {
        wrap.classList.add('auth-mascot-shake');
        setTimeout(() => wrap.classList.remove('auth-mascot-shake'), 600);
      }
    }
  },

  // 3. Smooth Color Morph Transition (Blue -> Green -> Yellow -> Purple -> Red) - 100% SILENT (NO TEXT)
  async playColorTransition() {
    if (this.isColorShifting) return;
    this.isColorShifting = true;

    const companionImg = $('#mascotImg');
    if (!companionImg) return;

    this.hideBubble();
    companionImg.classList.add('color-shifting');

    const colorSteps = [
      'avatar/colors/blue.svg',
      'avatar/colors/green.svg',
      'avatar/colors/yellow.svg',
      'avatar/colors/purple.svg',
      'avatar/colors/red.svg'
    ];

    for (let i = 0; i < colorSteps.length; i++) {
      const src = colorSteps[i];
      companionImg.style.opacity = '0.35';
      companionImg.style.transform = 'scale(0.92)';
      await new Promise(r => setTimeout(r, 180));

      companionImg.src = src;

      companionImg.style.opacity = '1';
      companionImg.style.transform = 'scale(1.08)';
      await new Promise(r => setTimeout(r, 1000));
    }

    // Smoothly return to Red Idle GIF
    companionImg.style.opacity = '0.35';
    await new Promise(r => setTimeout(r, 180));
    companionImg.src = this.states.red.idle;
    companionImg.style.opacity = '1';
    companionImg.style.transform = '';
    companionImg.classList.remove('color-shifting');

    setTimeout(() => {
      this.isColorShifting = false;
      this.resetToIdle();
    }, 800);
  },

  say(message, durationMs = 4500) {
    const bubble = $('#mascotBubble');
    const textEl = $('#mascotBubbleText');
    if (bubble && textEl) {
      textEl.textContent = message;
      bubble.hidden = false;
      if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
      if (durationMs > 0) {
        this.bubbleTimer = setTimeout(() => {
          bubble.hidden = true;
        }, durationMs);
      }
    }
  },

  hideBubble() {
    const bubble = $('#mascotBubble');
    if (bubble) bubble.hidden = true;
  },

  resetToIdle() {
    this.currentState = 'idle';
    const companionImg = $('#mascotImg');
    if (companionImg && !this.isColorShifting) companionImg.src = this.states.red.idle;
    const authMascotImg = $('#authMascotImg');
    if (authMascotImg) authMascotImg.src = this.states.white.idle;
  },

  init() {
    this.setupDraggable();

    const closeBtn = $('#closeMascotBubble');
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        this.hideBubble();
      };
    }

    // Periodic random ambient behavior & random color shifts (عشوائيا)
    setInterval(() => {
      if (this.currentState === 'idle' && !this.isColorShifting && $('#activationOverlay')?.hidden) {
        const shouldColorShift = Math.random() < 0.25;
        if (shouldColorShift) {
          this.playColorTransition();
        } else {
          const list = MASCOT_MESSAGES.ambientThoughts;
          const pick = list[Math.floor(Math.random() * list.length)];
          this.set(pick.state, pick.text, 4000);
        }
      }
    }, 45000);
  },

  setupDraggable() {
    const companion = $('#mascotCompanion');
    const handle = $('#mascotInteractiveBtn');
    if (!companion || !handle) return;

    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;
    let hasMoved = false;

    const MASCOT_SIZE = 92;    // px — matches rendered mascot width/height
    const SIDEBAR_W   = 258;   // px — sidebar width + small buffer
    const EDGE_PAD    = 10;    // px — min gap from left/top/right edges
    const BOTTOM_PAD  = 24;    // px — extra clearance from bottom (above taskbar)

    // Clamp helper — keeps mascot fully inside viewport (respects sidebar on left)
    const clamp = (x, y) => ({
      x: Math.min(Math.max(SIDEBAR_W, x), window.innerWidth  - MASCOT_SIZE - EDGE_PAD),
      y: Math.min(Math.max(EDGE_PAD,   y), window.innerHeight - MASCOT_SIZE - BOTTOM_PAD)
    });

    // Reposition speech bubble so it never clips off-screen
    const repositionBubble = () => {
      const bubble = $('#mascotBubble');
      if (!bubble) return;
      const rect = companion.getBoundingClientRect();
      // Flip bubble to RIGHT side when mascot is near left edge
      bubble.classList.toggle('bubble-flip-right', rect.left < SIDEBAR_W + 280);
      // Flip bubble BELOW mascot when mascot is near top edge
      bubble.classList.toggle('bubble-flip-below', rect.top < 120);
    };

    // Restore saved position if available
    try {
      const saved = JSON.parse(localStorage.getItem('vcode_mascot_pos'));
      if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
        const { x, y } = clamp(saved.left, saved.top);
        companion.style.bottom = 'auto';
        companion.style.right  = 'auto';
        companion.style.left   = `${x}px`;
        companion.style.top    = `${y}px`;
      }
    } catch (_) {}

    const onStart = (clientX, clientY) => {
      const rect = companion.getBoundingClientRect();
      isDragging = true;
      hasMoved = false;
      startX = clientX;
      startY = clientY;
      initialLeft = rect.left;
      initialTop = rect.top;
      // NOTE: Do NOT convert bottom/right → left/top here.
      // That conversion only happens once real drag movement is detected.
    };

    const onMove = (clientX, clientY) => {
      if (!isDragging) return;
      const dx = clientX - startX;
      const dy = clientY - startY;

      if (!hasMoved && Math.hypot(dx, dy) > 5) {
        hasMoved = true;
        // Lock position to left/top NOW (first time we know user is really dragging)
        companion.style.bottom = 'auto';
        companion.style.right = 'auto';
        companion.style.left = `${initialLeft}px`;
        companion.style.top = `${initialTop}px`;
        companion.classList.add('is-flying');
        this.set('exited', MASCOT_MESSAGES.flying, 0);
      }

      if (hasMoved) {
        const { x: newX, y: newY } = clamp(initialLeft + dx, initialTop + dy);
        companion.style.left = `${newX}px`;
        companion.style.top  = `${newY}px`;
        repositionBubble();
      }
    };

    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      companion.classList.remove('is-flying');

      if (hasMoved) {
        const rect = companion.getBoundingClientRect();
        localStorage.setItem('vcode_mascot_pos', JSON.stringify({ left: rect.left, top: rect.top }));
        repositionBubble();
        this.say(MASCOT_MESSAGES.landed, 2500);
        setTimeout(() => this.resetToIdle(), 1600);
      }
    };

    // Mouse Drag events
    handle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      onStart(e.clientX, e.clientY);

      const onMouseMove = ev => onMove(ev.clientX, ev.clientY);
      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        onEnd();
      };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });

    // Touch events
    handle.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        onStart(t.clientX, t.clientY);
      }
    }, { passive: true });

    window.addEventListener('touchmove', e => {
      if (isDragging && e.touches.length === 1) {
        const t = e.touches[0];
        onMove(t.clientX, t.clientY);
      }
    }, { passive: true });

    window.addEventListener('touchend', () => {
      if (isDragging) onEnd();
    });

    // Click handler for quotes when NOT dragging
    handle.onclick = (e) => {
      if (hasMoved) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      this.clickCount++;
      if (this.clickCount % 5 === 0) {
        this.playColorTransition();
        return;
      }
      const quotes = MASCOT_MESSAGES.clickQuotes;
      const item = quotes[this.clickCount % quotes.length];
      this.set(item.state, item.text, 4500);
    };
  }
};

// ==========================================
// ACTIVATION & AUTH SYSTEM
// ==========================================
function showActivationScreen() {
  const overlay = $('#activationOverlay');
  if (overlay) {
    overlay.hidden = false;
    $('#activationError').hidden = true;
    $('#activationKeyInput').value = '';
    $('#activationKeyInput').focus();
    mascotManager.setAuth('idle');
    const companion = $('#mascotCompanion');
    if (companion) companion.hidden = true;
  }
}

function hideActivationScreen() {
  const overlay = $('#activationOverlay');
  if (overlay) overlay.hidden = true;
  const companion = $('#mascotCompanion');
  if (companion) {
    companion.hidden = false;
    mascotManager.resetToIdle();
  }
}

$('#activationForm').onsubmit = async e => {
  e.preventDefault();
  const key = $('#activationKeyInput').value.trim();
  const errEl = $('#activationError');
  errEl.hidden = true;

  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ activationKey: key })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Invalid activation key');

    authToken = d.token;
    localStorage.setItem('vcode_auth_token', authToken);
    sessionStorage.setItem('vcode_auth_token', authToken);
    mascotManager.setAuth('exited');
    setTimeout(() => {
      hideActivationScreen();
      mascotManager.set('exited', 'Workspace unlocked! Welcome to VCode.', 4000);
      showToast('Workspace unlocked successfully');
      load();
    }, 600);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
    mascotManager.setAuth('angry');
  }
};

$('#lockWorkspaceBtn').onclick = () => {
  authToken = '';
  localStorage.removeItem('vcode_auth_token');
  sessionStorage.removeItem('vcode_auth_token');
  showActivationScreen();
};

async function load() {
  try {
    state = await api('/api/state');
    hideActivationScreen();
    render();
  } catch (err) {
    if (err.message.includes('Activation')) showActivationScreen();
  }
}

const label = s => s === 'interested' ? 'Interested' : (s === 'not_interested' ? 'Not interested' : s);
const ago = d => {
  const h = Math.round((Date.now() - new Date(d)) / 36e5);
  return h < 24 ? `${Math.max(0, h)}h ago` : `${Math.round(h / 24)}d ago`;
};

function page() {
  const p = location.hash === '#leads' ? 'leads' : 'emails';
  $('#leadsPage').hidden = p !== 'leads';
  $('#emailsPage').hidden = p !== 'emails';
  document.querySelectorAll('[data-page]').forEach(x => x.classList.toggle('active', x.dataset.page === p));
  render();
}

function render() {
  const q = ($('#emailSearch')?.value || '').toLowerCase();
  const all = state.outreach || [];
  const rs = all.filter(x => (ef === 'all' || x.status === ef) && `${x.name} ${x.company} ${x.email}`.toLowerCase().includes(q));
  const yes = all.filter(x => x.status === 'interested').length;
  const no = all.filter(x => x.status === 'not_interested').length;

  $('#interested').textContent = yes;
  $('#notInterested').textContent = no;
  $('#responses').textContent = all.length;
  $('#allCount').textContent = all.length;
  $('#interestedCount').textContent = yes;
  $('#notInterestedCount').textContent = no;
  $('#inboxCount').textContent = all.length;
  $('#resultSummary').textContent = `Showing ${rs.length ? `1–${rs.length}` : 0} of ${rs.length} results`;

  $('#emailRows').innerHTML = rs.map(x => `
    <tr>
      <td><input type="checkbox" aria-label="Select ${esc(x.name || x.email)}"></td>
      <td>
        <div class="sender">
          <span class="avatar">${avatar(x.name || x.email)}</span>
          <div>
            <b>${esc(x.name || x.email)}</b>
            <div class="email">${esc(x.email)}</div>
          </div>
        </div>
      </td>
      <td>${esc(x.company || '—')}</td>
      <td>
        <b>${ago(x.updatedAt || x.createdAt)}</b>
        <div class="email">${new Date(x.updatedAt || x.createdAt).toLocaleDateString()}</div>
      </td>
      <td><span class="status ${x.status}">${label(x.status)}</span></td>
      <td style="text-align: right;">
        <button class="mail-trigger" onclick="viewMail('${x.id}')">
          <i class="ui-icon icon-mail"></i>
          <span>Open mail</span>
        </button>
      </td>
    </tr>
  `).join('');
  $('#emptyEmails').style.display = rs.length ? 'none' : 'block';

  const lq = ($('#leadSearch')?.value || '').toLowerCase();
  const ls = (state.leads || []).filter(x => `${x.name} ${x.company} ${x.email} ${x.jobTitle} ${x.website} ${x.linkedin}`.toLowerCase().includes(lq));

  $('#leadRows').innerHTML = ls.map(x => `
    <tr>
      <td><input type="checkbox" ${selected.has(x.id) ? 'checked' : ''} onchange="pick('${x.id}',this.checked)"></td>
      <td><b>${esc(x.name || '—')}</b></td>
      <td>${esc(x.company || '—')}</td>
      <td>${esc(x.jobTitle || '—')}</td>
      <td>${esc(x.email)}</td>
      <td>${esc(x.phone || '—')}</td>
      <td>${esc(x.country || '—')}</td>
      <td>${esc(x.source || '—')}</td>
      <td style="text-align: right;">
        <button class="edit-btn" onclick="editLead('${x.id}')" aria-label="Edit ${esc(x.name || x.email)}" title="Edit lead">
          <i class="ui-icon edit-pen-icon"></i>
        </button>
      </td>
    </tr>
  `).join('');
  $('#emptyLeads').style.display = ls.length ? 'none' : 'block';
}

function pick(id, on) {
  on ? selected.add(id) : selected.delete(id);
}

// ==========================================
// SOCIAL LINKS & EMAIL VIEWER
// ==========================================
const SOCIAL_PLATFORMS = [
  {
    name: 'Instagram',
    id: 'instagram',
    match: /(?:instagram\.com|instagr\.am)/i,
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg>`
  },
  {
    name: 'TikTok',
    id: 'tiktok',
    match: /tiktok\.com/i,
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.298-.002.595.042.88.13V9.4a6.33 6.33 0 0 0-1-.08A6.34 6.34 0 0 0 3 15.66a6.34 6.34 0 0 0 10.82 4.49 6.31 6.31 0 0 0 1.86-4.49V8.51a8.28 8.28 0 0 0 4.91 1.6V6.69z"/></svg>`
  },
  {
    name: 'LinkedIn',
    id: 'linkedin',
    match: /linkedin\.com/i,
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect width="4" height="12" x="2" y="9"/><circle cx="4" cy="4" r="2"/></svg>`
  },
  {
    name: 'X (Twitter)',
    id: 'twitter',
    match: /(?:twitter\.com|x\.com)/i,
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`
  },
  {
    name: 'Facebook',
    id: 'facebook',
    match: /(?:facebook\.com|fb\.me|fb\.com)/i,
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>`
  },
  {
    name: 'YouTube',
    id: 'youtube',
    match: /(?:youtube\.com|youtu\.be)/i,
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><polygon points="10 15 15 12 10 9 10 15"/></svg>`
  },
  {
    name: 'WhatsApp',
    id: 'whatsapp',
    match: /(?:wa\.me|whatsapp\.com)/i,
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`
  },
  {
    name: 'Telegram',
    id: 'telegram',
    match: /(?:t\.me|telegram\.me)/i,
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" x2="11" y1="2" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`
  },
  {
    name: 'Website',
    id: 'website',
    match: /.*/,
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`
  }
];

function identifyPlatform(url) {
  for (const p of SOCIAL_PLATFORMS) {
    if (p.match.test(url)) return p;
  }
  return SOCIAL_PLATFORMS[SOCIAL_PLATFORMS.length - 1];
}

function extractSocialLinks(text) {
  const urlRegex = /https?:\/\/[^\s<>"'\)\]]+/gi;
  const matches = String(text || '').match(urlRegex) || [];
  const seen = new Set();
  const links = [];

  for (const rawUrl of matches) {
    const cleanUrl = rawUrl.replace(/[\.,;:!\?]$/, '');
    if (seen.has(cleanUrl) || /letsignit|schema\.org|w3\.org|cloudflare|googleapis/i.test(cleanUrl)) continue;
    seen.add(cleanUrl);
    const platform = identifyPlatform(cleanUrl);
    links.push({ url: cleanUrl, platform });
  }

  return links;
}

function mailText(source) {
  const detectedLinks = extractSocialLinks(source);
  let t = source.replace(/\r/g, '').split(/\n_{5,}/)[0];
  const quoted = t.search(/\n\s*(?:De|From|Envoyé|Sent|Date|À|To|Objet|Subject)\s*:/i);
  if (quoted >= 0) t = t.slice(0, quoted);
  
  const lines = t.split('\n');
  const signature = lines.findIndex((line, i) => i > 1 && (/letsignit|cloud\.letsignit|^\s*\[(?:biografy|linkedin|instagram|facebook|telegram)\]/i.test(line) || /responsable des|confidentiality notice|^\s*(?:tél\.|tel\.|phone\s*:)/i.test(line)));
  if (signature >= 0) lines.splice(signature);
  
  const clean = lines.join('\n')
    .replace(/\[https?:\/\/[^\]]+\]/gi, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/<\s*>/g, '')
    .trim();

  let html = `<div class="reply-main">${esc(clean).replace(/\n/g, '<br>')}</div>`;

  if (detectedLinks.length > 0) {
    const chipsHtml = detectedLinks.map(({ url, platform }) => `
      <a class="social-chip ${platform.id}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(url)}">
        <span class="chip-icon">${platform.icon}</span>
        <span>${esc(platform.name)}</span>
      </a>
    `).join('');

    html += `
      <div class="mail-socials-box">
        <span class="mail-socials-label">Social & Web Links</span>
        <div class="social-chips-grid">
          ${chipsHtml}
        </div>
      </div>
    `;
  }

  return html;
}

async function viewMail(id) {
  $('#mailModal').showModal();
  $('#mailTitle').textContent = 'Loading conversation…';
  $('#mailContent').innerHTML = '';
  mascotManager.set('listening', 'Reviewing lead conversation and messages...', 3500);
  try {
    const r = await api(`/api/outreach/${id}/emails`);
    $('#mailMeta').textContent = r.response.email;
    $('#mailTitle').textContent = `${r.response.name || r.response.email} — ${label(r.response.status)}`;
    $('#mailContent').innerHTML = r.messages.map(m => `
      <article class="mail-message">
        <strong>${esc(m.from || m.to)} · ${esc(m.subject)}</strong>
        <time>${ago(m.receivedAt)}</time>
        <div class="email-body">${mailText(m.text || '')}</div>
      </article>
    `).join('') || '<p class="sub">No messages found.</p>';
  } catch (e) {
    $('#mailTitle').textContent = 'Could not load mail';
    $('#mailContent').textContent = e.message;
  }
}

function avatar(name) {
  const words = String(name || '?').trim().split(/\s+/);
  return esc((words[0][0] || '?') + (words[1]?.[0] || '')).toUpperCase();
}

// ==========================================
// LEAD MANAGEMENT
// ==========================================
function show(x = {}) {
  const f = $('#leadForm');
  f.reset();
  Object.entries(x).forEach(([k, v]) => f.elements[k] && (f.elements[k].value = v || ''));
  f.dataset.id = x.id || '';
  $('#formTitle').textContent = x.id ? 'Edit lead' : 'Add lead';
  $('#leadModal').showModal();
}

function editLead(id) {
  show(state.leads.find(x => x.id === id));
}

$('#add').onclick = () => show();
$('#closeLeadModal').onclick = $('#cancelLeadModal').onclick = () => $('#leadModal').close();

$('#leadForm').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  const v = Object.fromEntries(new FormData(f));
  if (!v.email?.trim()) {
    f.elements.email.focus();
    showToast('Please add an email address.');
    return;
  }
  await api(f.dataset.id ? `/api/leads/${f.dataset.id}` : '/api/leads', {
    method: f.dataset.id ? 'PATCH' : 'POST',
    body: JSON.stringify(v)
  });
  $('#leadModal').close();
  const isInterested = v.status === 'interested';
  mascotManager.set(isInterested ? 'exited' : 'idle', f.dataset.id ? 'Lead updated successfully!' : 'New lead added to workspace!', 3500);
  showToast(f.dataset.id ? 'Lead updated' : 'Lead added');
  load();
};

// ==========================================
// CUSTOM DELETE CONFIRMATION MODAL
// ==========================================
$('#deleteSelected').onclick = () => {
  if (!selected.size) {
    showToast('Select at least one lead to delete.');
    return;
  }
  $('#deleteModalTitle').textContent = `Delete ${selected.size} Lead${selected.size > 1 ? 's' : ''}`;
  $('#deleteModalDesc').textContent = `Are you sure you want to delete ${selected.size} selected lead${selected.size > 1 ? 's' : ''}? This action cannot be undone.`;
  $('#deleteModal').showModal();
};

$('#cancelDeleteModal').onclick = () => $('#deleteModal').close();

$('#confirmDeleteBtn').onclick = async () => {
  if (!selected.size) return;
  const count = selected.size;
  try {
    await api('/api/leads', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [...selected] })
    });
    selected.clear();
    $('#deleteModal').close();
    mascotManager.set('angry', `Deleted ${count} lead(s) from workspace.`, 3500);
    showToast(`Deleted ${count} lead(s)`);
    load();
  } catch (err) {
    showToast(err.message);
  }
};

// ==========================================
// TEAM EMAIL NOTIFICATION SUBSCRIBERS
// ==========================================
async function loadSubscribers() {
  try {
    const res = await api('/api/notifications/subscribers');
    const list = res.subscribers || [];
    $('#subscriberCount').textContent = list.length;
    $('#subscribersList').innerHTML = list.length
      ? list.map(email => `
          <li class="subscriber-item">
            <span>${esc(email)}</span>
            <button class="subscriber-del-btn" onclick="removeSubscriber('${esc(email)}')" title="Remove email">
              <i class="ui-icon trash-icon"></i>
            </button>
          </li>
        `).join('')
      : '<li style="color: var(--text-muted); font-size: 13px; padding: 8px 0;">No subscribed team emails yet.</li>';
  } catch (e) {
    console.error(e);
  }
}

async function removeSubscriber(email) {
  try {
    await api('/api/notifications/subscribers', {
      method: 'DELETE',
      body: JSON.stringify({ email })
    });
    showToast(`Removed ${email}`);
    loadSubscribers();
  } catch (e) {
    showToast(e.message);
  }
}

$('#openNotificationsBtn').onclick = () => {
  $('#notificationsModal').showModal();
  loadSubscribers();
};

$('#closeNotificationsModal').onclick = () => $('#notificationsModal').close();

$('#subscribeForm').onsubmit = async e => {
  e.preventDefault();
  const input = $('#subscriberEmailInput');
  const email = input.value.trim();
  if (!email) return;

  try {
    await api('/api/notifications/subscribers', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    input.value = '';
    mascotManager.set('exited', `Subscribed ${email} for real-time alerts!`, 3500);
    showToast(`Subscribed ${email}`);
    loadSubscribers();
  } catch (err) {
    showToast(err.message);
  }
};

// ==========================================
// SYNC, SEARCH, & FILTERS
// ==========================================
$('#sync').onclick = async e => {
  const btn = e.currentTarget;
  const original = btn.innerHTML;
  btn.textContent = 'Syncing…';
  mascotManager.set('searching', 'Connecting to Instantly and syncing leads...', 4500);
  try {
    await api('/api/instantly/sync', { method: 'POST' });
    showToast('Sync completed');
    mascotManager.set('exited', 'Instantly leads sync complete!', 4000);
    load();
  } catch (x) {
    showToast(x.message);
    mascotManager.set('angry', 'Sync error: ' + x.message, 4500);
  } finally {
    btn.innerHTML = original;
  }
};

$('#emailSearch').oninput = render;
$('#leadSearch').oninput = render;

document.querySelectorAll('[data-email-filter]').forEach(b => {
  b.onclick = () => {
    ef = b.dataset.emailFilter;
    document.querySelector('[data-email-filter].active')?.classList.remove('active');
    b.classList.add('active');
    render();
  };
});

$('#selectAll').onchange = e => {
  state.leads.forEach(x => e.target.checked ? selected.add(x.id) : selected.delete(x.id));
  render();
};

function exportCsv(rows) {
  const c = ['name', 'company', 'jobTitle', 'email', 'phone', 'website', 'linkedin', 'country', 'city', 'industry', 'source', 'notes'];
  const s = [c.join(','), ...rows.map(x => c.map(k => `"${String(x[k] || '').replaceAll('"', '""')}"`).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([s], { type: 'text/csv' }));
  a.download = 'vcode-leads.csv';
  a.click();
}

$('#export').onclick = () => exportCsv(state.leads);
$('#exportSelected').onclick = () => exportCsv(state.leads.filter(x => selected.has(x.id)));

// ==========================================
// CSV IMPORT
// ==========================================
$('#csv').onchange = async e => {
  const a = (await e.target.files[0].text()).trim().split(/\r?\n/);
  const h = a.shift().split(',').map(x => x.trim());
  const map = {
    email: 'email', firstname: 'name', first_name: 'name', full_name: 'name', name: 'name',
    companyname: 'company', company_name: 'company', company: 'company',
    city: 'city', observation: 'notes', notes: 'notes', job_title: 'jobTitle', jobtitle: 'jobTitle'
  };
  pending = a.map(l => Object.fromEntries(h.map((x, i) => [map[x.replace(/[ _-]/g, '').toLowerCase()] || x, l.split(',')[i]?.trim() || '']))).filter(x => x.email);
  $('#importSummary').textContent = `${pending.length} valid rows will be added. Existing leads are preserved.`;
  $('#importHeaders').innerHTML = '<th>Name</th><th>Company</th><th>Email</th>';
  $('#importPreview').innerHTML = pending.slice(0, 5).map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.company)}</td><td>${esc(x.email)}</td></tr>`).join('');
  $('#importModal').showModal();
  e.target.value = '';
};

$('#confirmImport').onclick = async () => {
  for (const x of pending) {
    await api('/api/leads', { method: 'POST', body: JSON.stringify(x) });
  }
  $('#importModal').close();
  showToast(`Imported ${pending.length} lead(s)`);
  load();
};

// ==========================================
// PROMPT COPY
// ==========================================
function getLeadPrompt() {
  const existingList = (state.leads && state.leads.length > 0)
    ? state.leads.slice(0, 50).map(l => `| ${l.name || ''} | ${l.company || ''} | ${l.email || ''} | ${l.phone || ''} | ${l.status || 'new'} | ${l.notes ? l.notes.replace(/\r?\n/g, ' ') : ''} |`).join('\n')
    : `| Thomas Fullana | Biografy | tfullana@biografygroup.com | | not_interested | |\n| Jacques Freydrich | Tahe Outdoors | jacques.freydrich@taheoutdoors.com | | not_interested | |`;

  return `You are a lead-generation research agent working for a web and software development team.

## Our Business

We are a web and software development team offering services such as:

* Professional websites
* Business websites
* E-commerce websites
* Web applications
* Mobile applications
* Custom business software
* Dashboards and admin panels
* Restaurant websites and digital ordering systems
* Booking/reservation systems
* Customer management systems
* Business automation
* UI/UX redesign
* Website modernization
* Digital solutions tailored to businesses

Our portfolio:
https://vcodeweb.netlify.app/

Use our portfolio to understand the type and quality of services we provide.

## Your Mission

Find businesses, organizations, professionals, restaurants, agencies, shops, companies, and other potential clients that could realistically benefit from our services.

Prioritize businesses that have a clear digital opportunity, for example:

* No website
* Website is missing or difficult to find
* Website appears outdated
* Website is not mobile-friendly
* Poor online presence
* No online ordering system
* Restaurant without a proper digital menu/order system
* No booking/reservation system where one would be useful
* No web application despite having a process that could benefit from one
* No customer portal
* No e-commerce functionality where relevant
* Poor or incomplete digital presence
* Business relies heavily on Facebook/Instagram/WhatsApp but has no proper website
* Existing website has obvious usability or design problems
* Business appears to be growing and could benefit from custom software

Focus on leads that have a realistic possibility of becoming paying clients.

## Research Rules

Search across relevant public sources such as:

* Google/search engines
* Google Maps and business listings
* Official business websites
* Business directories
* LinkedIn
* Facebook
* Instagram
* Other publicly accessible business pages

For every lead, try to identify:

1. Contact person's name, if publicly available
2. Company/business name
3. Professional/business email
4. Business phone number
5. The reason why this business is a potential client

### IMPORTANT — DO NOT INVENT DATA

Never fabricate:

* Names
* Email addresses
* Phone numbers
* Companies
* Websites
* Contact information

If an email cannot be found, leave the email field empty.

If a phone number cannot be found, leave the phone field empty.

Do not guess email formats such as firstname@company.com.

Do not use obviously fake or generated contact information.

## Lead Qualification

Only return leads that have a reasonable business-development opportunity.

For example:

GOOD LEAD:
A restaurant with an active Google Maps/Instagram presence but no website or online ordering system.

GOOD LEAD:
A local company with an outdated website that could clearly benefit from a redesign.

GOOD LEAD:
An agency/business that currently handles bookings through WhatsApp and could benefit from a booking platform.

BAD LEAD:
A company with a modern website and strong digital infrastructure where there is no obvious need for our services.

BAD LEAD:
A random person with no identifiable business need.

## Status Field

The \`status\` field should describe the current outreach status.

Use:

* \`new\` — newly discovered lead that has not been contacted
* \`contacted\` — outreach has already been sent
* \`interested\` — the prospect showed interest
* \`not_interested\` — the prospect explicitly declined
* \`follow_up\` — the prospect should be contacted again later
* \`unknown\` — the outreach status cannot be determined

For newly discovered leads, use \`new\` unless there is evidence that the lead was already contacted.

## Notes Field

The \`notes\` field is extremely important.

Briefly explain why the lead is interesting and what opportunity you identified.

Examples:

* No official website found; active restaurant with strong Google presence.
* Has Instagram and WhatsApp but no online ordering website.
* Existing website appears outdated and could benefit from a redesign.
* Business has online presence but no booking system.
* No website found; potential candidate for a professional company website.

Keep notes concise and factual.

## Output Format

Return the results as a CSV.

The CSV MUST contain exactly these columns, in exactly this order:

name,company,email,phone,status,notes

Example:

\`\`\`csv
name,company,email,phone,status,notes
Thomas Fullana,Biografy,tfullana@biografygroup.com,,not_interested,
Jacques Freydrich,Tahe Outdoors,jacques.freydrich@taheoutdoors.com,,not_interested,
John Doe,Example Restaurant,john@example.com,+212600000000,new,"No official website found; active restaurant with strong online presence."
\`\`\`

### STRICT CSV REQUIREMENTS

* Do not add extra columns.
* Do not rename columns.
* Do not add URLs as separate columns.
* Do not add LinkedIn columns.
* Do not add website columns.
* Do not add industry columns.
* Do not add location columns.
* Do not add lead-score columns.
* Keep exactly:
  \`name,company,email,phone,status,notes\`

If a value is unavailable, leave the field empty.

Use proper CSV escaping. If a note contains commas, put the entire note inside double quotes.

## Existing Leads

The following leads may already exist in our database:

| name | company | email | phone | status | notes |
| --- | --- | --- | --- | --- | --- |
${existingList}

DO NOT return these existing leads again unless there is a significant new piece of information that changes their qualification.

Avoid duplicates by checking the company name, contact name, email, phone number, and other available identifying information.

## Geographic Scope

Prioritize businesses in the geographic area specified by the user.

If the user does not specify a location, ask for the target country/city/region before conducting a highly localized search.

## Quantity

Return as many qualified leads as you can find, but prioritize QUALITY over quantity.

Do not fill the list with weak leads simply to reach a target number.

## Final Response

Your final response should contain the CSV only, with no introduction, explanation, Markdown table, analysis, or commentary.

The first line MUST be:

name,company,email,phone,status,notes

Every subsequent line must be a valid CSV lead.`;
}

function showToast(msg = 'AI Lead Gen Prompt copied to clipboard!') {
  const toast = $('#toast');
  const toastMsg = $('#toastMsg');
  if (toastMsg) toastMsg.textContent = msg;
  if (toast) {
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
  }
}

async function copyPromptToClipboard() {
  const text = getLeadPrompt();
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    showToast('AI Lead Gen Prompt copied to clipboard!');
    mascotManager.set('exited', 'AI lead-gen prompt copied to clipboard! Ready to research.', 4000);
    const btn = $('#copyPrompt');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '<i class="ui-icon copy-icon"></i><span>Copied!</span>';
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }
  } catch (err) {
    showToast('Failed to copy: ' + err.message);
    mascotManager.set('angry', 'Clipboard copy failed: ' + err.message, 4000);
  }
}

$('#copyPrompt').onclick = copyPromptToClipboard;

mascotManager.init();

window.onhashchange = page;
page();
load();
