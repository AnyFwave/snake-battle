// ========== Client: Snake Battle Royale — 联机模式 + 模式路由 ==========

// ---- 可配置的 WebSocket URL ----
function getWSURL() {
  const input = document.getElementById('serverUrlInput');
  const customUrl = input ? input.value.trim() : '';
  if (customUrl) {
    const hasProtocol = customUrl.startsWith('ws://') || customUrl.startsWith('wss://');
    return hasProtocol ? customUrl : `ws://${customUrl}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}`;
}

// ========== UI 元素 ==========
const $menu = document.getElementById('menu');
const $lobby = document.getElementById('lobby');
const $game = document.getElementById('game');
const $result = document.getElementById('result');
const $aiConfig = document.getElementById('aiConfig');
const $multiplayerSetup = document.getElementById('multiplayerSetup');
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
let mpRenderLoopId = null;
let gameStartTime = 0;
let killMessages = [];
let currentMode = null;          // 'single' | 'ai' | 'multiplayer'
let reconnectAttempts = 0;
let reconnectTimer = null;

// ========== 全局面板管理 ==========
function showPanel(panel) {
  [$menu, $lobby, $game, $result, $aiConfig, $multiplayerSetup].forEach(p => {
    if (p) p.style.display = 'none';
  });
  panel.style.display = 'block';
}

function cleanupAll() {
  // 停止单机模式
  if (window.SinglePlayerMode && SinglePlayerMode.gameRunning) {
    SinglePlayerMode.exit();
  }
  // 停止人机模式
  if (window.AIMode && AIMode.gameRunning) {
    AIMode.exit();
  }
  // 停止联机模式
  gameRunning = false;
  if (mpRenderLoopId) { cancelAnimationFrame(mpRenderLoopId); mpRenderLoopId = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectAttempts = 0;
  players = [];
  food = [];
  killMessages = [];
  $killFeed.innerHTML = '';
}

// ========== 模式切换 ==========
function switchMode(mode) {
  cleanupAll();

  // 从其他模式的游戏面板清理
  if (ws && mode !== 'multiplayer') {
    try { ws.close(); } catch {}
    ws = null;
    roomId = null;
    myId = null;
  }

  currentMode = mode;

  switch (mode) {
    case 'single':
      SinglePlayerMode.start();
      break;
    case 'ai':
      AIMode.showConfig();
      break;
    case 'multiplayer':
      showPanel($multiplayerSetup);
      $connectionStatus.textContent = '已断开';
      $connectionStatus.className = 'disconnected';
      break;
    case 'menu':
      currentMode = null;
      showPanel($menu);
      $connectionStatus.textContent = '未连接';
      $connectionStatus.className = '';
      break;
  }
}

// ========== 连接 WebSocket ==========
function connectWS() {
  return new Promise((resolve, reject) => {
    const url = getWSURL();
    console.log('[WS] connecting to', url);
    const socket = new WebSocket(url);
    let resolved = false;

    socket.onopen = () => {
      $connectionStatus.textContent = '已连接';
      $connectionStatus.className = 'connected';
      resolved = true;
      reconnectAttempts = 0; // 连接成功，重置重试计数
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

      // 自动重连（仅联机模式 + 已在房间中）
      if (resolved && currentMode === 'multiplayer' && roomId && reconnectAttempts < 3) {
        reconnectAttempts++;
        const delay = 2000 * reconnectAttempts;
        $connectionStatus.textContent = `重连中(${reconnectAttempts}/3)...`;
        reconnectTimer = setTimeout(async () => {
          try {
            ws = await connectWS();
            // 重新加入房间
            ws.send(JSON.stringify({ type: 'joinRoom', roomId, name: playerName }));
            console.log('[WS] re-joined room', roomId);
          } catch {
            $connectionStatus.textContent = '重连失败';
          }
        }, delay);
      } else if (resolved && gameRunning) {
        showToast('与服务器断开连接');
        switchMode('menu');
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
      case 'serverInfo':
        console.log('[WS] server info', msg);
        break;

      case 'pong':
        // 心跳回复，无需处理
        break;

      case 'roomCreated':
        roomId = msg.roomId;
        document.getElementById('lobbyRoomId').textContent = roomId;
        showPanel($lobby);
        break;

      case 'roomJoined':
        roomId = msg.roomId;
        document.getElementById('lobbyRoomId').textContent = roomId;
        showPanel($lobby);
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
        if (mpRenderLoopId) { cancelAnimationFrame(mpRenderLoopId); mpRenderLoopId = null; }
        showResult(msg);
        break;

      case 'error':
        showToast(msg.message);
        break;

      default:
        console.log('[WS] unknown type:', msg.type);
    }
  } catch (err) {
    console.error('[WS] handleMessage error:', err);
  }
}

// ========== 联机渲染循环 ==========
function mpRenderLoop() {
  if (!gameRunning) return;

  const cellSize = SnakeRenderer.calcCellSize(mapSize.w, mapSize.h);
  $canvas.width = mapSize.w * cellSize;
  $canvas.height = mapSize.h * cellSize;

  SnakeRenderer.render(ctx, {
    mapW: mapSize.w,
    mapH: mapSize.h,
    players: players,
    food: food,
  }, myId, cellSize);

  // 计时器 & 存活
  const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
  const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const sec = String(elapsed % 60).padStart(2, '0');
  $gameTimer.textContent = `${min}:${sec}`;
  const alives = players.filter(p => p.alive).length;
  $aliveCount.textContent = `存活：${alives}`;

  mpRenderLoopId = requestAnimationFrame(mpRenderLoop);
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
  const cellSize = SnakeRenderer.calcCellSize(mapSize.w, mapSize.h);
  $canvas.width = mapSize.w * cellSize;
  $canvas.height = mapSize.h * cellSize;

  showPanel($game);
  mpRenderLoop();
}

function showLobby() {
  document.getElementById('lobbyRoomId').textContent = roomId;
  showPanel($lobby);
}

function showResult(msg) {
  const titleEl = document.getElementById('resultTitle');
  const winnerEl = document.getElementById('winnerInfo');
  const rankingEl = document.getElementById('rankingList');

  if (msg.winner) {
    titleEl.textContent = '🏆 游戏结束！';
    winnerEl.innerHTML = `
      <p>冠军：<strong style="color:#ffd700;">${msg.winner.name}</strong></p>
      <p>长度：${msg.winner.length} | 击杀：${msg.winner.kills}</p>
    `;
  } else {
    titleEl.textContent = '🤝 平局！';
    winnerEl.innerHTML = '<p>所有玩家同时出局</p>';
  }

  rankingEl.innerHTML = msg.ranking.map((r, i) => `
    <li>
      <span class="rank-name">#${i + 1} ${r.name} ${r.alive ? '👑' : '💀'}</span>
      <span class="rank-stats">长度 ${r.length} | 击杀 ${r.kills}</span>
    </li>
  `).join('');

  // 恢复按钮
  const btnBack = document.getElementById('btnBackToMenu');
  btnBack.textContent = '返回大厅';
  btnBack.onclick = () => {
    $result.style.display = 'none';
    showLobby();
  };
  const btn2 = document.getElementById('btnBackToMenu2');
  if (btn2) btn2.remove();

  showPanel($result);
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

// ========== Toast ==========
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ========== 击杀日志 ==========
function addKillMessage(text) {
  killMessages.push(text);
  if (killMessages.length > 20) killMessages.shift();
  $killFeed.innerHTML = killMessages.map(m => `<div class="kill-msg">${m}</div>`).join('');
  $killFeed.scrollTop = $killFeed.scrollHeight;
}

// ========== 键盘输入（全局，按模式分发）==========
document.addEventListener('keydown', (e) => {
  // 只处理方向键
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
  if (!dir) return;

  // 阻止页面滚动
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(
    e.key.toLowerCase())) {
    e.preventDefault();
  }

  // 根据活跃模式分发方向
  if (currentMode === 'single' && SinglePlayerMode.engine) {
    SinglePlayerMode.engine.setDirection(SinglePlayerMode.myPlayerIndex, dir);
  } else if (currentMode === 'ai' && AIMode.engine) {
    AIMode.engine.setDirection(AIMode.myPlayerIndex, dir);
  } else if (currentMode === 'multiplayer' && gameRunning && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'changeDir', dir }));
  }
});

// ========== 联机按钮事件 ==========
document.getElementById('btnCreate').addEventListener('click', async () => {
  const name = document.getElementById('mpNameInput').value.trim();
  if (!name) return showToast('请输入昵称');
  playerName = name;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    try { ws = await connectWS(); } catch {
      showToast('连接服务器失败，请检查服务器地址或刷新重试');
      return;
    }
  }

  console.log('[WS] → createRoom', name);
  ws.send(JSON.stringify({ type: 'createRoom', name }));
});

document.getElementById('btnJoin').addEventListener('click', async () => {
  const name = document.getElementById('mpNameInput').value.trim();
  const rid = document.getElementById('roomInput').value.trim().toUpperCase();
  if (!name) return showToast('请输入昵称');
  if (!rid) return showToast('请输入房间号');
  playerName = name;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    try { ws = await connectWS(); } catch {
      showToast('连接服务器失败，请检查服务器地址或刷新重试');
      return;
    }
  }

  if (_pendingJoinTimeout) clearTimeout(_pendingJoinTimeout);
  _pendingJoinTimeout = setTimeout(() => {
    showToast('加入房间超时，请检查房间号是否正确，或刷新页面重试');
    _pendingJoinTimeout = null;
  }, 5000);

  console.log('[WS] → joinRoom', rid, name);
  ws.send(JSON.stringify({ type: 'joinRoom', roomId: rid, name }));
});

document.getElementById('btnMPBack').addEventListener('click', () => {
  switchMode('menu');
});

document.getElementById('btnStart').addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'startGame' }));
  }
});

document.getElementById('btnLeaveLobby').addEventListener('click', () => {
  if (ws) { try { ws.close(); } catch {} }
  ws = null;
  roomId = null;
  myId = null;
  players = [];
  switchMode('menu');
});

// ========== 模式选择卡片事件 ==========
document.querySelectorAll('.mode-card').forEach(card => {
  card.addEventListener('click', () => {
    const mode = card.dataset.mode;
    switchMode(mode);
  });
});

// ========== 人机配置面板事件 ==========
// 对手数量选择
document.querySelectorAll('#botCountGroup .btn-group-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#botCountGroup .btn-group-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// 难度选择
document.querySelectorAll('#difficultyGroup .btn-group-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#difficultyGroup .btn-group-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

document.getElementById('btnAIStart').addEventListener('click', () => {
  const countBtn = document.querySelector('#botCountGroup .btn-group-btn.active');
  const diffBtn = document.querySelector('#difficultyGroup .btn-group-btn.active');
  const botCount = parseInt(countBtn ? countBtn.dataset.count : 4);
  const difficulty = diffBtn ? diffBtn.dataset.diff : 'medium';
  $aiConfig.style.display = 'none';
  AIMode.start(botCount, difficulty);
  currentMode = 'ai';
});

document.getElementById('btnAIBack').addEventListener('click', () => {
  switchMode('menu');
});

// ========== 窗口大小变化 ==========
window.addEventListener('resize', () => {
  if (gameRunning || (currentMode === 'single' && SinglePlayerMode.gameRunning) ||
      (currentMode === 'ai' && AIMode.gameRunning)) {
    const mw = currentMode === 'multiplayer' ? mapSize.w : 60;
    const mh = currentMode === 'multiplayer' ? mapSize.h : 40;
    const cs = SnakeRenderer.calcCellSize(mw, mh);
    $canvas.width = mw * cs;
    $canvas.height = mh * cs;
  }
});
