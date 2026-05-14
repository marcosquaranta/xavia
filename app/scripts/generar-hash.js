const bcrypt = require('bcryptjs');
const password = process.argv[2];
if (!password) { console.error('\nUso: node scripts/generar-hash.js "TuContraseña"\n'); process.exit(1); }
const hash = bcrypt.hashSync(password, 10);
console.log('\n' + '='.repeat(60));
console.log('Hash generado:');
console.log(hash);
console.log('='.repeat(60) + '\n');
