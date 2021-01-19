This is the code for the Fencing event at Mystery Hunt 2021, a competitive
crossword solving competition. It's written in node.js.

- Clone this repo and `cd` into it
- Run `mkdir save made` to create directories for saved games
- Run `npm install` to install dependencies
- Run `node server.js` to start the server
- Access at `localhost:9001`

qxw:
- If you want to create new games you'll need qxw installed
- The version in the Debian/Ubuntu repository is too old
- Get the latest from https://quinapalus.com/qxwdownload.html
- You can install it as a .deb or whatever works for your OS
- Version `20190909` is known to work

Credits:
- Written by @cesium12
- Thanks to @justinej and @cluedo for help preparing and running the event
- And to many ✈️✈️✈️ Galactic Trendsetters ✈️✈️✈️ for testsolving and moderating

Files:
- `state.js`: Handles all game logic and updates.
- `server.js`: Handles all serving and communication with clients.
- `home.html`: Home page for testing purposes; allows creating games, listing
  all open games, and picking which side to play as or spectate. However, the
  wiring for this was ripped out of `server.js`, so it won't work as is.
- `queue.html`: Home page for the actual event; only allows queueing for a
  game and being assigned a side to play as.
- `game.html`: Page for playing a game.
- `big.html`: Admin bigboard page to monitor all games.
- `bracket.html`: Hacky page for publicly showing a tournament bracket.
- `print.js`: Prints out a given saved game for debugging.
- `bracket.js`: See "Tournament instructions" below.
- Several data files are required but not provided:
- `clues`: TSV, first column answers, second column clues.
- `answers`: Same as `clues`, but just the first column.
- `grids`: Lines of the form
  `68 ####.#####.####|####.#####.####|##########.####|######.########|...####.#####..|########.######|#####.#####.###|####.#####.####|###.#####.#####|######.########|..#####.####...|########.######|####.##########|####.#####.####|####.#####.####`,
  where the black squares in the grid are encoded as periods, and the first
  number is unused.
    - It is important that these grids fulfill the game constraints like having
      the main diagonal free to encode the answer and having empty spots in
      opposite corners for starting locations, as the code will not verify this.

Games:
- Games are written to disk, which should be replaceable with a database if
  needed. When anyone loads a game, the server opens that JSON file and reads
  it if the game is not already in memory.
- A game has an `id`, and one `url` for each team playing. Each team's url only
  shows their squares, while knowing the id lets you spectate and see
  everything.
- After a game is started, it can be found at `save/<id>.json`, and each team's
  url gets a `save/<url>.json` that symlinks to `<id>.json`.
- This way, when the server needs to load a game, it can just open the file
  corresponding to the URL the player is using, while when saving a game, it
  only has to save it to `<id>.json`.

General architecture:
- A game is a JSON file or JS object. When a user performs an action,
  `processGuess` in `state.js` makes changes to the object, and then `server.js`
  saves the object to disk. `state.js` also generates a diff to send to the
  browser, and `server.js` forwards it.
- At certain points, e.g. when first loading a game page or when a game ends,
  `server.js` requests that the full game be sent rather than a diff.
- Either way, the object sent to the browser does not correspond to the full
  game object, but omits some fields and filters others by visibility. This is
  the job of the `render` functions in `state.js`.

Freeplay instructions:
- `node state.js` will generate grids with the event answer embedded for
  freeplay mode, and put them into the `made` directory.
- When two people queue on the site, the server pulls the first game from `made`
  and puts it into `save` for them to play.
- So before the event, we need to make sure there are enough games in `made` for
  everyone. In practice, teams went through about 1000 games in 2 hours.
- If the grids are not constrained by needing to have an answer embedded, then
  generation is probably fast enough to run `createGame` on-demand as needed.

Tournament instructions:
- We had plumbing in the Hunt website to import and export tournament CSVs
  based on team registration.
- The parts in this repo are: Run `node state.js <puzzle>.puz <input>.csv` to
  create all the tournament games for one round, using the same grid. They will
  be in `save` and locked, so solvers can access them but not start. Put the
  output in `<output>.csv`.
    - Note: Reading the .puz file uses `puzjs`, which is apparently in
      development and still has debug prints in it that I had to remove.
- Watch /galaxyboard to check that people are opening their games. Click the
  start button to unlock all the tournament games and start their timers.
    - Note: If, for any tournament game, neither competitor has opened the
      game when you click the button, it won't be started. You can keep mashing
      the button if you see any of these, and they'll just be a bit late.
- And: Run `node bracket.js <output>.csv` to gather the winners for each game
  in the round. If a line is indented, that means it was a tie or hasn't
  finished yet, or neither team showed up, and you need to decide whether to
  move both of them on or neither or wait longer.
- When you've dealt with these, the output forms a new input CSV for the next
  round of the bracket. Go back to the `node state.js` step, using the next
  .puz file. Repeat until someone wins!
