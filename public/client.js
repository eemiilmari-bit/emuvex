const state = {
  user: null,
  lobby: null,
  stream: null,
  aiMode: false
};

const views = {
  auth: document.getElementById('authView'),
  menu: document.getElementById('menuView'),
  lobby: document.getElementById('lobbyView'),
  game: document.getElementById('gameView')
};

const el = (id) => document.getElementById(id);
const server = '';

const show = (target) => {
  Object.values(views).forEach((v) => v.classList.add('hidden'));
  views[target].classList.remove('hidden');
};

const sseConnect = () => {
  if (!state.user) return;
  if (state.stream) state.stream.close();
  state.stream = new EventSource(`/api/stream?userId=${state.user.id}`);
  state.stream.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'lobby:update') {
      renderLobby(payload.lobby);
    }
    if (payload.type === 'tournament:end') {
      alert(`Tournament winner: ${payload.winner}`);
      show('lobby');
    }
  };
};

const post = async (url, body) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
};

const renderLobby = (lobby) => {
  state.lobby = lobby;
  el('lobbyTitle').innerText = lobby.name;
  el('lobbyCode').innerText = `Code: ${lobby.code}`;
  renderList('playerList', lobby.players, true);
  renderList('spectatorList', lobby.spectators, false);
  el('chatToggle').checked = lobby.chatEnabled;
  renderMessages(lobby.messages);
  if (lobby.game) {
    renderGame(lobby);
    show('game');
  } else {
    show('lobby');
  }
};

const renderList = (id, arr, isPlayer) => {
  const list = el(id);
  list.innerHTML = '';
  arr.forEach((uid) => {
    const li = document.createElement('li');
    const name = state.lobby.roster?.[uid] || uid;
    const label = uid === state.lobby.hostId ? `${name} (host)` : name;
    li.innerHTML = `<span>${label}</span>`;
    if (state.user && state.user.id === state.lobby.hostId && uid !== state.lobby.hostId) {
      const actions = document.createElement('div');
      const roleBtn = document.createElement('button');
      roleBtn.innerText = isPlayer ? 'To spectator' : 'To player';
      roleBtn.onclick = () => post('/api/set-role', { lobbyId: state.lobby.id, userId: state.user.id, targetId: uid, role: isPlayer ? 'spectator' : 'player' });
      const kick = document.createElement('button');
      kick.innerText = 'Kick';
      kick.onclick = () => post('/api/kick', { lobbyId: state.lobby.id, userId: state.user.id, targetId: uid });
      const muted = state.lobby.muted?.includes(uid);
      const muteBtn = document.createElement('button');
      muteBtn.innerText = muted ? 'Unmute' : 'Mute';
      muteBtn.onclick = () => post('/api/mute', { lobbyId: state.lobby.id, userId: state.user.id, targetId: uid, muted: !muted });
      actions.append(roleBtn, kick, muteBtn);
      li.append(actions);
    }
    list.appendChild(li);
  });
};

const renderMessages = (messages) => {
  const box = el('messages');
  box.innerHTML = '';
  messages.slice(-50).forEach((m) => {
    const div = document.createElement('div');
    div.className = 'message';
    div.innerHTML = `<strong>${m.author}</strong>: ${m.text}`;
    if (state.user && state.lobby && state.user.id === state.lobby.hostId) {
      const del = document.createElement('button');
      del.innerText = 'Delete';
      del.onclick = () => post('/api/delete-message', { lobbyId: state.lobby.id, userId: state.user.id, messageId: m.id });
      div.appendChild(del);
    }
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
};

const renderGame = (lobby) => {
  const { game, settings } = lobby;
  const board = el('board');
  board.style.gridTemplateColumns = `repeat(${settings.gridSize}, 1fr)`;
  board.innerHTML = '';
  const forgetEnabled = settings.forgetAfter && settings.forgetAfter > 0;
  if (forgetEnabled && game.placements.length >= settings.forgetAfter) {
    el('forgetHint').innerText = 'Oldest mark will fade on next move.';
  } else {
    el('forgetHint').innerText = '';
  }
  game.board.forEach((mark, idx) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (mark) {
      const symbol = lobby.players.indexOf(mark) === 0 ? 'X' : 'O';
      cell.textContent = symbol;
      cell.classList.add(symbol === 'X' ? 'x' : 'o');
    }
    cell.onclick = () => post('/api/move', { lobbyId: lobby.id, userId: state.user.id, index: idx });
    board.appendChild(cell);
  });
  renderScores(game);
  el('gameStatus').innerText = state.user.id === game.currentPlayer ? 'Your turn' : 'Waiting for opponent';
};

const renderScores = (game) => {
  const wrap = el('scores');
  wrap.innerHTML = '';
  Object.entries(game.scores).forEach(([id, score], idx) => {
    const pill = document.createElement('div');
    pill.className = 'score-pill';
    const symbol = idx === 0 ? 'X' : 'O';
    const name = state.lobby?.roster?.[id] || id;
    pill.innerText = `${symbol} (${name}): ${score}`;
    wrap.appendChild(pill);
  });
};

el('checkName').onclick = async () => {
  const name = el('username').value.trim();
  if (!name) return;
  const check = await post('/api/check-username', { name });
  if (!check.available) {
    el('nameStatus').innerText = `Taken. How about ${check.suggestion}?`;
    return;
  }
  const res = await post('/api/register', { name });
  state.user = res.user;
  el('userDisplay').innerText = `Logged in as ${res.user.name}`;
  show('menu');
  sseConnect();
};

el('createLobby').onclick = async () => {
  const res = await post('/api/create-lobby', { userId: state.user.id, name: `${state.user.name}'s lobby`, isPublic: true });
  renderLobby(res.lobby);
};

el('browseLobby').onclick = async () => {
  const list = await (await fetch('/api/public-lobbies')).json();
  const box = el('publicList');
  box.innerHTML = '<h3>Public lobbies</h3>';
  list.lobbies.forEach((l) => {
    const btn = document.createElement('button');
    btn.innerText = `${l.name} (${l.code})`;
    btn.onclick = () => joinCode(l.code);
    box.appendChild(btn);
  });
  box.classList.remove('hidden');
};

const joinCode = async (code) => {
  const res = await post('/api/join-lobby', { userId: state.user.id, code });
  renderLobby(res.lobby);
};

el('joinByCode').onclick = async () => {
  const code = prompt('Lobby code');
  if (code) joinCode(code);
};

el('leaveLobby').onclick = async () => {
  if (!state.lobby) return;
  await post('/api/leave-lobby', { userId: state.user.id, lobbyId: state.lobby.id });
  state.lobby = null;
  show('menu');
};

el('applySettings').onclick = async () => {
  const settings = collectSettings();
  await post('/api/update-settings', { lobbyId: state.lobby.id, userId: state.user.id, settings });
};

const collectSettings = () => ({
  mode: el('mode').value,
  gridSize: Number(el('gridSize').value),
  winLength: Number(el('winLength').value),
  allowDiagonal: el('allowDiagonal').checked,
  allowVertical: el('allowVertical').checked,
  allowHorizontal: el('allowHorizontal').checked,
  matchWinsToTakeTournament: Number(el('matchWins').value),
  powerUps: el('powerUps').checked,
  powerUpLimit: Number(el('powerUpLimit').value),
  forgetAfter: Number(el('forgetAfter').value)
});

el('startMatch').onclick = async () => {
  const res = await post('/api/start-tournament', { lobbyId: state.lobby.id, userId: state.user.id, mode: 'manual' });
  if (res.error) alert(res.error);
};

el('randomMatch').onclick = async () => {
  const res = await post('/api/start-tournament', { lobbyId: state.lobby.id, userId: state.user.id, mode: 'random' });
  if (res.error) alert(res.error);
};

el('chatToggle').onchange = async (e) => {
  await post('/api/toggle-chat', { lobbyId: state.lobby.id, userId: state.user.id, enabled: e.target.checked });
};

el('sendChat').onclick = async () => {
  if (!state.lobby) return;
  const text = el('chatText').value.trim();
  if (!text) return;
  await post('/api/chat', { lobbyId: state.lobby.id, userId: state.user.id, text });
  el('chatText').value = '';
};

el('backToLobby').onclick = () => {
  show('lobby');
};

el('playAi').onclick = () => {
  alert('AI play loads a single player lobby with simple opponent. Use the settings to experiment.');
  createAiLobby();
};

el('casual').onclick = async () => {
  const lobby = await post('/api/create-lobby', { userId: state.user.id, name: 'Casual', isPublic: true });
  await post('/api/start-tournament', { lobbyId: lobby.lobby.id, userId: state.user.id, mode: 'manual' });
};

const createAiLobby = async () => {
  state.aiMode = true;
  const res = await post('/api/create-lobby', { userId: state.user.id, name: `${state.user.name} vs AI`, isPublic: false });
  renderLobby(res.lobby);
  await post('/api/start-tournament', { lobbyId: res.lobby.id, userId: state.user.id, mode: 'manual', aiOpponent: true, aiName: 'Arcade AI' });
};

// quick demo AI move: random legal spot
const maybeAIMove = () => {
  if (!state.aiMode || !state.lobby || !state.lobby.game) return;
  const { game, settings } = state.lobby;
  const aiId = state.lobby.players[1];
  if (game.currentPlayer !== aiId) return;
  const empties = game.board.map((v, i) => (v ? null : i)).filter((v) => v !== null);
  const pick = empties[Math.floor(Math.random() * empties.length)];
  post('/api/move', { lobbyId: state.lobby.id, userId: aiId, index: pick });
};

setInterval(maybeAIMove, 1200);

// SSE auto-refresh poll for lobby list so friends can join
setInterval(async () => {
  if (views.menu.classList.contains('hidden')) return;
  const list = await (await fetch('/api/public-lobbies')).json();
  const box = el('publicList');
  box.innerHTML = '<h3>Public lobbies</h3>';
  list.lobbies.forEach((l) => {
    const btn = document.createElement('button');
    btn.innerText = `${l.name} (${l.code})`;
    btn.onclick = () => joinCode(l.code);
    box.appendChild(btn);
  });
}, 5000);
