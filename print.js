'use strict';

const fs = require('fs');
const process = require('process');

function formatCell({actual, status}) {
  if (!actual) return ' ';
  switch (status) {
    case 'red': return '\x1b[31;1m' + actual + '\x1b[0m';
    case 'blue': return '\x1b[34;1m' + actual + '\x1b[0m';
    case 'yellow': return '\x1b[33;1m' + actual + '\x1b[0m';
    case 'purple': return '\x1b[35;1m' + actual + '\x1b[0m';
  }
  return actual;
}

(async () => {
  for (let i = 2; i < process.argv.length; ++i) {
    const game = JSON.parse(await fs.promises.readFile(process.argv[i], 'utf8'));
    console.log(game.id, JSON.stringify(game.urls));
    console.log(game.cells.map(row => row.map(formatCell).join('')).join('\n'));
    console.log();
  }
})();
