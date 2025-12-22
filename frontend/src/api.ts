// frontend/src/api.ts
// Central de chamadas da API da plataforma GP Labs

import type {
  Conversation,
  ConversationStatus,
  LoginResponse,
  MediaItem,
  Message,
  PhoneNumberRecord,
  Template
} from "./types";

/**
 * Base da API
 * Compatível com:
 * - VITE_API_BASE (padrão)
 * - VITE_API_BASE_URL (fallback)
 * - localhost (dev)
 */
const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3010";

const AUTH_KEY = "gpLabsAuthToken";
const AUTH_USER_KEY = "gpLabsAuthUser";

// ======================================================
// HELPERS DE AUTENTICAÇÃO (FIX DEFINITIVO)
// ======================================================

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

  // prioridade: localStorage → sessionStorage
  return (
    safeParseJson(localStorage.getItem(AUTH_USER_KEY)) ||
    safeParseJson(sessionStorage.getItem(AUTH_USER_KEY))
  );
}

/**
 * ✅ TenantId:
 * - vem dentro do user salvo no storage (gpLabsAuthUser)
 * - formatos aceitos:
 *   - user.tenantId
 *   - user.tenants[0].tenantId
 *   - user.tenants[0].tenant.id
 *   - user.tenant.id
 */
function getTenantId(): string | null {
  const u = getAuthUser();
  if (!u) return null;

  const direct =
    u.tenantId ||
    u?.tenant?.id ||
    u?.tenants?.[0]?.tenantId ||
    u?.tenants?.[0]?.tenant?.id;

  return direct ? String(direct) : null;
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;

  // 🔐 prioridade: localStorage → sessionStorage
  const token =
    localStorage.getItem(AUTH_KEY) || sessionStorage.getItem(AUTH_KEY);

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
 * - Injeta x-tenant-id automaticamente (resolve "Token sem tenantId").
 * - Não sobrescrever Content-Type automaticamente se for FormData.
 * - Merge previsível (HeadersInit pode ser várias formas).
 */
function buildHeaders(extra?: HeadersInit): HeadersInit {
  const token = getToken();
  const tenantId = getTenantId();

  // Normaliza extra -> objeto simples
  const normalized: Record<string, string> = {};
  if (extra) {
    const h = new Headers(extra);
    h.forEach((v, k) => {
      normalized[k] = v;
    });
  }

  // Remove Authorization vindo de fora (case-insensitive)
  Object.keys(normalized).forEach((k) => {
    if (k.toLowerCase() === "authorization") delete normalized[k];
  });

  // Se já vier x-tenant-id no extra, respeita; senão injeta do storage
  const hasTenantHeader = Object.keys(normalized).some(
    (k) => k.toLowerCase() === "x-tenant-id"
  );

  return {
    ...normalized,
    ...(tenantId && !hasTenantHeader ? { "x-tenant-id": tenantId } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

// ======================================================
// HELPERS INTERNOS
// ======================================================

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

// ======================================================
// HELPER FETCH (JSON / TEXT / NO CONTENT)
// ======================================================

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  // ======================================================
  // ✅ FIX GLOBAL: garante "text" em /messages (evita "text obrigatório")
  // ======================================================
  let effectiveBody: any = options.body;

  const isMessagesEndpoint = /\/messages(\?|$)/.test(path);

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

    const hasText =
      b.text !== undefined &&
      b.text !== null &&
      String(b.text).trim() !== "";

    if (!hasText && candidate !== null && String(candidate).trim() !== "") {
      effectiveBody = { ...b, text: String(candidate).trim() };
    }
  }

  const hasBody = effectiveBody !== undefined && effectiveBody !== null;

  // Se já veio string/FormData/etc, respeita.
  const body =
    hasBody && isPlainObject(effectiveBody)
      ? JSON.stringify(effectiveBody)
      : (effectiveBody as any);

  const shouldSetJson =
    hasBody &&
    isPlainObject(effectiveBody) &&
    // se alguém já mandou Content-Type no header, respeita
    !new Headers(options.headers || {}).has("Content-Type");

  const headers = buildHeaders({
    ...(shouldSetJson ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  });

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    // ✅ importante: se no futuro o backend usar cookie, isso não quebra
    credentials: "include",
    headers,
    body
  });

  // ✅ 401: limpa token (sessão inválida)
  if (isUnauthorized(res)) {
    const payload = await safeReadJson<any>(res);
    const text = payload ? "" : await safeReadText(res);

    console.error("🔒 API 401:", path, payload || text);

    // só limpa auth depois de logar, pra debug ficar claro
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
    console.error("❌ API ERROR:", res.status, path, payload || text);
    throw buildApiError(res.status, path, payload, text);
  }

  // ✅ suporte a 204 No Content
  if (res.status === 204) return null as T;

  // ✅ tenta JSON, se não der, devolve texto
  const json = await safeReadJson<T>(res);
  if (json !== null) return json;

  const text = await safeReadText(res);
  return text as unknown as T;
}

// ======================================================
// HELPER FETCH FORM-DATA (UPLOAD)
// ======================================================

async function requestForm<T = any>(
  path: string,
  formData: FormData,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    method: options.method || "POST",
    headers: buildHeaders(options.headers), // NÃO seta Content-Type aqui (boundary)
    body: formData
  });

  if (isUnauthorized(res)) {
    const payload = await safeReadJson<any>(res);
    const text = payload ? "" : await safeReadText(res);
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
    console.error("❌ API FORM ERROR:", res.status, path, payload || text);
    throw buildApiError(res.status, path, payload, text);
  }

  if (res.status === 204) return null as T;

  const json = await safeReadJson<T>(res);
  if (json !== null) return json;

  const text = await safeReadText(res);
  return text as unknown as T;
}

// ======================================================
// HELPER DOWNLOAD (BLOB)
// ======================================================

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

/**
 * ✅ Use isso no LoginPage se quiser centralizar o storage:
 * setAuthSession({ token, user }, rememberMe)
 */
export function setAuthSession(
  data: { token?: string; user?: any },
  rememberMe: boolean = true
) {
  if (typeof window === "undefined") return;

  const storage = rememberMe ? localStorage : sessionStorage;

  // limpa os dois sempre (evita mismatch)
  localStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  sessionStorage.removeItem(AUTH_USER_KEY);

  if (data?.token) storage.setItem(AUTH_KEY, String(data.token));
  if (data?.user) storage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const data = await request<LoginResponse>("/login", {
    method: "POST",
    body: { email, password }
  });

  // ✅ grava token + user no localStorage (padrão)
  // (se teu LoginPage já controla rememberMe, chama setAuthSession lá com rememberMe)
  if (typeof window !== "undefined") {
    if ((data as any)?.token) {
      localStorage.setItem(AUTH_KEY, String((data as any).token));
      sessionStorage.setItem(AUTH_KEY, String((data as any).token));
    }
    if ((data as any)?.user) {
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify((data as any).user));
      sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify((data as any).user));
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

// (PÚBLICO) Criar senha por token (invite/reset)
export async function verifyPasswordToken(token: string) {
  return request(`/auth/password/verify?token=${encodeURIComponent(token)}`);
}

export async function setPasswordWithToken(token: string, password: string) {
  return request(`/auth/password/set`, {
    method: "POST",
    body: { token, password }
  });
}

// ======================================================
// SETTINGS — CHANNELS (Configurações → Canais)
// ======================================================

export type ChannelStatus = "connected" | "not_connected" | "soon";

export interface WebchatChannelConfig {
  primaryColor?: string; // compat front
  color?: string; // compat backend
  position?: "left" | "right";
  buttonText?: string;
  title?: string;
  greeting?: string;
}

export interface WebchatChannelRecord {
  enabled: boolean;
  status: ChannelStatus;
  widgetKey?: string;
  allowedOrigins?: string[];
  config?: WebchatChannelConfig;
  sessionTtlSeconds?: number;
  updatedAt?: string;
}

export interface ChannelsState {
  whatsapp?: { enabled: boolean; status: ChannelStatus; updatedAt?: string };
  webchat?: WebchatChannelRecord;
  messenger?: { enabled: boolean; status: ChannelStatus; updatedAt?: string };
  instagram?: { enabled: boolean; status: ChannelStatus; updatedAt?: string };
}

export async function fetchChannels(): Promise<ChannelsState> {
  const res = await request<{ channels: ChannelsState }>("/settings/channels");
  return (res?.channels || {}) as ChannelsState;
}

export async function updateWebchatChannel(payload: {
  enabled?: boolean;
  allowedOrigins?: string[];
  config?: WebchatChannelConfig;
  sessionTtlSeconds?: number;
}): Promise<{ ok: boolean; webchat: WebchatChannelRecord }> {
  return request<{ ok: boolean; webchat: WebchatChannelRecord }>(
    "/settings/channels/webchat",
    { method: "PATCH", body: payload }
  );
}

export async function rotateWebchatKey(): Promise<{ ok: boolean; widgetKey: string }> {
  return request<{ ok: boolean; widgetKey: string }>(
    "/settings/channels/webchat/rotate-key",
    { method: "POST" }
  );
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

// ======================================================
// SETTINGS — USERS (Configurações → Usuários)
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
  const data = "data" in res ? res.data : res.items;
  return {
    data: Array.isArray(data) ? data : [],
    total: (res as any).total ?? (Array.isArray(data) ? data.length : 0)
  };
}

export async function createUser(payload: {
  name: string;
  email: string;
  role: UserRole;
}): Promise<{
  success: boolean;
  user: UserRecord;
  token?: { id: string; type: string; expiresAt: string };
}> {
  return request("/settings/users", { method: "POST", body: payload });
}

export async function updateUser(
  id: number,
  payload: Partial<Pick<UserRecord, "name" | "role" | "isActive">>
): Promise<{ success: boolean; user: UserRecord }> {
  return request(`/settings/users/${encodeURIComponent(String(id))}`, {
    method: "PATCH",
    body: payload
  });
}

export async function deactivateUser(id: number): Promise<{ success: boolean; user: UserRecord }> {
  return request(`/settings/users/${encodeURIComponent(String(id))}/deactivate`, {
    method: "PATCH"
  });
}

export async function resetUserPassword(
  id: number
): Promise<{ success: boolean; token?: { id: string; type: string; expiresAt: string } }> {
  return request(`/settings/users/${encodeURIComponent(String(id))}/reset-password`, {
    method: "POST"
  });
}

// ======================================================
// SETTINGS — GROUPS (Configurações → Grupos)
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

export async function fetchGroups(params?: {
  includeInactive?: boolean;
}): Promise<{ items: GroupRecord[]; total: number }> {
  const qs = buildQuery(params?.includeInactive ? { includeInactive: "true" } : undefined);
  return request(`/settings/groups${qs}`);
}

export async function createGroup(payload: {
  name: string;
  color?: string;
  slaMinutes?: number;
}): Promise<GroupRecord> {
  return request("/settings/groups", { method: "POST", body: payload });
}

export async function updateGroup(
  id: string,
  payload: Partial<Pick<GroupRecord, "name" | "color" | "slaMinutes">>
): Promise<GroupRecord> {
  return request(`/settings/groups/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: payload
  });
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
  return request(`/settings/groups/${encodeURIComponent(groupId)}/members`, {
    method: "POST",
    body: payload
  });
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

export async function deactivateGroupMember(
  groupId: string,
  userId: number
): Promise<{ success: boolean; member: any }> {
  return request(
    `/settings/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(String(userId))}/deactivate`,
    { method: "PATCH" }
  );
}

export async function activateGroupMember(
  groupId: string,
  userId: number,
  payload?: { role?: GroupMemberRole }
): Promise<{ success: boolean; member: any }> {
  return request(
    `/settings/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(String(userId))}/activate`,
    { method: "PATCH", body: payload || {} }
  );
}

// ======================================================
// CONVERSAS
// ======================================================

export type ConversationKind = "all" | "bot" | "human" | "bot_only" | "human_only";

export type FetchConversationsOptions = {
  status?: ConversationStatus | "all";
  source?: "all" | "whatsapp" | "webchat";
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

export async function fetchMessages(conversationId: string): Promise<Message[]> {
  const data = await request<any>(`/conversations/${encodeURIComponent(conversationId)}/messages`);
  return Array.isArray(data) ? (data as Message[]) : [];
}

/**
 * ✅ IMPORTANTE (p/ seu erro "text obrigatório"):
 * O backend valida "text" como obrigatório para mensagens de texto.
 * Então SEMPRE enviamos "text".
 */
export async function sendTextMessage(
  conversationId: string,
  text: string,
  senderName?: string
): Promise<Message> {
  const t = String(text ?? "").trim();
  if (!t) throw new Error("Mensagem vazia.");

  return request(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    body: {
      text: t,
      ...(senderName ? { senderName } : {})
    }
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
  const file = opts.file;
  const type = String(opts.type || "").toLowerCase();

  const asset = await uploadAsset(file);

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
    type,
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

export async function updateConversationNotes(
  conversationId: string,
  notes: string
): Promise<Conversation> {
  return request(`/conversations/${encodeURIComponent(conversationId)}/notes`, {
    method: "PATCH",
    body: { notes }
  });
}

// ======================================================
// EXPORTS — HISTÓRICO (CSV / EXCEL)
// ======================================================

export async function downloadConversationCSV(conversationId: string) {
  return downloadBlob(
    `/conversations/${encodeURIComponent(conversationId)}/export.csv`,
    `conversation_${conversationId}.csv`
  );
}

export async function downloadHistoryExcel(params?: {
  kind?: ConversationKind;
  status?: ConversationStatus | "all";
  source?: "all" | "whatsapp" | "webchat";
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
  const data = await request<any>("/outbound/numbers");
  return Array.isArray(data) ? (data as PhoneNumberRecord[]) : [];
}

export async function syncNumbers(): Promise<{ success: boolean }> {
  return request("/outbound/numbers/sync", { method: "POST" });
}

// ======================================================
// OUTBOUND — TEMPLATES
// ======================================================

export async function fetchTemplates(): Promise<Template[]> {
  const data = await request<any>("/outbound/templates");
  return Array.isArray(data) ? (data as Template[]) : [];
}

export async function syncTemplates(): Promise<{ success: boolean }> {
  return request("/outbound/templates/sync", { method: "POST" });
}

export async function createTemplate(payload: {
  name: string;
  category: string;
  language: string;
  components: any[];
}): Promise<Template> {
  const res = await request<any>("/outbound/templates", {
    method: "POST",
    body: payload
  });

  if (res?.template) return res.template as Template;
  return res as Template;
}

// ======================================================
// OUTBOUND — ASSETS (ARQUIVOS)
// ======================================================

export async function fetchAssets(): Promise<MediaItem[]> {
  const data = await request<any>("/outbound/assets");
  return Array.isArray(data) ? (data as MediaItem[]) : [];
}

export async function uploadAsset(file: File): Promise<MediaItem> {
  const form = new FormData();
  form.append("file", file);
  return requestForm("/outbound/assets/upload", form);
}

export async function deleteAsset(id: string | number): Promise<{ success: boolean }> {
  return request(`/outbound/assets/${encodeURIComponent(String(id))}`, {
    method: "DELETE"
  });
}

// ======================================================
// OUTBOUND — CAMPANHAS
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
  return Array.isArray(data) ? (data as CampaignRecord[]) : [];
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

export async function startCampaign(
  campaignId: string
): Promise<{ success: boolean; sent?: number; failed?: number }> {
  return request(`/outbound/campaigns/${encodeURIComponent(campaignId)}/start`, {
    method: "POST"
  });
}

export async function pauseCampaign(campaignId: string): Promise<{ success: boolean }> {
  return request(`/outbound/campaigns/${encodeURIComponent(campaignId)}/pause`, {
    method: "PATCH"
  });
}

export async function resumeCampaign(campaignId: string): Promise<{ success: boolean }> {
  return request(`/outbound/campaigns/${encodeURIComponent(campaignId)}/resume`, {
    method: "PATCH"
  });
}

export async function fetchCampaignById(campaignId: string): Promise<CampaignRecord> {
  return request(`/outbound/campaigns/${encodeURIComponent(campaignId)}`);
}

// ======================================================
// CAMPAIGNS — REPORT / EXPORTS
// ======================================================

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

export async function createOptOut(payload: {
  phone: string;
  name?: string;
  reason?: string;
  source?: "manual";
}) {
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

export async function downloadOptOutExport(params?: {
  search?: string;
  source?: string;
  from?: string;
  to?: string;
}) {
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

// ============================
// SMS CAMPAIGNS (IAGENTE)
// ============================

export async function fetchSmsCampaigns() {
  return request(`/outbound/sms-campaigns`, { method: "GET" });
}

export async function createSmsCampaign(payload: { name: string; message: string }) {
  return request(`/outbound/sms-campaigns`, { method: "POST", body: payload });
}

export async function uploadSmsCampaignAudience(id: string, file: File) {
  const csvText = await file.text();

  return request(`/outbound/sms-campaigns/${encodeURIComponent(id)}/audience`, {
    method: "POST",
    body: { csvText }
  });
}

export async function startSmsCampaign(id: string) {
  return request(`/outbound/sms-campaigns/${encodeURIComponent(id)}/start`, {
    method: "POST"
  });
}

export async function fetchSmsCampaignReport(id: string) {
  return request(`/outbound/sms-campaigns/${encodeURIComponent(id)}/report`, {
    method: "GET"
  });
}

// ======================================================
// ALIASES (compat com imports antigos do front)
// ======================================================

export async function downloadConversationHistoryCSV(conversationId: string) {
  return downloadConversationCSV(conversationId);
}

// ⚠️ bug antigo: Excel estava apontando pro CSV
export async function downloadConversationHistoryExcel(conversationId: string) {
  return downloadBlob(
    `/conversations/${encodeURIComponent(conversationId)}/export.xlsx`,
    `conversation_${conversationId}.xlsx`
  );
}
