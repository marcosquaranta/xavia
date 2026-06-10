# XaviaApp

Gestión integral de cultivos hidropónicos · v1.0

App web para gestionar siembra, trasplantes, cosecha, ocupación de invernaderos, alertas de desvío y trazabilidad de lotes. Base de datos en Google Sheets, hosteada en Vercel.

**Stack**: Next.js 14 · TypeScript · Google Sheets API · iron-session · Tailwind CSS

---

## Estructura

```
xavia/
├── app/                      Páginas (Next.js App Router)
│   ├── login/                Login
│   ├── panel/                Panel principal
│   ├── cultivos/             Mis Cultivos + nuevo, trasplantar, cosechar
│   ├── ocupacion/            Ocupación e indicadores
│   ├── estadisticas/         Estadísticas
│   ├── alertas/              Alertas (admin only)
│   ├── admin/                Naves, semillas, usuarios, clientes
│   └── api/                  Endpoints REST
├── lib/                      Lógica de negocio
│   ├── sheets.ts             Conexión a Google Sheets
│   ├── auth.ts               Autenticación con bcrypt + iron-session
│   ├── lotes.ts              Lógica de lotes
│   ├── ocupacion.ts          Cálculos de ocupación
│   ├── estadisticas.ts       Cálculos de estadísticas
│   ├── loteId.ts             Generación de IDs de lote
│   └── types.ts              Tipos TypeScript
├── components/               Componentes UI
│   └── Header.tsx
├── scripts/
│   └── generar-hash.js       Genera hash bcrypt para crear primer admin
├── package.json
└── XaviaApp_BaseDatos_v3.xlsx  Plantilla de base de datos
```

---

## Desarrollo local

```bash
npm install
npm run dev
```

Abrí http://localhost:3000

Necesitás un archivo `.env.local` con las variables de entorno (ver Paso 5).

---

## Deploy completo · Paso a paso

Requisitos previos:
- Cuenta de GitHub (`marcosquaranta`)
- Cuenta de Google (cualquiera, gratis)
- Node.js instalado — https://nodejs.org

### Paso 1 · Subir el Sheet a Google Drive

1. Tomá el archivo `XaviaApp_BaseDatos_v3.xlsx` de la carpeta del proyecto.
2. Abrí [Google Drive](https://drive.google.com) y subí el archivo.
3. Click derecho → **Abrir con → Hojas de cálculo de Google**.
4. **Archivo → Guardar como Hojas de cálculo de Google**.
5. Anotá el ID de la URL:
   ```
   https://docs.google.com/spreadsheets/d/1aB2cD3eF4gH5iJ6kL7mN/edit
   ```
   El ID es `1aB2cD3eF4gH5iJ6kL7mN`.

### Paso 2 · Crear el Service Account de Google Cloud

1. Andá a [Google Cloud Console](https://console.cloud.google.com).
2. Creá un proyecto nuevo llamado `xaviaapp`.
3. Habilitá la **Google Sheets API** (APIs y servicios → Biblioteca).
4. Andá a **APIs y servicios → Credenciales → Crear credenciales → Cuenta de servicio**.
5. Nombre: `xaviaapp-sa`. Click en **Crear y continuar → Listo**.
6. En la lista, click en la cuenta → pestaña **Claves → Agregar clave → JSON**.
7. Se descarga un `.json`. **No lo subas a GitHub.** De ese archivo vas a usar:
   - `client_email`
   - `private_key`

### Paso 3 · Compartir el Sheet con el Service Account

1. Abrí el Sheet → **Compartir**.
2. Pegá el `client_email` del Service Account.
3. Permiso: **Editor**. Desmarcá "Notificar a las personas". Compartir.

### Paso 4 · Generar la contraseña del primer admin

```bash
node scripts/generar-hash.js "TuContraseñaSegura"
```

Copiá el hash resultante (`$2b$10$...`) y pegalo en la columna `password_hash` de la pestaña `Usuarios` del Sheet, en la fila del email admin.

### Paso 5 · Variables de entorno

Para desarrollo local, creá `.env.local`:

```env
GOOGLE_SHEET_ID=el-id-del-paso-1
GOOGLE_SERVICE_ACCOUNT_EMAIL=xaviaapp-sa@xaviaapp.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
SESSION_SECRET=una-clave-aleatoria-de-32-chars
```

Para Vercel, cargá esas mismas variables en **Settings → Environment Variables**.

> Podés generar `SESSION_SECRET` en https://generate-secret.vercel.app/32

### Paso 6 · Deploy a Vercel

1. Andá a [vercel.com](https://vercel.com) y registrate con GitHub.
2. **Add New → Project** → seleccioná `marcosquaranta/xavia`.
3. Framework: Next.js (se detecta solo). Root Directory: `./`.
4. Cargá las variables de entorno del Paso 5.
5. **Deploy**. En 1-2 minutos tenés una URL tipo `xavia-xyz.vercel.app`.

### Paso 7 · Verificar

1. Abrí la URL de Vercel.
2. Login con el email admin y la contraseña del Paso 4.
3. Si todo está bien, entrás al panel.

---

## Actualizaciones

Cada vez que modifiques código:

1. Hacé los cambios en tu carpeta local.
2. `git add . && git commit -m "descripción" && git push`
3. Vercel detecta el push y redeploya automáticamente en ~1 minuto.

---

## Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| "email o contraseña incorrectos" | Hash mal copiado o `activo ≠ SI` | Verificar Sheet, columnas `password_hash` y `activo` |
| "Variables de entorno faltantes" | Faltan vars en Vercel | Settings → Env Vars → agregar y Redeploy |
| "Permission denied" al leer Sheet | Sheet no compartido | Compartir con `client_email` como Editor |
| Sheet vacío en la app | `GOOGLE_SHEET_ID` incorrecto | Verificar ID en la URL del Sheet |

---

## Soporte

XaviaApp · 2026
