import http from 'node:http';
import { WebSocket } from 'ws';
import { SIM_DT } from '../sim/config';
import { GameWorld } from '../sim/world';
import { SnapshotDeltaDecoder, SnapshotDeltaEncoder } from './delta';
import type { ClientToServerMsg, ServerToClientMsg } from './protocol';
import { attachRelayToHttpServer } from './wsRelayPlugin';

function waitForMessage<T extends ServerToClientMsg['type']>(
  ws: WebSocket,
  type: T
): Promise<Extract<ServerToClientMsg, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), 5000);
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
  const wss = attachRelayToHttpServer(server, '/ws', { reconnectGraceMs: 10_000 });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  const hostWs = new WebSocket(wsUrl);
  const guestWs = new WebSocket(wsUrl);
  await Promise.all([
    new Promise<void>((r) => hostWs.once('open', r)),
    new Promise<void>((r) => guestWs.once('open', r)),
  ]);

  // 1. Host creates 1v1 Lobby with custom MatchConfig (Arctic, Soviets, $10,000)
  const createdP = waitForMessage(hostWs, 'room_created');
  send(hostWs, {
    type: 'create_room',
    config: {
      mapPreset: 'arctic',
      hostFaction: 'soviets',
      startingCredits: 10000,
      fogOfWar: true,
      cratesEnabled: true,
      superweaponsEnabled: true,
    },
    sessionToken: 'host-tok-1',
  });
  const created = await createdP;
  if (
    !created.roomId ||
    created.faction !== 'soviets' ||
    created.config.startingCredits !== 10000 ||
    created.inMatch
  ) {
    throw new Error('Unexpected room_created lobby payload');
  }

  // 2. Guest joins lobby — automatically gets opposite faction (Allies) and synced config
  const joinedP = waitForMessage(guestWs, 'room_joined');
  const peerJoinedP = waitForMessage(hostWs, 'peer_joined');
  send(guestWs, { type: 'join_room', roomId: created.roomId, sessionToken: 'guest-tok-1' });
  const [joined, peerJoined] = await Promise.all([joinedP, peerJoinedP]);
  if (
    joined.faction !== 'allies' ||
    joined.config.startingCredits !== 10000 ||
    joined.reconnected ||
    peerJoined.peerFaction !== 'allies'
  ) {
    throw new Error('Unexpected faction or config on lobby join');
  }

  // 3. Host updates lobby settings (swaps Host -> Allies, Credits -> $5000); both receive lobby_state
  const hostLobbyP = waitForMessage(hostWs, 'lobby_state');
  const guestLobbyP = waitForMessage(guestWs, 'lobby_state');
  send(hostWs, {
    type: 'update_lobby',
    config: { hostFaction: 'allies', startingCredits: 5000, mapPreset: 'arctic' },
  });
  const [hostLobby, guestLobby] = await Promise.all([hostLobbyP, guestLobbyP]);
  if (
    hostLobby.lobby.config.hostFaction !== 'allies' ||
    guestLobby.lobby.config.startingCredits !== 5000
  ) {
    throw new Error('Lobby config update failed to sync');
  }

  // 4. Guest readies up and Host launches the match
  const readyStateP = waitForMessage(hostWs, 'lobby_state');
  send(guestWs, { type: 'set_ready', ready: true });
  const readyState = await readyStateP;
  if (!readyState.lobby.guestReady) {
    throw new Error('Guest ready state did not propagate to Host');
  }

  const hostStartP = waitForMessage(hostWs, 'match_started');
  const guestStartP = waitForMessage(guestWs, 'match_started');
  send(hostWs, { type: 'start_match' });
  const [hostStart, guestStart] = await Promise.all([hostStartP, guestStartP]);
  if (hostStart.config.mapPreset !== 'arctic' || guestStart.config.startingCredits !== 5000) {
    throw new Error('match_started config mismatch');
  }

  // 5. Run live Host/Guest sim with Delta-Compressed Snapshot Sync!
  const hostWorld = new GameWorld({ ...hostStart.config, balancedPvP: true });
  hostWorld.setLocalFaction('allies');
  const guestWorld = new GameWorld({ ...guestStart.config, balancedPvP: true });
  guestWorld.setLocalFaction('soviets');

  const encoder = new SnapshotDeltaEncoder();
  const decoder = new SnapshotDeltaDecoder();

  // Send initial full keyframe
  const initPacket = encoder.encode(hostWorld.createSnapshot([]), true);
  const fullBytes = Buffer.byteLength(JSON.stringify(initPacket));
  const initPktP = waitForMessage(guestWs, 'snapshot_packet');
  send(hostWs, { type: 'snapshot_packet', packet: initPacket });
  const initRecv = await initPktP;
  const initDec = decoder.decode(initRecv.packet);
  if (!initDec.snapshot || initDec.needsResync) {
    throw new Error('Failed to decode initial full snapshot packet');
  }
  guestWorld.applySnapshot(initDec.snapshot);

  // Guest issues remote commands (queue tank, move, sell own turret)
  const sovietTankIds = Array.from(hostWorld.units.values())
    .filter((u) => u.faction === 'soviets' && u.type === 'medium_tank')
    .map((u) => u.id);

  const cmd1P = waitForMessage(hostWs, 'cmd');
  send(guestWs, { type: 'cmd', cmd: { type: 'queue_unit', unitType: 'medium_tank' } });
  hostWorld.executeCommand('soviets', (await cmd1P).cmd);

  const cmd2P = waitForMessage(hostWs, 'cmd');
  send(guestWs, {
    type: 'cmd',
    cmd: { type: 'move', unitIds: sovietTankIds, target: { x: 72, z: 72 }, attackMove: true },
  });
  hostWorld.executeCommand('soviets', (await cmd2P).cmd);

  const sovTurret = Array.from(hostWorld.buildings.values()).find(
    (b) => b.faction === 'soviets' && b.type === 'turret'
  )!;
  const cmd3P = waitForMessage(hostWs, 'cmd');
  send(guestWs, { type: 'cmd', cmd: { type: 'sell_building', buildingId: sovTurret.id } });
  hostWorld.executeCommand('soviets', (await cmd3P).cmd);

  // Confirm ownership protection: Guest cannot sell Allied ConYard or build Allied Prism Tower!
  const allyConyard = Array.from(hostWorld.buildings.values()).find(
    (b) => b.faction === 'allies' && b.type === 'conyard'
  )!;
  hostWorld.executeCommand('soviets', { type: 'sell_building', buildingId: allyConyard.id });
  hostWorld.executeCommand('soviets', { type: 'start_building', buildingType: 'prism' });
  if (!hostWorld.buildings.has(allyConyard.id)) {
    throw new Error('Security failure: Guest sold Allied Construction Yard!');
  }
  if (hostWorld.players.soviets.buildingProd?.type === 'prism') {
    throw new Error('Faction authority failure: Soviets started building Allied Prism Tower!');
  }

  // Stream 10 sequential delta snapshot packets over 150 ticks and measure compression!
  let deltaBytesTotal = 0;
  const deltaCount = 10;
  for (let step = 0; step < deltaCount; step++) {
    for (let i = 0; i < 15; i++) hostWorld.tick(SIM_DT);
    const events = hostWorld.drainEvents();
    const pkt = encoder.encode(hostWorld.createSnapshot(events));
    if (!pkt.delta) throw new Error('Expected delta packet after initial keyframe');
    deltaBytesTotal += Buffer.byteLength(JSON.stringify(pkt));

    const pktP = waitForMessage(guestWs, 'snapshot_packet');
    send(hostWs, { type: 'snapshot_packet', packet: pkt });
    const recv = await pktP;
    const dec = decoder.decode(recv.packet);
    if (!dec.snapshot || dec.needsResync) {
      throw new Error(`Delta decode failed at step ${step}`);
    }
    guestWorld.applySnapshot(dec.snapshot);
  }

  const avgDeltaBytes = Math.round(deltaBytesTotal / deltaCount);
  const savingsPct = Math.round((1 - avgDeltaBytes / fullBytes) * 100);
  if (avgDeltaBytes >= fullBytes * 0.65) {
    throw new Error(
      `Expected strong delta compression (avgDelta=${avgDeltaBytes}B vs full=${fullBytes}B)`
    );
  }

  if (
    Math.abs(guestWorld.simTime - hostWorld.simTime) > 0.001 ||
    guestWorld.tickCount !== hostWorld.tickCount ||
    guestWorld.units.size !== hostWorld.units.size ||
    guestWorld.buildings.has(sovTurret.id)
  ) {
    throw new Error('Guest state out of sync after delta snapshot stream');
  }

  // 6. Mid-Game Reconnect Test! Drop Guest socket abruptly, reject interloper, reconnect with token!
  const peerDiscP = waitForMessage(hostWs, 'peer_disconnected');
  guestWs.terminate();
  const discMsg = await peerDiscP;
  if (discMsg.graceSeconds <= 0) {
    throw new Error('Expected positive reconnect grace window');
  }

  // Interloper with different token should be rejected while Guest seat is reserved
  const thirdWs = new WebSocket(wsUrl);
  await new Promise<void>((r) => thirdWs.once('open', r));
  const errP = waitForMessage(thirdWs, 'error');
  send(thirdWs, { type: 'join_room', roomId: created.roomId, sessionToken: 'intruder-tok' });
  const errMsg = await errP;
  if (!errMsg.message.includes('reserved')) {
    throw new Error(`Expected seat-reserved rejection mid-match, got: "${errMsg.message}"`);
  }

  // Reconnect Guest using original sessionToken
  const guestReconnectWs = new WebSocket(wsUrl);
  await new Promise<void>((r) => guestReconnectWs.once('open', r));
  const reJoinedP = waitForMessage(guestReconnectWs, 'room_joined');
  const peerReconP = waitForMessage(hostWs, 'peer_reconnected');
  send(guestReconnectWs, {
    type: 'join_room',
    roomId: created.roomId,
    sessionToken: 'guest-tok-1',
  });
  const [reJoined, peerRecon] = await Promise.all([reJoinedP, peerReconP]);
  if (!reJoined.reconnected || !reJoined.inMatch || reJoined.faction !== 'soviets') {
    throw new Error('Guest mid-game reconnect failed');
  }
  if (peerRecon.peerFaction !== 'soviets') {
    throw new Error('Host did not receive peer_reconnected for soviets');
  }

  // Guest requests full resync -> Host sends fresh keyframe -> Guest recovers completely
  const syncReqP = waitForMessage(hostWs, 'request_full_sync');
  send(guestReconnectWs, { type: 'request_full_sync' });
  await syncReqP;

  const freshDecoder = new SnapshotDeltaDecoder();
  encoder.reset();
  const resyncPkt = encoder.encode(hostWorld.createSnapshot([]), true);
  const resyncRecvP = waitForMessage(guestReconnectWs, 'snapshot_packet');
  send(hostWs, { type: 'snapshot_packet', packet: resyncPkt });
  const resyncDec = freshDecoder.decode((await resyncRecvP).packet);
  if (!resyncDec.snapshot || resyncDec.snapshot.units.length !== hostWorld.units.size) {
    throw new Error('Mid-game reconnect full resync failed');
  }

  // 7. Verify 1v1 chat relay after reconnect
  const chatP = waitForMessage(hostWs, 'chat');
  send(guestReconnectWs, { type: 'chat', text: 'Back online, Kirov inbound!' });
  const chatMsg = await chatP;
  if (chatMsg.from !== 'soviets' || chatMsg.text !== 'Back online, Kirov inbound!') {
    throw new Error('Chat relay failed after reconnect');
  }

  console.log('=== 2-Player Lobby, Delta Sync & Mid-Game Reconnect Test ===');
  console.log(
    `Lobby Sync: Room=${created.roomId} | Swapped Host→Allies / Guest→Soviets | Ready-Up & Launch OK`
  );
  console.log(
    `Delta Compression: Full=${fullBytes}B | Avg Delta=${avgDeltaBytes}B (${savingsPct}% bandwidth saved)`
  );
  console.log(
    `Mid-Game Reconnect: Grace=${discMsg.graceSeconds}s | Intruder Rejected | Guest Resumed & Resynced`
  );
  console.log(
    'PASS: Lobby sync, asymmetric authority, delta snapshots, and mid-game reconnect verified.'
  );

  hostWs.close();
  guestReconnectWs.close();
  thirdWs.close();
  wss.close();
  server.close();
}

runMultiplayerTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
