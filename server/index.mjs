import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager } from './rooms.mjs';

const port = Number(process.env.PORT ?? 3000);
const manager = new RoomManager();
const configuredResponseTimeout = Number(process.env.RESPONSE_TIMEOUT_MS ?? 30_000);
const responseTimeoutMs = Number.isFinite(configuredResponseTimeout) ? Math.max(5_000, configuredResponseTimeout) : 30_000;
const responseTimers = new Map();
const server = createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', service: 'sanguokill-server', version: '0.2.0', transport: 'websocket' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'not_found' }));
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}
function broadcast(room, event = 'room_state') {
  for (const player of room.players) {
    if (player.socket) send(player.socket, { type: event, state: manager.snapshot(room, player.id) });
  }
  scheduleResponseTimeout(room);
}

function scheduleResponseTimeout(room) {
  const pending = room.game?.pendingResponse;
  const key = pending
    ? [pending.type, pending.targetId, pending.type === 'rescue' ? pending.order[pending.cursor] : pending.type === 'duel' ? pending.responderId : pending.targetId, pending.cursor ?? 0].join(':')
    : null;
  const current = responseTimers.get(room.code);
  if (current?.key === key) return;
  if (current) clearTimeout(current.timer);
  responseTimers.delete(room.code);
  if (!key || room.game?.status !== 'playing') return;
  const timer = setTimeout(() => {
    responseTimers.delete(room.code);
    const liveRoom = manager.rooms.get(room.code);
    const livePending = liveRoom?.game?.pendingResponse;
    if (!liveRoom || !livePending) return;
    const expectedId = livePending.type === 'rescue'
      ? livePending.order[livePending.cursor]
      : livePending.type === 'duel' ? livePending.responderId : livePending.targetId;
    const expectedPlayer = liveRoom.players.find(p => p.id === expectedId);
    if (!expectedPlayer) return;
    try {
      manager.act(expectedPlayer.token, livePending.type === 'rescue'
        ? { type: 'rescue', response: 'pass' }
        : { type: 'respond', response: 'pass' });
      broadcast(liveRoom);
    } catch (error) {
      if (expectedPlayer.socket) sendError(expectedPlayer.socket, error?.message ?? '响应超时处理失败');
    }
  }, responseTimeoutMs);
  timer.unref?.();
  responseTimers.set(room.code, { key, timer });
}
function sendError(socket, message) {
  send(socket, { type: 'error', message: String(message).slice(0, 200) });
}

wss.on('connection', socket => {
  let token = null;
  let rateWindowStart = Date.now();
  let messageCount = 0;
  socket.on('message', raw => {
    const now = Date.now();
    if (now - rateWindowStart >= 10_000) {
      rateWindowStart = now;
      messageCount = 0;
    }
    messageCount += 1;
    if (messageCount > 60) {
      sendError(socket, '消息过于频繁，请稍后再试');
      socket.close(1008, 'rate limit');
      return;
    }
    let message;
    try { message = JSON.parse(raw.toString()); }
    catch { sendError(socket, '消息必须是有效 JSON'); return; }
    try {
      if (!message || typeof message.type !== 'string') throw new Error('缺少消息类型');
      if (message.type === 'create_room') {
        if (token) throw new Error('此连接已经加入房间，请先离开当前房间');
        const result = manager.create({ name: message.name, mode: message.mode, maxPlayers: message.maxPlayers, socket });
        token = result.player.token;
        send(socket, { type: 'welcome', token, playerId: result.player.id, state: manager.snapshot(result.room, result.player.id) });
        broadcast(result.room);
        return;
      }
      if (message.type === 'join_room') {
        if (token) throw new Error('此连接已经加入房间，请先离开当前房间');
        const result = manager.join({ code: message.code, name: message.name, socket });
        token = result.player.token;
        send(socket, { type: 'welcome', token, playerId: result.player.id, state: manager.snapshot(result.room, result.player.id) });
        broadcast(result.room);
        return;
      }
      if (message.type === 'reconnect') {
        if (token) throw new Error('此连接已经加入房间，请先离开当前房间');
        const result = manager.reconnect({ token: message.token, socket });
        token = result.player.token;
        send(socket, { type: 'welcome', token, playerId: result.player.id, state: manager.snapshot(result.room, result.player.id) });
        broadcast(result.room);
        return;
      }
      if (message.type === 'leave_room') {
        const room = manager.leave(token);
        token = null;
        send(socket, { type: 'left_room' });
        if (room) broadcast(room);
        return;
      }
      if (message.type === 'bid_landlord') {
        const room = manager.bidLandlord(token, message.bid);
        broadcast(room);
        return;
      }
      if (message.type === 'select_generals') {
        const room = manager.selectGenerals(token, message.generals);
        broadcast(room);
        return;
      }
      if (message.type === 'start_game') {
        const room = manager.start(token);
        broadcast(room);
        return;
      }
      if (message.type === 'action') {
        const room = manager.act(token, message.action);
        broadcast(room);
        return;
      }
      if (message.type === 'ping') { send(socket, { type: 'pong', at: Date.now() }); return; }
      throw new Error('未知消息类型');
    } catch (error) {
      sendError(socket, error?.message ?? '操作失败');
    }
  });
  socket.on('close', () => {
    if (token) {
      const room = manager.disconnect(token, socket);
      if (room) broadcast(room);
    }
  });
  socket.on('error', () => {});
});

server.listen(port, '0.0.0.0', () => console.log('Sanguokill server listening on :' + port));
