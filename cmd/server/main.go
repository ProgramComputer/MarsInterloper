package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

// GameState represents the state of the game
type GameState struct {
	PlayerLocation string            `json:"playerLocation"`
	Interactions   map[string]bool   `json:"interactions"`
	Inventory      []string          `json:"inventory"`
	StoryProgress  map[string]string `json:"storyProgress"`
}

// defaultGameState returns a new game state with default values
func defaultGameState() GameState {
	return GameState{
		PlayerLocation: "hab_living_quarters",
		Interactions:   make(map[string]bool),
		Inventory:      []string{},
		StoryProgress:  make(map[string]string),
	}
}

// Current in-memory game state
// In a production app, this would be stored in a database
var gameState = defaultGameState()

// WebSocket manager for multiplayer functionality
var wsManager *WebSocketManager

// MarsTerrainService instance
var marsTerrainService *MarsTerrainService

// MarsSkyService instance
var marsSkyService *MarsSkyService

// API key for frontend validation
var apiKey string

// Generate a random API key
func generateAPIKey() string {
	b := make([]byte, 32)
	_, err := rand.Read(b)
	if err != nil {
		log.Fatal("Error generating API key:", err)
	}
	return base64.StdEncoding.EncodeToString(b)
}

// validateAPIKey validates the API key in the request
func validateAPIKey(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Skip validation for WebSocket connections, as they use their own security
		if r.URL.Path == "/ws" {
			next(w, r)
			return
		}

		// Skip validation for static assets
		if strings.HasPrefix(r.URL.Path, "/assets/") || !strings.HasPrefix(r.URL.Path, "/api/") {
			next(w, r)
			return
		}

		// Get API key from request headers
		requestKey := r.Header.Get("X-API-Key")
		if requestKey == "" {
			http.Error(w, "Unauthorized: Missing API key", http.StatusUnauthorized)
			return
		}

		// Validate the API key
		if requestKey != apiKey {
			http.Error(w, "Unauthorized: Invalid API key", http.StatusUnauthorized)
			return
		}

		// Key is valid, call the next handler
		next(w, r)
	}
}

// HandleHealth provides a simple health check endpoint
func HandleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status":    "healthy",
		"timestamp": fmt.Sprintf("%d", time.Now().Unix()),
	})
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	log.Println("Mars Interloper game server starting - Air hot reload is active!")
	
	// Generate API key for frontend validation
	apiKey = generateAPIKey()
	log.Println("API Key generated for frontend validation")
	
	// Initialize WebSocket manager
	wsManager = NewWebSocketManager()
	
	// Setup graceful shutdown to release resources
	setupGracefulShutdown()
	
	// Initialize Mars terrain service
	initMarsTerrainService()
	
	// Initialize Mars sky service
	initMarsSkyService()
	
	// API endpoints with API key validation
	http.HandleFunc("/api/game-state", validateAPIKey(handleGameState))
	http.HandleFunc("/api/interact", validateAPIKey(handleInteraction))
	http.HandleFunc("/api/reset", validateAPIKey(handleReset))
	
	// Mars terrain endpoints with API key validation
	http.HandleFunc("/api/mars/elevation", validateAPIKey(HandleMarsElevation))
	http.HandleFunc("/api/mars/chunk", validateAPIKey(HandleMarsChunk))
	
	// Mars sky endpoint with API key validation
	http.HandleFunc("/api/mars/sky", validateAPIKey(HandleMarsSky))
	
	// WebSocket endpoint
	http.HandleFunc("/ws", wsManager.HandleWebSocket)

	// Health check endpoint (no API key required)
	http.HandleFunc("/health", HandleHealth)

	// Add API key to index.html template
	http.HandleFunc("/", serveIndexWithAPIKey)

	// Serve game assets
	assetsFS := http.FileServer(http.Dir("./assets"))
	http.Handle("/assets/", http.StripPrefix("/assets/", assetsFS))

	// Serve other static files from the web directory
	http.Handle("/js/", http.FileServer(http.Dir("./web")))
	http.Handle("/css/", http.FileServer(http.Dir("./web")))
	http.Handle("/favicon.ico", http.FileServer(http.Dir("./web")))
	http.Handle("/favicon.svg", http.FileServer(http.Dir("./web")))

	// Start the server
	log.Printf("Starting server on port %s...\n", port)
	log.Printf("WebSocket endpoint available at ws://localhost:%s/ws\n", port)
	err := http.ListenAndServe(":"+port, nil)
	if err != nil {
		log.Fatal("Server error: ", err)
	}
}

// serveIndexWithAPIKey serves the index.html file with the API key injected
func serveIndexWithAPIKey(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.FileServer(http.Dir("./web")).ServeHTTP(w, r)
		return
	}

	// Read the index.html file
	indexContent, err := os.ReadFile("./web/index.html")
	if err != nil {
		http.Error(w, "Error reading index.html", http.StatusInternalServerError)
		return
	}

	// Inject the API key into the HTML
	apiKeyScript := fmt.Sprintf("<script>window.API_KEY = '%s';</script>", apiKey)
	htmlWithAPIKey := strings.Replace(
		string(indexContent),
		"<head>",
		"<head>\n    "+apiKeyScript,
		1,
	)

	// Serve the modified HTML
	w.Header().Set("Content-Type", "text/html")
	w.Write([]byte(htmlWithAPIKey))
}

// initMarsTerrainService initializes the Mars terrain service
func initMarsTerrainService() {
	// Base directory for Mars data files
	marsDataDir := "assets/mars_data"
	
	// Try to initialize Mars terrain service with mixed resolution support
	var err error
	marsTerrainService, err = NewMarsTerrainService(marsDataDir)
	if err != nil {
		log.Printf("Warning: Failed to initialize Mars terrain service: %v", err)
		log.Println("Mars terrain will use procedural generation instead")
		marsTerrainService = nil
	} else {
		log.Println("Mars terrain service initialized successfully with mixed-resolution data")
	}
}

// initMarsSkyService initializes the Mars sky service
func initMarsSkyService() {
	// Path to the Hipparcos catalog file
	catalogPath := "assets/mars_data/hipparcos-voidmain.csv"
	
	// Try to initialize Mars sky service
	var err error
	marsSkyService, err = NewMarsSkyService(catalogPath)
	if err != nil {
		log.Printf("Warning: Failed to initialize Mars sky service: %v", err)
		log.Println("Mars night sky will not be available")
		marsSkyService = nil
	} else {
		log.Println("Mars sky service initializing...")
	}
}

// setupGracefulShutdown sets up handlers for graceful shutdown
func setupGracefulShutdown() {
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	
	go func() {
		<-c
		log.Println("Shutting down server...")
		
		// Close Mars terrain service if active
		if marsTerrainService != nil {
			marsTerrainService.Close()
			log.Println("Mars terrain service closed")
		}
		
		// Close WebSocket connections if active
		if wsManager != nil {
			wsManager.Close()
			log.Println("WebSocket connections closed")
		}
		
		os.Exit(0)
	}()
}

// handleGameState returns the current game state
func handleGameState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(gameState)
}

// handleInteraction processes player interactions with objects
func handleInteraction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var interaction struct {
		ObjectID string `json:"objectId"`
		Action   string `json:"action"`
	}

	err := json.NewDecoder(r.Body).Decode(&interaction)
	if err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Process the interaction (this would have game logic in production)
	interactionKey := fmt.Sprintf("%s_%s", interaction.ObjectID, interaction.Action)
	gameState.Interactions[interactionKey] = true

	// Handle special cases
	switch interaction.ObjectID {
	case "solar_panel":
		if interaction.Action == "repair" {
			gameState.StoryProgress["solar_panel_repaired"] = "true"
		}
	case "strange_rock":
		if interaction.Action == "collect" {
			gameState.Inventory = append(gameState.Inventory, "strange_rock")
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(gameState)
}

// handleReset resets the game state to default
func handleReset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	gameState = defaultGameState()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(gameState)
} 