// Same-origin relative calls to /api/proxy/<path> which maps 1:1 to /api/v1/<path>.
// The proxy route resolves the session and injects X-User-Id for the backend.

type Json = Record<string, any>

async function req(path: string, init?: RequestInit) {
  const res = await fetch(path, init)
  const text = await res.text()
  let data: any = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = text }
  }
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `Request failed (${res.status})`
    throw new Error(message)
  }
  return data
}

const jsonInit = (method: string, body?: Json): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

function qs(params?: Record<string, any>): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const api = {
  // --- Workspaces ---
  listWorkspaces: () => req('/api/proxy/workspaces'),
  createWorkspace: (body: Json) => req('/api/proxy/workspaces', jsonInit('POST', body)),
  getWorkspace: (id: string) => req(`/api/proxy/workspaces/${id}`),
  updateWorkspace: (id: string, body: Json) => req(`/api/proxy/workspaces/${id}`, jsonInit('PUT', body)),
  listMembers: (id: string) => req(`/api/proxy/workspaces/${id}/members`),
  addMember: (id: string, body: Json) => req(`/api/proxy/workspaces/${id}/members`, jsonInit('POST', body)),
  removeMember: (id: string, memberId: string) => req(`/api/proxy/workspaces/${id}/members/${memberId}`, jsonInit('DELETE')),

  // --- Processors ---
  listProcessors: (workspace_id: string) => req(`/api/proxy/processors${qs({ workspace_id })}`),
  getProcessor: (id: string) => req(`/api/proxy/processors/${id}`),
  createProcessor: (body: Json) => req('/api/proxy/processors', jsonInit('POST', body)),
  updateProcessor: (id: string, body: Json) => req(`/api/proxy/processors/${id}`, jsonInit('PUT', body)),
  deleteProcessor: (id: string) => req(`/api/proxy/processors/${id}`, jsonInit('DELETE')),

  // --- Rate tables ---
  listRateTables: (params: { workspace_id: string; brand?: string }) => req(`/api/proxy/rate-tables${qs(params)}`),
  getRateTable: (id: string) => req(`/api/proxy/rate-tables/${id}`),
  createRateTable: (body: Json) => req('/api/proxy/rate-tables', jsonInit('POST', body)),
  updateRateTable: (id: string, body: Json) => req(`/api/proxy/rate-tables/${id}`, jsonInit('PUT', body)),
  activateRateTable: (id: string) => req(`/api/proxy/rate-tables/${id}/activate`, jsonInit('POST')),
  cloneRateTable: (id: string, body?: Json) => req(`/api/proxy/rate-tables/${id}/clone`, jsonInit('POST', body)),
  deleteRateTable: (id: string) => req(`/api/proxy/rate-tables/${id}`, jsonInit('DELETE')),

  // --- Categories ---
  listCategories: (version_id: string) => req(`/api/proxy/categories${qs({ version_id })}`),
  createCategory: (body: Json) => req('/api/proxy/categories', jsonInit('POST', body)),
  updateCategory: (id: string, body: Json) => req(`/api/proxy/categories/${id}`, jsonInit('PUT', body)),
  deleteCategory: (id: string) => req(`/api/proxy/categories/${id}`, jsonInit('DELETE')),

  // --- Uploads ---
  listUploads: (workspace_id: string) => req(`/api/proxy/uploads${qs({ workspace_id })}`),
  getUpload: (id: string) => req(`/api/proxy/uploads/${id}`),
  createUpload: (body: Json) => req('/api/proxy/uploads', jsonInit('POST', body)),
  parseUpload: (id: string) => req(`/api/proxy/uploads/${id}/parse`, jsonInit('POST')),
  deleteUpload: (id: string) => req(`/api/proxy/uploads/${id}`, jsonInit('DELETE')),

  // --- Transactions ---
  listTransactions: (params: {
    workspace_id: string; batch_id?: string; processor_id?: string; brand?: string;
    product?: string; mcc?: string; downgrade_only?: boolean; q?: string; from?: string; to?: string;
  }) => req(`/api/proxy/transactions${qs(params)}`),
  getTransaction: (id: string) => req(`/api/proxy/transactions/${id}`),
  setTransactionTags: (id: string, body: Json) => req(`/api/proxy/transactions/${id}/tags`, jsonInit('POST', body)),
  bulkTagTransactions: (body: Json) => req('/api/proxy/transactions/bulk/tag', jsonInit('POST', body)),
  bulkDeleteTransactions: (body: Json) => req('/api/proxy/transactions/bulk/delete', jsonInit('POST', body)),

  // --- Qualification ---
  listQualifications: (params: { workspace_id: string; batch_id?: string; downgrade_only?: boolean }) =>
    req(`/api/proxy/qualification${qs(params)}`),
  getQualification: (id: string) => req(`/api/proxy/qualification/${id}`),
  runQualificationBatch: (batchId: string) => req(`/api/proxy/qualification/run/batch/${batchId}`, jsonInit('POST')),
  runQualificationTransaction: (txnId: string) => req(`/api/proxy/qualification/run/transaction/${txnId}`, jsonInit('POST')),

  // --- Downgrades ---
  listDowngrades: (params: { workspace_id: string; batch_id?: string; cause?: string }) =>
    req(`/api/proxy/downgrades${qs(params)}`),
  getCauseBreakdown: (workspace_id: string) => req(`/api/proxy/downgrades/causes/breakdown${qs({ workspace_id })}`),

  // --- Level 2/3 ---
  getLevel23Gaps: (params: { workspace_id: string; level?: string }) => req(`/api/proxy/level23/gaps${qs(params)}`),
  getLevel23Summary: (workspace_id: string) => req(`/api/proxy/level23/summary${qs({ workspace_id })}`),

  // --- Effective rate ---
  getEffectiveRate: (params: { workspace_id: string; dimension?: string }) => req(`/api/proxy/effective-rate${qs(params)}`),
  getEffectiveRateTrend: (workspace_id: string) => req(`/api/proxy/effective-rate/trend${qs({ workspace_id })}`),

  // --- Savings ---
  listSavings: (params: { workspace_id: string; scope?: string }) => req(`/api/proxy/savings${qs(params)}`),
  getSavingsSummary: (workspace_id: string) => req(`/api/proxy/savings/summary${qs({ workspace_id })}`),

  // --- Reconciliation ---
  listReconciliations: (workspace_id: string) => req(`/api/proxy/reconciliation${qs({ workspace_id })}`),
  getReconciliation: (id: string) => req(`/api/proxy/reconciliation/${id}`),
  updateReconciliation: (id: string, body: Json) => req(`/api/proxy/reconciliation/${id}`, jsonInit('PUT', body)),

  // --- Benchmarks ---
  listBenchmarks: (params: { workspace_id: string; dimension?: string }) => req(`/api/proxy/benchmarks${qs(params)}`),
  createBenchmark: (body: Json) => req('/api/proxy/benchmarks', jsonInit('POST', body)),
  updateBenchmark: (id: string, body: Json) => req(`/api/proxy/benchmarks/${id}`, jsonInit('PUT', body)),
  deleteBenchmark: (id: string) => req(`/api/proxy/benchmarks/${id}`, jsonInit('DELETE')),

  // --- Saved filters ---
  listSavedFilters: (workspace_id: string) => req(`/api/proxy/saved-filters${qs({ workspace_id })}`),
  createSavedFilter: (body: Json) => req('/api/proxy/saved-filters', jsonInit('POST', body)),
  updateSavedFilter: (id: string, body: Json) => req(`/api/proxy/saved-filters/${id}`, jsonInit('PUT', body)),
  deleteSavedFilter: (id: string) => req(`/api/proxy/saved-filters/${id}`, jsonInit('DELETE')),

  // --- Tags ---
  listTags: (workspace_id: string) => req(`/api/proxy/tags${qs({ workspace_id })}`),
  createTag: (body: Json) => req('/api/proxy/tags', jsonInit('POST', body)),
  deleteTag: (id: string) => req(`/api/proxy/tags/${id}`, jsonInit('DELETE')),

  // --- Notifications ---
  listNotifications: (workspace_id: string) => req(`/api/proxy/notifications${qs({ workspace_id })}`),
  markNotificationRead: (id: string) => req(`/api/proxy/notifications/${id}/read`, jsonInit('POST')),
  markAllNotificationsRead: (workspace_id: string) => req(`/api/proxy/notifications/read-all${qs({ workspace_id })}`, jsonInit('POST')),

  // --- Webhooks ---
  listWebhooks: (workspace_id: string) => req(`/api/proxy/webhooks${qs({ workspace_id })}`),
  createWebhook: (body: Json) => req('/api/proxy/webhooks', jsonInit('POST', body)),
  updateWebhook: (id: string, body: Json) => req(`/api/proxy/webhooks/${id}`, jsonInit('PUT', body)),
  deleteWebhook: (id: string) => req(`/api/proxy/webhooks/${id}`, jsonInit('DELETE')),
  testWebhook: (id: string) => req(`/api/proxy/webhooks/${id}/test`, jsonInit('POST')),
  listWebhookDeliveries: (id: string) => req(`/api/proxy/webhooks/${id}/deliveries`),

  // --- API keys ---
  listApiKeys: () => req('/api/proxy/api-keys'),
  createApiKey: (body: Json) => req('/api/proxy/api-keys', jsonInit('POST', body)),
  revokeApiKey: (id: string) => req(`/api/proxy/api-keys/${id}`, jsonInit('DELETE')),

  // --- Audit log ---
  listAuditLog: (params: { workspace_id: string; action?: string; entity_type?: string }) =>
    req(`/api/proxy/audit-log${qs(params)}`),

  // --- Settings ---
  getSettings: (workspace_id: string) => req(`/api/proxy/settings${qs({ workspace_id })}`),
  upsertSetting: (body: Json) => req('/api/proxy/settings', jsonInit('PUT', body)),

  // --- Onboarding ---
  getOnboarding: (workspace_id: string) => req(`/api/proxy/onboarding${qs({ workspace_id })}`),
  completeOnboardingStep: (body: Json) => req('/api/proxy/onboarding/step', jsonInit('POST', body)),

  // --- Sample seeder ---
  seedSample: (body?: Json) => req('/api/proxy/sample/seed', jsonInit('POST', body)),

  // --- Analytics ---
  getAnalyticsOverview: (workspace_id: string) => req(`/api/proxy/analytics/overview${qs({ workspace_id })}`),
  getTopCauses: (workspace_id: string) => req(`/api/proxy/analytics/top-causes${qs({ workspace_id })}`),
  getTopMccs: (workspace_id: string) => req(`/api/proxy/analytics/top-mccs${qs({ workspace_id })}`),

  // --- Billing ---
  getBillingPlan: () => req('/api/proxy/billing/plan'),
  startCheckout: (body?: Json) => req('/api/proxy/billing/checkout', jsonInit('POST', body)),
  openBillingPortal: (body?: Json) => req('/api/proxy/billing/portal', jsonInit('POST', body)),
}

export default api
