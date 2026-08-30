const BASE_URL = '';

async function request(endpoint, options = {}) {
  const defaultHeaders = {
    'Content-Type': 'application/json'
  };

  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers
    }
  };

  const response = await fetch(`${BASE_URL}${endpoint}`, config);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Network request failed');
  }

  return data;
}

export const API = {
  // Auth
  async register(userData) {
    return request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData)
    });
  },

  async preLogin(username) {
    return request('/api/auth/pre-login', {
      method: 'POST',
      body: JSON.stringify({ username })
    });
  },

  async login(username, authVerifier) {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, auth_verifier: authVerifier })
    });
  },

  async getUser(username) {
    return request(`/api/auth/user/${encodeURIComponent(username)}`);
  },

  // Chat
  async searchUsers(query, excludeUserId) {
    const params = new URLSearchParams({ q: query });
    if (excludeUserId) params.append('exclude', excludeUserId);
    return request(`/api/chat/users/search?${params.toString()}`);
  },

  async getConversations(userId) {
    return request(`/api/chat/conversations?userId=${encodeURIComponent(userId)}`);
  },

  async createDirectConversation(currentUserId, targetUsername) {
    return request('/api/chat/conversations/direct', {
      method: 'POST',
      body: JSON.stringify({ currentUserId, targetUsername })
    });
  },

  async getMessages(convId, limit = 100) {
    return request(`/api/chat/conversations/${encodeURIComponent(convId)}/messages?limit=${limit}`);
  }
};
