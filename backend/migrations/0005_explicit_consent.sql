-- Separate phone/account consent from profile/directory consent.
-- Old consent_at values were written at registration without showing an explicit notice.
ALTER TABLE users ADD COLUMN consent_given INTEGER NOT NULL DEFAULT 0 CHECK(consent_given IN (0,1));
ALTER TABLE users ADD COLUMN consent_version TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN account_consent_at TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN account_consent_version TEXT NOT NULL DEFAULT '';
UPDATE users SET consent_at='',consent_given=0,consent_version='',account_consent_at='',account_consent_version='';
