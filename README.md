# Bloods Turf Tracker

Small site we use to keep an eye on our turfs and see who did the daily work (spray / drug sales).

## Setup

1. Put a GTA V map image in this folder and call it `map.jpg` (square, it gets treated as 554 x 554).
2. Check `config.js`. The database URL is already in there. `DECAY_PER_DAY` is a guess, change it to whatever the server actually takes off.
3. In the Firebase console go to Realtime Database > Rules and make sure read and write are allowed:

   ```json
   { "rules": { ".read": true, ".write": true } }
   ```

   Anyone with the link can edit stuff, so don't post it anywhere public.
4. Push to GitHub, then Settings > Pages > deploy from the main branch.

## Files

- `index.html` - page
- `style.css` - looks
- `config.js` - settings
- `app.js` - everything else

## Using it

- Type your name top right first, otherwise nothing gets saved under your name.
- "Today" tab is the checklist. Press a task once you did it, press again to undo.
- "Backup" tab exports everything to a json file. Do that once in a while.
