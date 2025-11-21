const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

const users = new Map(); // id -> {id,name,lobbyId}
const lobbies = new Map(); // id -> lobby
const streams = new Map(); // userId -> response
let messageCounter = 0;

const defaultSettings = () => ({
  mode: 'classic',
  gridSize: 3,
  winLength: 3,
  allowDiagonal: true,
  allowVertical: true,
  allowHorizontal: true,
  matchWinsToTakeTournament: 1,
  powerUps: false,
  forgetAfter: 0, // 0 disables
  powerUpLimit: 0
});

const newLobby = ({ hostId, name, isPublic }) => {
  const lobbyId = randomId();
  const code = randomCode();
  const lobby = {
    id: lobbyId,
    code,
    name: name || `Lobby-${code}`,
    hostId,
    isPublic: Boolean(isPublic),
    players: [hostId],
    spectators: [],
    bans: new Set(),
    muted: new Set(),
    chatEnabled: true,
    messages: [],
    settings: defaultSettings(),
    game: null
  };
  lobbies.set(lobbyId, lobby);
  const user = users.get(hostId);
  if (user) user.lobbyId = lobbyId;
  return lobby;
};

const randomId = () => Math.random().toString(36).slice(2, 10);
const randomCode = () => Math.random().toString(36).toUpperCase().slice(2, 8);

const serveFile = (req, res) => {
  let filePath = path.join(publicDir, req.url.split('?')[0]);
  if (req.url === '/' || req.url.startsWith('/?')) {
    filePath = path.join(publicDir, 'index.html');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const type = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript'
    }[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
};

const respond = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(payload));
};

const broadcast = (userIds, event) => {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  userIds.forEach((id) => {
    const stream = streams.get(id);
    if (stream) {
      stream.write(data);
    }
  });
};

const lobbyUserIds = (lobby) => {
  const ids = new Set([lobby.hostId, ...lobby.players, ...lobby.spectators]);
  return Array.from(ids);
};

const pushLobbyUpdate = (lobby) => {
  broadcast(lobbyUserIds(lobby), { type: 'lobby:update', lobby: serializeLobby(lobby) });
};

const serializeLobby = (lobby) => ({
  id: lobby.id,
  code: lobby.code,
  name: lobby.name,
  hostId: lobby.hostId,
  isPublic: lobby.isPublic,
  players: lobby.players,
  spectators: lobby.spectators,
  roster: Object.fromEntries(
    [...users.entries()]
      .filter(([id]) => lobbyUserIds(lobby).includes(id))
      .map(([id, u]) => [id, u.name])
  ),
  muted: Array.from(lobby.muted),
  chatEnabled: lobby.chatEnabled,
  messages: lobby.messages,
  settings: lobby.settings,
  game: lobby.game
});

const createGameState = (lobby) => {
  const playerIds = lobby.players.slice(0, 2);
  const board = Array(lobby.settings.gridSize * lobby.settings.gridSize).fill(null);
  const placements = [];
  return {
    playerOrder: playerIds,
    currentPlayer: playerIds[0],
    board,
    placements,
    scores: Object.fromEntries(playerIds.map((id) => [id, 0])),
    finished: false,
    turn: 0
  };
};

const handleMove = (lobby, userId, index) => {
  const game = lobby.game;
  if (!game || game.finished) return;
  if (game.currentPlayer !== userId) return;
  if (index < 0 || index >= game.board.length) return;
  if (game.board[index]) return;
  game.board[index] = userId;
  game.placements.push(index);
  game.turn += 1;
  applyForget(lobby);
  if (checkWin(lobby.settings, game.board, lobby.players.indexOf(userId) === 0 ? 'X' : 'O', userId, lobby)) {
    game.scores[userId] = (game.scores[userId] || 0) + 1;
    if (game.scores[userId] >= lobby.settings.matchWinsToTakeTournament) {
      game.finished = true;
      broadcast(lobbyUserIds(lobby), { type: 'tournament:end', winner: userId, lobbyId: lobby.id });
    }
    resetBoard(lobby);
    return;
  }
  if (game.board.every(Boolean)) {
    resetBoard(lobby);
    return;
  }
  const nextIndex = (game.playerOrder.indexOf(userId) + 1) % game.playerOrder.length;
  game.currentPlayer = game.playerOrder[nextIndex];
};

const applyForget = (lobby) => {
  const { forgetAfter } = lobby.settings;
  const game = lobby.game;
  if (!forgetAfter || !game) return;
  while (game.placements.length > forgetAfter) {
    const oldestIndex = game.placements.shift();
    game.board[oldestIndex] = null;
  }
};

const resetBoard = (lobby) => {
  const game = lobby.game;
  if (!game) return;
  game.board = Array(lobby.settings.gridSize * lobby.settings.gridSize).fill(null);
  game.placements = [];
  game.turn = 0;
  game.currentPlayer = game.playerOrder[0];
};

const checkWin = (settings, board, symbol, userId, lobby) => {
  const size = settings.gridSize;
  const winLen = settings.winLength;
  const lines = [];
  if (settings.allowHorizontal) {
    for (let r = 0; r < size; r++) lines.push([...Array(size).keys()].map((c) => r * size + c));
  }
  if (settings.allowVertical) {
    for (let c = 0; c < size; c++) lines.push([...Array(size).keys()].map((r) => r * size + c));
  }
  const diag1 = [], diag2 = [];
  for (let i = 0; i < size; i++) {
    diag1.push(i * size + i);
    diag2.push(i * size + (size - i - 1));
  }
  if (settings.allowDiagonal) {
    lines.push(diag1, diag2);
  }
  const mark = userId;
  return lines.some((line) => {
    if (line.length < winLen) return false;
    let streak = 0;
    for (const idx of line) {
      if (board[idx] === mark) {
        streak += 1;
        if (streak >= winLen) return true;
      } else {
        streak = 0;
      }
    }
    return false;
  });
};

const usernameSuggestion = (name) => {
  const base = name.replace(/\W+/g, '') || 'Player';
  for (let i = 1; i < 100; i++) {
    const candidate = `${base}${Math.floor(Math.random() * 90 + 10)}`;
    if (![...users.values()].some((u) => u.name === candidate)) return candidate;
  }
  return `${base}${Date.now()}`;
};

const route = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (req.url.startsWith('/api/stream')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const userId = url.searchParams.get('userId');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('\n');
    streams.set(userId, res);
    req.on('close', () => streams.delete(userId));
    return;
  }

  if (req.url.startsWith('/api/')) {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        handleApi(req, res, payload);
      } catch (err) {
        respond(res, 400, { error: 'Invalid payload' });
      }
    });
    return;
  }

  serveFile(req, res);
};

const handleApi = (req, res, payload) => {
  switch (req.url) {
    case '/api/check-username': {
      const taken = [...users.values()].some((u) => u.name === payload.name);
      respond(res, 200, { available: !taken, suggestion: taken ? usernameSuggestion(payload.name) : null });
      return;
    }
    case '/api/register': {
      if ([...users.values()].some((u) => u.name === payload.name)) {
        respond(res, 409, { error: 'Name taken', suggestion: usernameSuggestion(payload.name) });
        return;
      }
      const user = { id: randomId(), name: payload.name, lobbyId: null };
      users.set(user.id, user);
      respond(res, 200, { user });
      return;
    }
    case '/api/create-lobby': {
      const user = users.get(payload.userId);
      if (!user) return respond(res, 404, { error: 'User not found' });
      const lobby = newLobby({ hostId: user.id, name: payload.name, isPublic: payload.isPublic });
      respond(res, 200, { lobby: serializeLobby(lobby) });
      return;
    }
    case '/api/public-lobbies': {
      const list = [...lobbies.values()].filter((l) => l.isPublic).map((l) => ({ id: l.id, code: l.code, name: l.name }));
      respond(res, 200, { lobbies: list });
      return;
    }
    case '/api/join-lobby': {
      const user = users.get(payload.userId);
      if (!user) return respond(res, 404, { error: 'User not found' });
      const lobby = [...lobbies.values()].find((l) => l.code === payload.code || l.id === payload.code);
      if (!lobby) return respond(res, 404, { error: 'Lobby not found' });
      if (lobby.bans.has(user.id)) return respond(res, 403, { error: 'Banned from lobby' });
      if (!lobby.players.includes(user.id) && !lobby.spectators.includes(user.id)) {
        lobby.spectators.push(user.id);
      }
      user.lobbyId = lobby.id;
      pushLobbyUpdate(lobby);
      respond(res, 200, { lobby: serializeLobby(lobby) });
      return;
    }
    case '/api/leave-lobby': {
      const user = users.get(payload.userId);
      if (!user) return respond(res, 404, { error: 'User not found' });
      const lobby = lobbies.get(payload.lobbyId);
      if (!lobby) return respond(res, 404, { error: 'Lobby missing' });
      lobby.players = lobby.players.filter((id) => id !== user.id);
      lobby.spectators = lobby.spectators.filter((id) => id !== user.id);
      if (lobby.hostId === user.id) {
        const replacement = lobby.players[0] || lobby.spectators[0];
        lobby.hostId = replacement || null;
      }
      user.lobbyId = null;
      pushLobbyUpdate(lobby);
      respond(res, 200, { ok: true });
      return;
    }
    case '/api/update-settings': {
      const lobby = lobbies.get(payload.lobbyId);
      if (!lobby) return respond(res, 404, { error: 'Lobby missing' });
      if (lobby.hostId !== payload.userId) return respond(res, 403, { error: 'Host only' });
      lobby.settings = { ...lobby.settings, ...payload.settings };
      pushLobbyUpdate(lobby);
      respond(res, 200, { settings: lobby.settings });
      return;
    }
    case '/api/set-role': {
      const lobby = lobbies.get(payload.lobbyId);
      if (!lobby) return respond(res, 404, { error: 'Lobby missing' });
      if (lobby.hostId !== payload.userId) return respond(res, 403, { error: 'Host only' });
      lobby.players = lobby.players.filter((id) => id !== payload.targetId);
      lobby.spectators = lobby.spectators.filter((id) => id !== payload.targetId);
      if (payload.role === 'player') lobby.players.push(payload.targetId);
      else lobby.spectators.push(payload.targetId);
      pushLobbyUpdate(lobby);
      respond(res, 200, { lobby: serializeLobby(lobby) });
      return;
    }
    case '/api/start-tournament': {
      const lobby = lobbies.get(payload.lobbyId);
      if (!lobby) return respond(res, 404, { error: 'Lobby missing' });
      if (lobby.hostId !== payload.userId) return respond(res, 403, { error: 'Host only' });
      const eligible = lobby.players.slice();
      if (payload.aiOpponent) {
        const aiId = `AI-${randomId()}`;
        users.set(aiId, { id: aiId, name: payload.aiName || 'AI', lobbyId: lobby.id });
        if (!eligible.includes(aiId)) eligible.push(aiId);
      }
      if (eligible.length < 2) return respond(res, 400, { error: 'Need at least two players' });
      if (payload.mode === 'random' && eligible.length >= 2) {
        shuffle(eligible);
        lobby.players = eligible.slice(0, 2);
        lobby.spectators = eligible.slice(2).concat(lobby.spectators.filter((id) => !eligible.includes(id)));
      } else if (eligible.length >= 2) {
        lobby.players = eligible.slice(0, 2);
      }
      lobby.game = createGameState(lobby);
      pushLobbyUpdate(lobby);
      respond(res, 200, { game: lobby.game });
      return;
    }
    case '/api/chat': {
      const lobby = lobbies.get(payload.lobbyId);
      if (!lobby) return respond(res, 404, { error: 'Lobby missing' });
      if (!lobby.chatEnabled) return respond(res, 403, { error: 'Chat disabled' });
      if (lobby.muted.has(payload.userId)) return respond(res, 403, { error: 'You are muted' });
      const user = users.get(payload.userId);
      if (!user) return respond(res, 404, { error: 'User missing' });
      const msg = { id: ++messageCounter, author: user.name, userId: user.id, text: payload.text, ts: Date.now() };
      lobby.messages.push(msg);
      pushLobbyUpdate(lobby);
      respond(res, 200, { message: msg });
      return;
    }
    case '/api/delete-message': {
      const lobby = lobbies.get(payload.lobbyId);
      if (!lobby) return respond(res, 404, { error: 'Lobby missing' });
      if (lobby.hostId !== payload.userId) return respond(res, 403, { error: 'Host only' });
      lobby.messages = lobby.messages.filter((m) => m.id !== payload.messageId);
      pushLobbyUpdate(lobby);
      respond(res, 200, { ok: true });
      return;
    }
    case '/api/mute': {
      const lobby = lobbies.get(payload.lobbyId);
      if (!lobby) return respond(res, 404, { error: 'Lobby missing' });
      if (lobby.hostId !== payload.userId) return respond(res, 403, { error: 'Host only' });
      if (payload.muted) lobby.muted.add(payload.targetId);
      else lobby.muted.delete(payload.targetId);
      pushLobbyUpdate(lobby);
      respond(res, 200, { muted: Array.from(lobby.muted) });
      return;
    }
    case '/api/toggle-chat': {
      const lobby = lobbies.get(payload.lobbyId);
      if (!lobby) return respond(res, 404, { error: 'Lobby missing' });
      if (lobby.hostId !== payload.userId) return respond(res, 403, { error: 'Host only' });
      lobby.chatEnabled = Boolean(payload.enabled);
      pushLobbyUpdate(lobby);
      respond(res, 200, { chatEnabled: lobby.chatEnabled });
      return;
    }
    case '/api/kick': {
      const lobby = lobbies.get(payload.lobbyId);
      if (!lobby) return respond(res, 404, { error: 'Lobby missing' });
      if (lobby.hostId !== payload.userId) return respond(res, 403, { error: 'Host only' });
      const targetId = payload.targetId;
      lobby.players = lobby.players.filter((id) => id !== targetId);
      lobby.spectators = lobby.spectators.filter((id) => id !== targetId);
      if (payload.ban) lobby.bans.add(targetId);
      pushLobbyUpdate(lobby);
      respond(res, 200, { ok: true });
      return;
    }
    case '/api/move': {
      const lobby = lobbies.get(payload.lobbyId);
      if (!lobby) return respond(res, 404, { error: 'Lobby missing' });
      handleMove(lobby, payload.userId, payload.index);
      pushLobbyUpdate(lobby);
      respond(res, 200, { board: lobby.game ? lobby.game.board : [] });
      return;
    }
    default:
      respond(res, 404, { error: 'Not found' });
  }
};

const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
};

const server = http.createServer(route);
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
