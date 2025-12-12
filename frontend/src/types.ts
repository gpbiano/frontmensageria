// frontend/src/types.ts
// Tipos centrais compartilhados entre App, API, Componentes e Páginas.

/* ============================================================
   CONVERSAS
============================================================ */

export type ConversationStatus = "open" | "closed";

export type ConversationMode = "bot" | "human";

export interface Conversation {
  id: number;
  phone?: string;
  channel?: string;

  status: ConversationStatus;
  currentMode?: ConversationMode;
  botAttempts?: number;

  contactId?: number | null;
  contactName?: string;

  lastMessage?: string;
  tags?: string[];
  notes?: string;

  createdAt?: string;
  updatedAt?: string;

  autoClosed?: boolean;
  closedReason?: string;

  [key: string]: any;
}

/* ============================================================
   MENSAGENS
============================================================ */

export type MessageDirection = "in" | "out";
export type MessageRole = "agent" | "customer" | "bot";

// (opcional) tipos mais comuns do WhatsApp
export type MessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contacts"
  | string;

export interface MessageLocation {
  latitude: number;
  longitude: number;
  name?: string | null;
  address?: string | null;
}

export interface MessageContactPhone {
  phone?: string;
  wa_id?: string;
  type?: string;
}

export interface MessageContact {
  name?: string;
  org?: string;
  phones?: MessageContactPhone[];
}

export interface Message {
  id?: string | number;

  // id da mensagem na Meta (Cloud API)
  waMessageId?: string;

  // seu backend usa direction
  direction?: MessageDirection;

  // compat: algumas telas antigas usavam from
  from?: MessageRole;

  type?: MessageType;

  text?: string;
  caption?: string;

  mediaUrl?: string;

  timestamp?: string | number;

  fromBot?: boolean;

  location?: MessageLocation;

  contact?: MessageContact;

  [key: string]: any;
}

/* ============================================================
   NÚMEROS DE WHATSAPP (WABA PHONE NUMBERS)
============================================================ */

export interface PhoneNumberRecord {
  id?: string | number;

  name: string;
  displayNumber: string;

  // opcional: número "cru"
  number?: string;

  channel?: string;

  quality?: string;
  limitPerDay?: number | null;

  status?: string;
  connected?: boolean;

  updatedAt?: string;

  raw?: any;

  [key: string]: any;
}

/* ============================================================
   LOGIN
============================================================ */

export interface LoginResponse {
  token: string;
  user?: {
    id?: string | number;
    email?: string;
    name?: string;
    [key: string]: any;
  };
}

/* ============================================================
   TEMPLATE COMPONENTS (MODELO DA META)
============================================================ */

export type TemplateButtonType =
  | "QUICK_REPLY"
  | "URL"
  | "PHONE_NUMBER"
  | "FLOW"
  | string;

export interface TemplateComponentButton {
  type?: TemplateButtonType;
  text?: string;

  // URL buttons
  url?: string;
  example?: string[] | any;

  // Phone buttons
  phone_number?: string;

  // Flow buttons
  flow_id?: string;
  button_type?: string;

  [key: string]: any;
}

export type TemplateComponentType =
  | "HEADER"
  | "BODY"
  | "FOOTER"
  | "BUTTONS"
  | "FLOW"
  | string;

export type TemplateHeaderFormat = "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

export interface TemplateComponent {
  type: TemplateComponentType;

  // HEADER content
  format?: TemplateHeaderFormat;
  text?: string;

  // Exemplos obrigatórios quando há variáveis
  example?: {
    header_text?: string[];
    body_text?: string[][];
    url?: string[];
    [key: string]: any;
  };

  // Buttons
  buttons?: TemplateComponentButton[];

  // Flow components
  flow_id?: string;
  flow_action?: string;

  [key: string]: any;
}

/* ============================================================
   TEMPLATE COMPLETO (META)
============================================================ */

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION" | string;

export type TemplateStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "PAUSED"
  | string;

export interface Template {
  id: string | number;
  name: string;

  category?: TemplateCategory;
  language?: string; // pt_BR, en_US, etc.

  status?: TemplateStatus;
  rejectedReason?: string | null;

  quality?: string | null;

  hasFlow?: boolean;

  components?: TemplateComponent[];

  latestVersion?: any;

  updatedAt?: string;
  createdAt?: string;
  createdFromPlatform?: boolean;

  raw?: any;

  [key: string]: any;
}

/* ============================================================
   MEDIA LIBRARY
============================================================ */

export type MediaType = "image" | "video" | "document" | string;

export interface MediaItem {
  id: string | number;
  label: string;
  type: MediaType;
  url: string;

  createdAt?: string;

  raw?: any;

  [key: string]: any;
}
/* ============================================================
   OUTBOUND – OPT-OUT (Blacklist)
============================================================ */

export type OptOutSource = "manual" | "csv" | "whatsapp" | "flow" | "webhook";

export interface OptOutItem {
  id: string;
  phone: string; // normalizado (ex: 55DDDNUMERO)
  name?: string | null;
  source: OptOutSource;
  sourceRef?: string | null;
  reason?: string | null;
  createdAt: string;

  [key: string]: any;
}

export interface OptOutListResponse {
  page: number;
  limit: number;
  total: number;
  items: OptOutItem[];
}

export interface WhatsAppContactLite {
  phone: string; // normalizado
  name?: string | null;

  [key: string]: any;
}
