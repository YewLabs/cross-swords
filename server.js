'use strict';

const express = require('express');
const fs = require('fs');
const socketio = require('socket.io');
const state = require('./state');
require('console-stamp')(console, {label: false, colors: {stamp: 'yellow'}});

const GAMES = {};
let LAST = [];
const APP = express().set('strict routing', true);
const IO = socketio.listen(APP.listen(9001));
let Q = new Promise(resolve => resolve());
let QQ = 0;

APP.get('/css', (req, res) => res.sendFile('style.css', {root: __dirname}));
APP.get('/', (req, res) => res.sendFile('queue.html', {root: __dirname}));
APP.get('/bracket',
    (req, res) => res.sendFile('bracket.html', {root: __dirname}));
APP.get('/galaxyboard',
    (req, res) => res.sendFile('big.html', {root: __dirname}));
APP.get('/:game', async (req, res, next) => await loadGame(req.params.game) ?
    res.sendFile('game.html', {root: __dirname}) : next());

async function newGame() {
  const id = (await fs.promises.readdir(__dirname + '/made')
      ).sort()[0].replace(/\.json$/, '');
  await fs.promises.rename(`${__dirname}/made/${id}.json`,
      `${__dirname}/save/${id}.json`);
  const game = await loadGame(id);
  for (const url in game.urls) await fs.promises.symlink(`${id}.json`,
      `${__dirname}/save/${url}.json`);
  game.phase = 'started';
  game.start = +new Date;
  return game;
}

async function loadGame(id) {
  if (GAMES[id]) return GAMES[id];
  let game;
  try {
    game = JSON.parse(await fs.promises.readFile(
        `${__dirname}/save/${id}.json`, 'utf8'));
  } catch {
    return;
  }
  GAMES[game.id] = game;
  for (const url in game.urls) GAMES[url] = game;
  bigBroadcast(game);
  return game;
}

function saveGame(game) {
  if (game._pending) return;
  game._pending = true;
  ++QQ;
  Q = Q.then(async () => {
    delete game._pending;
    await fs.promises.writeFile(`.${game.id}.json`,
        JSON.stringify(game), 'utf8');
    await fs.promises.rename(`.${game.id}.json`,
        `${__dirname}/save/${game.id}.json`);
    --QQ;
  }).catch(console.warn);
}

function startGames() {
  for (const [id, game] of Object.entries(GAMES))
    if (id == game.id && game.phase == 'locked') {
      game.phase = 'started';
      game.start = +new Date;
      saveGame(game);
      console.log(QQ, 'unlocking', game.id);
      for (const side of [null, ...Object.keys(game.names)])
        IO.in(`${game.id}/${side || 'none'}`)
            .emit('state', state.renderGame(game, side));
    }
}

function bigBroadcast(game, socket) {
  const {id, urls} = game;
  const {cells, score, total, winner, names} = state.renderGame(game);
  (socket || IO.in('galaxyboard')).emit('get',
      {id, urls, names, cells, score, total, winner});
}

IO.on('connection', async socket => {
  const room = socket.handshake.query.path.substring(1);
  if (!room) {
    socket.on('new', async name => {
      LAST = [...LAST, [socket, name]].filter(([{connected}]) => connected);
      console.log(QQ, 'queuing', LAST.length, name);
      if (LAST.length < 2) return;
      const game = await newGame();
      console.log(QQ, 'starting', game.id);
      for (const url in game.urls) {
        const [socket, name] = LAST.shift();
        game.names[game.urls[url]] = name || game.urls[url];
        socket.emit('start', url);
      }
      saveGame(game);
    });
  } else if (room == 'galaxyboard') {
    socket.join(room);
    socket.on('start', startGames);
    for (const [id, game] of Object.entries(GAMES))
      if (id == game.id) bigBroadcast(game, socket);
  } else if (room == 'bracket') {
    const fns = (await fs.promises.readdir(__dirname))
        .filter(fn => /^tourney\d+\.out$/.test(fn)).sort();
    socket.emit('bracket', await Promise.all(fns.map(async fn => {
      const out = {};
      const text = await fs.promises.readFile(`${__dirname}/${fn}`, 'utf8');
      for (const line of text.trim().split('\n')) {
        const [,, id, side, name] = line.split(',');
        out[id] = out[id] || [];
        out[id].push([side, name]);
      }
      return Object.values(out);
    })));
  } else {
    const game = await loadGame(room);
    if (!game) return;
    const side = game.urls[room];
    socket.join([game.id, `${game.id}/${side || 'none'}`]);
    socket.on('chat', data => IO.in(game.id).emit('chat',
        {side, name: game.names[side], message: data}));
    if (!side || game.phase == 'finished') {
      socket.emit('state', state.renderGame(game));
      return;
    }
    socket.emit('state', state.renderGame(game, side));
    socket.on('hints', () => socket.emit('update',
        [{type: 'hints', hints: state.renderHints(game, side)}]));
    socket.on('guess', data => {
      if (game.phase != 'started') return;
      const replies = state.processGuess(game, side, data);
      for (const {side, events} of replies) {
        IO.in(`${game.id}/${side || 'none'}`).emit('update', events);
        if (!side) IO.in('galaxyboard').emit('set', {id: game.id, events});
      }
      state.checkVictory(game);
      saveGame(game);
      if (game.phase == 'finished') {
        console.log(QQ, 'finishing', game.id);
        IO.in(game.id).emit('state', state.renderGame(game));
        bigBroadcast(game);
      }
    });
  }
});
