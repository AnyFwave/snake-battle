const http = require('http');
const os = require('os');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
app.use(express.static('public'));

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: Object.keys(rooms || {}).length, uptime: process.uptime() });
});

// 房间列表（调试用）
app.get('/rooms', (req, res) => {
  const roomList = {};
  const allRooms = rooms || {};
  for (const rid of Object.keys(allRooms)) {
    const r = allRooms[rid];
    roomList[rid] = { state: r.state, players: r.players ? r.players.size : 0, alive: r.alive };
  }
  res.json(roomList);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, pingInterval: 25000 });

// ========== 游戏状态（提前声明，供健康检查端点引用）==========
let rooms = {};       // { roomId: { players: Map<ws, Player>, state, timer, food } }
let playerRoom = {};  // ws → roomId 映射

// ========== 游戏常量 ==========
const MAP_W = 60;          // 地图格子宽
const MAP_H = 40;          // 地图格子高
const TICK_RATE = 8;       // 每秒 tick 次数
const FOOD_MAX = 30;        // 地图上食物数量
const INITIAL_LENGTH = 4;  // 蛇初始长度

// 随机 ID
function genId(len = 4) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// 格子随机坐标
function randPos() {
  return { x: Math.floor(Math.random() * MAP_W), y: Math.floor(Math.random() * MAP_H) };
}

// 生成食物
function spawnFood() {
  return { ...randPos(), color: `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)` };
}

// 随机方向
function randDir() {
  const dirs = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  return dirs[Math.floor(Math.random() * dirs.length)];
}

// ========== 房间管理 ==========
function createRoom() {
  const roomId = genId(4);
  rooms[roomId] = {
    players: new Map(),  // ws → playerData
    gameLoop: null,
    state: 'lobby',      // 'lobby' | 'running' | 'ended'
    food: [],
    alive: 0,
  };
  return roomId;
}

function getRoom(ws) {
  const rid = playerRoom[ws.uid];
  return rid ? rooms[rid] : null;
}

function getPlayer(ws) {
  const room = getRoom(ws);
  return room ? room.players.get(ws) : null;
}

// ========== 广播 ==========
function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  room.players.forEach((_, ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(data); } catch { /* skip broken connections */ }
    }
  });
}

// 发给所有人除自己
function broadcastOthers(room, ws, msg) {
  const data = JSON.stringify(msg);
  room.players.forEach((_, other) => {
    if (other !== ws && other.readyState === WebSocket.OPEN) {
      try { other.send(data); } catch { /* skip broken connections */ }
    }
  });
}

// ========== 游戏 Tick ==========
function gameTick(roomId) {
  const room = rooms[roomId];
  if (!room || room.state !== 'running') return;

  const players = Array.from(room.players.entries());

  // 1. 移动所有存活蛇
  for (const [ws, p] of players) {
    if (!p.alive) continue;
    p.segments.unshift({ x: p.head.x + p.dir.x, y: p.head.y + p.dir.y });
    if (p.segments.length > p.length) p.segments.pop();
  }

  // 2. 碰撞检测
  const allSegments = [];  // [{x, y, owner: ws}]
  for (const [ws, p] of players) {
    if (!p.alive) continue;
    for (const seg of p.segments) {
      allSegments.push({ ...seg, owner: ws });
    }
  }

  for (const [ws, p] of players) {
    if (!p.alive) continue;

    // 撞墙
    if (p.head.x < 0 || p.head.x >= MAP_W || p.head.y < 0 || p.head.y >= MAP_H) {
      killPlayer(room, ws, '撞墙出局');
      continue;
    }

    // 撞自己（跳过自己的头）
    for (let i = 1; i < p.segments.length; i++) {
      if (p.segments[i].x === p.head.x && p.segments[i].y === p.head.y) {
        killPlayer(room, ws, '撞到自己出局');
        break;
      }
    }

    // 撞其他蛇
    if (p.alive) {
      for (const seg of allSegments) {
        if (seg.owner === ws) continue;
        if (seg.x === p.head.x && seg.y === p.head.y) {
          const victim = room.players.get(seg.owner);
          killPlayer(room, ws, `撞到 ${victim ? victim.name : '?'} 出局`);
          // 只杀当前玩家（撞别人的人死）
          break;
        }
      }
    }
  }

  // 3. 吃食物
  for (let i = room.food.length - 1; i >= 0; i--) {
    const f = room.food[i];
    for (const [ws, p] of players) {
      if (!p.alive) continue;
      if (p.head.x === f.x && p.head.y === f.y) {
        p.length += 2;
        p.kills++;
        room.food.splice(i, 1);
        break;
      }
    }
  }

  // 4. 补充食物
  while (room.food.length < FOOD_MAX) {
    room.food.push(spawnFood());
  }

  // 5. 检查存活人数
  const alivePlayers = players.filter(([, p]) => p.alive);
  room.alive = alivePlayers.length;

  if (alivePlayers.length <= 1) {
    endGame(room, roomId);
    return;
  }

  // 6. 广播状态
  broadcast(room, {
    type: 'gameState',
    players: serializePlayers(room),
    food: room.food,
    alive: room.alive,
  });
}

function killPlayer(room, ws, reason) {
  const p = room.players.get(ws);
  if (!p || !p.alive) return;
  p.alive = false;
  broadcast(room, {
    type: 'playerDied',
    name: p.name,
    reason,
    length: p.length,
    kills: p.kills,
  });
}

function endGame(room, roomId) {
  room.state = 'ended';
  if (room.gameLoop) {
    clearInterval(room.gameLoop);
    room.gameLoop = null;
  }

  // 找冠军
  let winner = null;
  room.players.forEach(p => {
    if (p.alive) winner = p;
  });

  broadcast(room, {
    type: 'gameOver',
    winner: winner ? { name: winner.name, length: winner.length, kills: winner.kills } : null,
    ranking: getRanking(room),
  });

  // 3 秒后恢复大厅状态，可以再来一局
  setTimeout(() => {
    if (room.state === 'ended') {
      room.state = 'lobby';
      broadcast(room, { type: 'playerList', players: serializePlayers(room) });
    }
  }, 3000);
}

function serializePlayers(room) {
  const arr = [];
  room.players.forEach((p, ws) => {
    arr.push({
      id: ws.uid,
      name: p.name,
      color: p.color,
      segments: p.segments,
      alive: p.alive,
      kills: p.kills,
      length: p.length,
    });
  });
  return arr;
}

function getRanking(room) {
  const arr = [];
  room.players.forEach(p => {
    arr.push({ name: p.name, kills: p.kills, length: p.length, alive: p.alive });
  });
  arr.sort((a, b) => b.length - a.length);
  return arr;
}

// ========== WebSocket 消息处理 ==========
wss.on('connection', (ws) => {
  ws.uid = genId(8);
  console.log(`[+] ${ws.uid} 已连接`);

  // 发送服务器信息
  ws.send(JSON.stringify({
    type: 'serverInfo',
    version: '1.0.0',
    mapSize: { w: MAP_W, h: MAP_H },
  }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch {
      console.log(`[!] JSON parse error from ${ws.uid}`);
      ws.send(JSON.stringify({ type: 'error', message: '消息格式错误' }));
      return;
    }

    switch (msg.type) {
      // ---- 心跳 ----
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;

      // ---- 创建房间 ----
      case 'createRoom': {
        const roomId = createRoom();
        const color = `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`;
        rooms[roomId].players.set(ws, makePlayer(msg.name, color));
        playerRoom[ws.uid] = roomId;
        ws.send(JSON.stringify({ type: 'roomCreated', roomId }));
        broadcast(rooms[roomId], { type: 'playerList', players: serializePlayers(rooms[roomId]) });
        console.log(`[+] ${msg.name} 创建房间 ${roomId}`);
        break;
      }

      // ---- 加入房间 ----
      case 'joinRoom': {
        const room = rooms[msg.roomId];
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
          break;
        }
        if (room.state === 'running') {
          ws.send(JSON.stringify({ type: 'error', message: '游戏已开始，无法加入' }));
          break;
        }
        if (room.players.size >= 8) {
          ws.send(JSON.stringify({ type: 'error', message: '房间已满（最多8人）' }));
          break;
        }
        // 检查昵称唯一
        let nameExists = false;
        room.players.forEach(p => { if (p.name === msg.name) nameExists = true; });
        if (nameExists) {
          ws.send(JSON.stringify({ type: 'error', message: '昵称已被占用，请换一个' }));
          break;
        }

        const color = `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`;
        room.players.set(ws, makePlayer(msg.name, color));
        playerRoom[ws.uid] = roomId;
        ws.send(JSON.stringify({ type: 'roomJoined', roomId: msg.roomId }));
        broadcast(room, { type: 'playerList', players: serializePlayers(room) });
        console.log(`[+] ${msg.name} 加入房间 ${msg.roomId}`);
        break;
      }

      // ---- 开始游戏 ----
      case 'startGame': {
        const room = getRoom(ws);
        if (!room || (room.state !== 'lobby' && room.state !== 'ended')) break;
        if (room.players.size < 2) {
          ws.send(JSON.stringify({ type: 'error', message: '至少需要 2 名玩家才能开始' }));
          break;
        }
        startGame(room);
        break;
      }

      // ---- 方向输入 ----
      case 'changeDir': {
        const player = getPlayer(ws);
        if (!player || !player.alive) break;
        const { x, y } = msg.dir;
        // 禁止反向
        if (player.dir.x + x === 0 && player.dir.y + y === 0) break;
        player.dir = { x, y };
        break;
      }

      // ---- 断开 ----
      default:
        break;
    }
  });

  ws.on('close', () => {
    console.log(`[-] ${ws.uid} 断开`);
    handleDisconnect(ws);
  });

  ws.on('error', () => {
    handleDisconnect(ws);
  });
});

function makePlayer(name, color) {
  const dir = randDir();
  const head = randPos();
  const segments = [head];
  // 预生成身体（反向延伸）
  for (let i = 1; i < INITIAL_LENGTH; i++) {
    segments.push({ x: head.x - dir.x * i, y: head.y - dir.y * i });
  }
  return {
    name,
    color,
    segments,
    dir,
    length: INITIAL_LENGTH,
    alive: true,
    kills: 0,
    get head() { return this.segments[0]; },
  };
}

function startGame(room) {
  // 重置所有玩家状态
  room.players.forEach((p, ws) => {
    Object.assign(p, makePlayer(p.name, p.color));
  });

  room.state = 'running';
  room.food = [];
  room.alive = room.players.size;
  while (room.food.length < FOOD_MAX) room.food.push(spawnFood());

  broadcast(room, { type: 'gameStarted', mapSize: { w: MAP_W, h: MAP_H } });
  console.log(`[>] 游戏开始！${room.players.size} 名玩家`);

  // 启动游戏循环
  const roomEntries = [...Object.entries(rooms)].find(([, r]) => r === room);
  const roomId = roomEntries ? roomEntries[0] : null;
  if (roomId) {
    if (room.gameLoop) clearInterval(room.gameLoop);
    room.gameLoop = setInterval(() => gameTick(roomId), 1000 / TICK_RATE);
  }
}

function handleDisconnect(ws) {
  if (ws._disconnected) return;
  ws._disconnected = true;

  const room = getRoom(ws);
  if (!room) return;

  const player = room.players.get(ws);
  room.players.delete(ws);
  delete playerRoom[ws.uid];

  if (player) {
    broadcast(room, {
      type: 'playerLeft',
      name: player.name,
      players: serializePlayers(room),
    });
    console.log(`[-] ${player.name} 离开房间`);

    // 如果游戏中，标记为死亡
    if (room.state === 'running' && player.alive) {
      player.alive = false;
      broadcast(room, { type: 'playerDied', name: player.name, reason: '断开连接', length: player.length, kills: player.kills });
    }
  }

  // 清理空房间
  if (room.players.size === 0) {
    if (room.gameLoop) clearInterval(room.gameLoop);
    const roomId = Object.keys(rooms).find(k => rooms[k] === room);
    if (roomId) delete rooms[roomId];
    console.log(`[x] 房间已销毁`);
  }
}

// ========== 启动 ==========
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`🐍 Snake Battle Royale 已启动 → http://localhost:${PORT}`);
  console.log(`   绑定地址: ${HOST}:${PORT}`);

  // 打印局域网 IP，方便手机等设备连接
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // 跳过内部回环和非 IPv4
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`   📡 局域网: http://${net.address}:${PORT}`);
      }
    }
  }
});
