# Emuvex Tic Tac Toe Arena

A minimalist, animated tic-tac-toe experience with lobbies, tournaments, chat moderation, and AI practice. The stack is dependency-free Node.js (built-in HTTP + Server-Sent Events) with a lightweight HTML/CSS/JS frontend.

## Features
- Username reservation with smart suggestions when a name is taken.
- Create public or private lobbies that friends can join with a lobby code or from the public list.
- Host controls: configure match/tournament settings, pick players vs spectators, random duel selection, kick/ban, mute, delete chat messages, and toggle chat availability.
- Chat inside each lobby with live updates.
- Classic or “ultimate” flavor settings, configurable grid size, win length, directional rules, power-up toggles, “forget” decay with oldest-move indicator, and match wins required to take the tournament.
- Tournament flow returns everyone to the lobby when it ends so the host can tweak settings and restart.
- Single-player AI sandbox (simple opponent) and casual 1v1 queue-style entry point.
- Minimal, sleek UI with soft shadows and hover animations.

## Running locally
See [START_SERVER.md](START_SERVER.md) for step-by-step instructions.
