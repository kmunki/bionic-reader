// Bionic Reader PWA - Main App

const DATA_URLS = {
  rss: 'https://rss-worker.kmunkitt.workers.dev/data/rss.json',
  twitter: 'data/twitter.json'  // Twitter stays local (needs Mac for auth)
};

// State
let items = [];
let state = { read: [], starred: [], readLater: [] };
let currentFilter = 'all';  // Default to All (For You requires recommendation logic)
let currentCategory = 'all';

// Haptic feedback utility
const haptic = {
  light: () => navigator.vibrate?.(10),
  medium: () => navigator.vibrate?.(20),
  success: () => navigator.vibrate?.([10, 50, 10]),
  error: () => navigator.vibrate?.([30, 50, 30, 50, 30])
};

// Swipe gesture state
let swipeState = {
  active: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  itemEl: null,
  direction: null,  // 'left' or 'right'
  triggered: false
};

const SWIPE_THRESHOLD = 0.3;  // 30% of card width to trigger action
const LONG_SWIPE_THRESHOLD = 0.6;  // 60% for long swipe (read later)
const LONG_PRESS_DURATION = 500;  // ms to trigger context menu

// Long press state
let longPressTimer = null;
let longPressItem = null;

// DOM elements
const itemsContainer = document.getElementById('items');
const categoriesNav = document.querySelector('.categories');
const filterBtns = document.querySelectorAll('.filter-btn');

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  loadState();
  setupPullToRefresh();
  setupEventListeners();
  setupSwipeGestures();
  setupLongPress();
  createContextMenu();
  await loadData();
  render();
  showOnboardingHint();
}

// Load read/starred state from localStorage
function loadState() {
  const saved = localStorage.getItem('reader-state');
  if (saved) {
    state = JSON.parse(saved);
  }
}

function saveState() {
  localStorage.setItem('reader-state', JSON.stringify(state));
}

// Pull to refresh
function setupPullToRefresh() {
  let startY = 0;
  let pulling = false;
  const pullIndicator = document.querySelector('.pull-indicator');

  itemsContainer.addEventListener('touchstart', (e) => {
    if (itemsContainer.scrollTop === 0) {
      startY = e.touches[0].clientY;
      pulling = true;
    }
  });

  itemsContainer.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const diff = e.touches[0].clientY - startY;
    if (diff > 50 && !pullIndicator.classList.contains('visible')) {
      pullIndicator.classList.add('visible');
      haptic.light();
    }
  });

  itemsContainer.addEventListener('touchend', async (e) => {
    if (pullIndicator.classList.contains('visible')) {
      pullIndicator.textContent = 'Refreshing...';
      await loadData();
      render();
      pullIndicator.textContent = 'Pull to refresh';
    }
    pullIndicator.classList.remove('visible');
    pulling = false;
  });
}

function setupEventListeners() {
  // Filter buttons
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      render();
    });
  });

  // Category buttons (delegated)
  categoriesNav.addEventListener('click', (e) => {
    if (e.target.classList.contains('cat-btn')) {
      categoriesNav.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentCategory = e.target.dataset.category;
      render();
    }
  });

  // Item actions (delegated)
  itemsContainer.addEventListener('click', (e) => {
    const itemEl = e.target.closest('.item');
    if (!itemEl) return;

    // Don't handle clicks if we just finished a swipe
    if (swipeState.triggered) {
      swipeState.triggered = false;
      return;
    }

    const id = itemEl.dataset.id;
    const item = items.find(i => i.id === id);

    if (e.target.classList.contains('star-btn')) {
      toggleStarred(id);
      e.target.classList.toggle('starred');
      haptic.light();
    } else if (e.target.tagName !== 'A' && item?.link) {
      // Tap on article → mark read + open link
      markRead(id);
      itemEl.classList.add('read');
      window.open(item.link, '_blank');
    }
  });
}

// Swipe gesture handling
function setupSwipeGestures() {
  itemsContainer.addEventListener('touchstart', handleSwipeStart, { passive: true });
  itemsContainer.addEventListener('touchmove', handleSwipeMove, { passive: false });
  itemsContainer.addEventListener('touchend', handleSwipeEnd, { passive: true });
  itemsContainer.addEventListener('touchcancel', handleSwipeCancel, { passive: true });
}

function handleSwipeStart(e) {
  const itemEl = e.target.closest('.item');
  if (!itemEl) return;

  swipeState.active = true;
  swipeState.startX = e.touches[0].clientX;
  swipeState.startY = e.touches[0].clientY;
  swipeState.currentX = swipeState.startX;
  swipeState.itemEl = itemEl;
  swipeState.direction = null;
  swipeState.triggered = false;

  // Add swipe action elements if not present
  ensureSwipeActions(itemEl);
}

function handleSwipeMove(e) {
  if (!swipeState.active || !swipeState.itemEl) return;

  const deltaX = e.touches[0].clientX - swipeState.startX;
  const deltaY = e.touches[0].clientY - swipeState.startY;

  // Determine if this is a horizontal or vertical swipe
  if (swipeState.direction === null) {
    if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
      swipeState.direction = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
    }
  }

  // Only handle horizontal swipes
  if (swipeState.direction !== 'horizontal') return;

  // Prevent vertical scroll while swiping horizontally
  e.preventDefault();

  swipeState.currentX = e.touches[0].clientX;
  const itemWidth = swipeState.itemEl.offsetWidth;
  const progress = Math.abs(deltaX) / itemWidth;

  // Update visual feedback
  const itemContent = swipeState.itemEl.querySelector('.item-content');
  if (itemContent) {
    itemContent.style.transform = `translateX(${deltaX}px)`;
  }

  // Show appropriate action indicator
  const actionRight = swipeState.itemEl.querySelector('.swipe-action-right');
  const actionLeft = swipeState.itemEl.querySelector('.swipe-action-left');

  if (deltaX > 0) {
    // Swiping right → mark read
    actionRight?.classList.add('visible');
    actionLeft?.classList.remove('visible');
    if (progress >= SWIPE_THRESHOLD && !swipeState.thresholdReached) {
      swipeState.thresholdReached = true;
      haptic.light();
    }
  } else if (deltaX < 0) {
    // Swiping left → star (short) or read later (long)
    actionLeft?.classList.add('visible');
    actionRight?.classList.remove('visible');

    // Update icon based on swipe distance
    const icon = actionLeft?.querySelector('.swipe-icon');
    if (icon) {
      if (progress >= LONG_SWIPE_THRESHOLD) {
        icon.textContent = '📑';  // Read later
        icon.dataset.action = 'readLater';
      } else {
        icon.textContent = '★';  // Star
        icon.dataset.action = 'star';
      }
    }

    if (progress >= SWIPE_THRESHOLD && !swipeState.thresholdReached) {
      swipeState.thresholdReached = true;
      haptic.light();
    }
  }
}

function handleSwipeEnd(e) {
  if (!swipeState.active || !swipeState.itemEl) return;

  const deltaX = swipeState.currentX - swipeState.startX;
  const itemWidth = swipeState.itemEl.offsetWidth;
  const progress = Math.abs(deltaX) / itemWidth;
  const id = swipeState.itemEl.dataset.id;

  // Execute action if threshold met
  if (progress >= SWIPE_THRESHOLD) {
    swipeState.triggered = true;
    onSwipeComplete();  // Dismiss onboarding hint if shown

    if (deltaX > 0) {
      // Swipe right → toggle read
      toggleRead(id);
      swipeState.itemEl.classList.toggle('read');
      haptic.medium();
    } else {
      // Swipe left → star or read later
      const actionIcon = swipeState.itemEl.querySelector('.swipe-action-left .swipe-icon');
      if (progress >= LONG_SWIPE_THRESHOLD || actionIcon?.dataset.action === 'readLater') {
        toggleReadLater(id);
        swipeState.itemEl.classList.toggle('read-later');
      } else {
        toggleStarred(id);
        swipeState.itemEl.classList.toggle('starred');
        // Update star button visual
        const starBtn = swipeState.itemEl.querySelector('.star-btn');
        if (starBtn) {
          const isStarred = state.starred.includes(id);
          starBtn.classList.toggle('starred', isStarred);
          starBtn.textContent = isStarred ? '★' : '☆';
        }
      }
      haptic.medium();
    }
  }

  // Reset visual state
  resetSwipeState();
}

function handleSwipeCancel() {
  resetSwipeState();
}

function resetSwipeState() {
  if (swipeState.itemEl) {
    const itemContent = swipeState.itemEl.querySelector('.item-content');
    if (itemContent) {
      itemContent.style.transform = '';
    }

    const actionRight = swipeState.itemEl.querySelector('.swipe-action-right');
    const actionLeft = swipeState.itemEl.querySelector('.swipe-action-left');
    actionRight?.classList.remove('visible');
    actionLeft?.classList.remove('visible');
  }

  swipeState.active = false;
  swipeState.itemEl = null;
  swipeState.direction = null;
  swipeState.thresholdReached = false;
}

function ensureSwipeActions(itemEl) {
  // Only add if not already present
  if (itemEl.querySelector('.swipe-action-right')) return;

  // Wrap existing content
  const children = Array.from(itemEl.children);
  const content = document.createElement('div');
  content.className = 'item-content';
  children.forEach(child => content.appendChild(child));
  itemEl.innerHTML = '';

  // Add swipe action backgrounds
  const actionRight = document.createElement('div');
  actionRight.className = 'swipe-action-right';
  actionRight.innerHTML = '<span class="swipe-icon">✓</span>';

  const actionLeft = document.createElement('div');
  actionLeft.className = 'swipe-action-left';
  actionLeft.innerHTML = '<span class="swipe-icon" data-action="star">★</span>';

  itemEl.appendChild(actionRight);
  itemEl.appendChild(actionLeft);
  itemEl.appendChild(content);
}

// Long press handling
function setupLongPress() {
  itemsContainer.addEventListener('touchstart', handleLongPressStart, { passive: true });
  itemsContainer.addEventListener('touchmove', handleLongPressCancel, { passive: true });
  itemsContainer.addEventListener('touchend', handleLongPressCancel, { passive: true });
  itemsContainer.addEventListener('touchcancel', handleLongPressCancel, { passive: true });
}

function handleLongPressStart(e) {
  const itemEl = e.target.closest('.item');
  if (!itemEl) return;

  longPressItem = itemEl;
  longPressTimer = setTimeout(() => {
    if (longPressItem) {
      haptic.medium();
      showContextMenu(longPressItem);
      // Prevent the swipe from triggering
      swipeState.active = false;
    }
  }, LONG_PRESS_DURATION);
}

function handleLongPressCancel() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  longPressItem = null;
}

// Context menu
function createContextMenu() {
  const menu = document.createElement('div');
  menu.id = 'context-menu';
  menu.className = 'context-menu';
  menu.innerHTML = `
    <div class="context-menu-backdrop"></div>
    <div class="context-menu-sheet">
      <button class="context-action" data-action="open">
        <span class="action-icon">🔗</span>
        <span class="action-label">Open in Browser</span>
      </button>
      <button class="context-action" data-action="toggleRead">
        <span class="action-icon">✓</span>
        <span class="action-label">Mark as Read</span>
      </button>
      <button class="context-action" data-action="toggleStar">
        <span class="action-icon">★</span>
        <span class="action-label">Star</span>
      </button>
      <button class="context-action" data-action="readLater">
        <span class="action-icon">📑</span>
        <span class="action-label">Read Later</span>
      </button>
      <button class="context-action" data-action="copy">
        <span class="action-icon">📋</span>
        <span class="action-label">Copy Link</span>
      </button>
      <button class="context-action" data-action="share">
        <span class="action-icon">↗</span>
        <span class="action-label">Share</span>
      </button>
      <button class="context-action cancel" data-action="cancel">
        <span class="action-label">Cancel</span>
      </button>
    </div>
  `;

  // Hide share if not supported
  if (!navigator.share) {
    menu.querySelector('[data-action="share"]').style.display = 'none';
  }

  document.body.appendChild(menu);

  // Event listeners
  menu.querySelector('.context-menu-backdrop').addEventListener('click', hideContextMenu);
  menu.querySelectorAll('.context-action').forEach(btn => {
    btn.addEventListener('click', handleContextAction);
  });
}

let contextMenuItemId = null;

function showContextMenu(itemEl) {
  const id = itemEl.dataset.id;
  contextMenuItemId = id;
  const item = items.find(i => i.id === id);
  const menu = document.getElementById('context-menu');

  // Update labels based on current state
  const isRead = state.read.includes(id);
  const isStarred = state.starred.includes(id);
  const isReadLater = state.readLater.includes(id);

  menu.querySelector('[data-action="toggleRead"] .action-label').textContent =
    isRead ? 'Mark as Unread' : 'Mark as Read';
  menu.querySelector('[data-action="toggleStar"] .action-label').textContent =
    isStarred ? 'Unstar' : 'Star';
  menu.querySelector('[data-action="readLater"] .action-label').textContent =
    isReadLater ? 'Remove from Later' : 'Read Later';

  menu.classList.add('visible');
}

function hideContextMenu() {
  const menu = document.getElementById('context-menu');
  menu.classList.remove('visible');
  contextMenuItemId = null;
}

function handleContextAction(e) {
  const action = e.currentTarget.dataset.action;
  const id = contextMenuItemId;
  const item = items.find(i => i.id === id);
  const itemEl = document.querySelector(`.item[data-id="${id}"]`);

  switch (action) {
    case 'open':
      if (item?.link) window.open(item.link, '_blank');
      break;
    case 'toggleRead':
      toggleRead(id);
      if (itemEl) itemEl.classList.toggle('read');
      break;
    case 'toggleStar':
      toggleStarred(id);
      if (itemEl) {
        itemEl.classList.toggle('starred');
        const starBtn = itemEl.querySelector('.star-btn');
        if (starBtn) {
          const isStarred = state.starred.includes(id);
          starBtn.classList.toggle('starred', isStarred);
          starBtn.textContent = isStarred ? '★' : '☆';
        }
      }
      break;
    case 'readLater':
      toggleReadLater(id);
      if (itemEl) itemEl.classList.toggle('read-later');
      break;
    case 'copy':
      if (item?.link) {
        navigator.clipboard.writeText(item.link).then(() => {
          haptic.success();
        });
      }
      break;
    case 'share':
      if (item?.link && navigator.share) {
        navigator.share({
          title: item.title,
          url: item.link
        });
      }
      break;
  }

  hideContextMenu();
  haptic.light();
}

// Gesture onboarding
function showOnboardingHint() {
  // Only show if user hasn't seen it and there are items
  if (localStorage.getItem('reader-onboarding-seen') || items.length === 0) return;

  const hint = document.createElement('div');
  hint.className = 'onboarding-hint';
  hint.innerHTML = `
    <div class="onboarding-content">
      <div class="onboarding-hand">👆</div>
      <div class="onboarding-text">Swipe right to mark read</div>
      <button class="onboarding-dismiss">Got it</button>
    </div>
  `;

  document.body.appendChild(hint);

  // Show after a brief delay
  requestAnimationFrame(() => {
    hint.classList.add('visible');
  });

  // Dismiss handlers
  hint.querySelector('.onboarding-dismiss').addEventListener('click', dismissOnboarding);
  hint.addEventListener('click', (e) => {
    if (e.target === hint) dismissOnboarding();
  });

  // Auto-dismiss after first successful swipe
  const originalHandleSwipeEnd = handleSwipeEnd;
  window._originalHandleSwipeEnd = originalHandleSwipeEnd;
}

function dismissOnboarding() {
  const hint = document.querySelector('.onboarding-hint');
  if (hint) {
    hint.classList.remove('visible');
    setTimeout(() => hint.remove(), 300);
  }
  localStorage.setItem('reader-onboarding-seen', 'true');
}

// Call this when a swipe is successfully completed
function onSwipeComplete() {
  if (!localStorage.getItem('reader-onboarding-seen')) {
    dismissOnboarding();
  }
}

async function loadData() {
  const loading = document.querySelector('.loading');
  loading.style.display = 'block';

  try {
    // Network-first handled by SW; no-store ensures we bypass browser cache
    const fetchOpts = { cache: 'no-store' };
    const [rssRes, twitterRes] = await Promise.all([
      fetch(DATA_URLS.rss, fetchOpts).catch(() => null),
      fetch(DATA_URLS.twitter, fetchOpts).catch(() => null)
    ]);

    items = [];

    if (rssRes?.ok) {
      const rssData = await rssRes.json();
      items.push(...rssData.items.map(item => ({
        ...item,
        type: 'rss'
      })));
    }

    if (twitterRes?.ok) {
      const twitterData = await twitterRes.json();
      items.push(...twitterData.items.map(item => ({
        ...item,
        type: 'twitter',
        category: item.category || 'Twitter'
      })));
    }

    // Sort by date, newest first
    items.sort((a, b) => new Date(b.published) - new Date(a.published));

    // Build tag list from all items' tags arrays
    const allTags = new Set();
    items.forEach(item => {
      const tags = item.tags || [item.category];
      tags.forEach(tag => allTags.add(tag));
    });
    renderCategories([...allTags].sort());

  } catch (err) {
    console.error('Failed to load data:', err);
  }

  loading.style.display = 'none';
}

function renderCategories(categories) {
  const existing = categoriesNav.querySelector('.cat-btn[data-category="all"]');
  categoriesNav.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className = 'cat-btn' + (currentCategory === 'all' ? ' active' : '');
  allBtn.dataset.category = 'all';
  allBtn.textContent = 'All';
  categoriesNav.appendChild(allBtn);

  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-btn' + (currentCategory === cat ? ' active' : '');
    btn.dataset.category = cat;
    btn.textContent = cat;
    categoriesNav.appendChild(btn);
  });
}

function render() {
  const filtered = items.filter(item => {
    // Filter by read/starred/recommended/readLater
    if (currentFilter === 'unread' && state.read.includes(item.id)) return false;
    if (currentFilter === 'starred' && !state.starred.includes(item.id)) return false;
    if (currentFilter === 'readLater' && !state.readLater.includes(item.id)) return false;
    if (currentFilter === 'recommended' && !item.recommended) return false;

    // Filter by tag (items can have multiple tags)
    if (currentCategory !== 'all') {
      const itemTags = item.tags || [item.category];
      if (!itemTags.includes(currentCategory)) return false;
    }

    return true;
  });

  const pullIndicator = document.querySelector('.pull-indicator');
  const loading = document.querySelector('.loading');

  itemsContainer.innerHTML = '';
  itemsContainer.appendChild(pullIndicator);
  itemsContainer.appendChild(loading);

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = currentFilter === 'starred' ? 'No starred items' :
                        currentFilter === 'unread' ? 'All caught up!' :
                        currentFilter === 'readLater' ? 'No items saved for later' :
                        currentFilter === 'recommended' ? 'No recommendations yet' : 'No items';
    itemsContainer.appendChild(empty);
    return;
  }

  filtered.forEach(item => {
    const el = document.createElement('article');
    let classes = 'item';
    if (state.read.includes(item.id)) classes += ' read';
    if (state.starred.includes(item.id)) classes += ' starred';
    if (state.readLater.includes(item.id)) classes += ' read-later';
    el.className = classes;
    el.dataset.id = item.id;

    const isStarred = state.starred.includes(item.id);
    const date = formatDate(item.published);
    const source = item.type === 'twitter' ? `@${item.user}` : item.source;

    el.innerHTML = `
      <div class="item-header">
        <span class="source">${source}</span>
        <span class="date">${date}</span>
        <button class="star-btn${isStarred ? ' starred' : ''}" aria-label="Star">
          ${isStarred ? '★' : '☆'}
        </button>
      </div>
      <h3 class="title">${item.type === 'twitter' ? '' : `<a href="${item.link}" target="_blank">${escapeHtml(item.title)}</a>`}</h3>
      <p class="summary">${formatNumberedLists(bionify(escapeHtml(item.summary || item.text || '')))}</p>
      ${item.type === 'twitter' ? `<a href="${item.link}" target="_blank" class="tweet-link">View tweet</a>` : ''}
    `;

    itemsContainer.appendChild(el);
  });
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${Math.floor(diffHours)}h ago`;
  if (diffHours < 48) return 'Yesterday';

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatNumberedLists(text) {
  // Detect "1. item 2. item 3. item" patterns and add line breaks
  // Match number followed by period and space, but not at start
  return text.replace(/(\S)\s+(\d+)\.\s/g, '$1<br>$2. ');
}

function markRead(id) {
  if (!state.read.includes(id)) {
    state.read.push(id);
    saveState();
  }
}

function toggleRead(id) {
  const idx = state.read.indexOf(id);
  if (idx >= 0) {
    state.read.splice(idx, 1);
  } else {
    state.read.push(id);
  }
  saveState();
}

function toggleStarred(id) {
  const idx = state.starred.indexOf(id);
  if (idx >= 0) {
    state.starred.splice(idx, 1);
  } else {
    state.starred.push(id);
  }
  saveState();
}

function toggleReadLater(id) {
  const idx = state.readLater.indexOf(id);
  if (idx >= 0) {
    state.readLater.splice(idx, 1);
  } else {
    state.readLater.push(id);
  }
  saveState();
}

// Register service worker with update detection
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // Check for updates on load and periodically (every 5 min during dev)
    reg.update();
    setInterval(() => reg.update(), 5 * 60 * 1000);

    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New version available - show update prompt
          showUpdatePrompt();
        }
      });
    });
  });

  // Handle controller change (when new SW takes over)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
}

function showUpdatePrompt() {
  const toast = document.createElement('div');
  toast.className = 'update-toast';
  toast.innerHTML = `
    <span>Update available</span>
    <button onclick="applyUpdate()">Refresh</button>
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
}

function applyUpdate() {
  navigator.serviceWorker.getRegistration().then(reg => {
    if (reg?.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  });
}
