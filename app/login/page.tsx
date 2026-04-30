// app/login/page.tsx
// Pantalla de login.

import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import LoginForm from './LoginForm';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  // Si ya está logueado, mandalo al panel
  const user = await getCurrentUser();
  if (user) redirect('/panel');

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #d1fae5 0%, #f3f4f6 100%)',
        padding: '20px',
      }}
    >
      <div
        style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          padding: '32px',
          width: '100%',
          maxWidth: '380px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
        }}
      >
        <div
          className="logo"
          style={{ marginBottom: '24px', justifyContent: 'center' }}
        >
          <span className="logo-box">X</span>
          <span style={{ fontSize: '20px' }}>XaviaApp</span>
        </div>

        <h1
          style={{
            margin: '0 0 6px',
            fontSize: '20px',
            fontWeight: 600,
            textAlign: 'center',
          }}
        >
          Ingresar
        </h1>
        <p
          style={{
            margin: '0 0 24px',
            fontSize: '13px',
            color: '#6b7280',
            textAlign: 'center',
          }}
        >
          Gestión de cultivos hidropónicos
        </p>

        {searchParams.error === 'invalid' && (
          <div className="alert-box error" style={{ marginBottom: '14px' }}>
            Email o contraseña incorrectos.
          </div>
        )}

        <LoginForm />

        <p
          style={{
            margin: '20px 0 0',
            fontSize: '11px',
            color: '#9ca3af',
            textAlign: 'center',
          }}
        >
          ¿Olvidaste tu contraseña? Pedísela al administrador.
        </p>
      </div>
    </div>
  );
}
