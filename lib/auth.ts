// lib/auth.ts
// Manejo de sesiones y autenticación con iron-session.

import { getIronSession, SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { readSheet } from './sheets';
import type { Usuario, UsuarioPublico, Rol } from './types';

export interface SessionData {
  email?: string;
  rol?: Rol;
  nombre?: string;
  loggedIn: boolean;
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET || 'fallback_dev_secret_min_32_chars_long_x',
  cookieName: 'xaviaapp_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 días
  },
};

/**
 * Lee la sesión actual desde las cookies.
 */
export async function getSession() {
  return await getIronSession<SessionData>(cookies(), sessionOptions);
}

/**
 * Devuelve el usuario logueado o null si no hay sesión activa.
 */
export async function getCurrentUser(): Promise<UsuarioPublico | null> {
  const session = await getSession();
  if (!session.loggedIn || !session.email || !session.rol || !session.nombre) {
    return null;
  }
  return {
    email: session.email,
    rol: session.rol,
    nombre: session.nombre,
  };
}

/**
 * Verifica si el usuario actual es admin.
 */
export async function isAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  return user?.rol === 'admin';
}

/**
 * Intenta autenticar a un usuario contra el Sheet.
 * Devuelve el usuario público si las credenciales son válidas, null si no.
 */
export async function authenticate(
  email: string,
  password: string
): Promise<UsuarioPublico | null> {
  if (!email || !password) return null;

  const usuarios = await readSheet<Usuario>('Usuarios');
  const user = usuarios.find(
    (u) => u.email.toLowerCase().trim() === email.toLowerCase().trim() && u.activo === 'SI'
  );

  if (!user) return null;
  if (!user.password_hash || user.password_hash === 'PENDIENTE_GENERAR_DESDE_APP') {
    return null;
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;

  return {
    email: user.email,
    rol: user.rol,
    nombre: user.nombre,
  };
}

/**
 * Genera un hash bcrypt de una contraseña. Útil para crear usuarios.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}
