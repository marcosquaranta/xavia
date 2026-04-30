// scripts/generar-hash.js
// Genera un hash bcrypt para una contraseña.
// Uso: node scripts/generar-hash.js "MiContraseña123"

const bcrypt = require('bcryptjs');

const password = process.argv[2];

if (!password) {
  console.error('\nUso: node scripts/generar-hash.js "TuContraseña"\n');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);

console.log('\n' + '='.repeat(60));
console.log('Contraseña:', password);
console.log('Hash generado:');
console.log(hash);
console.log('='.repeat(60));
console.log('\nCopiá el hash y pegalo en la columna password_hash');
console.log('de la pestaña Usuarios del Sheet.\n');
