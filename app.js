// Bionic Reader PWA - Main App

const DATA_URLS = {
  rss: 'https://rss-worker.kmunkitt.workers.dev/data/rss.json',
  twitter: 'data/twitter.json'  // Twitter stays local (needs Mac for auth)
};

// State
let items = [];
let state = { read: [], starred: [] };
let currentFilter = 'recommended';  // Default to "For You"
let currentCategory = 'all';

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
  await loadData();
  render();
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
    if (diff > 50) {
      pullIndicator.classList.add('visible');
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
    const item = e.target.closest('.item');
    if (!item) return;

    const id = item.dataset.id;

    if (e.target.classList.contains('star-btn')) {
      toggleStarred(id);
      e.target.classList.toggle('starred');
    } else if (e.target.tagName !== 'A') {
      // Toggle read on tap (unless clicking link or star)
      toggleRead(id);
      item.classList.toggle('read');
    }
  });
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
    // Filter by read/starred/recommended
    if (currentFilter === 'unread' && state.read.includes(item.id)) return false;
    if (currentFilter === 'starred' && !state.starred.includes(item.id)) return false;
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
                        currentFilter === 'recommended' ? 'No recommendations yet' : 'No items';
    itemsContainer.appendChild(empty);
    return;
  }

  filtered.forEach(item => {
    const el = document.createElement('article');
    el.className = 'item' + (state.read.includes(item.id) ? ' read' : '');
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

// Register service worker with update detection
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // Check for updates periodically (every 30 min)
    setInterval(() => reg.update(), 30 * 60 * 1000);

    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker.addEventListener('statechange', () => {
        // New SW activated - reload to get fresh code
        if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
          console.log('New version available, reloading...');
          window.location.reload();
        }
      });
    });
  });
}
