package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/syumai/workers"
	"github.com/syumai/workers/cloudflare"
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

// Current in-memory game state (Note: Cloudflare Workers are stateless, consider using KV)
var gameState = defaultGameState()

// define allowedOrigin using environment variable
var allowedOrigin = func() string {
	if origin := os.Getenv("ALLOWED_ORIGIN"); origin != "" {
		return origin
	}
	return "*"
}()

func main() {
	// Create a new HTTP mux
	mux := http.NewServeMux()

	// API endpoints
	mux.HandleFunc("/api/game-state", handleGameState)
	mux.HandleFunc("/api/interact", handleInteraction)
	mux.HandleFunc("/api/reset", handleReset)
	mux.HandleFunc("/api/mars/elevation", handleMarsElevation)
	mux.HandleFunc("/api/mars/chunk", handleMarsChunk)
	mux.HandleFunc("/api/mars/sky", handleMarsSky)
	mux.HandleFunc("/health", handleHealth)

	// Serve assets from R2 bucket
	mux.HandleFunc("/assets/", func(w http.ResponseWriter, r *http.Request) {
		// strip the /assets/ prefix to get the object key
		key := strings.TrimPrefix(r.URL.Path, "/assets/")
		// get R2 bucket binding
		bucket, err := cloudflare.NewR2Bucket("ASSETS_BUCKET")
		if err != nil {
			http.Error(w, "R2 binding error", http.StatusInternalServerError)
			return
		}
		// fetch object from R2
		obj, err := bucket.Get(key)
		if err != nil || obj == nil {
			http.NotFound(w, r)
			return
		}
		// serve content
		w.Header().Set("Cache-Control", "public, max-age=3600")
		io.Copy(w, obj.Body)
	})

	// Serve with workers
	workers.Serve(mux)
}

// handleHealth provides a simple health check endpoint
func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status":    "healthy",
		"service":   "cloudflare-worker",
	})
}

// handleGameState returns the current game state
func handleGameState(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(gameState)
}

// handleInteraction processes player interactions with objects
func handleInteraction(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
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

	// Process the interaction
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
	w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	gameState = defaultGameState()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(gameState)
}

// Simplified Mars endpoints for Cloudflare Workers
// Note: For production, consider caching results in Cloudflare KV or using Cloudflare Cache API

func handleMarsElevation(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	// Simplified version - return mock data
	// In production, you'd use Cloudflare KV or R2 for data storage
	lat := r.URL.Query().Get("lat")
	lon := r.URL.Query().Get("lon")
	
	response := map[string]interface{}{
		"elevation": 1500.0, // Mock elevation in meters
		"latitude":  lat,
		"longitude": lon,
		"source":    "mock-data",
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func handleMarsChunk(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	// Simplified version - return basic chunk data
	chunkX := r.URL.Query().Get("x")
	chunkZ := r.URL.Query().Get("z")
	
	// Generate simple height data
	var heights []float32
	for i := 0; i < 1024; i++ {
		heights = append(heights, float32(1500.0))
	}
	
	response := map[string]interface{}{
		"chunkX":  chunkX,
		"chunkZ":  chunkZ,
		"size":    32,
		"heights": heights[:100], // Limit data size for example
		"source":  "procedural",
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func handleMarsSky(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	// Fetch star data from remote Hipparcos catalog
	hipparcosURL := "https://raw.githubusercontent.com/ProgramComputer/MarsInterloper/refs/heads/main/assets/mars_data/hipparcos-voidmain.csv"
	
	// Get query parameters
	minMag := r.URL.Query().Get("minMag")
	maxMag := r.URL.Query().Get("maxMag")
	limit := r.URL.Query().Get("limit")
	
	// Default values
	if minMag == "" {
		minMag = "-2"
	}
	if maxMag == "" {
		maxMag = "6"
	}
	if limit == "" {
		limit = "100"
	}
	
	minMagFloat, _ := strconv.ParseFloat(minMag, 32)
	maxMagFloat, _ := strconv.ParseFloat(maxMag, 32)
	limitInt, _ := strconv.Atoi(limit)
	
	// Fetch the CSV data
	resp, err := http.Get(hipparcosURL)
	if err != nil {
		// Fallback to basic star data
		response := map[string]interface{}{
			"stars": []map[string]interface{}{
				{
					"ra":   0.0,
					"dec":  0.0,
					"mag":  1.0,
					"name": "Polaris",
				},
			},
			"error": "Failed to fetch star catalog",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}
	defer resp.Body.Close()
	
	// Read limited amount of data to avoid memory issues
	// Cloudflare Workers have a 128MB memory limit
	limitedReader := io.LimitReader(resp.Body, 1024*1024) // 1MB limit
	data, err := io.ReadAll(limitedReader)
	if err != nil {
		http.Error(w, "Error reading star data", http.StatusInternalServerError)
		return
	}
	
	// Parse CSV and filter stars
	lines := strings.Split(string(data), "\n")
	var stars []map[string]interface{}
	
	for i, line := range lines {
		if i == 0 || i > limitInt+1 { // Skip header and limit results
			continue
		}
		
		fields := strings.Split(line, ",")
		if len(fields) < 10 {
			continue
		}
		
		// Parse magnitude (Vmag is at index 5)
		mag, err := strconv.ParseFloat(strings.TrimSpace(fields[5]), 32)
		if err != nil || mag < minMagFloat || mag > maxMagFloat {
			continue
		}
		
		// Parse RA and Dec (indices 8 and 9)
		ra, _ := strconv.ParseFloat(strings.TrimSpace(fields[8]), 64)
		dec, _ := strconv.ParseFloat(strings.TrimSpace(fields[9]), 64)
		
		star := map[string]interface{}{
			"ra":  ra,
			"dec": dec,
			"mag": mag,
			"hip": strings.TrimSpace(fields[1]), // HIP number
		}
		
		stars = append(stars, star)
		
		if len(stars) >= limitInt {
			break
		}
	}
	
	response := map[string]interface{}{
		"stars":     stars,
		"count":     len(stars),
		"source":    "hipparcos",
		"minMag":    minMagFloat,
		"maxMag":    maxMagFloat,
	}
	
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600") // Cache for 1 hour
	json.NewEncoder(w).Encode(response)
} 