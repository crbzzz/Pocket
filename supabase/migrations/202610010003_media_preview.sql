CREATE TABLE IF NOT EXISTS public.attachments (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id), mime_type text NOT NULL, size integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.previews (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id), job_id uuid NOT NULL REFERENCES public.jobs(id), data jsonb NOT NULL, expires_at timestamptz NOT NULL, status text NOT NULL);
CREATE INDEX IF NOT EXISTS previews_expiry ON public.previews(status, expires_at);
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.previews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attachments, public.previews FROM anon, authenticated;
GRANT ALL ON public.attachments, public.previews TO service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('pocket-attachments','pocket-attachments',false,500000,ARRAY['image/jpeg','image/png']) ON CONFLICT(id) DO NOTHING;
