# Backup de Xavia — qué respaldar y cómo

Xavia tiene **tres piezas separadas**, y cada una se respalda distinto. El código es la
que menos importa (ya está duplicada en GitHub); la planilla es la única verdaderamente
irreemplazable.

| Pieza | Dónde vive | Si se pierde | Prioridad |
|---|---|---|---|
| **Datos** (Google Sheets) | Google Drive | Se pierde el historial de la quinta. **No se recupera.** | 🔴 Alta |
| **Secretos** (variables de entorno) | Vercel | La app deja de funcionar hasta regenerarlos | 🟠 Media |
| **Código** | GitHub + este ZIP | Nada, **si tenés el ZIP**: incluye todo el historial y no depende de GitHub | 🟢 Baja |

---

## 1. Datos — la planilla de Google Sheets 🔴

Es lo único que **no se puede reconstruir**. Cada lote, cosecha, venta, cliente, precio,
fichaje y conteo de cámara vive ahí.

### Backup manual (5 minutos, hacelo hoy)

1. Abrí la planilla de Xavia en Google Sheets.
2. **Archivo → Descargar → Microsoft Excel (.xlsx)**.
3. Guardá el archivo con la fecha en el nombre: `xavia-datos-2026-08-28.xlsx`.
4. Poné una copia **fuera de Google Drive** — un pendrive, un disco externo, o
   Dropbox/OneDrive. Si el problema es la cuenta de Google, un backup dentro de Drive
   no sirve de nada.

Repetilo una vez por mes. Con eso, lo peor que puede pasar es perder el último mes.

### Backup automático

**Google Takeout** (https://takeout.google.com) permite programar una exportación
automática cada 2 meses, durante un año. Elegí solo Drive → la planilla de Xavia.

### Recuperación de emergencia

Google Sheets guarda **historial de versiones** (Archivo → Historial de versiones). Si
alguien borra o rompe algo, se puede volver atrás sin necesidad del backup. Esto cubre
errores humanos, pero **no** cubre que se pierda la cuenta entera — para eso hace falta
la copia de afuera.

---

## 2. Secretos — variables de entorno de Vercel 🟠

Sin estas, la app no puede leer la planilla ni mandar mails. Están en
**Vercel → Settings → Environment Variables**:

- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `SESSION_SECRET`
- `RESEND_API_KEY`
- `CRON_SECRET`
- `CROSSCHEX_API_KEY` / `CROSSCHEX_API_SECRET`
- Credenciales de Xubio

**Guardalas en un gestor de contraseñas** (1Password, Bitwarden, el de Google). **No las
pongas en el ZIP, ni en la planilla, ni en un mail.** Un backup de código con las claves
adentro es peor que no tener backup: cualquiera que consiga el archivo entra a todo.

Buena noticia: casi todas son **regenerables** si se pierden. La clave de la cuenta de
servicio de Google se puede volver a emitir desde Google Cloud Console, y `SESSION_SECRET`
puede ser cualquier valor nuevo (solo desloguea a todos una vez). La que conviene no
perder es la de Xubio, porque depende de un tercero.

---

## 3. Código 🟢

Está en **GitHub** (`marcosquaranta/xavia`) y en el ZIP que acompaña a este documento.

**El ZIP es autosuficiente: no depende de GitHub para nada.** Incluye la carpeta `.git`
completa con los 361 commits, así que si mañana perdés la cuenta de GitHub o te borran el
repositorio, desde este archivo recuperás el proyecto entero con todo su historial y podés
subirlo a otro lado (GitLab, Bitbucket, otra cuenta de GitHub) como si nada.

Adentro hay dos copias del repositorio, a propósito:

- **La carpeta del proyecto** (con su `.git`) — lista para trabajar.
- **`xavia-repo.bundle`** — el repositorio entero comprimido en UN archivo, verificable.
  Es el formato que usa git para backups offline. Si el `.git` de la carpeta se corrompe,
  desde el bundle se reconstruye todo igual.

### Restaurar desde el ZIP (sin GitHub)

```bash
cd xavia && npm install && npm run dev
```

Y para volver a subirlo a un repositorio nuevo:

```bash
git remote set-url origin <la-URL-del-repo-nuevo> && git push -u origin main
```

O reconstruirlo desde el bundle, si hiciera falta:

```bash
git clone xavia-repo.bundle xavia-recuperado
```

El ZIP **no** incluye `node_modules` (se reinstala solo con `npm install`) ni ningún
secreto.

---

## Si se cae o se hackea algo

**Se rompió la app / Vercel caído** → El código está en GitHub y los datos en Sheets. Se
redeploya y listo. No se pierde nada.

**Alguien borró datos de la planilla** → Archivo → Historial de versiones, volver al punto
anterior. Si ya pasó demasiado tiempo, el último `.xlsx` mensual.

**Se comprometió la cuenta de Google** → Acá pega fuerte. Cambiá la contraseña, activá
verificación en dos pasos, revocá el acceso de la cuenta de servicio desde Google Cloud
Console y emití una clave nueva. Si perdiste la planilla, restaurás desde el `.xlsx`.

**Perdiste GitHub, te lo borraron o te lo hackearon** → No se pierde nada. El ZIP tiene el
repositorio completo con todo el historial: creás un repo nuevo donde quieras y lo subís
con los comandos de arriba. El código además no tiene ningún secreto adentro (verificado),
así que un repositorio expuesto no compromete la app: las claves viven solo en Vercel.

---

## Lo mínimo indispensable

Si vas a hacer una sola cosa: **descargá la planilla en .xlsx y guardala fuera de Drive,
una vez por mes.** Eso cubre el 90% del riesgo real.

Lo segundo: **activá verificación en dos pasos** en la cuenta de Google y en GitHub. La
mayoría de los "hackeos" son contraseñas robadas, no ataques sofisticados — y el 2FA los
frena casi todos.
