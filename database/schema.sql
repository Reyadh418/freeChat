-- Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    auth_verifier TEXT NOT NULL,
    public_key TEXT NOT NULL,
    encrypted_priv_key TEXT NOT NULL,
    salt TEXT NOT NULL,
    iv TEXT NOT NULL,
    avatar_color TEXT DEFAULT '#007AFF',
    status_message TEXT DEFAULT 'Hey there! I am using freeChat.',
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL CHECK (type IN ('direct', 'group')) DEFAULT 'direct',
    title TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Participants
CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    encrypted_group_key TEXT,
    role TEXT DEFAULT 'member',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_participants_user ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_participants_conv ON conversation_participants(conversation_id);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    sender_public_key TEXT,
    media_url TEXT,
    media_type TEXT,
    ephemeral_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- 1. Enable and Force RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;

ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants FORCE ROW LEVEL SECURITY;

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;

-- 2. Service Role Bypass Policies
-- Allows trusted backend services operating with SUPABASE_KEY (service_role) full administrative access.
DROP POLICY IF EXISTS "service_role_full_access_users" ON users;
CREATE POLICY "service_role_full_access_users" ON users 
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access_conversations" ON conversations;
CREATE POLICY "service_role_full_access_conversations" ON conversations 
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access_participants" ON conversation_participants;
CREATE POLICY "service_role_full_access_participants" ON conversation_participants 
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access_messages" ON messages;
CREATE POLICY "service_role_full_access_messages" ON messages 
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. Users Table Policies
-- Allow authenticated users to view public user profile information
DROP POLICY IF EXISTS "users_select_authenticated" ON users;
CREATE POLICY "users_select_authenticated" ON users 
    FOR SELECT TO authenticated
    USING (true);

-- Allow users to update only their own profile
DROP POLICY IF EXISTS "users_update_own" ON users;
CREATE POLICY "users_update_own" ON users 
    FOR UPDATE TO authenticated
    USING (auth.uid() = id) 
    WITH CHECK (auth.uid() = id);

-- Allow registration (insert own user row during signup)
DROP POLICY IF EXISTS "users_insert_signup" ON users;
CREATE POLICY "users_insert_signup" ON users 
    FOR INSERT 
    WITH CHECK (auth.uid() = id OR auth.uid() IS NULL);

-- 4. Conversations Table Policies
-- Users can only view conversations where they are a participant
DROP POLICY IF EXISTS "conversations_select_participant" ON conversations;
CREATE POLICY "conversations_select_participant" ON conversations 
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM conversation_participants cp 
            WHERE cp.conversation_id = conversations.id 
            AND cp.user_id = auth.uid()
        )
    );

-- Users can create conversations where they are the designated creator
DROP POLICY IF EXISTS "conversations_insert_creator" ON conversations;
CREATE POLICY "conversations_insert_creator" ON conversations 
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = created_by);

-- Participants or creators can update conversation metadata
DROP POLICY IF EXISTS "conversations_update_participant" ON conversations;
CREATE POLICY "conversations_update_participant" ON conversations 
    FOR UPDATE TO authenticated
    USING (
        auth.uid() = created_by OR
        EXISTS (
            SELECT 1 FROM conversation_participants cp 
            WHERE cp.conversation_id = conversations.id 
            AND cp.user_id = auth.uid()
        )
    );

-- 5. Conversation Participants Table Policies
-- Users can only view participants of conversations they belong to
DROP POLICY IF EXISTS "participants_select_member" ON conversation_participants;
CREATE POLICY "participants_select_member" ON conversation_participants 
    FOR SELECT TO authenticated
    USING (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM conversation_participants cp 
            WHERE cp.conversation_id = conversation_participants.conversation_id 
            AND cp.user_id = auth.uid()
        )
    );

-- Participants can be added by conversation creators or existing participants
DROP POLICY IF EXISTS "participants_insert_creator_or_member" ON conversation_participants;
CREATE POLICY "participants_insert_creator_or_member" ON conversation_participants 
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM conversations c 
            WHERE c.id = conversation_participants.conversation_id 
            AND c.created_by = auth.uid()
        ) OR
        EXISTS (
            SELECT 1 FROM conversation_participants cp 
            WHERE cp.conversation_id = conversation_participants.conversation_id 
            AND cp.user_id = auth.uid()
        )
    );

-- A user can leave a conversation, or conversation creator can remove members
DROP POLICY IF EXISTS "participants_delete_self_or_owner" ON conversation_participants;
CREATE POLICY "participants_delete_self_or_owner" ON conversation_participants 
    FOR DELETE TO authenticated
    USING (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM conversations c 
            WHERE c.id = conversation_participants.conversation_id 
            AND c.created_by = auth.uid()
        )
    );

-- 6. Messages Table Policies
-- Messages can only be read by participants of that conversation
DROP POLICY IF EXISTS "messages_select_participant" ON messages;
CREATE POLICY "messages_select_participant" ON messages 
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM conversation_participants cp 
            WHERE cp.conversation_id = messages.conversation_id 
            AND cp.user_id = auth.uid()
        )
    );

-- Messages can only be inserted by authenticated participants sending as themselves
DROP POLICY IF EXISTS "messages_insert_sender_participant" ON messages;
CREATE POLICY "messages_insert_sender_participant" ON messages 
    FOR INSERT TO authenticated
    WITH CHECK (
        sender_id = auth.uid() AND
        EXISTS (
            SELECT 1 FROM conversation_participants cp 
            WHERE cp.conversation_id = messages.conversation_id 
            AND cp.user_id = auth.uid()
        )
    );

