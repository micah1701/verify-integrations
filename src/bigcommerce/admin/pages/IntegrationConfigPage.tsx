import React, { useState, useEffect } from 'react';
import {
  Panel,
  Form,
  FormGroup,
  FormControlLabel,
  Input,
  Button,
  Text,
  InlineMessage,
  Modal,
  Checkbox,
  Select,
  Textarea,
  HR,
} from '@bigcommerce/big-design';
import {
  getTemplateIntegrationConfig,
  loginToAdhocApi,
  refreshAdhocToken,
  updateTemplateIntegrationConfig,
} from '../../../core/verify-api.js';
import type { AdHocAdminConfig, IntegrationConfig, FaceMatchScore } from '../../../core/types.js';

interface Props {
  config: AdHocAdminConfig;
}

const SESSION_TOKEN_KEY = 'ahv_bearer';
const SESSION_EXPIRY_KEY = 'ahv_bearer_exp';
const SESSION_REFRESH_KEY = 'ahv_bearer_refresh';
const LOCAL_KEY_KEY = 'ahv_integration_key';
const LOCAL_TEMPLATE_KEY = 'ahv_template_id';

const FACE_MATCH_OPTIONS: Array<{ value: FaceMatchScore | ''; label: string }> = [
  { value: '', label: 'Any (no minimum)' },
  { value: 'possible_match', label: 'Possible match' },
  { value: 'likely_match', label: 'Likely match' },
  { value: 'definite_match', label: 'Definite match' },
];

function storeAuthResult(result: { access_token: string; refresh_token?: string; expires_in: number }) {
  sessionStorage.setItem(SESSION_TOKEN_KEY, result.access_token);
  sessionStorage.setItem(SESSION_EXPIRY_KEY, String(Date.now() + result.expires_in * 1000));
  if (result.refresh_token) {
    sessionStorage.setItem(SESSION_REFRESH_KEY, result.refresh_token);
  }
}

function clearAuthTokens() {
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
  sessionStorage.removeItem(SESSION_EXPIRY_KEY);
  sessionStorage.removeItem(SESSION_REFRESH_KEY);
}

async function getOrRefreshToken(apiBase: string): Promise<string | null> {
  const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
  const expiry = sessionStorage.getItem(SESSION_EXPIRY_KEY);
  if (token && expiry && Date.now() < parseInt(expiry, 10)) return token;

  // Token missing or expired — try refresh
  const refreshToken = sessionStorage.getItem(SESSION_REFRESH_KEY);
  if (refreshToken) {
    const refreshed = await refreshAdhocToken(apiBase, refreshToken);
    if (refreshed) {
      storeAuthResult(refreshed);
      return refreshed.access_token;
    }
  }

  clearAuthTokens();
  return null;
}

export default function IntegrationConfigPage({ config }: Props) {
  // Setup inputs (persisted to localStorage)
  const [integrationKey, setIntegrationKey] = useState(
    () => localStorage.getItem(LOCAL_KEY_KEY) ?? '',
  );
  const [templateId, setTemplateId] = useState(
    () => localStorage.getItem(LOCAL_TEMPLATE_KEY) ?? '',
  );

  // Loaded config state
  const [configData, setConfigData] = useState<IntegrationConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<IntegrationConfig>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Auth state
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    localStorage.setItem(LOCAL_KEY_KEY, integrationKey);
  }, [integrationKey]);

  useEffect(() => {
    localStorage.setItem(LOCAL_TEMPLATE_KEY, templateId);
  }, [templateId]);

  async function handleLoadConfig() {
    const key = integrationKey.trim();
    const tid = templateId.trim();
    if (!key || !tid) {
      setLoadError('Both Integration Key and Template ID are required.');
      return;
    }
    setLoadingConfig(true);
    setLoadError(null);
    setConfigData(null);
    setIsEditing(false);

    const remote = await getTemplateIntegrationConfig(config.apiBase, key, tid);
    if (!remote) {
      setLoadError('Network error. Check your connection and try again.');
    } else if (!remote.ok) {
      if (remote.status === 401) {
        setLoadError(`Integration Key is invalid or revoked. Verify the key in your Ad-Hoc Verify account. (${remote.error})`);
      } else if (remote.status === 404) {
        setLoadError('Template not found. Check that the Template ID is correct.');
      } else {
        setLoadError(`Failed to load config (HTTP ${remote.status}): ${remote.error}`);
      }
    } else {
      setConfigData(remote.data);
    }
    setLoadingConfig(false);
  }

  async function handleEditClick() {
    const token = await getOrRefreshToken(config.apiBase);
    if (token) {
      setDraft({ ...configData });
      setSaveError(null);
      setIsEditing(true);
    } else {
      setLoginEmail('');
      setLoginPassword('');
      setLoginError(null);
      setShowLoginModal(true);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError(null);

    const result = await loginToAdhocApi(config.apiBase, loginEmail.trim(), loginPassword);
    if (!result) {
      setLoginError('Login failed. Check your Ad-Hoc Verify credentials and try again.');
      setLoggingIn(false);
      return;
    }

    storeAuthResult(result);

    setLoggingIn(false);
    setShowLoginModal(false);
    setDraft({ ...configData });
    setSaveError(null);
    setIsEditing(true);
  }

  async function handleSave() {
    const token = await getOrRefreshToken(config.apiBase);
    if (!token) {
      setLoginEmail('');
      setLoginPassword('');
      setLoginError(null);
      setShowLoginModal(true);
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const ok = await updateTemplateIntegrationConfig(
        config.apiBase,
        token,
        templateId.trim(),
        draft,
      );
      if (ok) {
        setConfigData({ ...draft });
        setIsEditing(false);
      } else {
        setSaveError('Save failed. Please try again.');
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'unauthorized') {
        clearAuthTokens();
        setIsEditing(false);
        setLoginEmail('');
        setLoginPassword('');
        setLoginError('Your session has expired. Please sign in again.');
        setShowLoginModal(true);
      } else {
        setSaveError('Save failed. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  function updateDraft(patch: Partial<IntegrationConfig>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  return (
    <>
      {/* ── Setup ─────────────────────────────────────────────────────────── */}
      <Panel header="Integration Setup">
        <Text>
          Enter your Integration Key and Template ID to load or edit the storefront configuration
          stored in this template. These values are saved in your browser for convenience.
        </Text>
        <Form onSubmit={(e) => { e.preventDefault(); void handleLoadConfig(); }}>
          <FormGroup>
            <FormControlLabel htmlFor="integration-key">Integration Key</FormControlLabel>
            <Input
              id="integration-key"
              value={integrationKey}
              onChange={(e) => setIntegrationKey(e.target.value)}
              placeholder="ahv_pub_..."
            />
          </FormGroup>
          <FormGroup>
            <FormControlLabel htmlFor="template-id">Template ID</FormControlLabel>
            <Input
              id="template-id"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
          </FormGroup>
          <Button type="submit" isLoading={loadingConfig}>
            Load Config
          </Button>
        </Form>
      </Panel>

      {loadError && (
        <InlineMessage type="error" messages={[{ text: loadError }]} marginVertical="medium" />
      )}

      {/* ── Config display / edit ──────────────────────────────────────────── */}
      {configData !== null && !isEditing && (
        <Panel header="Integration Config">
          <ReadOnlyConfig configData={configData} />
          <div style={{ marginTop: '24px' }}>
            <Button variant="secondary" onClick={() => void handleEditClick()}>
              Edit
            </Button>
            <Text as="span" marginLeft="small" color="secondary50">
              You will need your Ad-Hoc Verify credentials to save changes.
            </Text>
          </div>
        </Panel>
      )}

      {isEditing && (
        <Panel header="Edit Integration Config">
          <EditForm
            draft={draft}
            updateDraft={updateDraft}
          />
          {saveError && (
            <InlineMessage type="error" messages={[{ text: saveError }]} marginVertical="medium" />
          )}
          <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
            <Button onClick={() => void handleSave()} isLoading={saving}>
              Save
            </Button>
            <Button
              variant="subtle"
              onClick={() => { setIsEditing(false); setSaveError(null); }}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </Panel>
      )}

      {/* ── Login modal ────────────────────────────────────────────────────── */}
      <Modal
        isOpen={showLoginModal}
        onClose={() => { setShowLoginModal(false); setLoginError(null); }}
        header="Sign in to Ad-Hoc Verify"
        actions={[
          {
            text: loggingIn ? 'Signing in…' : 'Sign In',
            onClick: () => {},
            variant: 'primary',
          },
          {
            text: 'Cancel',
            onClick: () => { setShowLoginModal(false); setLoginError(null); },
            variant: 'subtle',
          },
        ]}
      >
        <Text marginBottom="medium">
          Use your <strong>Ad-Hoc Verify</strong> account credentials (not your BigCommerce
          credentials) to authenticate and save changes.
        </Text>
        <Form onSubmit={(e) => void handleLogin(e)}>
          <FormGroup>
            <FormControlLabel htmlFor="login-email">Email</FormControlLabel>
            <Input
              id="login-email"
              type="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </FormGroup>
          <FormGroup>
            <FormControlLabel htmlFor="login-password">Password</FormControlLabel>
            <Input
              id="login-password"
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </FormGroup>
          {loginError && (
            <InlineMessage type="error" messages={[{ text: loginError }]} marginVertical="small" />
          )}
          <Button type="submit" isLoading={loggingIn}>
            Sign In
          </Button>
        </Form>
      </Modal>
    </>
  );
}

// ─── Read-only display ────────────────────────────────────────────────────────

function ReadOnlyConfig({ configData }: { configData: IntegrationConfig }) {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Store Hash', value: configData.storeHash ?? '—' },
    { label: 'Store Access Token', value: configData.storeAccessToken ? '••••••••' : '—' },
    { label: 'Pages', value: configData.pages?.join(', ') || '—' },
    { label: 'Require Verification', value: configData.ruleset?.requireVerification ? 'Yes' : 'No' },
    { label: 'Min Face Match Score', value: configData.ruleset?.minFaceMatchScore ?? 'Any' },
    { label: 'Require Over 18', value: configData.ruleset?.requireOver18 ? 'Yes' : 'No' },
    { label: 'Require Over 21', value: configData.ruleset?.requireOver21 ? 'Yes' : 'No' },
    { label: 'Block Checkout on Manual Review', value: configData.manualReview?.blockCheckout ? 'Yes' : 'No' },
    { label: 'Manual Review Message', value: configData.manualReview?.message ? String(configData.manualReview.message) : '—' },
    { label: 'Button Text', value: configData.buttonText ?? '—' },
    { label: 'Selector', value: configData.selector ?? '—' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '8px 16px' }}>
      {rows.map(({ label, value }) => (
        <React.Fragment key={label}>
          <Text bold>{label}</Text>
          <Text>{value}</Text>
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Edit form ────────────────────────────────────────────────────────────────

function EditForm({
  draft,
  updateDraft,
}: {
  draft: IntegrationConfig;
  updateDraft: (patch: Partial<IntegrationConfig>) => void;
}) {
  const ruleset = draft.ruleset ?? {
    requireVerification: true,
    minFaceMatchScore: null,
    requireOver18: false,
    requireOver21: false,
  };
  const manualReview = draft.manualReview ?? { blockCheckout: false, message: null };

  return (
    <Form onSubmit={(e) => e.preventDefault()}>
      {/* Store credentials */}
      <FormGroup>
        <FormControlLabel htmlFor="edit-store-hash">Store Hash</FormControlLabel>
        <Input
          id="edit-store-hash"
          value={draft.storeHash ?? ''}
          onChange={(e) => updateDraft({ storeHash: e.target.value })}
          placeholder="e.g. abc123"
        />
      </FormGroup>
      <FormGroup>
        <FormControlLabel htmlFor="edit-store-token">Store Access Token</FormControlLabel>
        <Input
          id="edit-store-token"
          value={draft.storeAccessToken ?? ''}
          onChange={(e) => updateDraft({ storeAccessToken: e.target.value })}
          placeholder="BC OAuth access token"
        />
      </FormGroup>

      <HR />

      {/* Ruleset */}
      <FormGroup>
        <Checkbox
          label="Require Verification"
          checked={ruleset.requireVerification}
          onChange={(e) =>
            updateDraft({ ruleset: { ...ruleset, requireVerification: e.target.checked } })
          }
        />
      </FormGroup>
      <FormGroup>
        <FormControlLabel htmlFor="edit-face-match">Min Face Match Score</FormControlLabel>
        <Select
          inputProps={{ id: 'edit-face-match' }}
          value={ruleset.minFaceMatchScore ?? ''}
          onOptionChange={(val) =>
            updateDraft({
              ruleset: {
                ...ruleset,
                minFaceMatchScore: (val as FaceMatchScore | '') || null,
              },
            })
          }
          options={FACE_MATCH_OPTIONS}
        />
      </FormGroup>
      <FormGroup>
        <Checkbox
          label="Require Over 18"
          checked={ruleset.requireOver18}
          onChange={(e) =>
            updateDraft({ ruleset: { ...ruleset, requireOver18: e.target.checked } })
          }
        />
      </FormGroup>
      <FormGroup>
        <Checkbox
          label="Require Over 21"
          checked={ruleset.requireOver21}
          onChange={(e) =>
            updateDraft({ ruleset: { ...ruleset, requireOver21: e.target.checked } })
          }
        />
      </FormGroup>

      <HR />

      {/* Manual review */}
      <FormGroup>
        <Checkbox
          label="Block Checkout During Manual Review"
          checked={manualReview.blockCheckout ?? false}
          onChange={(e) =>
            updateDraft({ manualReview: { ...manualReview, blockCheckout: e.target.checked } })
          }
        />
      </FormGroup>
      <FormGroup>
        <FormControlLabel htmlFor="edit-review-message">Manual Review Message</FormControlLabel>
        <Textarea
          id="edit-review-message"
          value={manualReview.message ? String(manualReview.message) : ''}
          onChange={(e) =>
            updateDraft({
              manualReview: { ...manualReview, message: e.target.value || null },
            })
          }
          placeholder="Leave blank to use the default message"
          rows={3}
        />
      </FormGroup>

      <HR />

      {/* UI */}
      <FormGroup>
        <FormControlLabel htmlFor="edit-button-text">Button Text</FormControlLabel>
        <Input
          id="edit-button-text"
          value={draft.buttonText ?? ''}
          onChange={(e) => updateDraft({ buttonText: e.target.value })}
          placeholder="Verify ID"
        />
      </FormGroup>
      <FormGroup>
        <FormControlLabel htmlFor="edit-selector">CSS Selector</FormControlLabel>
        <Input
          id="edit-selector"
          value={draft.selector ?? ''}
          onChange={(e) => updateDraft({ selector: e.target.value })}
          placeholder=".cart-actions"
        />
      </FormGroup>
    </Form>
  );
}
