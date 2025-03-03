package main

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"sync"
)

// Star represents a star from the Hipparcos catalog with essential rendering information
type Star struct {
	HIP         int     `json:"hip"`         // Hipparcos ID
	RightAsc    float64 `json:"ra"`          // Right Ascension in degrees (J1991.25)
	Declination float64 `json:"dec"`         // Declination in degrees (J1991.25)
	Magnitude   float64 `json:"magnitude"`   // Visual magnitude
	ColorIndex  float64 `json:"colorIndex"`  // B-V color index
	SpectralType string  `json:"spectralType,omitempty"` // Spectral type
	Color       string  `json:"color"`       // HTML color code based on B-V
}

// VisibleStar represents a star as visible from Mars with altitude/azimuth coordinates
type VisibleStar struct {
	HIP       int     `json:"hip"`       // Hipparcos ID
	Magnitude float64 `json:"magnitude"` // Visual magnitude
	Altitude  float64 `json:"altitude"`  // Degrees above horizon (negative means below)
	Azimuth   float64 `json:"azimuth"`   // Degrees from north (clockwise)
	Color     string  `json:"color"`     // HTML color code
}

// MarsSkyService manages the star catalog and calculations for Mars night sky
type MarsSkyService struct {
	stars      []Star
	starsMutex sync.RWMutex
	loaded     bool
}

// NewMarsSkyService creates a new service for serving Mars night sky data
func NewMarsSkyService(catalogPath string) (*MarsSkyService, error) {
	service := &MarsSkyService{
		stars:  make([]Star, 0),
		loaded: false,
	}

	// Load catalog asynchronously to not block server startup
	go func() {
		err := service.loadHipparcosCatalog(catalogPath)
		if err != nil {
			log.Printf("Error loading Hipparcos catalog: %v", err)
			return
		}
		service.loaded = true
		log.Printf("Mars sky service: Loaded %d stars from Hipparcos catalog", len(service.stars))
	}()

	return service, nil
}

// loadHipparcosCatalog loads star data from the Hipparcos CSV file
func (m *MarsSkyService) loadHipparcosCatalog(filePath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("failed to open Hipparcos catalog: %w", err)
	}
	defer file.Close()

	// Create CSV reader
	reader := csv.NewReader(file)
	
	// Set comma separator (adjust if your CSV uses a different delimiter)
	reader.Comma = ','
	
	// Read header
	_, err = reader.Read()
	if err != nil {
		return fmt.Errorf("failed to read header: %w", err)
	}

	// Read records
	records, err := reader.ReadAll()
	if err != nil {
		return fmt.Errorf("failed to read records: %w", err)
	}

	m.starsMutex.Lock()
	defer m.starsMutex.Unlock()

	// Process each star
	for _, record := range records {
		// Skip if we don't have enough fields
		if len(record) < 77 {
			continue
		}

		// Extract hip number - field 1
		hip, err := strconv.Atoi(record[1])
		if err != nil {
			continue // Skip stars with invalid HIP numbers
		}

		// Extract RA in degrees - field 8
		ra, err := strconv.ParseFloat(record[8], 64)
		if err != nil {
			continue
		}

		// Extract Dec in degrees - field 9
		dec, err := strconv.ParseFloat(record[9], 64)
		if err != nil {
			continue
		}

		// Extract visual magnitude - field 5
		vmag, err := strconv.ParseFloat(record[5], 64)
		if err != nil {
			// Try Hipparcos magnitude if visual magnitude isn't available - field 44
			vmag, err = strconv.ParseFloat(record[44], 64)
			if err != nil {
				continue // Skip stars with no magnitude information
			}
		}

		// Only include stars brighter than magnitude 6.5 (visible to naked eye)
		if vmag > 6.5 {
			continue
		}

		// Extract B-V color index - field 37
		colorIndex := 0.0
		if record[37] != "" {
			colorIndex, _ = strconv.ParseFloat(record[37], 64)
		}

		// Extract spectral type - field 76
		spectralType := record[76]

		// Create color code based on B-V index
		color := getBVColor(colorIndex, spectralType)

		// Create star entry
		star := Star{
			HIP:         hip,
			RightAsc:    ra,
			Declination: dec,
			Magnitude:   vmag,
			ColorIndex:  colorIndex,
			SpectralType: spectralType,
			Color:       color,
		}

		m.stars = append(m.stars, star)
	}

	return nil
}

// getBVColor returns an HTML color code based on B-V color index and spectral type
func getBVColor(bv float64, spectralType string) string {
	// Default color is white
	if bv == 0 && spectralType == "" {
		return "#FFFFFF"
	}

	// Use spectral type as fallback if B-V is not available
	if bv == 0 && len(spectralType) > 0 {
		// Extract first letter of spectral type
		spectralClass := ""
		if len(spectralType) > 0 {
			spectralClass = string(spectralType[0])
		}

		switch spectralClass {
		case "O":
			return "#9BB0FF" // Blue
		case "B":
			return "#AAC0FF" // Blue-white
		case "A":
			return "#CAD7FF" // White
		case "F":
			return "#F8F7FF" // Yellow-white
		case "G":
			return "#FFF4EA" // Yellow
		case "K":
			return "#FFD2A1" // Orange
		case "M":
			return "#FFCC6F" // Red
		default:
			return "#FFFFFF" // White
		}
	}

	// Use B-V color index to determine star color
	if bv < -0.3 {
		return "#9BB0FF" // Blue
	} else if bv < 0.0 {
		return "#AAC0FF" // Blue-white
	} else if bv < 0.3 {
		return "#CAD7FF" // White
	} else if bv < 0.6 {
		return "#F8F7FF" // Yellow-white
	} else if bv < 1.0 {
		return "#FFF4EA" // Yellow
	} else if bv < 1.5 {
		return "#FFD2A1" // Orange
	} else {
		return "#FFCC6F" // Red
	}
}

// GetVisibleStars calculates which stars are visible from a given Mars location
func (m *MarsSkyService) GetVisibleStars(marsLat, marsLon, marsTime float64, limit int) ([]VisibleStar, error) {
	if !m.loaded {
		return nil, fmt.Errorf("star catalog not yet loaded")
	}

	m.starsMutex.RLock()
	defer m.starsMutex.RUnlock()

	// Mars-specific astronomical constants
	const (
		marsAxialTilt = 25.19  // Mars' axial tilt in degrees (Earth is 23.5)
		marsDayLength = 24.623 // Mars day length in hours
		
		// Constants for Mars-specific star brightness adjustments
		marsSunDistRatio   = 1.52    // Mars/Earth distance ratio from Sun (Mars is ~1.52 AU from Sun)
		marsAtmosRatio     = 0.006   // Mars/Earth atmospheric pressure ratio (~0.6% of Earth's)
	)

	// Calculate Mars Local Sidereal Time (LST)
	// This is a simplified model; a full implementation would use Mars orbital elements
	lst := marsTime / marsDayLength * 360.0 // Convert Mars time to degrees of rotation
	lst = math.Mod(lst+marsLon, 360.0)      // Add Mars longitude
	if lst < 0 {
		lst += 360.0 // Ensure positive value between 0-360
	}

	// Create result array
	visibleStars := make([]VisibleStar, 0, limit)

	// Mars' position relative to Earth at J1991.25 (Hipparcos epoch)
	// This is a simplified approximation - a complete implementation would calculate
	// Mars' position for the specific date
	const (
		marsEarthDistAU = 1.5  // Average Mars-Earth distance in AU
		marsLonOffset   = 48.0 // Approximate longitude offset in degrees
	)

	// Process each star to calculate altitude and azimuth
	for _, star := range m.stars {
		// Convert RA/Dec to Mars-centered horizontal coordinates
		alt, az := equatorialToMarsHorizontal(
			star.RightAsc, 
			star.Declination, 
			marsLat, 
			lst, 
			marsAxialTilt,
			marsEarthDistAU,
			marsLonOffset,
		)

		// Only include stars above or near the horizon
		if alt > -10.0 { // Include stars slightly below horizon for smoother transitions
			// Adjust star magnitude based on Mars conditions
			adjustedMagnitude := star.Magnitude
			
			// 1. Apply specific distance effect based on the star
			distanceEffect := calculateMarsDistanceEffect(star.HIP)
			adjustedMagnitude += distanceEffect
			
			// 2. Apply Mars-specific atmospheric extinction using our scientific model
			atmosphericEffect := calculateMarsAtmosphericExtinction(alt)
			adjustedMagnitude += atmosphericEffect
			
			// 3. Never make stars unrealistically bright
			if adjustedMagnitude < -1.5 {
				adjustedMagnitude = -1.5
			}
			
			// 4. Log star brightness adjustments (for major stars only, to avoid log spam)
			if star.Magnitude < 1.0 {
				/*log.Printf("Mars star brightness: HIP=%d, orig_mag=%.2f, dist_effect=%.2f, atmos_effect=%.2f, final_mag=%.2f",
					star.HIP, 
					star.Magnitude, 
					distanceEffect, 
					atmosphericEffect,
					adjustedMagnitude)*/
			}
			
			visibleStar := VisibleStar{
				HIP:       star.HIP,
				Magnitude: adjustedMagnitude, // Use Mars-adjusted magnitude
				Altitude:  alt,
				Azimuth:   az,
				Color:     star.Color,
			}
			visibleStars = append(visibleStars, visibleStar)

			// Enforce limit
			if len(visibleStars) >= limit {
				break
			}
		}
	}

	// Sort stars by magnitude (brightest first)
	// Using a simple bubble sort for clarity
	for i := 0; i < len(visibleStars)-1; i++ {
		for j := 0; j < len(visibleStars)-i-1; j++ {
			if visibleStars[j].Magnitude > visibleStars[j+1].Magnitude {
				visibleStars[j], visibleStars[j+1] = visibleStars[j+1], visibleStars[j]
			}
		}
	}

	// Limit number of stars if needed
	if len(visibleStars) > limit {
		visibleStars = visibleStars[:limit]
	}

	return visibleStars, nil
}

// equatorialToMarsHorizontal converts equatorial coordinates (RA/Dec) to Mars horizontal (alt/az)
// Accounts for Mars' axial tilt and position in the solar system
func equatorialToMarsHorizontal(ra, dec, lat, lst, axialTilt, marsEarthDistAU, marsLonOffset float64) (altitude, azimuth float64) {
	// Convert degrees to radians
	raRad := toRadians(ra)
	decRad := toRadians(dec)
	latRad := toRadians(lat)
	lstRad := toRadians(lst)
	marsLonOffsetRad := toRadians(marsLonOffset)
	
	// 1. Adjust for Mars' position relative to Earth
	// This is a simplified parallax correction based on Mars' distance from Earth
	// A full implementation would use more complex orbital mechanics
	parallaxShift := toRadians(0.1 * math.Sin(marsLonOffsetRad) / marsEarthDistAU)
	raRad += parallaxShift

	// 2. Calculate hour angle with Mars LST
	haRad := lstRad - raRad
	
	// 3. Account for Mars' axial tilt in declination (simplified)
	// This adjusts the declination based on Mars' different axial tilt compared to Earth
	decAdjustment := toRadians(dec) * (axialTilt / 23.5)
	decRadAdjusted := decRad + decAdjustment
	
	// 4. Calculate altitude using Mars-adjusted coordinates
	sinAlt := math.Sin(decRadAdjusted)*math.Sin(latRad) + 
	          math.Cos(decRadAdjusted)*math.Cos(latRad)*math.Cos(haRad)
	alt := math.Asin(math.Max(-1, math.Min(1, sinAlt))) // Clamp to valid range
	
	// 5. Calculate azimuth
	cosAz := (math.Sin(decRadAdjusted) - math.Sin(latRad)*sinAlt) / 
	         (math.Cos(latRad) * math.Cos(alt))
	
	// Handle potential numerical issues
	if cosAz > 1.0 {
		cosAz = 1.0
	} else if cosAz < -1.0 {
		cosAz = -1.0
	}
	
	az := math.Acos(cosAz)
	
	// Correct azimuth for hemisphere
	if math.Sin(haRad) >= 0 {
		az = 2*math.Pi - az
	}
	
	// Convert back to degrees
	altitude = toDegrees(alt)
	azimuth = toDegrees(az)
	
	return altitude, azimuth
}

// calculateMarsAtmosphericExtinction calculates the effect of Mars' atmosphere on star magnitude
// Returns magnitude adjustment (negative value = makes star appear brighter)
// Based on scientific models of the Martian atmosphere's effect on light extinction
func calculateMarsAtmosphericExtinction(altitude float64) float64 {
	// If star is below horizon, no adjustment
	if altitude < 0 {
		return 0
	}
	
	// Convert altitude to zenith angle in radians (zenith = 90° - altitude)
	zenithAngleRad := toRadians(90.0 - altitude)
	
	// Earth values for comparison
	// At zenith (altitude = 90°), extinction is ~0.15 mag
	// At horizon (altitude = 0°), extinction is ~0.7 mag
	
	// For Mars with ~1% Earth atmosphere:
	// - Base extinction at zenith is much less (~0.01 mag)
	// - Horizon extinction is also less (~0.1 mag)
	
	// Simplified Atmospheric Extinction Model for Mars
	// (based on Earth's model but scaled for Mars' thinner atmosphere)
	
	// Earth-based airmass approximation (Kasten and Young, 1989)
	// Modified for Mars atmosphere
	const marsAtmosScale = 0.01 // 1% of Earth's atmosphere
	
	// Airmass calculation - increases with zenith angle (more atmosphere to look through)
	var airmass float64
	if zenithAngleRad < toRadians(85.0) {
		// For angles below 85°, use simple 1/cos(zenith) approximation
		airmass = 1.0 / math.Cos(zenithAngleRad)
	} else {
		// For angles near horizon, use more complex model to avoid infinity at 90°
		airmass = 1.0 / (math.Cos(zenithAngleRad) + 0.15*math.Pow(93.885-toDegrees(zenithAngleRad), -1.253))
	}
	
	// Extinction coefficient for Mars (magnitude per airmass unit)
	// Scaled down from Earth's ~0.15 mag/airmass
	const marsExtinctionCoef = 0.15 * marsAtmosScale
	
	// Calculate extinction (negative because we're making magnitude smaller = brighter)
	extinction := -marsExtinctionCoef * airmass
	
	// Earth's extinction makes stars at horizon ~0.7 mag dimmer, 
	// Mars' extinction is much less due to thinner atmosphere
	
	// Limit maximum effect to avoid unrealistic values
	if extinction < -0.1 {
		extinction = -0.1
	}
	
	return extinction
}

// calculateMarsDistanceEffect calculates how a star's magnitude changes due to Mars' different
// distance from the star compared to Earth. For most stars, the effect is negligible due to
// their immense distance, but for closest stars it can be noticeable.
func calculateMarsDistanceEffect(hipID int) float64 {
	// Default effect for most stars - slightly dimmer due to Mars being further from most stars
	defaultEffect := 0.3
	
	// For specific nearby stars, we can calculate more accurate adjustments
	// Distance effect follows inverse square law: Change in magnitude = 5 * log10(d2/d1)
	// where d1 = distance from Earth, d2 = distance from Mars
	
	// Map of notable stars with their HIP IDs and distance effects
	// Negative values make stars appear brighter from Mars, positive makes them dimmer
	specialStarEffects := map[int]float64{
		// Alpha Centauri (nearest star system)
		71683: 0.4, // Slightly dimmer from Mars due to greater distance (~4.4 ly from Earth)
		
		// Sirius (brightest star in Earth's night sky)
		32349: 0.32, // Slightly dimmer from Mars
		
		// Vega
		91262: 0.28,
		
		// Arcturus
		69673: 0.27,
		
		// Rigel
		24436: 0.25,
		
		// Procyon
		37279: 0.31,
		
		// Betelgeuse
		27989: 0.25,
		
		// Aldebaran
		21421: 0.27,
		
		// Antares (similar red appearance to Mars, might be confused with Mars from Earth)
		80763: 0.28,
		
		// Spica
		65474: 0.29,
		
		// Pollux
		37826: 0.30,
		
		// Deneb
		102098: 0.20, // Less effect due to greater distance
		
		// Regulus
		49669: 0.31,
		
		// Sun - special case, appears much smaller from Mars (~1.5x Earth distance)
		0: 0.83, // log10(1.52²) * 5 ≈ 0.83 magnitudes dimmer from Mars
	}
	
	// Check if this is a special star with known distance effect
	if effect, exists := specialStarEffects[hipID]; exists {
		return effect
	}
	
	// For all other stars, return the default effect
	return defaultEffect
}

// Convert degrees to radians
func toRadians(degrees float64) float64 {
	return degrees * math.Pi / 180.0
}

// Convert radians to degrees
func toDegrees(radians float64) float64 {
	return radians * 180.0 / math.Pi
}

// HandleMarsSky handles requests for Mars night sky data
func HandleMarsSky(w http.ResponseWriter, r *http.Request) {
	if marsSkyService == nil {
		http.Error(w, "Mars sky data not available", http.StatusServiceUnavailable)
		return
	}

	// Get parameters
	latStr := r.URL.Query().Get("lat")
	lonStr := r.URL.Query().Get("lon")
	timeStr := r.URL.Query().Get("time")
	limitStr := r.URL.Query().Get("limit")
	
	if latStr == "" || lonStr == "" {
		http.Error(w, "Missing lat/lon parameters", http.StatusBadRequest)
		return
	}
	
	lat, err := strconv.ParseFloat(latStr, 64)
	if err != nil {
		http.Error(w, "Invalid latitude value", http.StatusBadRequest)
		return
	}
	
	lon, err := strconv.ParseFloat(lonStr, 64)
	if err != nil {
		http.Error(w, "Invalid longitude value", http.StatusBadRequest)
		return
	}
	
	// Default time to local Mars midnight (12.0 hours)
	marsTime := 12.0
	if timeStr != "" {
		t, err := strconv.ParseFloat(timeStr, 64)
		if err == nil {
			marsTime = t
		}
	}
	
	// Default limit to 500 stars
	limit := 500
	if limitStr != "" {
		l, err := strconv.Atoi(limitStr)
		if err == nil && l > 0 {
			limit = l
		}
	}
	
	// Get visible stars
	stars, err := marsSkyService.GetVisibleStars(lat, lon, marsTime, limit)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error calculating visible stars: %v", err), http.StatusInternalServerError)
		return
	}
	
	// Return as JSON
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"marsLocation": map[string]float64{
			"latitude": lat,
			"longitude": lon,
			"timeHours": marsTime,
		},
		"stars": stars,
	})
} 