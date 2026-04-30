// app/layout.tsx
// Layout raíz de la aplicación.

import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'XaviaApp · Gestión de cultivos hidropónicos',
  description: 'Sistema de gestión integral para cultivos hidropónicos',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
