'use strict';

const fs = require('fs');
const process = require('process');

function rand(list) {
  return list[parseInt(Math.random() * list.length)];
}

const [_, __, tourney, force] = process.argv;
const lines = fs.readFileSync(tourney, 'utf8').trim().split('\n')
    .map(line => line.split(','));

if (force == '--force') {
  const ids = lines.filter(line => line[1] != 'BYE').map(line => line[2]);
  for (const id of new Set(ids)) {
    const game = JSON.parse(fs.readFileSync(
        `${__dirname}/save/${id}.json`, 'utf8'));
    game.winner = rand(Object.values(game.urls));
    fs.writeFileSync(`${__dirname}/save/${id}.json`,
        JSON.stringify(game), 'utf8');
  }
} else {
  for (const [teamId, url, gameId, side, name] of lines) {
    if (url != 'BYE') {
      const game = JSON.parse(fs.readFileSync(
          `${__dirname}/save/${gameId}.json`, 'utf8'));
      if (game.winner in game.names) {
        if (game.winner != side) continue;
      } else {
        console.log(`\t${teamId},${name},${gameId},${game.phase},${game.winner}`);
        continue;
      }
    }
    console.log(`${teamId},${name}`);
  }
}
