# emuvex tower defense

A lightweight browser-based tower defense game built with HTML5 canvas and vanilla JavaScript. Place towers to stop creeps from reaching your base across five waves.

## Running the game

1. Start a local web server from the project root (Python example below):
   ```bash
   python -m http.server 8000
   ```
2. Open `http://localhost:8000` in your browser and click on the grass to place towers.
3. Defeat all waves before ten creeps reach your base to win.

## Gameplay tips

- Towers cost 60 coins; you start with 200 and earn 20 per defeated creep.
- Towers cannot be placed on or too close to the road.
- Use the restart button at any time to reset the match.
