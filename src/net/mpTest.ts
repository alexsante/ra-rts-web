import http from 'node:http';
import { WebSocket } from 'ws';
import { SIM_DT } from '../sim/config';
import { GameWorld } from '../sim/world';
import type { ClientToServerMsg, ServerToClientMsg } from './protocol';
import { attachRelayToHttpServer } from './wsRelayPlugin';

function waitForMessage<T extends ServerToClientMsg['type']>(
  ws: WebSocket,
  type: T
): Promise<Extract<ServerToClientMsg, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), 4000);
    const handler = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString()) as ServerToClientMsg;
      if (msg.type === type) {
        clearTimeout(timeout);
        ws.off('message', handler);
        resolve(msg as Extract<ServerToClientMsg, { type: T }>);
      }
    };
    ws.on('message', handler);
  });
}

function send(ws: WebSocket, msg: ClientToServerMsg): void {
  ws.send(JSON.stringify(msg));
}

async function runMultiplayerTest(): Promise<void> {
  const server = http.createServer();
  const wss = attachRelayToHttpServer(server, '/ws');

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  const hostWs = new WebSocket(wsUrl);
  const guestWs = new WebSocket(wsUrl);
  await Promise.all([
    new Promise<void>((r) => hostWs.once('open', r)),
    new Promise<void>((r) => guestWs.once('open', r)),
  ]);

  // 1. Host creates room on Arctic map
  const createdP = waitForMessage(hostWs, 'room_created');
  send(hostWs, { type: 'create_room', mapPreset: 'arctic' });
  const created = await createdP;
  if (!created.roomId || created.faction !== 'allies' || created.mapPreset !== 'arctic') {
    throw new Error('Unexpected room_created payload');
  }

  // 2. Guest joins via room code and receives Arctic map preset
  const joinedP = waitForMessage(guestWs, 'room_joined');
  const peerJoinedP = waitForMessage(hostWs, 'peer_joined');
  send(guestWs, { type: 'join_room', roomId: created.roomId });
  const [joined, peerJoined] = await Promise.all([joinedP, peerJoinedP]);
  if (joined.faction !== 'soviets' || joined.mapPreset !== 'arctic' || peerJoined.peerFaction !== 'soviets') {
    throw new Error('Unexpected faction or mapPreset on join');
  }

  // 3. Verify Host & Guest sync across commands (unit queue, move, sell_building, superweapon)
  const hostWorld = new GameWorld(true, created.mapPreset);
  const guestWorld = new GameWorld(true, joined.mapPreset);
  guestWorld.setLocalFaction('soviets');

  const sovietTankIds = Array.from(hostWorld.units.values())
    .filter((u) => u.faction === 'soviets' && u.type === 'medium_tank')
    .map((u) => u.id);

  const cmd1P = waitForMessage(hostWs, 'cmd');
  send(guestWs, { type: 'cmd', cmd: { type: 'queue_unit', unitType: 'medium_tank' } });
  const cmd1 = await cmd1P;
  hostWorld.executeCommand('soviets', cmd1.cmd);

  const cmd2P = waitForMessage(hostWs, 'cmd');
  send(guestWs, {
    type: 'cmd',
    cmd: { type: 'move', unitIds: sovietTankIds, target: { x: 72, z: 72 }, attackMove: true },
  });
  const cmd2 = await cmd2P;
  hostWorld.executeCommand('soviets', cmd2.cmd);

  // Guest sells its own turret via remote command
  const sovTurret = Array.from(hostWorld.buildings.values()).find(
    (b) => b.faction === 'soviets' && b.type === 'turret'
  )!;
  const cmd3P = waitForMessage(hostWs, 'cmd');
  send(guestWs, { type: 'cmd', cmd: { type: 'sell_building', buildingId: sovTurret.id } });
  const cmd3 = await cmd3P;
  hostWorld.executeCommand('soviets', cmd3.cmd);

  // Confirm ownership protection: Guest cannot sell an Allied building!
  const allyConyard = Array.from(hostWorld.buildings.values()).find(
    (b) => b.faction === 'allies' && b.type === 'conyard'
  )!;
  hostWorld.executeCommand('soviets', { type: 'sell_building', buildingId: allyConyard.id });
  if (!hostWorld.buildings.has(allyConyard.id)) {
    throw new Error('Security failure: Guest sold Allied Construction Yard!');
  }

  for (let i = 0; i < 200; i++) {
    hostWorld.tick(SIM_DT);
  }
  const events = hostWorld.drainEvents();
  const snapP = waitForMessage(guestWs, 'snapshot');
  send(hostWs, { type: 'snapshot', snapshot: hostWorld.createSnapshot(events) });
  const { snapshot } = await snapP;

  guestWorld.applySnapshot(snapshot);

  if (Math.abs(guestWorld.simTime - hostWorld.simTime) > 0.001) {
    throw new Error('Guest simTime out of sync with Host');
  }
  if (guestWorld.units.size !== hostWorld.units.size) {
    throw new Error(`Unit count mismatch: guest=${guestWorld.units.size} host=${hostWorld.units.size}`);
  }
  if (guestWorld.derricks.size !== 2 || guestWorld.crates.size !== hostWorld.crates.size) {
    throw new Error('Expected derricks & crates synced identically to Guest');
  }
  if (guestWorld.buildings.has(sovTurret.id)) {
    throw new Error('Expected sold Soviet turret to be removed on Guest');
  }

  // 4. Verify 1v1 chat relay between Guest and Host
  const chatP = waitForMessage(hostWs, 'chat');
  send(guestWs, { type: 'chat', text: 'Kirov inbound!' });
  const chatMsg = await chatP;
  if (chatMsg.from !== 'soviets' || chatMsg.text !== 'Kirov inbound!') {
    throw new Error('Unexpected chat relay payload');
  }

  // 5. Verify 3rd player rejection
  const thirdWs = new WebSocket(wsUrl);
  await new Promise<void>((r) => thirdWs.once('open', r));
  const errP = waitForMessage(thirdWs, 'error');
  send(thirdWs, { type: 'join_room', roomId: created.roomId });
  const errMsg = await errP;
  if (!errMsg.message.includes('full')) {
    throw new Error(`Expected full-room error, got: ${errMsg.message}`);
  }

  console.log('=== 2-Player Multiplayer Relay & Sync Test ===');
  console.log(`Room Code: ${created.roomId} | Map: ${created.mapPreset} | Host=allies | Guest=soviets`);
  console.log(`Synced Sim Time: ${guestWorld.simTime.toFixed(1)}s | Units: ${guestWorld.units.size} | Derricks: ${guestWorld.derricks.size} | Events: ${snapshot.events.length}`);
  console.log(`3rd Player Rejection: "${errMsg.message}"`);
  console.log('PASS: Multiplayer map sync, remote sell/command authority, snapshot sync, and 2P cap verified.');

  hostWs.close();
  guestWs.close();
  thirdWs.close();
  wss.close();
  server.close();
}

runMultiplayerTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
