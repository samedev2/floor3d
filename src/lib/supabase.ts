/**
 * Supabase Integration for Floor3D
 *
 * - Auth: email/password (cada usuário tem sua biblioteca)
 * - Database: salva plantas processadas na nuvem
 * - Storage: (opcional) guarda imagens originais
 *
 * Credenciais são configuradas pelo usuário em Configurações
 */

import { createClient, SupabaseClient, Session, User } from '@supabase/supabase-js';

const CONFIG_KEY = 'floorvision_supabase_config';
const SESSION_KEY = 'floorvision_supabase_session';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export interface SavedPlant {
  id?: string;
  user_id?: string;
  name: string;
  image_data?: string;
  width_meters: number;
  depth_meters: number;
  total_area: number;
  total_walls: number;
  total_rooms: number;
  walls: any[]; // JSON
  rooms: any[]; // JSON
  created_at?: string;
  updated_at?: string;
}

export function getConfig(): SupabaseConfig | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setConfig(cfg: SupabaseConfig) {
  window.localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

export function clearConfig() {
  window.localStorage.removeItem(CONFIG_KEY);
}

let client: SupabaseClient | null = null;
let currentConfig: SupabaseConfig | null = null;

export function getClient(): SupabaseClient | null {
  const cfg = getConfig();
  if (!cfg || !cfg.url || !cfg.anonKey) return null;

  if (client && currentConfig?.url === cfg.url && currentConfig?.anonKey === cfg.anonKey) {
    return client;
  }

  client = createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: SESSION_KEY,
    },
  });
  currentConfig = cfg;
  return client;
}

export function getCurrentSession(): { session: Session | null; user: User | null } {
  const c = getClient();
  if (!c) return { session: null, user: null };
  // Síncrono - tenta pegar do storage
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return { session: null, user: null };
    const session = JSON.parse(raw) as Session;
    return { session, user: session.user as User };
  } catch {
    return { session: null, user: null };
  }
}

export async function signUp(email: string, password: string): Promise<{ user: User | null; error: string | null }> {
  const c = getClient();
  if (!c) return { user: null, error: 'Supabase não configurado' };
  const { data, error } = await c.auth.signUp({ email, password });
  if (error) return { user: null, error: error.message };
  return { user: data.user, error: null };
}

export async function signIn(email: string, password: string): Promise<{ user: User | null; error: string | null }> {
  const c = getClient();
  if (!c) return { user: null, error: 'Supabase não configurado' };
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) return { user: null, error: error.message };
  return { user: data.user, error: null };
}

export async function signOut(): Promise<{ error: string | null }> {
  const c = getClient();
  if (!c) return { error: null };
  const { error } = await c.auth.signOut();
  return { error: error?.message || null };
}

export async function getCurrentUser(): Promise<User | null> {
  const c = getClient();
  if (!c) return null;
  const { data } = await c.auth.getUser();
  return data.user;
}

// ============================================
// PLANTS CRUD
// ============================================
export async function listPlants(): Promise<SavedPlant[]> {
  const c = getClient();
  if (!c) return [];
  const user = await getCurrentUser();
  if (!user) return [];

  const { data, error } = await c
    .from('plants')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('listPlants error:', error);
    return [];
  }
  return data || [];
}

export async function savePlant(plant: SavedPlant): Promise<SavedPlant | null> {
  const c = getClient();
  if (!c) return null;
  const user = await getCurrentUser();
  if (!user) return null;

  const record = {
    ...plant,
    user_id: user.id,
    updated_at: new Date().toISOString(),
  };

  if (plant.id) {
    const { data, error } = await c
      .from('plants')
      .update(record)
      .eq('id', plant.id)
      .eq('user_id', user.id)
      .select()
      .single();
    if (error) {
      console.error('savePlant update error:', error);
      return null;
    }
    return data;
  } else {
    const { data, error } = await c
      .from('plants')
      .insert(record)
      .select()
      .single();
    if (error) {
      console.error('savePlant insert error:', error);
      return null;
    }
    return data;
  }
}

export async function deletePlant(id: string): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  const user = await getCurrentUser();
  if (!user) return false;

  const { error } = await c
    .from('plants')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  return !error;
}

export async function getPlant(id: string): Promise<SavedPlant | null> {
  const c = getClient();
  if (!c) return null;
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await c
    .from('plants')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error) return null;
  return data;
}

// ============================================
// HEALTH CHECK
// ============================================
export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  const c = getClient();
  if (!c) return { ok: false, error: 'Configuração ausente' };
  try {
    const { error } = await c.from('plants').select('count', { count: 'exact', head: true });
    if (error) {
      // Tabela não existe ainda
      if (error.message.includes('does not exist') || error.code === '42P01') {
        return { ok: false, error: 'Tabela "plants" não existe. Crie no SQL Editor.' };
      }
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message || 'Erro desconhecido' };
  }
}
