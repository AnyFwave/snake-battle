// ========== Client: Snake Battle Royale ==========
const HOST = window.location.host;
const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${HOST}`;

// ========== UI 元素 ==========
const $menu = document.getElementById('menu');
const $lobby = document.getElementById('lobby');
const $game = document.getElementById('game');
const $result = document.getElementById('result');
const $canvas = document.getElementById('gameCanvas');
const $killFeed = document.getElementById('killFeed');
const $aliveCount = document.getElementById('aliveCount');
const $gameTimer = document.getElementById('gameTimer');
const $connectionStatus = document.getElementById('connectionStatus');

const ctx = $canvas.getContext('2d');

// ========== 状态 ==========
let ws = null;
let roomId = null;
let playerName = '';
let players = [];
let food = [];
let myId = null;
let gameRunning = false;
let mapSize = { w: 60, h: 40 };
let animFrameId = null;
let gameStartTime = 0;
let killMessages = [];

// ========== 连接 WebSocket ==========
function connectWS() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL);
    let resolved = false;
    socket.onopen = () => {
      $connectionStatus.textContent = '已连接';
      $connectionStatus.className = 'connected';
      resolved = true;
      resolve(socket);
    };
    socket.onerror = () => {
      $connectionStatus.textContent = '连接失败';
      $connectionStatus.className = 'disconnected';
      if (!resolved) reject(new Error('WebSocket 连接失败'));
    };
    socket.onclose = () => {
      $connectionStatus.textContent = '已断开';
      $connectionStatus.className = 'disconnected';
      // 只有曾经连成功过的 socket 断掉才触发回菜单
      if (resolved && gameRunning) {
        showToast('与服务器断开连接');
        backToMenu();
      }
    };
    socket.onmessage = handleMessage;
  });
}

// ========== 消息处理 ==========
let _pendingJoinTimeout = null;

function handleMessage(e) {
  try {
    const msg = JSON.parse(e.data);
    console.log('[WS] ←', msg.type, msg);

    // 收到任何响应都清除加入超时
    if (_pendingJoinTimeout && (msg.type === 'roomJoined' || msg.type === 'error')) {
      clearTimeout(_pendingJoinTimeout);
      _pendingJoinTimeout = null;
    }

    switch (msg.type) {
      case 'roomCreated':
        roomId = msg.roomId;
        document.getElementById('lobbyRoomId').textContent = roomId;
        showLobby();
        break;

      case 'roomJoined':
        roomId = msg.roomId;
        document.getElementById('lobbyRoomId').textContent = roomId;
        showLobby();
        break;

      case 'playerList':
        players = msg.players;
        renderPlayerList();
        break;

      case 'playerLeft':
        players = msg.players;
        renderPlayerList();
        break;

      case 'gameStarted':
        mapSize = msg.mapSize;
        startGameUI();
        break;

      case 'gameState':
        players = msg.players;
        food = msg.food;
        break;

      case 'playerDied':
        addKillMessage(`💀 ${msg.name} ${msg.reason}（长度: ${msg.length}, 击杀: ${msg.kills}）`);
        break;

      case 'gameOver':
        gameRunning = false;
        cancelAnimationFrame(animFrameId);
        showResult(msg);
        break;

      case 'error':
        showToast(msg.message);
        break;

      default:
        console.log('[WS] unknown type:', msg.type);
    }
  } catch (err) {
    console.error('[WS] handleMessage error:', err, 'raw:', typeof e.data === 'string' ? e.data.substring(0, 300) : e.data);
  }
}

// ========== 面板切换 ==========
function showPanel(panel) {
  [$menu, $lobby, $game, $result].forEach(p => p.style.display = 'none');
  panel.style.display = 'block';
}

function showLobby() {
  document.getElementById('lobbyRoomId').textContent = roomId;
  showPanel($lobby);
}

function backToMenu() {
  gameRunning = false;
  cancelAnimationFrame(animFrameId);
  players = [];
  food = [];
  roomId = null;
  myId = null;
  killMessages = [];
  $killFeed.innerHTML = '';
  showPanel($menu);
}

function backToLobby() {
  gameRunning = false;
  cancelAnimationFrame(animFrameId);
  players = [];
  food = [];
  killMessages = [];
  $killFeed.innerHTML = '';
  showPanel($lobby);
}

// ========== 按钮事件 ==========
document.getElementById('btnCreate').addEventListener('click', async () => {
  const name = document.getElementById('nameInput').value.trim();
  if (!name) return showToast('请输入昵称');
  playerName = name;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    try { ws = await connectWS(); } catch {
      showToast('连接服务器失败，请刷新重试');
      return;
    }
  }

  console.log('[WS] → createRoom', name);
  ws.send(JSON.stringify({ type: 'createRoom', name }));
});

document.getElementById('btnJoin').addEventListener('click', async () => {
  const name = document.getElementById('nameInput').value.trim();
  const rid = document.getElementById('roomInput').value.trim().toUpperCase();
  if (!name) return showToast('请输入昵称');
  if (!rid) return showToast('请输入房间号');
  playerName = name;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    try { ws = await connectWS(); } catch {
      showToast('连接服务器失败，请刷新重试');
      return;
    }
  }

  // 5 秒超时：没收到 roomJoined / error 就提示
  if (_pendingJoinTimeout) clearTimeout(_pendingJoinTimeout);
  _pendingJoinTimeout = setTimeout(() => {
    showToast('加入房间超时，请检查房间号是否正确，或刷新页面重试');
    _pendingJoinTimeout = null;
  }, 5000);

  console.log('[WS] → joinRoom', rid, name);
  ws.send(JSON.stringify({ type: 'joinRoom', roomId: rid, name }));
});

document.getElementById('btnStart').addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'startGame' }));
});

document.getElementById('btnLeaveLobby').addEventListener('click', () => {
  backToMenu();
  // 重新连接以离开当前房间
  if (ws) ws.close();
  ws = null;
});

document.getElementById('btnBackToMenu').addEventListener('click', () => {
  showLobby(); // 留在房间里可以继续下一局
});

// ========== Toast ==========
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ========== 玩家列表 ==========
function renderPlayerList() {
  const list = document.getElementById('playerList');
  list.innerHTML = players.map(p => `
    <li>
      <span class="player-dot" style="background:${p.color}"></span>
      <span class="player-name">${p.name}</span>
      ${p.id === myId ? '<span class="player-tag">你</span>' : ''}
    </li>
  `).join('');
}

// ========== 游戏界面 ==========
function startGameUI() {
  gameRunning = true;
  gameStartTime = Date.now();
  killMessages = [];
  $killFeed.innerHTML = '';

  // 找到自己的 ID
  const me = players.find(p => p.name === playerName);
  if (me) myId = me.id;

  // 设置画布大小
  const cellSize = calcCellSize();
  $canvas.width = mapSize.w * cellSize;
  $canvas.height = mapSize.h * cellSize;

  showPanel($game);
  gameLoop();
}

function calcCellSize() {
  const maxW = Math.min(window.innerWidth - 40, 700);
  const maxH = Math.min(window.innerHeight - 160, 500);
  return Math.floor(Math.min(maxW / mapSize.w, maxH / mapSize.h));
}

// ========== 渲染 ==========
function gameLoop() {
  if (!gameRunning) return;

  const cellSize = calcCellSize();
  $canvas.width = mapSize.w * cellSize;
  $canvas.height = mapSize.h * cellSize;
  ctx.clearRect(0, 0, $canvas.width, $canvas.height);

  // 背景网格
  ctx.fillStyle = '#0d0d25';
  ctx.fillRect(0, 0, $canvas.width, $canvas.height);
  ctx.strokeStyle = '#111133';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= mapSize.w; x++) {
    ctx.beginPath();
    ctx.moveTo(x * cellSize, 0);
    ctx.lineTo(x * cellSize, mapSize.h * cellSize);
    ctx.stroke();
  }
  for (let y = 0; y <= mapSize.h; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * cellSize);
    ctx.lineTo(mapSize.w * cellSize, y * cellSize);
    ctx.stroke();
  }

  // 食物
  food.forEach(f => {
    const cx = f.x * cellSize + cellSize / 2;
    const cy = f.y * cellSize + cellSize / 2;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(cx, cy, cellSize * 0.35, 0, Math.PI * 2);
    ctx.fill();
    // 光晕
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.arc(cx, cy, cellSize * 0.15, 0, Math.PI * 2);
    ctx.fill();
  });

  // 蛇
  players.forEach(p => {
    if (!p.segments || p.segments.length === 0) return;
    const isMe = p.id === myId;
    const alpha = p.alive ? 1 : 0.3;

    p.segments.forEach((seg, i) => {
      const x = seg.x * cellSize;
      const y = seg.y * cellSize;
      const pad = 1;

      ctx.globalAlpha = alpha;

      if (i === 0) {
        // 蛇头 — 圆角方形
        ctx.fillStyle = isMe ? '#fff' : p.color;
        roundRect(x + pad, y + pad, cellSize - pad * 2, cellSize - pad * 2, 4);
        ctx.fill();

        // 眼睛
        ctx.fillStyle = p.alive ? '#000' : '#666';
        const eyeR = cellSize * 0.1;
        const cx = x + cellSize / 2;
        const cy = y + cellSize / 2;
        ctx.beginPath();
        ctx.arc(cx - cellSize * 0.2, cy - cellSize * 0.1, eyeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + cellSize * 0.2, cy - cellSize * 0.1, eyeR, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 身体
        const ratio = 1 - (i / p.segments.length) * 0.4;
        ctx.fillStyle = isMe ? `rgba(200,200,255,${ratio})` : adjustAlpha(p.color, ratio);
        roundRect(x + pad, y + pad, cellSize - pad * 2, cellSize - pad * 2, 3);
        ctx.fill();
      }

      ctx.globalAlpha = 1;

      // 自己蛇的边框
      if (isMe && p.alive) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        roundRect(x + pad, y + pad, cellSize - pad * 2, cellSize - pad * 2, 4);
        ctx.stroke();
      }
    });

    // 死亡蛇的 X
    if (!p.alive && p.segments.length > 0) {
      const hx = p.segments[0].x * cellSize + cellSize / 2;
      const hy = p.segments[0].y * cellSize + cellSize / 2;
      const s = cellSize * 0.3;
      ctx.strokeStyle = '#f44';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx - s, hy - s);
      ctx.lineTo(hx + s, hy + s);
      ctx.moveTo(hx + s, hy - s);
      ctx.lineTo(hx - s, hy + s);
      ctx.stroke();
    }
  });

  // 计时器 & 存活
  if (gameRunning) {
    const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
    const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const sec = String(elapsed % 60).padStart(2, '0');
    $gameTimer.textContent = `${min}:${sec}`;
    const alives = players.filter(p => p.alive).length;
    $aliveCount.textContent = `存活：${alives}`;
  }

  animFrameId = requestAnimationFrame(gameLoop);
}

// ========== 键盘输入 ==========
document.addEventListener('keydown', (e) => {
  if (!gameRunning) return;

  let dir = null;
  switch (e.key.toLowerCase()) {
    case 'w':
    case 'arrowup':    dir = { x: 0, y: -1 }; break;
    case 's':
    case 'arrowdown':  dir = { x: 0, y: 1 };  break;
    case 'a':
    case 'arrowleft':  dir = { x: -1, y: 0 }; break;
    case 'd':
    case 'arrowright': dir = { x: 1, y: 0 };  break;
  }

  if (dir && ws && ws.readyState === WebSocket.OPEN) {
    e.preventDefault();
    ws.send(JSON.stringify({ type: 'changeDir', dir }));
  }
});

// ========== 击杀日志 ==========
function addKillMessage(text) {
  killMessages.push(text);
  if (killMessages.length > 20) killMessages.shift();
  $killFeed.innerHTML = killMessages.map(m => `<div class="kill-msg">${m}</div>`).join('');
  $killFeed.scrollTop = $killFeed.scrollHeight;
}

// ========== 结算 ==========
function showResult(msg) {
  const title = document.getElementById('resultTitle');
  const winnerInfo = document.getElementById('winnerInfo');
  const rankingList = document.getElementById('rankingList');

  if (msg.winner) {
    title.textContent = '🏆 游戏结束！';
    winnerInfo.innerHTML = `
      <p>冠军：<strong style="color:#ffd700;">${msg.winner.name}</strong></p>
      <p>长度：${msg.winner.length} | 击杀：${msg.winner.kills}</p>
    `;
  } else {
    title.textContent = '🤝 平局！';
    winnerInfo.innerHTML = '<p>所有玩家同时出局</p>';
  }

  rankingList.innerHTML = msg.ranking.map((r, i) => `
    <li>
      <span class="rank-name">#${i + 1} ${r.name} ${r.alive ? '👑' : '💀'}</span>
      <span class="rank-stats">长度 ${r.length} | 击杀 ${r.kills}</span>
    </li>
  `).join('');

  showPanel($result);
}

// ========== 工具函数 ==========
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// 解析 hsl 颜色并修改 alpha
function adjustAlpha(hsl, alpha) {
  const match = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (match) {
    return `hsla(${match[1]}, ${match[2]}%, ${match[3]}%, ${alpha})`;
  }
  return hsl;
}

// ========== 初始化 ==========
async function init() {
  try { ws = await connectWS(); } catch { /* 用户操作时再连 */ }
}

init();

// 窗口大小变化时重设画布
window.addEventListener('resize', () => {
  if (gameRunning) {
    const cs = calcCellSize();
    $canvas.width = mapSize.w * cs;
    $canvas.height = mapSize.h * cs;
  }
});
