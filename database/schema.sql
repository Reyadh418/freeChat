-- ==============================================================================
-- freeChat: Zero-Knowledge End-to-End Encrypted Messenger Schema for Supabase
-- ==============================================================================

-- 1. USERS TABLE
-- Stores public identities and encrypted private key backups (Zero-Knowledge)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    auth_verifier TEXT NOT NULL,         -- Client-derived auth token (hash/verifier)
    public_key TEXT NOT NULL,            -- ECDH P-256 Public Key (JWK JSON string)
    encrypted_priv_key TEXT NOT NULL,    -- AES-GCM Encrypted Private Key (Base64)
    salt TEXT NOT NULL,                  -- Salt used for PBKDF2 Master Key derivation (Base64)
    iv TEXT NOT NULL,                    -- IV used to encrypt private key (Base64)
    avatar_color TEXT DEFAULT '#007AFF', -- Profile avatar background accent
    status_message TEXT DEFAULT 'Hey there! I am using freeChat.',
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for instant username searches
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 2. CONVERSATIONS TABLE
-- Represents direct (1-on-1) or group chat rooms
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL CHECK (type IN ('direct', 'group')) DEFAULT 'direct',
    title TEXT,                          -- Group title or custom nickname
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CONVERSATION PARTICIPANTS TABLE
-- Maps users to conversations and stores group keys or session metadata
CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    encrypted_group_key TEXT,            -- Group symmetric key encrypted for this user's public key (if group)
    role TEXT DEFAULT 'member',          -- 'owner', 'admin', 'member'
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_participants_user ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_participants_conv ON conversation_participants(conversation_id);

-- 4. MESSAGES TABLE
-- Completely encrypted message payloads (Server only ever stores Ciphertext & IV)
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
    ciphertext TEXT NOT NULL,            -- AES-256-GCM Encrypted payload (Base64)
    iv TEXT NOT NULL,                    -- 12-byte initialization vector (Base64)
    sender_public_key TEXT,              -- Sender's public key identifier or ratchet key
    media_url TEXT,                      -- Link to encrypted storage blob (if attachment exists)
    media_type TEXT,                     -- 'image', 'audio', 'file'
    ephemeral_expires_at TIMESTAMPTZ,    -- Self-destruct expiration timestamp (if set)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);

