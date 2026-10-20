import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager } from './rooms.mjs';

const port = Number(process.env.PORT ?? 3000);
const manager = new RoomManager();
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
}
function sendError(socket, message) {
  send(socket, { type: 'error', message: String(message).slice(0, 200) });
}

wss.on('connection', socket => {
  let token = null;
  socket.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); }
    catch { sendError(socket, '消息必须是有效 JSON'); return; }
    try {
      if (!message || typeof message.type !== 'string') throw new Error('缺少消息类型');
      if (message.type === 'create_room') {
        const result = manager.create({ name: message.name, mode: message.mode, maxPlayers: message.maxPlayers, socket });
        token = result.player.token;
        send(socket, { type: 'welcome', token, playerId: result.player.id, state: manager.snapshot(result.room, result.player.id) });
        broadcast(result.room);
        return;
      }
      if (message.type === 'join_room') {
        const result = manager.join({ code: message.code, name: message.name, socket });
        token = result.player.token;
        send(socket, { type: 'welcome', token, playerId: result.player.id, state: manager.snapshot(result.room, result.player.id) });
        broadcast(result.room);
        return;
      }
      if (message.type === 'reconnect') {
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
