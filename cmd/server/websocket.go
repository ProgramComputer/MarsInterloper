package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Player represents a connected player in the game
type Player struct {
	ID         string          `json:"id"`
	Position   [3]float64      `json:"position"`  // [x, y, z]
	Rotation   [3]float64      `json:"rotation"`  // [x, y, z]
	Connection *websocket.Conn `json:"-"`
	IPAddress  string          `json:"-"`
	writeMutex sync.Mutex      `json:"-"` // Mutex to ensure safe concurrent writes
}

// PlayerUpdate represents an update sent from a client
type PlayerUpdate struct {
	ID       string     `json:"id"`
	Position [3]float64 `json:"position"`
	Rotation [3]float64 `json:"rotation"`
}

// WebSocketManager handles all websocket connections and player tracking
type WebSocketManager struct {
	players            map[string]*Player
	playersMutex       sync.RWMutex
	upgrader           websocket.Upgrader
	ipConnections      map[string]int
	ipConnectionsMutex sync.RWMutex
	maxPlayersPerIP    int
}

// NewWebSocketManager creates a new websocket manager
func NewWebSocketManager() *WebSocketManager {
	return &WebSocketManager{
		players:         make(map[string]*Player),
		ipConnections:   make(map[string]int),
		maxPlayersPerIP: 100, // Maximum 100 players per IP address
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins in development
			},
		},
	}
}

// HandleWebSocket handles websocket connections
func (wm *WebSocketManager) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	// Get IP address from request
	ipAddress := getIPAddress(r)
	
	// Check if IP has reached connection limit
	if wm.hasReachedConnectionLimit(ipAddress) {
		log.Printf("Connection from %s rejected: maximum %d connections per IP reached", ipAddress, wm.maxPlayersPerIP)
		http.Error(w, "Maximum number of connections reached for this IP address", http.StatusTooManyRequests)
		return
	}
	
	// Upgrade HTTP connection to WebSocket
	conn, err := wm.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Error upgrading to websocket:", err)
		return
	}
	
	// Generate a unique ID for this player
	playerID := generatePlayerID()
	
	// Create a new player
	player := &Player{
		ID:         playerID,
		Position:   [3]float64{0, 0, 0},
		Rotation:   [3]float64{0, 0, 0},
		Connection: conn,
		IPAddress:  ipAddress,
	}
	
	// Increment connection count for this IP
	wm.incrementIPConnectionCount(ipAddress)
	
	// Add player to the list
	wm.playersMutex.Lock()
	wm.players[playerID] = player
	wm.playersMutex.Unlock()
	
	// Send the player their ID
	initialMessage := map[string]string{
		"type": "connected",
		"id":   playerID,
	}
	player.writeMutex.Lock()
	conn.WriteJSON(initialMessage)
	player.writeMutex.Unlock()
	
	// Send the new player information about all other players
	wm.sendExistingPlayers(player)
	
	// Notify other players about the new player
	wm.broadcastNewPlayer(player)
	
	log.Printf("Player %s connected from IP %s. Total players: %d", playerID, ipAddress, len(wm.players))
	
	// Handle incoming messages in a goroutine
	go wm.handlePlayerMessages(player)
}

// getIPAddress extracts the client IP address from the request
func getIPAddress(r *http.Request) string {
	// Check for X-Forwarded-For header (common when behind a proxy)
	forwarded := r.Header.Get("X-Forwarded-For")
	if forwarded != "" {
		return forwarded
	}
	
	// Check for X-Real-IP header (another common proxy header)
	realIP := r.Header.Get("X-Real-IP")
	if realIP != "" {
		return realIP
	}
	
	// Fallback to RemoteAddr (will include port)
	return r.RemoteAddr
}

// hasReachedConnectionLimit checks if the IP has reached the connection limit
func (wm *WebSocketManager) hasReachedConnectionLimit(ipAddress string) bool {
	wm.ipConnectionsMutex.RLock()
	defer wm.ipConnectionsMutex.RUnlock()
	
	count, exists := wm.ipConnections[ipAddress]
	return exists && count >= wm.maxPlayersPerIP
}

// incrementIPConnectionCount increments the connection count for an IP address
func (wm *WebSocketManager) incrementIPConnectionCount(ipAddress string) {
	wm.ipConnectionsMutex.Lock()
	defer wm.ipConnectionsMutex.Unlock()
	
	wm.ipConnections[ipAddress] = wm.ipConnections[ipAddress] + 1
}

// decrementIPConnectionCount decrements the connection count for an IP address
func (wm *WebSocketManager) decrementIPConnectionCount(ipAddress string) {
	wm.ipConnectionsMutex.Lock()
	defer wm.ipConnectionsMutex.Unlock()
	
	count, exists := wm.ipConnections[ipAddress]
	if exists {
		if count <= 1 {
			delete(wm.ipConnections, ipAddress)
		} else {
			wm.ipConnections[ipAddress] = count - 1
		}
	}
}

// handlePlayerMessages processes incoming messages from a player
func (wm *WebSocketManager) handlePlayerMessages(player *Player) {
	defer func() {
		// Get player IP address before removing from list
		ipAddress := player.IPAddress
		
		// Remove player when they disconnect
		wm.playersMutex.Lock()
		delete(wm.players, player.ID)
		wm.playersMutex.Unlock()
		
		// Decrement connection count for this IP
		wm.decrementIPConnectionCount(ipAddress)
		
		// Close the connection
		player.Connection.Close()
		
		// Notify other players about the disconnection
		wm.broadcastPlayerDisconnect(player.ID)
		
		log.Printf("Player %s disconnected from IP %s. Total players: %d", player.ID, ipAddress, len(wm.players))
	}()
	
	for {
		// Read message
		messageType, message, err := player.Connection.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("Error reading message: %v", err)
			}
			break // Exit loop if connection is closed
		}
		
		// Only process text messages
		if messageType != websocket.TextMessage {
			continue
		}
		
		// Parse the message
		var update PlayerUpdate
		if err := json.Unmarshal(message, &update); err != nil {
			log.Printf("Error unmarshaling message: %v", err)
			continue
		}
		
		// Update player position and rotation
		wm.playersMutex.Lock()
		player.Position = update.Position
		player.Rotation = update.Rotation
		wm.playersMutex.Unlock()
		
		// Broadcast the update to all other players
		wm.broadcastPlayerUpdate(player)
	}
}

// sendExistingPlayers sends information about all existing players to a new player
func (wm *WebSocketManager) sendExistingPlayers(newPlayer *Player) {
	wm.playersMutex.RLock()
	defer wm.playersMutex.RUnlock()
	
	for id, player := range wm.players {
		// Skip the new player
		if id == newPlayer.ID {
			continue
		}
		
		playerInfo := map[string]interface{}{
			"type":     "newPlayer",
			"id":       player.ID,
			"position": player.Position,
			"rotation": player.Rotation,
		}
		
		newPlayer.writeMutex.Lock()
		newPlayer.Connection.WriteJSON(playerInfo)
		newPlayer.writeMutex.Unlock()
	}
}

// broadcastNewPlayer notifies all existing players about a new player
func (wm *WebSocketManager) broadcastNewPlayer(newPlayer *Player) {
	wm.playersMutex.RLock()
	defer wm.playersMutex.RUnlock()
	
	message := map[string]interface{}{
		"type":     "newPlayer",
		"id":       newPlayer.ID,
		"position": newPlayer.Position,
		"rotation": newPlayer.Rotation,
	}
	
	wm.broadcast(message, newPlayer.ID)
}

// broadcastPlayerUpdate sends a player's position update to all other players
func (wm *WebSocketManager) broadcastPlayerUpdate(player *Player) {
	wm.playersMutex.RLock()
	defer wm.playersMutex.RUnlock()
	
	message := map[string]interface{}{
		"type":     "playerUpdate",
		"id":       player.ID,
		"position": player.Position,
		"rotation": player.Rotation,
	}
	
	wm.broadcast(message, player.ID)
}

// broadcastPlayerDisconnect notifies all players that a player has disconnected
func (wm *WebSocketManager) broadcastPlayerDisconnect(playerID string) {
	message := map[string]string{
		"type": "playerDisconnect",
		"id":   playerID,
	}
	
	wm.broadcast(message, playerID)
}

// broadcast sends a message to all connected players except the excluded one
func (wm *WebSocketManager) broadcast(message interface{}, excludeID string) {
	wm.playersMutex.RLock()
	defer wm.playersMutex.RUnlock()
	
	for id, player := range wm.players {
		if id == excludeID {
			continue
		}
		
		// Lock the write mutex for this player's connection
		player.writeMutex.Lock()
		if err := player.Connection.WriteJSON(message); err != nil {
			log.Printf("Error sending message to player %s: %v", id, err)
		}
		player.writeMutex.Unlock()
	}
}

// generatePlayerID creates a new unique player ID
func generatePlayerID() string {
	// Simple implementation using timestamp and random values
	return "player_" + generateRandomString(8)
}

// generateRandomString creates a random string of the specified length
func generateRandomString(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	result := make([]byte, length)
	for i := range result {
		// Simple non-secure random implementation
		result[i] = charset[int(time.Now().UnixNano()%int64(len(charset)))]
		time.Sleep(1 * time.Nanosecond) // Ensure different values
	}
	return string(result)
}

// Close closes all WebSocket connections
func (wm *WebSocketManager) Close() {
	wm.playersMutex.Lock()
	defer wm.playersMutex.Unlock()
	
	// Close all websocket connections
	for id, player := range wm.players {
		if player.Connection != nil {
			player.Connection.Close()
			log.Printf("Closed WebSocket connection for player %s", id)
		}
	}
	
	// Clear the players map
	wm.players = make(map[string]*Player)
} 