// frontend/src/types.ts
// Tipos centrais compartilhados entre App, API, Componentes e Páginas.

/* ============================================================
   CONVERSAS
============================================================ */

export type ConversationStatus = "open" | "closed";

export interface Conversation {
  id: number;
  status: ConversationStatus;
  currentMode?: "bot" | "human";
  botAttempts?: number;
  updatedAt?: string;

  [key: string]: any;
}

/* ============================================================
   MENSAGENS (TEXT, MEDIA, LOCATION, CONTACT, FLOW, ETC.)
============================================================ */

export interface Message {
  id?: string | number;
  waMessageId?: string;
  from?: "agent" | "customer" | "bot";

  text?: string;
  type?: string; 
  mediaUrl?: string;
  timestamp?: string | number;

  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };

  contact?: {
    name?: string;
    org?: string;
    phones?: {
      phone?: string;
      wa_id?: string;
      type?: string;
    }[];
  };

  [key: string]: any;
}

/* ============================================================
   NÚMEROS DE WHATSAPP (WABA PHONE NUMBERS)
============================================================ */

export interface PhoneNumberRecord {
  id?: string | number;

  name: string;
  displayNumber: string;
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

// -----------------------------
// Botões de template
// -----------------------------
export interface TemplateComponentButton {
  type?: "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "FLOW" | string;
  text?: string;

  // URL buttons
  url?: string;
  example?: string[] | any;

  // Phone buttons
  phone_number?: string;

  // Flow buttons
  flow_id?: string;
  button_type?: string; // variações da Meta

  [key: string]: any;
}

// -----------------------------
// Componentes (HEADER, BODY, FOOTER, BUTTONS)
// -----------------------------
export interface TemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS" | "FLOW" | string;

  // HEADER content
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
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

export interface Template {
  id: string | number;
  name: string;

  category?: "MARKETING" | "UTILITY" | "AUTHENTICATION" | string;
  language?: string; // pt_BR, en_US, etc.

  status?: "PENDING" | "APPROVED" | "REJECTED" | "PAUSED" | string;
  rejectedReason?: string | null;

  quality?: string | null; // HIGH, MEDIUM, LOW, GREEN, YELLOW, RED...

  hasFlow?: boolean;

  // Conteúdo principal
  components?: TemplateComponent[];

  // Última versão retornada pela Meta
  latestVersion?: any;

  // Metadata local
  updatedAt?: string;
  createdFromPlatform?: boolean;

  // Payload original
  raw?: any;

  [key: string]: any;
}

/* ============================================================
   MEDIA LIBRARY
============================================================ */

export interface MediaItem {
  id: string | number;
  label: string;
  type: "image" | "video" | "document" | string;
  url: string;
  createdAt?: string;

  raw?: any;

  [key: string]: any;
}
