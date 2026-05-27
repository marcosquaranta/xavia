import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { updateRow } from '@/lib/sheets';

export async function POST(req: NextRequest) {
  const admin = await isAdmin();
  if (!admin) return NextResponse.json({ error: 'no_auth' }, { status: 401 });
  try {
    const { email, activo } = await req.json();
    await updateRow('Usuarios', 'email', email, { activo });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
