const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const livesEl = document.getElementById("lives");
const coinsEl = document.getElementById("coins");
const waveEl = document.getElementById("wave");
const statusEl = document.getElementById("status");
const restartButton = document.getElementById("restart");

const PATH_POINTS = [
  { x: 40, y: 280 },
  { x: 320, y: 280 },
  { x: 320, y: 120 },
  { x: 620, y: 120 },
  { x: 620, y: 440 },
  { x: 860, y: 440 },
];

const GAME_CONFIG = {
  towerCost: 60,
  startCoins: 200,
  startLives: 10,
  waves: 5,
  creepBaseHealth: 40,
  creepHealthGrowth: 12,
  creepSpeed: 65,
  reward: 20,
};

const colors = {
  path: "#725437",
  grass: "#0b4d26",
  tower: "#0ea5e9",
  towerOutline: "#082f49",
  creep: "#ef4444",
  bullet: "#facc15",
  text: "#e2e8f0",
};

let lastTime = performance.now();
let gameState = createInitialState();

function createInitialState() {
  return {
    lives: GAME_CONFIG.startLives,
    coins: GAME_CONFIG.startCoins,
    wave: 1,
    creeps: [],
    towers: [],
    projectiles: [],
    spawnTimer: 0,
    creepsSpawned: 0,
    status: "Place towers and defend!",
    finished: false,
  };
}

function resetGame() {
  gameState = createInitialState();
}

class Creep {
  constructor(wave) {
    this.health = GAME_CONFIG.creepBaseHealth + (wave - 1) * GAME_CONFIG.creepHealthGrowth;
    this.speed = GAME_CONFIG.creepSpeed;
    this.progress = 0;
    this.radius = 12;
  }

  get position() {
    const segment = Math.min(PATH_POINTS.length - 2, Math.floor(this.progress));
    const t = this.progress - segment;
    const from = PATH_POINTS[segment];
    const to = PATH_POINTS[segment + 1];
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
  }

  update(dt) {
    const segment = Math.min(PATH_POINTS.length - 2, Math.floor(this.progress));
    const from = PATH_POINTS[segment];
    const to = PATH_POINTS[segment + 1];
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const travel = (this.speed * dt) / dist;
    this.progress += travel;
  }

  reachedGoal() {
    return this.progress >= PATH_POINTS.length - 1;
  }
}

class Tower {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.range = 140;
    this.fireRate = 0.8;
    this.cooldown = 0;
    this.damage = 25;
  }

  update(dt, creeps, projectiles) {
    this.cooldown -= dt;
    if (this.cooldown > 0) return;

    const target = creeps
      .filter((c) => c.health > 0)
      .find((c) => distance(c.position, { x: this.x, y: this.y }) <= this.range);

    if (target) {
      projectiles.push(new Projectile(this.x, this.y, target, this.damage));
      this.cooldown = 1 / this.fireRate;
    }
  }
}

class Projectile {
  constructor(x, y, target, damage) {
    this.x = x;
    this.y = y;
    this.target = target;
    this.damage = damage;
    this.speed = 250;
  }

  update(dt) {
    if (!this.target || this.target.health <= 0) return true;
    const { x: tx, y: ty } = this.target.position;
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dist = Math.hypot(dx, dy);
    const step = this.speed * dt;

    if (dist < step) {
      this.target.health -= this.damage;
      return true;
    }

    this.x += (dx / dist) * step;
    this.y += (dy / dist) * step;
    return false;
  }
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function update(dt) {
  if (gameState.finished) return;

  spawnCreeps(dt);

  gameState.creeps.forEach((creep) => creep.update(dt));
  gameState.towers.forEach((tower) => tower.update(dt, gameState.creeps, gameState.projectiles));

  gameState.projectiles = gameState.projectiles.filter((projectile) => {
    const shouldRemove = projectile.update(dt);
    return !shouldRemove;
  });

  resolveCombat();
  updateUI();
  checkEndConditions();
}

function spawnCreeps(dt) {
  const creepsPerWave = 8 + gameState.wave;
  const spawnInterval = 1.2;

  if (gameState.creepsSpawned >= creepsPerWave) return;

  gameState.spawnTimer -= dt;
  if (gameState.spawnTimer <= 0) {
    gameState.creeps.push(new Creep(gameState.wave));
    gameState.creepsSpawned += 1;
    gameState.spawnTimer = spawnInterval;
  }
}

function resolveCombat() {
  const aliveCreeps = [];
  for (const creep of gameState.creeps) {
    if (creep.health <= 0) {
      gameState.coins += GAME_CONFIG.reward;
      continue;
    }

    if (creep.reachedGoal()) {
      gameState.lives -= 1;
      continue;
    }

    aliveCreeps.push(creep);
  }
  gameState.creeps = aliveCreeps;

  if (gameState.creeps.length === 0 && gameState.creepsSpawned >= 8 + gameState.wave) {
    if (gameState.wave < GAME_CONFIG.waves) {
      gameState.wave += 1;
      gameState.creepsSpawned = 0;
      gameState.spawnTimer = 0;
      gameState.status = `Wave ${gameState.wave} incoming!`;
    }
  }
}

function checkEndConditions() {
  if (gameState.lives <= 0) {
    gameState.status = "You were overrun!";
    gameState.finished = true;
    return;
  }

  if (gameState.wave === GAME_CONFIG.waves && gameState.creeps.length === 0 && gameState.creepsSpawned >= 8 + gameState.wave) {
    gameState.status = "Victory! All waves cleared.";
    gameState.finished = true;
  }
}

function updateUI() {
  livesEl.textContent = gameState.lives;
  coinsEl.textContent = `${gameState.coins} (-${GAME_CONFIG.towerCost} per tower)`;
  waveEl.textContent = `${gameState.wave}/${GAME_CONFIG.waves}`;
  statusEl.textContent = gameState.status;
  statusEl.className = gameState.finished
    ? `badge ${gameState.lives > 0 ? "success" : "danger"}`
    : "";
}

function draw() {
  ctx.fillStyle = colors.grass;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawPath();
  drawTowers();
  drawCreeps();
  drawProjectiles();
}

function drawPath() {
  ctx.strokeStyle = colors.path;
  ctx.lineWidth = 32;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(PATH_POINTS[0].x, PATH_POINTS[0].y);
  for (let i = 1; i < PATH_POINTS.length; i += 1) {
    ctx.lineTo(PATH_POINTS[i].x, PATH_POINTS[i].y);
  }
  ctx.stroke();
}

function drawTowers() {
  for (const tower of gameState.towers) {
    ctx.fillStyle = colors.tower;
    ctx.strokeStyle = colors.towerOutline;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tower.x, tower.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(14,165,233,0.25)";
    ctx.beginPath();
    ctx.arc(tower.x, tower.y, tower.range, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawCreeps() {
  for (const creep of gameState.creeps) {
    const { x, y } = creep.position;
    ctx.fillStyle = colors.creep;
    ctx.beginPath();
    ctx.arc(x, y, creep.radius, 0, Math.PI * 2);
    ctx.fill();

    const healthRatio = Math.max(creep.health, 0) / (GAME_CONFIG.creepBaseHealth + (gameState.wave - 1) * GAME_CONFIG.creepHealthGrowth);
    ctx.fillStyle = "#111827";
    ctx.fillRect(x - 14, y - 20, 28, 6);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(x - 14, y - 20, 28 * healthRatio, 6);
  }
}

function drawProjectiles() {
  ctx.fillStyle = colors.bullet;
  for (const projectile of gameState.projectiles) {
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function placeTower(event) {
  if (gameState.finished) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  if (gameState.coins < GAME_CONFIG.towerCost) {
    gameState.status = "Not enough coins.";
    return;
  }

  if (isOnPath(x, y)) {
    gameState.status = "Towers cannot block the road.";
    return;
  }

  const tooClose = gameState.towers.some((tower) => distance(tower, { x, y }) < 40);
  if (tooClose) {
    gameState.status = "Too close to another tower.";
    return;
  }

  gameState.towers.push(new Tower(x, y));
  gameState.coins -= GAME_CONFIG.towerCost;
  gameState.status = "Tower placed.";
  updateUI();
}

function isOnPath(x, y) {
  const threshold = 24;
  for (let i = 0; i < PATH_POINTS.length - 1; i += 1) {
    const a = PATH_POINTS[i];
    const b = PATH_POINTS[i + 1];
    const dist = distanceToSegment({ x, y }, a, b);
    if (dist < threshold) return true;
  }
  return false;
}

function distanceToSegment(p, a, b) {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const ap = { x: p.x - a.x, y: p.y - a.y };
  const abLengthSquared = ab.x * ab.x + ab.y * ab.y;
  const t = Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y) / abLengthSquared));
  const closest = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return distance(p, closest);
}

function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  update(dt);
  draw();

  requestAnimationFrame(loop);
}

canvas.addEventListener("click", placeTower);
restartButton.addEventListener("click", () => {
  resetGame();
});

updateUI();
requestAnimationFrame(loop);
