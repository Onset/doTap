const WebSocket = require('ws')

const PORT = process.env.PORT || 8080
const DEBUG = process.env.DEBUG || false
const wss = new WebSocket.Server({ port: PORT })

let lastClientId = 0
const players = {}

console.log(`Server started at port ${PORT}`)

function clientLog(clientId, message) {
	if (DEBUG) {
		console.log(`[${clientId}] ${message}`)
	}
}

function sendToOtherPlayers(blacklistIds, data) {
	Object.keys(players).forEach((clientId) => {
		clientId = clientId
		const player = players[clientId]
		if (!blacklistIds.includes(clientId)) {
			sendToClient(player.socket, data)
		}
	})
}

function sendToClient(clientSocket, data) {
	if (clientSocket.readyState === WebSocket.OPEN) {
		clientSocket.send(JSON.stringify(data))
	}
}

function sendToPlayers(playerIds, data) {
	playerIds.forEach((playerId) => {
		if (players[playerId]) {
			sendToClient(players[playerId].socket, data)
		}
	})
}

wss.on('connection', (ws) => {
	const clientId = `p${String(lastClientId++)}`
	clientLog(clientId, 'New connection')
	players[clientId] = {
		socket: ws,
		score: 0,
		lastInputTime: Date.now(),
		active: true,
	}

	ws.on('close', () => {
		clientLog(clientId, 'Disconnected')
	})

	ws.on('message', (message) => {
		clientLog(clientId, `New message: ${message}`)
		players[clientId].lastInputTime = Date.now()
		const actions = JSON.parse(message)
		Object.keys(actions).forEach((action) => {
			const data = actions[action]
			switch (action) {
				case 'active':
					players[clientId].active = Boolean(data)
					break
				case 'score':
					players[clientId].score = Number(data)
					break
				case 'claimPoints':
					const playersToSubtract = []
					getActivePlayersIds().forEach((playerId) => {
						const player = players[playerId]
						if (playerId !== clientId && player.score > 0) {
							player.score--
							playersToSubtract.push(playerId)
						}
					})
					sendToPlayers([ clientId ], {
						add: playersToSubtract.length,
					})
					sendToPlayers(playersToSubtract, {
						subtract: 1,
					})
					break
				case 'give':
					sendToPlayers([ data.to ], {
						add: data.amount,
					})
					break
				default:
					clientLog(clientId, `Unknown action: ${action}`)
				}
		})
	})
})

const ACTIVE_PLAYER_TIME_PERIOD = 60 * 1000 // One minute
function getActivePlayersIds() {
	const activePlayers = []
	const now = Date.now()
	Object.keys(players).forEach((playerId) => {
		const player = players[playerId]
		if (player.lastInputTime > now - ACTIVE_PLAYER_TIME_PERIOD && player.socket.readyState === WebSocket.OPEN && player.active) {
			activePlayers.push(playerId)
		}
	})
	return activePlayers
}

const BEST_UPDATE_PLAYERS_INTERVAL = 300
function broadcastBestPlayerLoop() {
	let bestScore = 0
	let bestPlayerIds = []
	const now = Date.now()
	const activePlayersIds = getActivePlayersIds()

	if (activePlayersIds.length > 1) {
		activePlayersIds.forEach((playerId) => {
			const player = players[playerId]
			if (player.score > bestScore) {
				bestScore = player.score
				bestPlayerIds = [ playerId ]
			} else if (player.score === bestScore) {
				bestPlayerIds.push(playerId)
			}
		})

		sendToPlayers(bestPlayerIds, {
			best: true,
		})
		sendToOtherPlayers(bestPlayerIds, {
			best: false,
		})
	}

	setTimeout(() => {
		broadcastBestPlayerLoop()
	}, BEST_UPDATE_PLAYERS_INTERVAL)
}

broadcastBestPlayerLoop()
