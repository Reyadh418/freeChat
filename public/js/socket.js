let socket = null;
let currentActiveConversationId = null;

export const Realtime = {
  connect({
    token,
    onMessageReceived,
    onTypingChange,
    onStatusChange,
    onOnlineUsersList,
    onConversationUpdated,
    onConnect,
    onDisconnect,
    onReconnectAttempt,
    onConnectError
  }) {
    if (socket) {
      socket.disconnect();
    }

    // Connect with JWT auth token
    // @ts-ignore
    socket = window.io({
      auth: { token }
    });

    socket.on('connect', () => {
      if (typeof onConnect === 'function') {
        onConnect();
      }
      if (currentActiveConversationId) {
        socket.emit('join_conversation', currentActiveConversationId);
      }
    });

    socket.on('disconnect', (reason) => {
      if (typeof onDisconnect === 'function') {
        onDisconnect(reason);
      }
    });

    if (socket.io) {
      socket.io.on('reconnect_attempt', () => {
        if (typeof onReconnectAttempt === 'function') {
          onReconnectAttempt();
        }
      });
    }

    socket.on('connect_error', (err) => {
      console.error('[Socket Auth Error]:', err.message);
      if (typeof onConnectError === 'function') {
        onConnectError(err);
      }
    });

    socket.on('online_users_list', (userIds) => {
      if (typeof onOnlineUsersList === 'function') {
        onOnlineUsersList(userIds);
      }
    });

    socket.on('new_message', (msg) => {
      if (typeof onMessageReceived === 'function') {
        onMessageReceived(msg);
      }
    });

    socket.on('user_typing', (data) => {
      if (typeof onTypingChange === 'function') {
        onTypingChange(data);
      }
    });

    socket.on('user_status_change', (data) => {
      if (typeof onStatusChange === 'function') {
        onStatusChange(data);
      }
    });

    socket.on('conversation_updated', (data) => {
      if (typeof onConversationUpdated === 'function') {
        onConversationUpdated(data);
      }
    });

    return socket;
  },

  joinConversation(conversationId) {
    currentActiveConversationId = conversationId;
    if (socket && conversationId) {
      socket.emit('join_conversation', conversationId, (response) => {
        if (response?.error) {
          console.warn('[Realtime Join Denied]:', response.error);
        }
      });
    }
  },

  leaveConversation(conversationId) {
    if (currentActiveConversationId === conversationId) {
      currentActiveConversationId = null;
    }
    if (socket && conversationId) {
      socket.emit('leave_conversation', conversationId);
    }
  },

  sendMessage(messageData) {
    return new Promise((resolve, reject) => {
      if (!socket) return reject(new Error('Socket not connected'));

      socket.emit('send_message', messageData, (response) => {
        if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve(response?.message);
        }
      });
    });
  },

  sendTypingStart(conversationId) {
    if (socket && conversationId) {
      socket.emit('typing_start', { conversationId });
    }
  },

  sendTypingStop(conversationId) {
    if (socket && conversationId) {
      socket.emit('typing_stop', { conversationId });
    }
  },

  disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  }
};
