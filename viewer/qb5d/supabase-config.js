// =====================================================================
// QB5D — supabase-config.js
// Config do Supabase self-hosted (Hostinger) usado para PERSISTIR as plantas
// enviadas ao sistema (SVG detectado ou planta traçada).
//
// A chave "anon" é de CLIENTE por design — pode ficar no front-end; os dados
// são protegidos por Row Level Security no servidor. Este arquivo vai para o
// repositório e para o navegador.
//
// ATENÇÃO: a URL abaixo é http:// (sem TLS). Em rede não confiável, a chave e
// os dados trafegam em texto claro — o ideal é colocar HTTPS na frente.
//
// Para DESLIGAR a persistência: deixe SUPABASE_URL como "".
// =====================================================================

export const SUPABASE_URL =
  "http://supabasekong-csg7lhcc5ngxt7yrbw40u1tr.2.25.92.118.sslip.io";

export const SUPABASE_ANON_KEY =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc4NzkxOTYwMCwiZXhwIjo0OTQzNTkzMjAwLCJyb2xlIjoiYW5vbiJ9.8JEGrWEOCZ9VPuzF-b5hoVjLaAZwQoh_4leWchmM_5Y";

// Tabela dedicada (não colide com a `plants` que já existe na instância).
export const PLANS_TABLE = "qb5d_plans";
