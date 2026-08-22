-- Sprint 4 follow-up: indexes justified by FK cascade paths identified by
-- Supabase Advisors after the instrumentation tables were applied.

create index drop_claim_states_viewer_id_idx
  on private.drop_claim_states (viewer_id);

create index interest_opens_recipient_id_idx
  on private.interest_opens (recipient_id);
