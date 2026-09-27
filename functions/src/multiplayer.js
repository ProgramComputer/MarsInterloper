// Multiplayer room as a Durable Object, speaking the same protocol as cmd/server/websocket.go:
//   server -> client: {type: "connected", id}, {type: "newPlayer" | "playerUpdate", id, position, rotation},
//                     {type: "playerDisconnect", id}
//   client -> server: {id, position: [x, y, z], rotation: [x, y, z]}
//
// Uses the WebSocket Hibernation API, so the object can be evicted from memory between messages;
// each player's state lives in its socket's serialized attachment rather than in instance fields.

const MAX_CONNECTIONS_PER_IP = 100;
const PLAYER_ID_CHARSET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function newPlayerId() {
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	let id = "player_";
	for (const b of bytes) id += PLAYER_ID_CHARSET[b % PLAYER_ID_CHARSET.length];
	return id;
}

function isVec3(value) {
	return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

export class MultiplayerRoom {
	constructor(ctx) {
		this.ctx = ctx;
	}

	async fetch(request) {
		const ip = request.headers.get("CF-Connecting-IP") || "unknown";
		if (this.ctx.getWebSockets(ip).length >= MAX_CONNECTIONS_PER_IP) {
			return new Response("Maximum number of connections reached for this IP address\n", { status: 429 });
		}

		const [client, server] = Object.values(new WebSocketPair());
		const player = { id: newPlayerId(), position: [0, 0, 0], rotation: [0, 0, 0] };
		this.ctx.acceptWebSocket(server, [ip]);
		server.serializeAttachment(player);

		server.send(JSON.stringify({ type: "connected", id: player.id }));
		for (const ws of this.ctx.getWebSockets()) {
			const other = ws === server ? null : ws.deserializeAttachment();
			if (other && !other.left) server.send(JSON.stringify(playerMessage("newPlayer", other)));
		}
		this.broadcast(playerMessage("newPlayer", player), server);

		return new Response(null, { status: 101, webSocket: client });
	}

	webSocketMessage(ws, message) {
		if (typeof message !== "string") return;
		let update;
		try {
			update = JSON.parse(message);
		} catch {
			return;
		}
		const player = ws.deserializeAttachment();
		if (!player || player.left || !isVec3(update?.position) || !isVec3(update?.rotation)) return;

		player.position = update.position;
		player.rotation = update.rotation;
		ws.serializeAttachment(player);
		this.broadcast(playerMessage("playerUpdate", player), ws);
	}

	webSocketClose(ws, code, reason) {
		this.leave(ws);
		try {
			ws.close(code, reason);
		} catch {
			// Already closed, or a reserved code such as 1005/1006 that cannot be echoed back.
		}
	}

	webSocketError(ws) {
		this.leave(ws);
	}

	leave(ws) {
		const player = ws.deserializeAttachment();
		if (!player || player.left) return;
		ws.serializeAttachment({ ...player, left: true });
		this.broadcast({ type: "playerDisconnect", id: player.id }, ws);
	}

	broadcast(message, except) {
		const data = JSON.stringify(message);
		for (const ws of this.ctx.getWebSockets()) {
			if (ws === except || ws.deserializeAttachment()?.left) continue;
			try {
				ws.send(data);
			} catch {
				// The socket closed between getWebSockets() and send(); its close handler cleans up.
			}
		}
	}
}

function playerMessage(type, player) {
	return { type, id: player.id, position: player.position, rotation: player.rotation };
}
