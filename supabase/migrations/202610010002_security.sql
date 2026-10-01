-- Apply after the schema migration. The API uses a backend DB role; clients get
-- only tenant-scoped SELECT access to realtime job updates. No public writes.
ALTER TABLE public.github_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_user_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.github_oauth_states,public.github_user_grants FROM anon,authenticated;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.users,public.projects,public.memberships,public.jobs,public.events,public.saves,public.actions,public.audit,public.usage,public.webhook_deliveries FROM anon,authenticated;
GRANT SELECT ON public.jobs,public.memberships TO authenticated;
CREATE POLICY memberships_self ON public.memberships FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()));
CREATE POLICY jobs_self ON public.jobs FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()) AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.project_id=jobs.project_id AND m.user_id=(SELECT auth.uid())));
ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('pocket-checkpoints','pocket-checkpoints',false,29360128,ARRAY['application/json']) ON CONFLICT(id) DO NOTHING;
-- No client storage policies: only the API's service-role key can access bundles.
