// frontend/src/api.ts
// Central de chamadas da API da plataforma GP Labs
// ✅ Completa + compat (não quebra imports antigos)
// ✅ Multi-tenant (X-Tenant-Id) + Auth robusto + Outbound completo (WA + SMS)

import type {
  Conversation,
  ConversationStatus,
  LoginResponse,
  MediaItem,
  Message,
  PhoneNumberRecord,
  Template
} from "./types";

// ------------------------------------------------------
// API BASE
// ------------------------------------------------------
const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3010";

const AUTH_KEY = "gpLabsAuthToken";
const AUTH_USER_KEY = "gpLabsAuthUser";

// ------------------------------------------------------
// AUTH HELPERS
// ------------------------------------------------------
function safeParseJson<T = any>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getAuthUser(): any | null {
  if (typeof window === "undefined") return null;
  return (
    safeParseJson(localStorage.getItem(AUTH_USER_KEY)) ||
    safeParseJson(sessionStorage.getItem(AUTH_USER_KEY))
  );
}

/**
 * ✅ Tenant Header (X-Tenant-Id)
 * Regra do backend (resolveTenant):
 * - via subdomínio resolve por host
 * - via cliente.gplabs.com.br precisa header
 */
function getTenantId(): string | null {
  const u = getAuthUser();
  if (!u) return null;

  const direct =
    u?.tenant?.slug ||
    u?.tenant?.id ||
    u?.tenantId ||
    u?.tenants?.[0]?.tenant?.slug ||
    u?.tenants?.[0]?.tenant?.id ||
    u?.tenants?.[0]?.tenantId;

  return direct ? String(direct) : null;
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem(AUTH_KEY) || sessionStorage.getItem(AUTH_KEY);
  return token ? String(token) : null;
}

function clearAuth() {
  if (typeof window === "undefined") return;

  localStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(AUTH_KEY);

  localStorage.removeItem(AUTH_USER_KEY);
  sessionStorage.removeItem(AUTH_USER_KEY);
}

function isUnauthorized(res: Response) {
  return res.status === 401;
}

/**
 * ✅ Regra:
 * - Não deixar "extra headers" sobrescrever Authorization.
 * - Injeta X-Tenant-Id automaticamente.
 * - Não sobrescrever Content-Type quando for FormData.
 */
function buildHeaders(extra?: HeadersInit): HeadersInit {
  const token = getToken();
  const tenantId = getTenantId();

  const normalized: Record<string, string> = {};
  if (extra) {
    const h = new Headers(extra);
    h.forEach((v, k) => {
      normalized[k] = v;
    });
  }

  // impede override do Authorization
  Object.keys(normalized).forEach((k) => {
    if (k.toLowerCase() === "authorization") delete normalized[k];
  });

  const hasTenantHeader = Object.keys(normalized).some(
    (k) => k.toLowerCase() === "x-tenant-id"
  );

  return {
    ...normalized,
    ...(tenantId && !hasTenantHeader ? { "X-Tenant-Id": tenantId } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

// ------------------------------------------------------
// INTERNAL HELPERS
// ------------------------------------------------------
async function safeReadText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function safeReadJson<T = any>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function buildApiError(status: number, path: string, payload: any, text: string) {
  const msg =
    payload?.error ||
    payload?.message ||
    payload?.details ||
    (typeof payload === "string" ? payload : "") ||
    text ||
    "sem corpo";

  return new Error(`Erro na API (${status}) ${path}: ${msg}`);
}

function isPlainObject(v: any) {
  return (
    v &&
    typeof v === "object" &&
    !(v instanceof FormData) &&
    !(v instanceof Blob) &&
    !(v instanceof ArrayBuffer)
  );
}

function buildQuery(params?: Record<string, any>) {
  if (!params) return "";
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    qs.set(k, String(v));
  });
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/**
 * ✅ Normaliza listas:
 * - array direto
 * - { items: [...] }
 * - { data: [...] }
 * - { templates: [...] } / { numbers: [...] } / { results: [...] }
 */
function unwrapList<T = any>(res: any): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === "object") {
    const cands = [res.items, res.data, res.templates, res.numbers, res.results, res.pages];
    for (const c of cands) if (Array.isArray(c)) return c as T[];
  }
  return [];
}

/**
 * ✅ Helper para fallback de endpoints (quando o backend varia)
 */
async function requestWithFallback<T = any>(
  primary: () => Promise<T>,
  fallbacks: Array<() => Promise<T>>
): Promise<T> {
  try {
    return await primary();
  } catch (e: any) {
    const msg = String(e?.message || "");
    const is404 = /(\b404\b)|not found/i.test(msg);
    if (!is404) throw e;

    let lastErr = e;
    for (const fn of fallbacks) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        const m = String(err?.message || "");
        const still404 = /(\b404\b)|not found/i.test(m);
        if (!still404) throw err;
      }
    }
    throw lastErr;
  }
}

// ------------------------------------------------------
// REQUEST (JSON/TEXT/204)
// ------------------------------------------------------
async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  // ✅ FIX GLOBAL: garante "text" em /messages
  let effectiveBody: any = (options as any).body;

  const isMessagesEndpoint =
    /\/messages(\?|$)/.test(path) ||
    /\/conversations\/[^/]+\/messages(\?|$)/.test(path);

  if (isMessagesEndpoint && isPlainObject(effectiveBody)) {
    const b: any = effectiveBody;

    const candidate =
      b.text ??
      b.body ??
      b.message ??
      b.caption ??
      b.content ??
      b.payload?.text ??
      null;

    const hasText = b.text !== undefined && b.text !== null && String(b.text).trim() !== "";

    if (!hasText && candidate !== null && String(candidate).trim() !== "") {
      effectiveBody = { ...b, text: String(candidate).trim() };
    }
  }

  const hasBody = effectiveBody !== undefined && effectiveBody !== null;

  const body: any =
    hasBody && isPlainObject(effectiveBody) ? JSON.stringify(effectiveBody) : (effectiveBody as any);

  // ✅ Só seta JSON se for plain object (e se ainda não veio Content-Type)
  const headersInput = new Headers(options.headers || {});
  const hasContentType = headersInput.has("Content-Type") || headersInput.has("content-type");

  const shouldSetJson = hasBody && isPlainObject(effectiveBody) && !hasContentType;

  const headers = buildHeaders({
    ...(shouldSetJson ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  });

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers,
    body
  });

  if (isUnauthorized(res)) {
    const payload = await safeReadJson<any>(res);
    const text = payload ? "" : await safeReadText(res);

    // eslint-disable-next-line no-console
    console.error("🔒 API 401:", path, payload || text);

    clearAuth();

    throw new Error(
      payload?.message ||
        payload?.error ||
        "Sessão expirada ou token inválido. Faça login novamente."
    );
  }

  if (!res.ok) {
    const payload = await safeReadJson(res);
    const text = payload ? "" : await safeReadText(res);

    // eslint-disable-next-line no-console
    console.error("❌ API ERROR:", res.status, path, payload || text);

    throw buildApiError(res.status, path, payload, text);
  }

  if (res.status === 204) return null as T;

  const json = await safeReadJson<T>(res);
  if (json !== null) return json;

  const text = await safeReadText(res);
  return text as unknown as T;
}

// ------------------------------------------------------
// REQUEST (FORM DATA)
// ------------------------------------------------------
async function requestForm<T = any>(
  path: string,
  formData: FormData,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    method: options.method || "POST",
    headers: buildHeaders(options.headers),
    body: formData
  });

  if (isUnauthorized(res)) {
    const payload = await safeReadJson<any>(res);
    const text = payload ? "" : await safeReadText(res);

    // eslint-disable-next-line no-console
    console.error("🔒 API FORM 401:", path, payload || text);

    clearAuth();

    throw new Error(
      payload?.message ||
        payload?.error ||
        "Sessão expirada ou token inválido. Faça login novamente."
    );
  }

  if (!res.ok) {
    const payload = await safeReadJson(res);
    const text = payload ? "" : await safeReadText(res);

    // eslint-disable-next-line no-console
    console.error("❌ API FORM ERROR:", res.status, path, payload || text);

    throw buildApiError(res.status, path, payload, text);
  }

  if (res.status === 204) return null as T;

  const json = await safeReadJson<T>(res);
  if (json !== null) return json;

  const text = await safeReadText(res);
  return text as unknown as T;
}

// ------------------------------------------------------
// DOWNLOAD (BLOB)
// ------------------------------------------------------
async function downloadBlob(path: string, filename: string) {
  if (typeof window === "undefined") {
    throw new Error("downloadBlob só pode ser executado no browser");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    credentials: "include",
    headers: buildHeaders()
  });

  if (isUnauthorized(res)) {
    const payload = await safeReadJson<any>(res);
    const text = payload ? "" : await safeReadText(res);

    // eslint-disable-next-line no-console
    console.error("🔒 DOWNLOAD 401:", path, payload || text);

    clearAuth();

    throw new Error(
      payload?.message ||
        payload?.error ||
        "Sessão expirada ou token inválido. Faça login novamente."
    );
  }

  if (!res.ok) {
    const payload = await safeReadJson(res);
    const text = payload ? "" : await safeReadText(res);

    // eslint-disable-next-line no-console
    console.error("❌ DOWNLOAD ERROR:", res.status, path, payload || text);

    throw buildApiError(res.status, path, payload, text);
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  window.URL.revokeObjectURL(url);
}

// ======================================================
// AUTH
// ======================================================
export function setAuthSession(
  data: { token?: string; user?: any; tenant?: any },
  rememberMe: boolean = true
) {
  if (typeof window === "undefined") return;

  const storage = rememberMe ? localStorage : sessionStorage;

  localStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  sessionStorage.removeItem(AUTH_USER_KEY);

  if (data?.token) storage.setItem(AUTH_KEY, String(data.token));
  if (data?.user) {
    const mergedUser = data?.tenant ? { ...data.user, tenant: data.tenant } : data.user;
    storage.setItem(AUTH_USER_KEY, JSON.stringify(mergedUser));
  }
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const data = await request<LoginResponse>("/login", {
    method: "POST",
    body: { email, password }
  });

  if (typeof window !== "undefined") {
    const token = (data as any)?.token;
    const user = (data as any)?.user;
    const tenant = (data as any)?.tenant;

    if (token) {
      localStorage.setItem(AUTH_KEY, String(token));
      sessionStorage.setItem(AUTH_KEY, String(token));
    }

    if (user) {
      const mergedUser = tenant ? { ...user, tenant } : user;
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(mergedUser));
      sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(mergedUser));
    }
  }

  return data;
}

export function logout(): void {
  clearAuth();
}

export function getAuthToken() {
  return getToken();
}

export function getAuthTenantId() {
  return getTenantId();
}

export async function verifyPasswordToken(token: string) {
  return request(`/auth/password/verify?token=${encodeURIComponent(token)}`);
}

export async function setPasswordWithToken(token: string, password: string) {
  return request(`/auth/password/set`, { method: "POST", body: { token, password } });
}

// ======================================================
// ME / TENANT
// ======================================================
export async function fetchMe() {
  return request("/me", { method: "GET" });
}

export async function fetchTenant() {
  return request("/tenant", { method: "GET" });
}

// ======================================================
// SETTINGS — CHANNELS
// ======================================================
export type ChannelStatus = "connected" | "not_connected" | "disconnected" | "disabled" | "soon";

export interface BaseChannelRecord {
  enabled: boolean;
  status: ChannelStatus;
  widgetKey?: string | null;
  pageId?: string | null;
  phoneNumberId?: string | null;
  wabaId?: string | null;
  displayName?: string | null;
  displayPhoneNumber?: string | null;
  hasAccessToken?: boolean;
  config?: any;
  updatedAt?: string;
}

export interface WebchatChannelConfig {
  primaryColor?: string;
  color?: string;
  position?: "left" | "right";
  buttonText?: string;
  title?: string;
  headerTitle?: string;
  greeting?: string;
  allowedOrigins?: string[];
  sessionTtlSeconds?: number;
}

export interface WhatsAppChannelConfig {
  businessName?: string;
  phoneNumber?: string;
  phoneNumberId?: string;
  wabaId?: string;
  webhookVerified?: boolean;
  connectedAt?: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
}

export interface WebchatChannelRecord extends BaseChannelRecord {
  allowedOrigins?: string[];
  config?: WebchatChannelConfig;
  sessionTtlSeconds?: number;
}

export interface WhatsAppChannelRecord extends BaseChannelRecord {
  config?: WhatsAppChannelConfig;
}

export interface MessengerPageItem {
  id: string;
  name: string;
  pictureUrl?: string;
  category?: string;
  pageAccessToken?: string;
}

export interface MessengerChannelConfig {
  subscribedFields?: string[];
  connectedAt?: string;
  graphVersion?: string;
}

export interface MessengerChannelRecord extends BaseChannelRecord {
  config?: MessengerChannelConfig;
}

export interface InstagramChannelConfig {
  instagramBusinessId?: string;
  igUsername?: string;
  subscribedFields?: string[];
  tokenKind?: "page" | "user";
  userTokenExpiresIn?: number | null;
  connectedAt?: string;
  graphVersion?: string;
}

export interface InstagramChannelRecord extends BaseChannelRecord {
  config?: InstagramChannelConfig;
}

export interface ChannelsState {
  whatsapp?: WhatsAppChannelRecord;
  webchat?: WebchatChannelRecord;
  messenger?: MessengerChannelRecord;
  instagram?: InstagramChannelRecord;
}

export async function fetchChannels(): Promise<ChannelsState> {
  const res = await request<any>("/settings/channels");

  if (Array.isArray(res)) {
    const out: ChannelsState = {};
    for (const item of res) {
      const ch = String(item?.channel || item?.id || "").toLowerCase();
      if (!ch) continue;
      (out as any)[ch] = item;
    }
    return out;
  }

  if (res && typeof res === "object" && res.channels && typeof res.channels === "object") {
    return res.channels as ChannelsState;
  }

  return (res || {}) as ChannelsState;
}

export async function updateWebchatChannel(payload: {
  enabled?: boolean;
  allowedOrigins?: string[];
  config?: WebchatChannelConfig;
  sessionTtlSeconds?: number;
}): Promise<WebchatChannelRecord> {
  return request<WebchatChannelRecord>("/settings/channels/webchat", {
    method: "PATCH",
    body: payload
  });
}

export async function rotateWebchatKey(): Promise<{ widgetKey: string }> {
  return request<{ widgetKey: string }>("/settings/channels/webchat/rotate-key", {
    method: "POST"
  });
}

export async function fetchWebchatSnippet(): Promise<{
  ok: boolean;
  enabled: boolean;
  status: ChannelStatus;
  widgetKey: string;
  allowedOrigins: string[];
  sessionTtlSeconds: number;
  snippet?: string;
  scriptTag?: string;
  widgetJsUrl?: string;
}> {
  return request("/settings/channels/webchat/snippet");
}

// WhatsApp Embedded Signup
export async function startWhatsAppEmbeddedSignup(): Promise<{
  appId: string;
  redirectUri?: string;
  state: string;
  scopes: string[];
}> {
  return request("/settings/channels/whatsapp/start", { method: "POST" });
}

export async function finishWhatsAppEmbeddedSignup(payload: {
  code: string;
  state: string;
}): Promise<{ ok: boolean }> {
  return request("/settings/channels/whatsapp/callback", {
    method: "POST",
    body: payload
  });
}

export async function disconnectWhatsAppChannel(): Promise<{ ok: boolean }> {
  return request("/settings/channels/whatsapp", { method: "DELETE" });
}

// Messenger
export async function listMessengerPages(userAccessToken?: string): Promise<{ pages: MessengerPageItem[] }> {
  const tok = String(userAccessToken || "").trim();
  if (!tok) throw new Error("userAccessToken_required");

  return request("/settings/channels/messenger/pages", {
    method: "POST",
    body: { userAccessToken: tok }
  });
}

export async function connectMessengerChannel(payload: {
  pageId: string;
  pageAccessToken: string;
  subscribedFields?: string[];
}): Promise<{ ok: boolean; messenger?: MessengerChannelRecord }> {
  return request("/settings/channels/messenger/connect", { method: "POST", body: payload });
}

export async function disconnectMessengerChannel(): Promise<{ ok: boolean }> {
  return request("/settings/channels/messenger", { method: "DELETE" });
}

// Instagram
export type InstagramPageItem = {
  id: string;
  name: string;
  pictureUrl?: string | null;
  category?: string | null;
};

export async function startInstagramBusinessLogin(): Promise<{
  appId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
  authBaseUrl?: string;
}> {
  return request("/settings/channels/instagram/start", { method: "POST" });
}

export async function finishInstagramBusinessLogin(payload: {
  code: string;
  state: string;
}): Promise<{
  ok: boolean;
  pages?: InstagramPageItem[];
  connectState?: string;
  tokenKind?: "long_lived" | "short_lived" | "page" | "user" | string;
  expiresIn?: number | null;
}> {
  return request("/settings/channels/instagram/callback", { method: "POST", body: payload });
}

export async function connectInstagramChannel(payload: {
  pageId: string;
  connectState: string;
  subscribedFields?: string[];
}): Promise<{ ok: boolean; instagram?: InstagramChannelRecord; resolved?: any }> {
  return request("/settings/channels/instagram/connect", { method: "POST", body: payload });
}

export async function disconnectInstagramChannel(): Promise<{ ok: boolean; instagram?: InstagramChannelRecord }> {
  return request("/settings/channels/instagram", { method: "DELETE" });
}

// Compat aliases
export const startInstagramOAuth = startInstagramBusinessLogin;
export const finishInstagramOAuth = finishInstagramBusinessLogin;

export async function listInstagramPages(userAccessToken: string): Promise<{ pages: InstagramPageItem[] }> {
  const tok = String(userAccessToken || "").trim();
  if (!tok) throw new Error("userAccessToken_required");

  return request("/settings/channels/instagram/pages", { method: "POST", body: { userAccessToken: tok } });
}

// ======================================================
// SETTINGS — USERS
// ======================================================
export type UserRole = "admin" | "manager" | "agent" | "viewer";

export interface UserRecord {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

type UsersListResponse =
  | { data: UserRecord[]; total: number }
  | { items: UserRecord[]; total: number };

export async function fetchUsers(): Promise<{ data: UserRecord[]; total: number }> {
  const res = await request<UsersListResponse>("/settings/users");
  const data = "data" in res ? res.data : (res as any).items;

  return {
    data: Array.isArray(data) ? data : [],
    total: (res as any).total ?? (Array.isArray(data) ? data.length : 0)
  };
}

export async function createUser(payload: {
  name: string;
  email: string;
  role: UserRole;
}): Promise<{ success: boolean; user: UserRecord; token?: { id: string; type: string; expiresAt: string } }> {
  return request("/settings/users", { method: "POST", body: payload });
}

export async function updateUser(
  id: number,
  payload: Partial<Pick<UserRecord, "name" | "role" | "isActive">>
): Promise<{ success: boolean; user: UserRecord }> {
  return request(`/settings/users/${encodeURIComponent(String(id))}`, { method: "PATCH", body: payload });
}

export async function deactivateUser(id: number): Promise<{ success: boolean; user: UserRecord }> {
  return request(`/settings/users/${encodeURIComponent(String(id))}/deactivate`, { method: "PATCH" });
}

export async function activateUser(id: number): Promise<{ success: boolean; user: UserRecord }> {
  return request(`/settings/users/${encodeURIComponent(String(id))}/activate`, { method: "PATCH" });
}

export async function resetUserPassword(id: number): Promise<{
  success: boolean;
  token?: { id: string; type: string; expiresAt: string };
}> {
  return request(`/settings/users/${encodeURIComponent(String(id))}/reset-password`, { method: "POST" });
}

// ======================================================
// SETTINGS — GROUPS
// ======================================================
export interface GroupRecord {
  id: string;
  name: string;
  color?: string;
  slaMinutes?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export async function fetchGroups(params?: { includeInactive?: boolean }): Promise<{ items: GroupRecord[]; total: number }> {
  const qs = buildQuery(params?.includeInactive ? { includeInactive: "true" } : undefined);
  return request(`/settings/groups${qs}`);
}

export async function createGroup(payload: { name: string; color?: string; slaMinutes?: number }): Promise<GroupRecord> {
  return request("/settings/groups", { method: "POST", body: payload });
}

export async function updateGroup(
  id: string,
  payload: Partial<Pick<GroupRecord, "name" | "color" | "slaMinutes">>
): Promise<GroupRecord> {
  return request(`/settings/groups/${encodeURIComponent(id)}`, { method: "PATCH", body: payload });
}

export async function deactivateGroup(id: string): Promise<{ ok: boolean; group: GroupRecord }> {
  return request(`/settings/groups/${encodeURIComponent(id)}/deactivate`, { method: "PATCH" });
}

export async function activateGroup(id: string): Promise<{ ok: boolean; group: GroupRecord }> {
  return request(`/settings/groups/${encodeURIComponent(id)}/activate`, { method: "PATCH" });
}

// ======================================================
// SETTINGS — GROUP MEMBERS
// ======================================================
export type GroupMemberRole = "agent" | "manager";

export interface GroupMemberItem {
  groupId: string;
  userId: number;
  memberRole: GroupMemberRole;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;

  name?: string;
  email?: string;
  userRole?: UserRole;
  userIsActive?: boolean;
}

export async function fetchGroupMembers(
  groupId: string,
  params?: { includeInactive?: boolean }
): Promise<{ items: GroupMemberItem[]; total: number; group?: GroupRecord }> {
  const qs = buildQuery(params?.includeInactive ? { includeInactive: "true" } : undefined);
  return request(`/settings/groups/${encodeURIComponent(groupId)}/members${qs}`);
}

export async function addGroupMember(
  groupId: string,
  payload: { userId: number; role?: GroupMemberRole }
): Promise<{ success: boolean; member: any; user?: any }> {
  return request(`/settings/groups/${encodeURIComponent(groupId)}/members`, { method: "POST", body: payload });
}

export async function updateGroupMember(
  groupId: string,
  userId: number,
  payload: { role?: GroupMemberRole; isActive?: boolean }
): Promise<{ success: boolean; member: any }> {
  return request(
    `/settings/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(String(userId))}`,
    { method: "PATCH", body: payload }
  );
}

export async function deactivateGroupMember(groupId: string, userId: number) {
  return request(
    `/settings/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(String(userId))}/deactivate`,
    { method: "PATCH" }
  );
}

export async function activateGroupMember(groupId: string, userId: number, payload?: { role?: GroupMemberRole }) {
  return request(
    `/settings/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(String(userId))}/activate`,
    { method: "PATCH", body: payload || {} }
  );
}

// ======================================================
// CONVERSAS / MENSAGENS
// ======================================================
export type ConversationKind = "all" | "bot" | "human" | "bot_only" | "human_only";

export type FetchConversationsOptions = {
  status?: ConversationStatus | "all";
  source?: "all" | "whatsapp" | "webchat" | "messenger" | "instagram";
  mode?: "all" | "human" | "bot";
  kind?: ConversationKind;
};

export async function fetchConversations(
  statusOrOpts: ConversationStatus | "all" | FetchConversationsOptions = "open"
): Promise<Conversation[]> {
  const opts: FetchConversationsOptions =
    typeof statusOrOpts === "string" ? { status: statusOrOpts } : statusOrOpts || {};

  const qs = buildQuery({
    status: opts.status ?? "open",
    source: opts.source ?? "all",
    mode: opts.mode ?? "all",
    kind: opts.kind ?? "all"
  });

  const data = await request<any>(`/conversations${qs}`);
  return Array.isArray(data) ? (data as Conversation[]) : [];
}

export async function fetchConversationById(conversationId: string) {
  return request(`/conversations/${encodeURIComponent(conversationId)}`, { method: "GET" });
}

export async function fetchMessages(conversationId: string): Promise<Message[]> {
  const data = await request<any>(`/conversations/${encodeURIComponent(conversationId)}/messages`);
  return Array.isArray(data) ? (data as Message[]) : [];
}

export async function sendTextMessage(conversationId: string, text: string, senderName?: string): Promise<Message> {
  const t = String(text ?? "").trim();
  if (!t) throw new Error("Mensagem vazia.");

  return request(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    body: { text: t, ...(senderName ? { senderName } : {}) }
  });
}

export async function sendMediaMessage(
  conversationId: string,
  payload: { type: string; mediaUrl: string; caption?: string; senderName?: string }
): Promise<Message> {
  const type = String(payload?.type || "text").toLowerCase();
  const mediaUrl = String(payload?.mediaUrl || "").trim();
  const caption = String(payload?.caption || "").trim();

  return request(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    body: {
      type,
      ...(caption ? { text: caption } : {}),
      ...(mediaUrl ? { mediaUrl } : {}),
      ...(payload?.senderName ? { senderName: payload.senderName } : {})
    }
  });
}

export async function sendFileMessage(
  conversationId: string,
  opts: {
    file: File;
    type: "audio" | "image" | "video" | "document" | "sticker" | string;
    caption?: string;
    senderName?: string;
  }
): Promise<Message> {
  const asset = await uploadAsset(opts.file);

  const mediaUrl =
    (asset as any)?.url ||
    (asset as any)?.publicUrl ||
    (asset as any)?.link ||
    (asset as any)?.mediaUrl ||
    (asset as any)?.downloadUrl ||
    "";

  if (!String(mediaUrl).trim()) {
    throw new Error("Upload do arquivo não retornou uma URL pública (url/publicUrl/link).");
  }

  return sendMediaMessage(conversationId, {
    type: String(opts.type || "").toLowerCase(),
    mediaUrl: String(mediaUrl).trim(),
    caption: opts.caption,
    senderName: opts.senderName
  });
}

export async function updateConversationStatus(
  conversationId: string,
  status: ConversationStatus,
  extra?: { tags?: string[] }
): Promise<Conversation> {
  return request(`/conversations/${encodeURIComponent(conversationId)}/status`, {
    method: "PATCH",
    body: { status, ...(extra || {}) }
  });
}

export async function assignConversation(conversationId: string, payload: { userId?: number | null; groupId?: string | null }) {
  return request(`/conversations/${encodeURIComponent(conversationId)}/assign`, {
    method: "PATCH",
    body: payload
  });
}

export async function updateConversationNotes(conversationId: string, notes: string): Promise<Conversation> {
  return request(`/conversations/${encodeURIComponent(conversationId)}/notes`, {
    method: "PATCH",
    body: { notes }
  });
}

// Exports de histórico
export async function downloadConversationCSV(conversationId: string) {
  return downloadBlob(
    `/conversations/${encodeURIComponent(conversationId)}/export.csv`,
    `conversation_${conversationId}.csv`
  );
}

export async function downloadConversationXLSX(conversationId: string) {
  return downloadBlob(
    `/conversations/${encodeURIComponent(conversationId)}/export.xlsx`,
    `conversation_${conversationId}.xlsx`
  );
}

export async function downloadHistoryExcel(params?: {
  kind?: ConversationKind;
  status?: ConversationStatus | "all";
  source?: "all" | "whatsapp" | "webchat" | "messenger" | "instagram";
}) {
  const qs = buildQuery({
    kind: params?.kind ?? "all",
    status: params?.status ?? "all",
    source: params?.source ?? "all"
  });

  return downloadBlob(
    `/conversations/export.xlsx${qs}`,
    `historico_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}

// ======================================================
// OUTBOUND — NÚMEROS
// ======================================================
export async function fetchNumbers(): Promise<PhoneNumberRecord[]> {
  const res = await request<any>("/outbound/numbers");
  return unwrapList<PhoneNumberRecord>(res);
}

export async function syncNumbers(): Promise<{ ok?: boolean; success?: boolean; items?: PhoneNumberRecord[] }> {
  return request("/outbound/numbers/sync", { method: "POST" });
}

// ======================================================
// OUTBOUND — TEMPLATES (WhatsApp)
// ======================================================
export async function fetchTemplates(): Promise<Template[]> {
  const res = await request<any>("/outbound/templates");
  return unwrapList<Template>(res);
}

export async function syncTemplates(): Promise<{ ok?: boolean; success?: boolean; items?: Template[] }> {
  return request("/outbound/templates/sync", { method: "POST" });
}

/**
 * ✅ Backend atual geralmente cria via endpoint próprio (não /sync).
 * - Mantém compat com respostas variáveis.
 */
export async function createTemplate(payload: {
  name: string;
  category: string;
  language: string;
  components: any[];
}): Promise<Template> {
  const res = await request<any>("/outbound/templates", { method: "POST", body: payload });

  if (res?.item) return res.item as Template;
  if (res?.template) return res.template as Template;
  return res as Template;
}

// ======================================================
// OUTBOUND — ASSETS
// ======================================================
export async function fetchAssets(): Promise<MediaItem[]> {
  const data = await request<any>("/outbound/assets");
  return Array.isArray(data) ? (data as MediaItem[]) : unwrapList<MediaItem>(data);
}

export async function uploadAsset(file: File): Promise<MediaItem> {
  const form = new FormData();
  form.append("file", file);
  return requestForm("/outbound/assets/upload", form);
}

export async function deleteAsset(id: string | number): Promise<{ success: boolean }> {
  return request(`/outbound/assets/${encodeURIComponent(String(id))}`, { method: "DELETE" });
}

// ======================================================
// OUTBOUND — CAMPANHAS (WhatsApp) — Compat
// ======================================================
export type CampaignStatus = "draft" | "ready" | "sending" | "done" | "failed";

export interface CampaignAudience {
  fileName?: string | null;
  totalRows?: number;
  validRows?: number;
  invalidRows?: number;
}

export interface CampaignResultItem {
  phone: string;
  status: "sent" | "failed" | "delivered" | "read";
  waMessageId?: string | null;
  updatedAt?: string | null;
  errorCode?: string | number | null;
  errorMessage?: string | null;
  error?: any;
}

export interface CampaignRecord {
  id: string;
  name: string;
  numberId: string;
  templateName: string;
  excludeOptOut?: boolean;
  status: CampaignStatus;
  createdAt: string;
  updatedAt?: string;
  audience?: CampaignAudience;
  results?: CampaignResultItem[];
  logs?: Array<{ at: string; type: string; message: string }>;
}

export async function fetchCampaigns(): Promise<CampaignRecord[]> {
  const data = await request<any>("/outbound/campaigns");
  return Array.isArray(data) ? (data as CampaignRecord[]) : unwrapList<CampaignRecord>(data);
}

export async function fetchCampaignById(campaignId: string): Promise<CampaignRecord> {
  return request(`/outbound/campaigns/${encodeURIComponent(campaignId)}`);
}

export async function createCampaign(payload: {
  name: string;
  numberId: string;
  templateName: string;
  excludeOptOut?: boolean;
}): Promise<CampaignRecord> {
  return request("/outbound/campaigns", { method: "POST", body: payload });
}

export async function uploadCampaignAudience(campaignId: string, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return requestForm(`/outbound/campaigns/${encodeURIComponent(campaignId)}/audience`, fd);
}

export async function startCampaign(campaignId: string): Promise<{ success: boolean; sent?: number; failed?: number }> {
  return request(`/outbound/campaigns/${encodeURIComponent(campaignId)}/start`, { method: "POST" });
}

export async function pauseCampaign(campaignId: string): Promise<{ success: boolean }> {
  return request(`/outbound/campaigns/${encodeURIComponent(campaignId)}/pause`, { method: "PATCH" });
}

export async function resumeCampaign(campaignId: string): Promise<{ success: boolean }> {
  return request(`/outbound/campaigns/${encodeURIComponent(campaignId)}/resume`, { method: "PATCH" });
}

// REPORTS (WhatsApp)
export function metaErrorShortLink(code: string | number) {
  return `${API_BASE}/r/meta-error/${encodeURIComponent(String(code))}`;
}

export async function downloadCampaignReportCSV(campaignId: string) {
  return downloadBlob(
    `/outbound/campaigns/${encodeURIComponent(campaignId)}/report/export.csv`,
    `campaign_${campaignId}.csv`
  );
}

export async function downloadCampaignReportPDF(campaignId: string) {
  return downloadBlob(
    `/outbound/campaigns/${encodeURIComponent(campaignId)}/report/export.pdf`,
    `campaign_${campaignId}.pdf`
  );
}

// ======================================================
// OUTBOUND — OPT-OUT
// ======================================================
export interface OptOutItem {
  id: string;
  phone: string;
  name?: string;
  source: "manual" | "csv" | "whatsapp" | "flow" | "webhook";
  reason?: string;
  createdAt: string;
}

export async function fetchOptOut(params?: {
  page?: number;
  limit?: number;
  search?: string;
  source?: string;
  from?: string;
  to?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.search) qs.set("search", params.search);
  if (params?.source) qs.set("source", params.source);
  if (params?.from) qs.set("from", params.from);
  if (params?.to) qs.set("to", params.to);

  const suffix = qs.toString();
  return request(`/outbound/optout${suffix ? `?${suffix}` : ""}`);
}

export async function createOptOut(payload: { phone: string; name?: string; reason?: string; source?: "manual" }) {
  return request("/outbound/optout", { method: "POST", body: payload });
}

export async function deleteOptOut(id: string) {
  return request(`/outbound/optout/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function importOptOutCSV(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return requestForm("/outbound/optout/import/csv", fd);
}

export async function fetchOptOutWhatsAppContacts() {
  return request("/outbound/optout/whatsapp-contacts");
}

export async function downloadOptOutExport(params?: { search?: string; source?: string; from?: string; to?: string }) {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.source) qs.set("source", params.source);
  if (params?.from) qs.set("from", params.from);
  if (params?.to) qs.set("to", params.to);

  const suffix = qs.toString();
  await downloadBlob(
    `/outbound/optout/export${suffix ? `?${suffix}` : ""}`,
    `optout-${new Date().toISOString().slice(0, 10)}.csv`
  );

  return { success: true };
}

// ======================================================
// SMS TEMPLATES (NOVO)
// ======================================================
export type SmsTemplateStatus = "active" | "inactive" | "archived" | string;

export type SmsTemplateItem = {
  id: string;
  name: string;
  status?: SmsTemplateStatus;
  text?: string;
  message?: string;
  content?: string;
  body?: string;
  metadata?: any;
  createdAt?: string;
  updatedAt?: string;
};

export async function fetchSmsTemplates(params?: { q?: string; status?: string }) {
  const qs = buildQuery({ q: params?.q || "", status: params?.status || "" });
  const res = await request<any>(`/outbound/sms-templates${qs}`, { method: "GET" });
  return unwrapList<SmsTemplateItem>(res);
}

export async function createSmsTemplate(payload: {
  name: string;
  text?: string;
  message?: string;
  status?: SmsTemplateStatus;
  metadata?: any;
}) {
  const body = {
    name: payload.name,
    status: payload.status || "active",
    text: payload.text ?? payload.message ?? "",
    message: payload.message ?? payload.text ?? "",
    metadata: payload.metadata || {}
  };

  return request(`/outbound/sms-templates`, { method: "POST", body });
}

export async function updateSmsTemplate(id: string, payload: Partial<SmsTemplateItem>) {
  const path = `/outbound/sms-templates/${encodeURIComponent(id)}`;
  return requestWithFallback(
    () => request(path, { method: "PATCH", body: payload }),
    [() => request(path, { method: "PUT", body: payload })]
  );
}

export async function deleteSmsTemplate(id: string) {
  const path = `/outbound/sms-templates/${encodeURIComponent(id)}`;
  return requestWithFallback(
    () => request(path, { method: "DELETE" }),
    [() => request(`${path}/delete`, { method: "POST" })]
  );
}

// ======================================================
// SMS CAMPAIGNS
// ======================================================
export type SmsCampaignStatus =
  | "draft"
  | "running"
  | "paused"
  | "canceled"
  | "finished"
  | "failed";

export type SmsCampaignItem = {
  id: string;
  tenantId?: string;
  channel?: "sms" | string;
  name: string;
  status: SmsCampaignStatus | string;

  audience?: any;
  audienceCount?: number;

  metadata?: any;
  stats?: any;

  createdAt?: string;
  updatedAt?: string;
};

export async function fetchSmsCampaigns(): Promise<any> {
  return request(`/outbound/sms-campaigns`, { method: "GET" });
}

export async function createSmsCampaign(payload: { name: string; message: string; metadata?: any }) {
  return request(`/outbound/sms-campaigns`, { method: "POST", body: payload });
}

export async function updateSmsCampaign(
  id: string,
  payload: { name?: string; message?: string; metadata?: any }
) {
  const path = `/outbound/sms-campaigns/${encodeURIComponent(id)}`;
  return requestWithFallback(
    () => request(path, { method: "PATCH", body: payload }),
    [
      () => request(path, { method: "PUT", body: payload }),
      () => request(path, { method: "POST", body: payload })
    ]
  );
}

export async function deleteSmsCampaign(id: string) {
  const path = `/outbound/sms-campaigns/${encodeURIComponent(id)}`;
  return requestWithFallback(
    () => request(path, { method: "DELETE" }),
    [
      () => request(`${path}/delete`, { method: "POST" }),
      () => request(`${path}/cancel`, { method: "PATCH" })
    ]
  );
}

export async function uploadSmsCampaignAudience(id: string, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return requestForm(`/outbound/sms-campaigns/${encodeURIComponent(id)}/audience`, fd);
}

export async function startSmsCampaign(id: string, payload?: { limit?: number }) {
  if (!id) throw new Error("campaign_id_required");
  const body = payload && typeof payload === "object" ? payload : {};
  return request(`/outbound/sms-campaigns/${encodeURIComponent(id)}/start`, { method: "POST", body });
}

export async function pauseSmsCampaign(id: string) {
  return request(`/outbound/sms-campaigns/${encodeURIComponent(id)}/pause`, { method: "PATCH" });
}

export async function resumeSmsCampaign(id: string) {
  return request(`/outbound/sms-campaigns/${encodeURIComponent(id)}/resume`, { method: "PATCH" });
}

export async function cancelSmsCampaign(id: string) {
  return request(`/outbound/sms-campaigns/${encodeURIComponent(id)}/cancel`, { method: "PATCH" });
}

export async function fetchSmsCampaignReport(id: string) {
  return request(`/outbound/sms-campaigns/${encodeURIComponent(id)}/report`, { method: "GET" });
}

export async function downloadSmsCampaignReportCSV(id: string) {
  return downloadBlob(
    `/outbound/sms-campaigns/${encodeURIComponent(id)}/report.csv`,
    `sms_report_${id}.csv`
  );
}

// ======================================================
// COMPAT EXPORTS (nomes antigos)
// ======================================================
export async function downloadConversationHistoryCSV(conversationId: string) {
  return downloadConversationCSV(conversationId);
}

export async function downloadConversationHistoryExcel(conversationId: string) {
  return downloadConversationXLSX(conversationId);
}

// ======================================================
// RAW HELPERS EXPORT (debug/admin)
// ======================================================
export const __internal = {
  API_BASE,
  request,
  requestForm,
  downloadBlob,
  buildHeaders,
  getToken,
  getTenantId
};
