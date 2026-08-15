const fs = require('fs');

const config = `
window.SUPABASE_URL = '${process.env.SUPABASE_URL}';
window.SUPABASE_ANON_KEY = '${process.env.SUPABASE_ANON_KEY}';
`;

fs.writeFileSync('supabase-config.js', config);

console.log('supabase-config.js generated successfully');
