// Minimal line icons in the spirit of SF Symbols (24×24, stroke = currentColor).
const I = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M7 7l10 10M17 7L7 17"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  'chev-left': '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  'chev-right': '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  edit: '<path d="M14.5 5.5l4 4L9 19H5v-4z"/><path d="M12.5 7.5l4 4"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2"/><path d="M7 7l.8 11.6A1.5 1.5 0 0 0 9.3 20h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  repeat: '<path d="M17 3.5l3 3-3 3M4 12v-1a4.5 4.5 0 0 1 4.5-4.5H20M7 20.5l-3-3 3-3M20 12v1a4.5 4.5 0 0 1-4.5 4.5H4"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14"/>',
  undo: '<path d="M9 14L4.5 9.5 9 5"/><path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16M8.5 3.5v3M15.5 3.5v3"/>',
  receipt: '<path d="M6.5 3.5h11v17l-2.75-1.6-2.75 1.6-2.75-1.6-2.75 1.6z"/><path d="M9.5 8.5h5M9.5 12.5h5"/>',
  // transactions
  expense: '<path d="M7.5 16.5l9-9M10 7.5h6.5V14"/>',
  income: '<path d="M16.5 7.5l-9 9M14 16.5H7.5V10"/>',
  transfer: '<path d="M4.5 8.5h14M15.5 5.5l3 3-3 3M19.5 15.5h-14M8.5 12.5l-3 3 3 3"/>',
  adjust: '<path d="M12 5v6M9 8h6M9 17h6"/>',
  // tab bar
  'tab-budget': '<path d="M18.5 7.5V6a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h12a1.5 1.5 0 0 0 1.5-1.5V9a1.5 1.5 0 0 0-1.5-1.5H6.5A2.5 2.5 0 0 1 4 5"/><circle cx="16" cy="13.75" r="1.1" fill="currentColor" stroke="none"/>',
  'tab-daily': '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  'tab-buy': '<path d="M5.5 8.5h13l-.9 10.2a2 2 0 0 1-2 1.8H8.4a2 2 0 0 1-2-1.8z"/><path d="M9 10.5V7a3 3 0 0 1 6 0v3.5"/>',
  'tab-todo': '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.4 2.4 4.6-4.9"/>',
  'tab-summary': '<path d="M6.5 19v-5M12 19V5M17.5 19v-9"/>',
  // spending categories
  'cat-necessary': '<path d="M4.5 10.5L12 4.5l7.5 6V19a1 1 0 0 1-1 1h-4v-5.5h-5V20h-4a1 1 0 0 1-1-1z"/>',
  'cat-subscriptions': '<rect x="3.5" y="5.5" width="17" height="13" rx="3.5"/><path d="M10.5 9.5v5l4-2.5z"/>',
  'cat-selfcare': '<path d="M11 4l1.8 4.7 4.7 1.8-4.7 1.8L11 17l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="M18 15l.7 1.8 1.8.7-1.8.7L18 20l-.7-1.8-1.8-.7 1.8-.7z"/>',
  'cat-fun': '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4 4 0 0 0 7 0M9.5 9.5h.01M14.5 9.5h.01"/>',
  'cat-other': '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>',
  'cat-custom': '<path d="M4 4.5h7l8.5 8.5-6.5 6.5L4.5 11z"/><path d="M8.5 8.5h.01"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${I[name] || ''}</svg>`;
}

export const categoryIcon = (id) => icon(I[`cat-${id}`] ? `cat-${id}` : 'cat-custom');
