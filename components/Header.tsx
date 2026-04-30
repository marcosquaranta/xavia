// components/Header.tsx
// Header con logo, menú y datos del usuario.
// El menú varía según el rol: admin ve "Alertas" y "Admin", usuario no.

import Link from 'next/link';
import type { UsuarioPublico } from '@/lib/types';

export default function Header({
  user,
  current,
}: {
  user: UsuarioPublico;
  current?: string;
}) {
  const isAdmin = user.rol === 'admin';
  const items = [
    { href: '/panel', label: 'Panel', key: 'panel' },
    { href: '/cultivos', label: 'Mis Cultivos', key: 'cultivos' },
    { href: '/ocupacion', label: 'Ocupación', key: 'ocupacion' },
    { href: '/estadisticas', label: 'Estadísticas', key: 'estadisticas' },
  ];
  if (isAdmin) {
    items.push({ href: '/alertas', label: 'Alertas', key: 'alertas' });
    items.push({ href: '/admin', label: 'Admin', key: 'admin' });
  }

  return (
    <div className="topbar">
      <Link
        href="/panel"
        className="logo"
        style={{ textDecoration: 'none', color: '#111827' }}
      >
        <span className="logo-box">X</span>
        <span style={{ fontSize: '15px' }}>XaviaApp</span>
      </Link>

      <nav className="topbar-menu">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={current === item.key ? 'current' : ''}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="topbar-user">
        <span>
          {user.nombre} <span style={{ opacity: 0.6 }}>·</span>{' '}
          <span style={{ fontSize: '11px', color: '#9ca3af' }}>{user.rol}</span>
        </span>
        <form action="/api/auth/logout" method="POST">
          <button type="submit">Salir</button>
        </form>
      </div>
    </div>
  );
}
