# XaviaApp

Gestión integral de cultivos hidropónicos · v1.0

App web para gestionar siembra, trasplantes, cosecha, ocupación de invernaderos, alertas de desvío y trazabilidad de lotes. Base de datos en Google Sheets, hosteado en Vercel.

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
│   ├── admin/                naves, semillas, usuarios, clientes
│   └── api/                  Endpoints
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
├── scripts/                  Utilitarios
│   └── generar-hash.js       Genera hash bcrypt para crear primer admin
├── package.json
└── XaviaApp_BaseDatos_v3.xlsx  Base de datos inicial
```

---

## Instalación local (para probar antes del deploy)

```bash
npm install
npm run dev
```

Abrí http://localhost:3000

---

## Deploy completo · Paso a paso

Este instructivo asume que tenés:
- Cuenta de GitHub (`marcosquaranta`)
- GitHub Desktop instalado
- Cuenta de Google (cualquiera, gratis)
- Node.js instalado (https://nodejs.org)

### Paso 1 · Subir el Sheet a Google Drive

1. Tomá el archivo `XaviaApp_BaseDatos_v3.xlsx` de la carpeta del proyecto.
2. Abrí Google Drive en https://drive.google.com.
3. Subí el archivo.
4. Click derecho sobre el archivo → **Abrir con → Hojas de cálculo de Google**.
5. Una vez abierto, hacé **Archivo → Guardar como Hojas de cálculo de Google**.
6. Anotá el ID que aparece en la URL. Si la URL es:
   ```
   https://docs.google.com/spreadsheets/d/1aB2cD3eF4gH5iJ6kL7mN/edit
   ```
   el ID es `1aB2cD3eF4gH5iJ6kL7mN`.

### Paso 2 · Crear el Service Account de Google Cloud

Esto es lo que le permite a la app leer y escribir en tu Sheet.

1. Andá a https://console.cloud.google.com.
2. Click en el selector de proyecto arriba → **Nuevo proyecto**. Llamalo `xaviaapp`.
3. Habilitá la **Google Sheets API**:
   - Menú izquierdo → **APIs y servicios → Biblioteca**.
   - Buscá "Google Sheets API" → **Habilitar**.
4. Andá a **APIs y servicios → Credenciales**.
5. Click en **Crear credenciales → Cuenta de servicio**.
6. Nombre: `xaviaapp-sa`. Click en **Crear y continuar**.
7. Rol: dejalo en blanco (o "Editor" si te lo pide). Click **Continuar → Listo**.
8. Vas a ver la cuenta creada en la lista. Click en ella.
9. Pestaña **Claves → Agregar clave → Crear clave nueva → JSON → Crear**.
10. Se descarga un archivo `.json`. **Guardalo seguro** (y no lo subas a GitHub).
11. Abrí ese JSON con un editor de texto. Vas a usar dos campos:
    - `client_email` (algo como `xaviaapp-sa@xaviaapp.iam.gserviceaccount.com`)
    - `private_key` (un texto largo que arranca con `-----BEGIN PRIVATE KEY-----`)

### Paso 3 · Compartir el Sheet con el Service Account

**Sin esto, la app no puede leer ni escribir.**

1. Volvé al Sheet en Google Drive.
2. Click en **Compartir** (arriba a la derecha).
3. Pegá el `client_email` del Service Account.
4. Dale permiso de **Editor**.
5. Desmarcá "Notificar a las personas".
6. Compartir.

### Paso 4 · Generar la contraseña del primer admin

En la terminal, dentro de la carpeta del proyecto:

```bash
node scripts/generar-hash.js "TuContraseñaSegura"
```

Te imprime un hash que arranca con `$2b$10$...`. Copialo entero.

Después, abrí tu Sheet de Google, andá a la pestaña `Usuarios`, y en la fila del email `admin@xavia.com` (o el email que prefieras), pegá el hash en la columna `password_hash`. Si querés cambiar el email del admin, cambialo en la columna `email` también.

### Paso 5 · Subir el código a tu repositorio de GitHub

1. Abrí GitHub Desktop.
2. Si todavía no clonaste tu repo: **File → Clone Repository →** seleccioná `marcosquaranta/xavia`.
3. Si ya está clonado, andá a esa carpeta local.
4. Copiá **todo el contenido** del proyecto (todos los archivos y carpetas) dentro de la carpeta `xavia/` local.
5. Volvé a GitHub Desktop. Vas a ver todos los archivos en "Changes".
6. Escribí un Summary (ej: `XaviaApp v1 completa`).
7. Click **Commit to main**.
8. Click **Push origin**.

Verificá en https://github.com/marcosquaranta/xavia que estén todos los archivos.

### Paso 6 · Deploy a Vercel

1. Andá a https://vercel.com y registrate con tu cuenta de GitHub.
2. Click en **Add New → Project**.
3. Seleccioná el repo `marcosquaranta/xavia`.
4. En **Configure Project**:
   - **Framework Preset**: Next.js (lo detecta solo).
   - **Root Directory**: dejalo en `./`.
5. **Environment Variables** (las más importantes):

   | Nombre | Valor |
   |---|---|
   | `GOOGLE_SHEET_ID` | El ID que anotaste en el Paso 1 |
   | `GOOGLE_SERVICE_ACCOUNT_EMAIL` | El `client_email` del JSON del Paso 2 |
   | `GOOGLE_PRIVATE_KEY` | El `private_key` del JSON, **incluyendo comillas y `\n`** |
   | `SESSION_SECRET` | Una clave aleatoria de 32+ chars (https://generate-secret.vercel.app/32) |

   **IMPORTANTE sobre `GOOGLE_PRIVATE_KEY`**: copiá el valor del JSON tal cual viene (con los `\n` literales). Vercel lo va a guardar bien.

6. Click **Deploy**.
7. Esperá 1-2 minutos. Cuando termine, te da una URL tipo `xavia-xyz.vercel.app`.

### Paso 7 · Probar

1. Abrí la URL que te dio Vercel.
2. Te lleva a la pantalla de login.
3. Email: `admin@xavia.com` (o el que pusiste en el Sheet).
4. Contraseña: la que generaste en el Paso 4.
5. Si todo está bien, entrás al panel.

---

## Cambios futuros

Cada vez que quieras hacer cambios:

1. Pedile a Claude (o a quien sea) los archivos modificados.
2. Reemplazalos en tu carpeta `xavia/` local.
3. En GitHub Desktop hacés Commit + Push.
4. Vercel detecta el push y redeploya en 1 minuto.

---

## Si algo falla

**No puedo entrar / "email o contraseña incorrectos"**:
- Verificá que el hash en el Sheet sea el correcto (sin espacios al principio o final).
- Verificá que `activo = SI` en la fila del usuario.

**"Variables de entorno faltantes"**:
- En Vercel → Settings → Environment Variables, chequeá que estén las 4 variables.
- Después de agregar variables, redesplegá: Deployments → ... → Redeploy.

**"Permission denied" al leer el Sheet**:
- Verificá que compartiste el Sheet con el `client_email` del Service Account, con permiso de **Editor**.

**El Sheet se ve vacío en la app**:
- Verificá que `GOOGLE_SHEET_ID` sea el ID correcto del archivo (mirá la URL).

---

## Soporte

XaviaApp · 2026
