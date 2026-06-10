import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { readSheet, updateRow } from '@/lib/sheets';
import type { ConfigItem } from '@/lib/types';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { lastA, lastB } = await req.json();
    const config = await readSheet<ConfigItem>('Config');
    const cfgA = config.find(c => c.clave === 'last_factura_a');
    const cfgB = config.find(c => c.clave === 'last_factura_b');
    if (lastA !== undefined && cfgA) await updateRow('Config', 'clave', 'last_factura_a', { valor: Number(lastA) });
    if (lastB !== undefined && cfgB) await updateRow('Config', 'clave', 'last_factura_b', { valor: Number(lastB) });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
