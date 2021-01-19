'use strict';

const child_process = require('child_process');
const fs = require('fs');
const process = require('process');
const puzjs = require('puzjs');

const CASUAL_GAME_TIME = 15 * 60 * 1000;
const COMP_GAME_TIME = 10 * 60 * 1000;
const GUESS_TIME = 10 * 1000;
const HINT_TIME = 30 * 1000;
const HINT_CAP = 3;
const ANSWER = 'NOWCALLINFACIAL';
const SIDES = [
  ['red', 0, -1],
  ['blue', -1, 0],
  ['yellow', 0, 0],
  ['purple', -1, -1],
];

function rand(list) {
  return list[parseInt(Math.random() * list.length)];
}

const GRIDS = fs.readFileSync(__dirname + '/grids', 'utf8').trim().split('\n');
const CLUES = {};
for (const line of fs.readFileSync(__dirname + '/clues', 'utf8')
    .trim().split('\n')) {
  let [actual, text] = line.split('\t');
  actual = actual.toUpperCase();
  CLUES[actual] = CLUES[actual] || [];
  CLUES[actual].push(text);
}

async function createGame(sides, competitive = null) {
  const grid = competitive ? competitive.grid :
      rand(GRIDS).split(' ')[1].split('|');

  const game = {
    id: null,
    urls: {},
    names: {},
    cells: grid.map((row, y) => Array.from(row).map((cell, x) => {
      if (cell == '.') return {
        status: 'wall',
        visible: {},
      };
      const ret = {
        status: 'blank',
        visible: {},
        guess: {},
        timeout: {},
        clues: [],
      };
      if (cell != '#') ret.actual = cell;
      if (!competitive && y == x) ret.actual = ANSWER[y];
      return ret;
    })),
    clues: [],
    log: [],
    hints: {},
    score: {},
    total: 0,
    phase: competitive ? 'locked' : 'created',
    time: competitive ? COMP_GAME_TIME : CASUAL_GAME_TIME,
  };

  let index = 1;
  game.cells.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell.status == 'wall') return;
      ++game.total;
      const across = !row[x - 1] || game.cells[y][x - 1].status == 'wall';
      const down = !game.cells[y - 1] || game.cells[y - 1][x].status == 'wall';
      const newClue = dir => ({
        status: 'open',
        dir,
        index,
        cells: [],
        walls: [],
        visible: {},
      });
      if (across) {
        const clue = newClue('across');
        if (x > 0) clue.walls.push([y, x - 1]);
        for (let xx = x;;) {
          game.cells[y][xx].clues.push(game.clues.length);
          clue.cells.push([y, xx]);
          if (!row[++xx]) break;
          else if (game.cells[y][xx].status == 'wall') {
            clue.walls.push([y, xx]);
            break;
          }
        }
        game.clues.push(clue);
      }
      if (down) {
        const clue = newClue('down');
        if (y > 0) clue.walls.push([y - 1, x]);
        for (let yy = y;;) {
          game.cells[yy][x].clues.push(game.clues.length);
          clue.cells.push([yy, x]);
          if (!game.cells[++yy]) break;
          else if (game.cells[yy][x].status == 'wall') {
            clue.walls.push([yy, x]);
            break;
          }
        }
        game.clues.push(clue);
      }
      if (across || down) cell.index = index++;
    });
  });

  if (competitive) {
    for (const clue of game.clues) {
      clue.text = competitive.clues[clue.dir][clue.index];
    }
  } else {
    let task;
    const promise = new Promise(resolve => task = child_process.exec(
        'cat | timeout 15s qxw -b /dev/stdin', (...args) => resolve(args)));
    task.stdin.write(`
      .DICTIONARY 1 ${__dirname}/answers
      .RANDOM 1
      .UNIQUE 1
    `);
    for (const {cells} of game.clues) {
      const line = [];
      for (const [y, x] of cells) {
        line.push(`${y}_${x}`);
        if (game.cells[y][x].actual) line.push('=' + game.cells[y][x].actual);
      }
      task.stdin.write(line.join(' ') + '\n');
    }
    task.stdin.end();

    const [error, stdout, stderr] = await promise;
    if (error) throw error;

    let i = 0;
    for (const line of stdout.trim().split('\n')) {
      if (line.startsWith('#')) continue;
      const [_, actual] = line.toUpperCase().split(' ');
      const clue = game.clues[i++];
      clue.cells.forEach(([y, x], i) => game.cells[y][x].actual = actual[i]);
      clue.text = rand(CLUES[actual]);
    }
  }

  const update = [];
  for (const [side, y, x] of SIDES.slice(0, sides)) {
    for (const id of game.cells.slice(y)[0].slice(x)[0].clues) {
      for (const [yy, xx] of game.clues[id].cells) {
        updateVision(game, side, yy, xx, update);
      }
    }
    game.urls[rand(Object.keys(CLUES)).toLowerCase() +
        '-' + String(Date.now() % 1000).padStart(3, 0)] = side;
    game.names[side] = null;
    game.hints[side] = {count: 0, time: 0};
    game.score[side] = 0;
  }
  commitUpdate(game, update);

  return game;
}

function updateVision(game, side, y, x, update) {
  for (const id of game.cells[y][x].clues) {
    if (game.clues[id].visible[side]) continue;
    game.clues[id].visible[side] = true;
    update.push({type: 'clue', side, id});
    for (const list of [game.clues[id].cells, game.clues[id].walls]) {
      for (const [yy, xx] of list) {
        if (game.cells[yy][xx].visible[side]) continue;
        game.cells[yy][xx].visible[side] = true;
        update.push({type: 'cell', side, y: yy, x: xx});
      }
    }
  }
}

function isVisible(game, thing, side) {
  if (side) return game.phase != 'locked' && thing.visible[side];
  return Object.values(thing.visible).some(v => v);
}

function renderCell(game, cell, side) {
  const {status, guess, timeout, actual, clues, index} = cell;
  if (!isVisible(game, cell, side)) return {};
  if (status == 'wall') return {status};
  if (status != 'blank') return {status, clues, index, guess: actual};
  if (!side) return {status, clues, index};
  return {status, clues, index, guess: guess[side], timeout: timeout[side]};
}

function renderClue(game, clue, side) {
  const {status, dir, index, cells, text} = clue;
  if (!isVisible(game, clue, side)) return {dir, index};
  return {status, dir, index, cells, text};
}

function renderHints(game, side) {
  if (!side || game.phase == 'locked') return undefined;
  const {count, time} = game.hints[side];
  const plus = parseInt((Date.now() - time) / HINT_TIME);
  if (count + plus >= HINT_CAP) return {count: HINT_CAP};
  return {count: count + plus, next: time + (plus + 1) * HINT_TIME};
}

function renderScore(game, side) {
  return side ? {[side]: game.score[side]} : Object.assign({}, game.score);
}

function renderGame(game, side) {
  return {
    cells: game.cells.map(row => row.map(cell => renderCell(game, cell, side))),
    clues: game.clues.map(clue => renderClue(game, clue, side)),
    log: side ? undefined : game.log,
    hints: renderHints(game, side),
    score: renderScore(game, side),
    total: game.total,
    start: game.start,
    time: game.time,
    winner: game.winner,
    names: game.names,
  };
}

function commitUpdate(game, update) {
  const replies = [];
  for (const side of [, ...Object.keys(game.score)]) {
    const events = [];
    for (const entry of update) {
      if (side && entry.side && side != entry.side) continue;
      const {type, id, y, x} = entry;
      switch (type) {
        case 'hints':
          if (side) events.push({type, hints: renderHints(game, side)});
          break;
        case 'score':
          events.push({type, score: renderScore(game, side)});
          break;
        case 'cell':
          const cell = renderCell(game, game.cells[y][x], side);
          if (cell.status) events.push({type, y, x, cell});
          break;
        case 'clue':
          const clue = renderClue(game, game.clues[id], side);
          if (clue.status) events.push({type, id, clue});
          break;
      }
    }
    if (events.length) replies.push({side, events});
    if (events.length && !side) game.log.push({time: Date.now(), events});
  }
  return replies;
}

function processGuess(game, side, {y, x, key}) {
  const update = [];
  let guess = String(key).toUpperCase();
  if (game.phase == 'started' && game.cells[y] && game.cells[y][x]) {
    const cell = game.cells[y][x];
    if (cell.status == 'blank' && cell.visible[side] &&
        !(cell.timeout[side] && cell.timeout[side] > Date.now())) {
      const {count, next} = renderHints(game, side);
      if (key ? cell.actual == guess : count > 0) {
        cell.status = side;
        update.push({type: 'cell', y, x});
        updateVision(game, side, y, x, update);
        for (const id of game.cells[y][x].clues) {
          if (game.clues[id].cells.every(
              ([y, x]) => game.cells[y][x].status != 'blank')) {
            game.clues[id].status = 'done';
            update.push({type: 'clue', id});
          }
        }
        ++game.score[side];
        update.push({type: 'score', side});
        if (!key) {
          game.hints[side].count = count - 1;
          game.hints[side].time = next ? next - HINT_TIME : Date.now();
          update.push({type: 'hints', side});
        }
      } else if (key && cell.guess[side] != guess) {
        cell.guess[side] = guess;
        cell.timeout[side] = Date.now() + GUESS_TIME;
        update.push({type: 'cell', side, y, x});
      }
    }
  }
  return commitUpdate(game, update);
}

function checkVictory(game) {
  const board = [];
  let sum = 0;
  for (const side in game.score) {
    sum += game.score[side];
    board.push({side, score: game.score[side]});
  }
  board.sort((a, b) => b.score - a.score);
  const {side, score} = board.shift();
  const force = new Date > game.start + game.time;
  if (force || game.total == sum) {
    game.phase = 'finished';
    game.winner = 'nobody';
  }
  if (score > board[0].score + (force ? 0 : game.total - sum)) {
    game.phase = 'finished';
    game.winner = side;
  }
}

module.exports = {
  renderGame,
  renderHints,
  processGuess,
  checkVictory,
};

async function pregenerate() {
  const [_, __, puzname, tourney] = process.argv;
  if (puzname) {
    const puz = puzjs.decode(fs.readFileSync(puzname));
    const lines = fs.readFileSync(tourney, 'utf8').trim().split('\n')
        .map(line => line.split(',')).sort(() => Math.random() - 0.5);
    let count = 0;
    while (lines.length >= 2) {
      const game = await createGame(2, puz);
      game.id = /^.*\/(.*)\.puz$/.exec(puzname)[1] +
          '-' + ('' + ++count).padStart(3, 0);
      for (const url in game.urls) {
        const [id, name] = lines.shift();
        game.names[game.urls[url]] = name;
        console.log([id, url, game.id, game.urls[url], name].join(','));
        await fs.promises.symlink(`${game.id}.json`,
            `${__dirname}/save/${url}.json`);
      }
      await fs.promises.writeFile(`${__dirname}/save/${game.id}.json`,
          JSON.stringify(game, null, 2), 'utf8');
    }
    for (const [id, name] of lines) console.log([id, 'BYE',,, name].join(','));
  } else {
    const games = [];
    for (let i = 0; i < 3; ++i) {
      (async () => {
        while (true) {
          try {
            games.push(await createGame(2));
          } catch {}
        }
      })();
    }
    let count = 0;
    while (true) {
      await new Promise(res => setTimeout(res, 3000 * Math.random() + 1000));
      if (!games.length) continue;
      const game = games.shift();
      game.id = Date.now();
      console.log(++count, game.id, JSON.stringify(game.urls));
      await fs.promises.writeFile(`${__dirname}/made/${game.id}.json`,
          JSON.stringify(game, null, 2), 'utf8');
    }
  }
}

if (require.main == module) pregenerate();
