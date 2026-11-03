BEGIN;
CREATE TABLE IF NOT EXISTS whatsapp_notifications (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  event text NOT NULL,
  sender_wa_id text NOT NULL CHECK (sender_wa_id ~ '^[0-9]{7,20}$'),
  message_text text NOT NULL CHECK (length(message_text) BETWEEN 1 AND 4096),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,event)
);
CREATE INDEX IF NOT EXISTS whatsapp_notifications_pending_idx ON whatsapp_notifications(status,created_at) WHERE status IN ('pending','failed');
INSERT INTO schema_migrations(version) VALUES ('009_whatsapp_notification_outbox') ON CONFLICT DO NOTHING;
COMMIT;
