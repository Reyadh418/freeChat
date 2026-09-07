export function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function formatTime(dateInput) {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDateDivider(dateInput) {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  const now = new Date();
  
  const isToday = date.toDateString() === now.toDateString();
  const isYesterday = new Date(now.setDate(now.getDate() - 1)).toDateString() === date.toDateString();

  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (isToday) return `Today ${timeStr}`;
  if (isYesterday) return `Yesterday ${timeStr}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeStr}`;
}

export function showToast(message, duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'ios-toast';
  toast.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
    </svg>
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hide');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
}

export function renderDateDivider(text) {
  const div = document.createElement('div');
  div.className = 'date-divider';
  div.textContent = text;
  return div;
}

export function renderConversationItem(conv, currentUserId, isActive = false, onlineUsers = new Set()) {
  const otherParticipant = conv.conversation_participants?.find(
    p => (p.user_id || p.users?.id) !== currentUserId
  )?.users || { username: conv.title || 'Unknown', avatar_color: '#007AFF' };

  const initial = escapeHtml((otherParticipant.username || '?')[0].toUpperCase());
  const rawColor = otherParticipant.avatar_color || '#007AFF';
  const color = /^#[0-9a-fA-F]{3,8}$/.test(rawColor) ? rawColor : '#007AFF';
  const isOnline = otherParticipant.id && onlineUsers ? onlineUsers.has(otherParticipant.id) : false;

  const div = document.createElement('div');
  div.className = `conv-item ${isActive ? 'active' : ''}`;
  div.dataset.convId = conv.id;
  div.dataset.targetUsername = otherParticipant.username;
  div.dataset.targetPublicKey = otherParticipant.public_key;

  div.innerHTML = `
    <div class="avatar" style="background-color: ${color}">
      ${initial}
      <div class="avatar-status-badge ${isOnline ? '' : 'offline'}" id="status-badge-${otherParticipant.id || conv.id}"></div>
    </div>
    <div class="conv-item-content">
      <div class="conv-item-top">
        <span class="conv-item-name">${escapeHtml(otherParticipant.username)}</span>
        <span class="conv-item-time">${conv.updated_at ? formatTime(conv.updated_at) : ''}</span>
      </div>
      <div class="conv-item-bottom">
        <span class="conv-item-preview" id="conv-preview-${conv.id}">Encrypted chat</span>
      </div>
    </div>
  `;

  return div;
}

export function renderMessageBubble({ id, isMine, plainText, createdAt }) {
  const row = document.createElement('div');
  row.className = `message-row ${isMine ? 'sent' : 'received'}`;
  row.id = `msg-${id}`;

  const formattedTime = formatTime(createdAt);

  row.innerHTML = `
    <div class="bubble">
      ${escapeHtml(plainText)}
    </div>
    <div class="bubble-meta">
      <span>${formattedTime}</span>
      ${isMine ? `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
      ` : ''}
    </div>
  `;

  return row;
}

export function renderTypingIndicator(username) {
  const div = document.createElement('div');
  div.id = 'active-typing-indicator';
  div.className = 'typing-bubble';
  div.title = `${username} is typing...`;
  div.innerHTML = `
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
  `;
  return div;
}

export function scrollToBottom(element, smooth = true) {
  if (!element) return;
  element.scrollTo({
    top: element.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto'
  });
}
