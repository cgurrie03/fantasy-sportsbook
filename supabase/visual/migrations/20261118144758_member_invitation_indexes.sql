CREATE INDEX member_invitations_team ON boff_dev_internal.member_invitations(team_id);
CREATE INDEX member_invitations_issuer ON boff_dev_internal.member_invitations(issuer,created_at DESC);
CREATE INDEX member_invitations_account ON boff_dev_internal.member_invitations(account_id) WHERE account_id IS NOT NULL;
