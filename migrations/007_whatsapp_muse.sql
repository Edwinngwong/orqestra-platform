BEGIN;
CREATE TABLE IF NOT EXISTS whatsapp_bindings (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_wa_id text NOT NULL CHECK (sender_wa_id ~ '^[0-9]{7,20}$'),
  business_phone_number_id text NOT NULL CHECK (business_phone_number_id ~ '^[0-9]{5,30}$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sender_wa_id,business_phone_number_id)
);
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id text PRIMARY KEY,
  sender_wa_id text NOT NULL,
  business_phone_number_id text NOT NULL,
  message_text text NOT NULL CHECK (length(message_text) BETWEEN 1 AND 4096),
  public_base_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_messages_pending_idx ON whatsapp_messages(status,received_at) WHERE status IN ('pending','failed');
INSERT INTO schema_migrations(version) VALUES ('007_whatsapp_muse') ON CONFLICT DO NOTHING;
COMMIT;
