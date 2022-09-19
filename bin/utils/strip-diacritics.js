const fs = require('fs');
var data = fs.readFileSync(0, 'utf-8');
data = data.replace(/[ؐ-ًؕ-ٖٓ-ٟۖ-ٰٰۭ]/g, '');
process.stdout.write(data);