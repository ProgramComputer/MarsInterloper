package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

// MOLA Data file information structure
type MolaDataFile struct {
	FilePath      string  // Path to the .img file
	FileHandle    *os.File // Open file handle
	PixelsPerDeg  int     // Resolution in pixels per degree
	MinLat        float64 // Minimum latitude covered
	MaxLat        float64 // Maximum latitude covered
	MinLon        float64 // Minimum longitude covered (0-360 range)
	MaxLon        float64 // Maximum longitude covered (0-360 range)
	Width         int     // Width in pixels
	Height        int     // Height in pixels
	IsPolar       bool    // Whether this is a polar region file
	SampleType    string  // Type of sample data (MSB_INTEGER or MSB_UNSIGNED_INTEGER)
	ScalingFactor float32 // Scaling factor to apply to raw values
	Offset        float32 // Offset to apply after scaling
}

// MarsTerrainService manages loading and serving Mars terrain data with mixed resolution
type MarsTerrainService struct {
	dataFiles       []*MolaDataFile // Collection of all data files
	highResFiles    []*MolaDataFile // High resolution (512 ppd) files
	mediumResFiles  []*MolaDataFile // Medium resolution (128 ppd) files
	mutex           sync.RWMutex
	chunkCache      map[string][]float32 // Cache for frequently accessed chunks
}

// TerrainChunk represents a chunk of elevation data for a specific area
type TerrainChunk struct {
	MinLat     float64   `json:"minLat"`
	MaxLat     float64   `json:"maxLat"`
	MinLon     float64   `json:"minLon"`
	MaxLon     float64   `json:"maxLon"`
	Width      int       `json:"width"`
	Height     int       `json:"height"`
	Elevation  []float32 `json:"elevation"`
	Resolution int       `json:"resolution"`
	DataSource string    `json:"dataSource"` // Information about the data source (high-res, medium-res)
}

// NewMarsTerrainService creates a new service for accessing Mars terrain data
func NewMarsTerrainService(baseDataDir string) (*MarsTerrainService, error) {
	service := &MarsTerrainService{
		dataFiles:      make([]*MolaDataFile, 0),
		highResFiles:   make([]*MolaDataFile, 0),
		mediumResFiles: make([]*MolaDataFile, 0),
		chunkCache:     make(map[string][]float32),
	}
	
	// First check if the directories exist
	meg512Dir := filepath.Join(baseDataDir, "meg512")
	meg128Dir := filepath.Join(baseDataDir, "meg128")
	
	// Try to load high-resolution (512 pixels/degree) data
	highResLoaded := false
	if _, err := os.Stat(meg512Dir); err == nil {
		// Directory exists, try to load north and south polar files
		northFile := filepath.Join(meg512Dir, "megt_n_512_1.img")
		southFile := filepath.Join(meg512Dir, "megt_s_512_1.img")
		
		if err := service.loadPolarFile(northFile, 512, true); err == nil {
			highResLoaded = true
			log.Printf("Loaded high-resolution north polar data: %s", northFile)
		} else {
			log.Printf("Warning: Failed to load north polar file: %v", err)
		}
		
		if err := service.loadPolarFile(southFile, 512, false); err == nil {
			highResLoaded = true
			log.Printf("Loaded high-resolution south polar data: %s", southFile)
		} else {
			log.Printf("Warning: Failed to load south polar file: %v", err)
		}
	} else {
		log.Printf("High-resolution directory not found: %s", meg512Dir)
	}
	
	// Try to load medium-resolution (128 pixels/degree) data
	mediumResLoaded := false
	if _, err := os.Stat(meg128Dir); err == nil {
		// Directory exists, try to load medium resolution files
		// Look for all .img files in the directory
		files, err := filepath.Glob(filepath.Join(meg128Dir, "*.img"))
		if err != nil {
			log.Printf("Warning: Error looking for medium resolution files: %v", err)
		} else {
			for _, file := range files {
				// Skip files that don't match the MOLA naming pattern
				fileName := filepath.Base(file)
				if !strings.HasPrefix(fileName, "megt") {
					continue
				}
				
				// Parse file name to extract region information
				// Example: megt44n000hb.img
				// Where 44 = latitude band, n = north (or s = south), 000 = longitude start
				isNorth := strings.Contains(fileName, "n")
				
				if err := service.loadRegionalFile(file, 128, isNorth); err != nil {
					log.Printf("Warning: Failed to load medium resolution file %s: %v", fileName, err)
				} else {
					mediumResLoaded = true
				}
			}
		}
	} else {
		log.Printf("Medium-resolution directory not found: %s", meg128Dir)
	}
	
	// Check if we loaded any files
	if !highResLoaded && !mediumResLoaded {
		return nil, fmt.Errorf("failed to load any terrain data files")
	}
	
	// Log the loaded files summary
	log.Printf("Mars terrain service initialized with %d files total (%d high-res, %d medium-res)", 
		len(service.dataFiles), len(service.highResFiles), len(service.mediumResFiles))
	
	return service, nil
}

// loadPolarFile loads a polar MOLA data file (North or South pole)
func (m *MarsTerrainService) loadPolarFile(filePath string, pixelsPerDeg int, isNorth bool) error {
	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("failed to open MOLA file: %w", err)
	}
	
	// Get file size to verify dimensions
	fileInfo, err := file.Stat()
	if err != nil {
		file.Close()
		return fmt.Errorf("failed to get file info: %w", err)
	}
	
	// Calculate dimensions based on file size (assuming 2 bytes per pixel)
	fileSize := fileInfo.Size()
	totalPixels := fileSize / 2
	
	// For polar data, calculate expected dimensions
	width := 360 * pixelsPerDeg  // Full 360 degrees of longitude
	height := int(totalPixels) / width
	
	// Determine lat/lon coverage based on file name and polar region
	var minLat, maxLat float64
	minLon := 0.0
	maxLon := 360.0 // Polar files cover all longitudes
	
	if isNorth {
		// North polar file covers from ~75° to 90° North
		minLat = 73.15 // Value based on standard MOLA data coverage
		maxLat = 90.0
	} else {
		// South polar file covers from ~-75° to -90° South
		minLat = -90.0
		maxLat = -73.15 // Value based on standard MOLA data coverage
	}
	
	// Create file info structure with scaling and offset from high-res polar data label
	molaFile := &MolaDataFile{
		FilePath:      filePath,
		FileHandle:    file,
		PixelsPerDeg:  pixelsPerDeg,
		MinLat:        minLat,
		MaxLat:        maxLat,
		MinLon:        minLon,
		MaxLon:        maxLon,
		Width:         width,
		Height:        height,
		IsPolar:       true,
		SampleType:    "MSB_UNSIGNED_INTEGER", // From polar label file
		ScalingFactor: 0.25,                   // From polar label file
		Offset:        -8000.0,                // From polar label file
	}
	
	// Add to appropriate collections
	m.dataFiles = append(m.dataFiles, molaFile)
	m.highResFiles = append(m.highResFiles, molaFile)
	
	return nil
}

// loadRegionalFile loads a non-polar regional MOLA data file
func (m *MarsTerrainService) loadRegionalFile(filePath string, pixelsPerDeg int, isNorth bool) error {
	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("failed to open MOLA file: %w", err)
	}
	
	// Get file size to verify dimensions
	fileInfo, err := file.Stat()
	if err != nil {
		file.Close()
		return fmt.Errorf("failed to get file info: %w", err)
	}
	
	// Parse filename to extract region information
	// Example: megt44n000hb.img
	// Where 44 = latitude band, n = north (or s = south), 000 = longitude start
	fileName := filepath.Base(filePath)
	
	// Extract latitude band from file name
	var minLat, maxLat float64
	
	// Try to extract latitude from filename
	latStr := ""
	for i := 4; i < len(fileName) && i < 7; i++ {
		if fileName[i] >= '0' && fileName[i] <= '9' {
			latStr += string(fileName[i])
		} else {
			break
		}
	}
	
	latBand, err := strconv.Atoi(latStr)
	if err != nil {
		// Default to making assumptions based on hemisphere
		if isNorth {
			minLat = 0.0
			maxLat = 44.0
		} else {
			minLat = -44.0
			maxLat = 0.0
		}
		log.Printf("Warning: Could not parse latitude from filename %s, using defaults: [%.1f°,%.1f°]", 
			fileName, minLat, maxLat)
	} else {
		// Use the parsed latitude band
		if isNorth {
			minLat = 0.0
			maxLat = float64(latBand)
		} else {
			minLat = -float64(latBand)
			maxLat = 0.0
		}
	}
	
	// Extract longitude from filename (3 digits after 'n' or 's')
	var minLon, maxLon float64
	
	lonStart := 0
	for i := 0; i < len(fileName); i++ {
		if fileName[i] == 'n' || fileName[i] == 's' {
			lonStart = i + 1
			break
		}
	}
	
	if lonStart > 0 && lonStart+3 <= len(fileName) {
		lonStr := fileName[lonStart:lonStart+3]
		startLon, err := strconv.Atoi(lonStr)
		if err == nil {
			// Longitude ranges in MOLA files are typically 90-degree segments
			minLon = float64(startLon)
			maxLon = minLon + 90.0
		} else {
			// Default longitude range
			minLon = 0.0
			maxLon = 90.0
			log.Printf("Warning: Could not parse longitude from filename %s, using defaults: [%.1f°,%.1f°]", 
				fileName, minLon, maxLon)
		}
	} else {
		// Default longitude range
		minLon = 0.0
		maxLon = 90.0
		log.Printf("Warning: Could not locate longitude in filename %s, using defaults: [%.1f°,%.1f°]", 
			fileName, minLon, maxLon)
	}
	
	// Calculate dimensions based on file size and expected resolution
	fileSize := fileInfo.Size()
	totalPixels := fileSize / 2
	
	// For regional data, dimensions should match the lat/lon coverage
	latRange := math.Abs(maxLat - minLat)
	lonRange := math.Abs(maxLon - minLon)
	
	width := int(lonRange * float64(pixelsPerDeg))
	height := int(latRange * float64(pixelsPerDeg))
	
	// Verify expected size matches file size
	expectedPixels := width * height
	if totalPixels != int64(expectedPixels) {
		log.Printf("Warning: File size mismatch for %s. Expected %d pixels, got %d pixels.", 
			fileName, expectedPixels, totalPixels)
		
		// Adjust height to match file size (width is more reliable)
		height = int(totalPixels) / width
	}
	
	// Create file info structure
	// For medium-res regional data (128ppd), according to label:
	// - SAMPLE_TYPE = MSB_INTEGER (signed)
	// - No explicit scaling factor or offset, raw values appear to be direct meters
	molaFile := &MolaDataFile{
		FilePath:      filePath,
		FileHandle:    file,
		PixelsPerDeg:  pixelsPerDeg,
		MinLat:        minLat,
		MaxLat:        maxLat,
		MinLon:        minLon,
		MaxLon:        maxLon,
		Width:         width,
		Height:        height,
		IsPolar:       false,
		SampleType:    "MSB_INTEGER", // From regional label file
		ScalingFactor: 1.0,           // Direct values, no scaling
		Offset:        0.0,           // Direct values, no offset
	}
	
	// Add to appropriate collections
	m.dataFiles = append(m.dataFiles, molaFile)
	m.mediumResFiles = append(m.mediumResFiles, molaFile)
	
	return nil
}

// GetElevationAt returns the elevation at a specific lat/lon position
func (m *MarsTerrainService) GetElevationAt(lat, lon float64) (float32, error) {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	// Normalize longitude to 0-360 range
	for lon < 0 {
		lon += 360.0
	}
	for lon >= 360.0 {
		lon -= 360.0
	}

	// Find best file for this location
	dataFile, err := m.findBestFileForLocation(lat, lon)
	if err != nil {
		return 0, err
	}
	
	// Calculate pixel coordinates in the file
	// The (x,y) calculation depends on the file's coverage
	var pixelX, pixelY int
	
	// For longitude, it's straightforward - map from file's min/max lon to 0 -> width
	lonRange := dataFile.MaxLon - dataFile.MinLon
	lonFraction := (lon - dataFile.MinLon) / lonRange
	pixelX = int(lonFraction * float64(dataFile.Width))
	
	// Clamp to valid range
	if pixelX < 0 {
		pixelX = 0
	}
	if pixelX >= dataFile.Width {
		pixelX = dataFile.Width - 1
	}
	
	// For latitude, it depends on whether this is a north or south hemispheric file
	if dataFile.MaxLat > 0 && dataFile.MinLat >= 0 {
		// North hemisphere file - latitude increases from 0 at equator to 90 at pole
		// But pixel Y value increases from 0 at min latitude to height-1 at max latitude
		// So bottom of image is min latitude (near equator)
		latRange := dataFile.MaxLat - dataFile.MinLat
		latFraction := (lat - dataFile.MinLat) / latRange
		pixelY = int(latFraction * float64(dataFile.Height))
	} else if dataFile.MinLat < 0 && dataFile.MaxLat <= 0 {
		// South hemisphere file - latitude decreases from 0 at equator to -90 at pole
		// But pixel Y value increases from 0 at max latitude to height-1 at min latitude
		// So top of image is max latitude (near equator)
		latRange := math.Abs(dataFile.MinLat - dataFile.MaxLat)
		latFraction := math.Abs(lat - dataFile.MaxLat) / latRange
		pixelY = int(latFraction * float64(dataFile.Height))
	} else {
		// This is a cross-equator file, need to handle differently
		latRange := dataFile.MaxLat - dataFile.MinLat
		latFraction := (lat - dataFile.MinLat) / latRange
		pixelY = int(latFraction * float64(dataFile.Height))
	}
	
	// Clamp to valid range
	if pixelY < 0 {
		pixelY = 0
	}
	if pixelY >= dataFile.Height {
		pixelY = dataFile.Height - 1
	}
	
	// Calculate index in the file
	index := pixelY * dataFile.Width + pixelX
	
	// Read the elevation value
	return m.readElevationValue(dataFile.FileHandle, index)
}

// findBestFileForLocation determines which MOLA data file provides the best resolution
// for a given location, prioritizing higher resolution when available
func (m *MarsTerrainService) findBestFileForLocation(lat, lon float64) (*MolaDataFile, error) {
	// First check high-resolution files
	for _, file := range m.highResFiles {
		if m.isLocationInFile(lat, lon, file) {
			return file, nil
		}
	}
	
	// Then check medium-resolution files
	for _, file := range m.mediumResFiles {
		if m.isLocationInFile(lat, lon, file) {
			return file, nil
		}
	}
	
	return nil, fmt.Errorf("no terrain data available for location (%.4f, %.4f)", lat, lon)
}

// isLocationInFile checks if a lat/lon coordinate is covered by a specific file
func (m *MarsTerrainService) isLocationInFile(lat, lon float64, file *MolaDataFile) bool {
	// Check latitude range
	if lat < file.MinLat || lat > file.MaxLat {
		return false
	}
	
	// For longitude, we need to handle the 0-360 wrap around
	// First normalize lon to 0-360 range to match file coordinates
	for lon < 0 {
		lon += 360.0
	}
	for lon >= 360.0 {
		lon -= 360.0
	}
	
	// Normal longitude range check
	if file.MinLon <= file.MaxLon {
		// Standard case (e.g., 0-90°)
		return lon >= file.MinLon && lon <= file.MaxLon
	} else {
		// Wrapping around 0/360° (rare but possible)
		return lon >= file.MinLon || lon <= file.MaxLon
	}
}

// GetChunk returns a chunk of terrain data for a region
func (m *MarsTerrainService) GetChunk(minLat, maxLat, minLon, maxLon float64, resolution int) (*TerrainChunk, error) {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	// Normalize longitude
	for minLon < 0 {
		minLon += 360.0
	}
	for maxLon < 0 {
		maxLon += 360.0
	}
	for minLon >= 360.0 {
		minLon -= 360.0
	}
	for maxLon >= 360.0 {
		maxLon -= 360.0
	}

	// Handle longitude wrapping
	if maxLon < minLon {
		// The chunk crosses the 0/360 boundary - split it
		chunk1, err := m.getChunkInternal(minLat, maxLat, minLon, 360.0, resolution)
		if err != nil {
			return nil, err
		}
		
		chunk2, err := m.getChunkInternal(minLat, maxLat, 0.0, maxLon, resolution)
		if err != nil {
			return nil, err
		}
		
		// Merge the chunks
		return m.mergeChunks(chunk1, chunk2, minLat, maxLat, minLon, maxLon, resolution)
	}

	// Handle normal case (no wrapping)
	return m.getChunkInternal(minLat, maxLat, minLon, maxLon, resolution)
}

// getChunkInternal handles the actual chunk data retrieval without longitude wrapping
func (m *MarsTerrainService) getChunkInternal(minLat, maxLat, minLon, maxLon float64, resolution int) (*TerrainChunk, error) {
	// Calculate chunk dimensions
	width := resolution
	height := int(float64(resolution) * (maxLat - minLat) / (maxLon - minLon))
	if height < 1 {
		height = 1
	}

	// Create cache key
	cacheKey := fmt.Sprintf("%.5f,%.5f,%.5f,%.5f,%d", minLat, maxLat, minLon, maxLon, resolution)

	// Check cache first
	if cachedData, exists := m.chunkCache[cacheKey]; exists {
		return &TerrainChunk{
			MinLat:     minLat,
			MaxLat:     maxLat,
			MinLon:     minLon,
			MaxLon:     maxLon,
			Width:      width,
			Height:     height,
			Elevation:  cachedData,
			Resolution: resolution,
			DataSource: "cached data", // Indicate this is from cache
		}, nil
	}

	// Allocate elevation data array
	elevations := make([]float32, width*height)
	
	// Track data sources used for this chunk
	dataSourcesUsed := make(map[string]int)

	// Fill the elevation data
	for y := 0; y < height; y++ {
		lat := minLat + (maxLat-minLat)*(float64(y)/float64(height))
		
		for x := 0; x < width; x++ {
			lon := minLon + (maxLon-minLon)*(float64(x)/float64(width))
			
			// Find best file for this location
			dataFile, err := m.findBestFileForLocation(lat, lon)
			if err != nil {
				elevations[y*width+x] = 0
				dataSourcesUsed["no data"] += 1
				continue
			}
			
			// Track which data source was used
			if dataFile.IsPolar {
				dataSourcesUsed["high-resolution polar"] += 1
			} else {
				dataSourcesUsed["medium-resolution regional"] += 1
			}
			
			// Calculate pixel coordinates in the file
			// The (x,y) calculation depends on the file's coverage
			var pixelX, pixelY int
			
			// For longitude, it's straightforward - map from file's min/max lon to 0 -> width
			lonRange := dataFile.MaxLon - dataFile.MinLon
			lonFraction := (lon - dataFile.MinLon) / lonRange
			pixelX = int(lonFraction * float64(dataFile.Width))
			
			// Clamp to valid range
			if pixelX < 0 {
				pixelX = 0
			}
			if pixelX >= dataFile.Width {
				pixelX = dataFile.Width - 1
			}
			
			// For latitude, it depends on whether this is a north or south hemispheric file
			if dataFile.MaxLat > 0 && dataFile.MinLat >= 0 {
				// North hemisphere file
				latRange := dataFile.MaxLat - dataFile.MinLat
				latFraction := (lat - dataFile.MinLat) / latRange
				pixelY = int(latFraction * float64(dataFile.Height))
			} else if dataFile.MinLat < 0 && dataFile.MaxLat <= 0 {
				// South hemisphere file
				latRange := math.Abs(dataFile.MinLat - dataFile.MaxLat)
				latFraction := math.Abs(lat - dataFile.MaxLat) / latRange
				pixelY = int(latFraction * float64(dataFile.Height))
			} else {
				// Cross-equator file
				latRange := dataFile.MaxLat - dataFile.MinLat
				latFraction := (lat - dataFile.MinLat) / latRange
				pixelY = int(latFraction * float64(dataFile.Height))
			}
			
			// Clamp to valid range
			if pixelY < 0 {
				pixelY = 0
			}
			if pixelY >= dataFile.Height {
				pixelY = dataFile.Height - 1
			}
			
			// Calculate index in the file
			index := pixelY * dataFile.Width + pixelX
			
			// Read the elevation value
			elevation, err := m.readElevationValue(dataFile.FileHandle, index)
			if err != nil {
				elevations[y*width+x] = 0
				continue
			}
			
			elevations[y*width+x] = elevation
		}
	}

	// Determine primary data source
	primarySource := "mixed sources"
	var maxCount int
	for source, count := range dataSourcesUsed {
		if count > maxCount {
			maxCount = count
			primarySource = source
		}
	}
	
	// If we have a clear majority source, use that
	totalPixels := width * height
	if maxCount > totalPixels/2 {
		primarySource = fmt.Sprintf("%s (%.1f%%)", primarySource, float64(maxCount)/float64(totalPixels)*100)
	} else {
		// Otherwise build a summary
		sources := make([]string, 0, len(dataSourcesUsed))
		for source, count := range dataSourcesUsed {
			sources = append(sources, fmt.Sprintf("%s (%.1f%%)", source, float64(count)/float64(totalPixels)*100))
		}
		primarySource = strings.Join(sources, ", ")
	}

	// Store in cache if not too large (limit to 1MB chunks)
	if width*height*4 <= 1024*1024 {
		m.chunkCache[cacheKey] = elevations
	}

	return &TerrainChunk{
		MinLat:     minLat,
		MaxLat:     maxLat,
		MinLon:     minLon,
		MaxLon:     maxLon,
		Width:      width,
		Height:     height,
		Elevation:  elevations,
		Resolution: resolution,
		DataSource: primarySource,
	}, nil
}

// mergeChunks combines two chunks into a single chunk
func (m *MarsTerrainService) mergeChunks(chunk1, chunk2 *TerrainChunk, minLat, maxLat, minLon, maxLon float64, resolution int) (*TerrainChunk, error) {
	// Calculate final dimensions
	width := resolution
	height := int(float64(resolution) * (maxLat - minLat) / (maxLon - minLon))
	if height < 1 {
		height = 1
	}

	// Create new elevation array
	mergedElevations := make([]float32, width*height)

	// Determine the proportion of the first chunk
	totalLonSpan := 360.0 - minLon + maxLon
	chunk1Proportion := (360.0 - minLon) / totalLonSpan
	
	// Calculate split point in the output array
	splitX := int(float64(width) * chunk1Proportion)
	
	// Copy data from both chunks with correct positioning
	for y := 0; y < height; y++ {
		// Calculate source y coordinates in both chunks
		y1 := int(float64(y) / float64(height) * float64(chunk1.Height))
		y2 := int(float64(y) / float64(height) * float64(chunk2.Height))
		
		// Clamp to valid ranges
		if y1 >= chunk1.Height {
			y1 = chunk1.Height - 1
		}
		if y2 >= chunk2.Height {
			y2 = chunk2.Height - 1
		}
		
		// Copy from first chunk (minLon to 360°)
		for x := 0; x < splitX; x++ {
			// Map x to source coordinate in chunk1
			x1 := int(float64(x) / float64(splitX) * float64(chunk1.Width))
			if x1 >= chunk1.Width {
				x1 = chunk1.Width - 1
			}
			
			if y1 >= 0 && y1 < chunk1.Height && x1 >= 0 && x1 < chunk1.Width {
				mergedElevations[y*width+x] = chunk1.Elevation[y1*chunk1.Width+x1]
			}
		}
		
		// Copy from second chunk (0° to maxLon)
		for x := splitX; x < width; x++ {
			// Map x to source coordinate in chunk2
			x2 := int(float64(x-splitX) / float64(width-splitX) * float64(chunk2.Width))
			if x2 >= chunk2.Width {
				x2 = chunk2.Width - 1
			}
			
			if y2 >= 0 && y2 < chunk2.Height && x2 >= 0 && x2 < chunk2.Width {
				mergedElevations[y*width+x] = chunk2.Elevation[y2*chunk2.Width+x2]
			}
		}
	}

	// Combine the data source information
	mergedDataSource := fmt.Sprintf("merged: %.1f%% from %s, %.1f%% from %s", 
		chunk1Proportion*100, chunk1.DataSource, 
		(1-chunk1Proportion)*100, chunk2.DataSource)

	return &TerrainChunk{
		MinLat:     minLat,
		MaxLat:     maxLat,
		MinLon:     minLon,
		MaxLon:     maxLon,
		Width:      width,
		Height:     height,
		Elevation:  mergedElevations,
		Resolution: resolution,
		DataSource: mergedDataSource,
	}, nil
}

// readElevationValue reads a single elevation value from a MOLA data file
func (m *MarsTerrainService) readElevationValue(file *os.File, index int) (float32, error) {
	// Each value is a 16-bit signed integer (2 bytes)
	valueOffset := int64(index * 2)
	
	// Check if the offset is within the file bounds
	fileInfo, err := file.Stat()
	if err != nil {
		return 0, fmt.Errorf("failed to get file info: %w", err)
	}
	
	fileSize := fileInfo.Size()
	if valueOffset >= fileSize || valueOffset < 0 {
		return 0, fmt.Errorf("offset %d is outside file bounds (size: %d)", valueOffset, fileSize)
	}
	
	// Read data
	data := make([]byte, 2)
	_, err = file.ReadAt(data, valueOffset)
	if err != nil {
		return 0, fmt.Errorf("failed to read elevation data: %w", err)
	}
	
	// We need to determine which file this is to apply the right formula
	// Find the matching data file for this file handle
	var dataFile *MolaDataFile
	for _, df := range m.dataFiles {
		if df.FileHandle == file {
			dataFile = df
			break
		}
	}
	
	if dataFile == nil {
		return 0, fmt.Errorf("could not identify data file for elevation lookup")
	}

	var elevation float32
	
	// Apply the appropriate formula based on the file type
	if dataFile.SampleType == "MSB_UNSIGNED_INTEGER" {
		// For high-resolution polar data (e.g., megt_n_512_1.img)
		// TOPOGRAPHY = (STORED VALUE * SCALING_FACTOR) + OFFSET
		rawElevation := binary.BigEndian.Uint16(data)
		elevation = float32(rawElevation) * dataFile.ScalingFactor + dataFile.Offset
	} else if dataFile.SampleType == "MSB_INTEGER" {
		// For medium-resolution regional data (e.g., megt44s000hb.img)
		// These use signed integers directly as meter values
		rawElevation := int16(binary.BigEndian.Uint16(data))
		elevation = float32(rawElevation) * dataFile.ScalingFactor + dataFile.Offset
	} else {
		// Fallback for unknown data type - use the high-res formula
		// This should never happen with proper initialization
		log.Printf("Warning: Unknown sample type for file %s, using default formula", dataFile.FilePath)
		rawElevation := binary.BigEndian.Uint16(data)
		elevation = float32(rawElevation) * 0.25 - 8000.0
	}
	
	return elevation, nil
}

// Close closes all open file handles
func (m *MarsTerrainService) Close() error {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	
	var lastErr error
	
	// Close all file handles
	for _, file := range m.dataFiles {
		if file.FileHandle != nil {
			if err := file.FileHandle.Close(); err != nil {
				lastErr = err
				log.Printf("Error closing file %s: %v", file.FilePath, err)
			}
			file.FileHandle = nil
		}
	}
	
	// Clear data structures
	m.dataFiles = nil
	m.highResFiles = nil
	m.mediumResFiles = nil
	
	return lastErr
}

// HandleMarsElevation handles requests for elevation at a specific point
func HandleMarsElevation(w http.ResponseWriter, r *http.Request) {
	if marsTerrainService == nil {
		http.Error(w, "Mars terrain data not available", http.StatusServiceUnavailable)
		return
	}

	// Get lat/lon from query parameters
	latStr := r.URL.Query().Get("lat")
	lonStr := r.URL.Query().Get("lon")
	
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
	
	// Try to get elevation at exact coordinates
	elevation, err := marsTerrainService.GetElevationAt(lat, lon)
	if err != nil {
		// If exact coordinates fail, try nearby points with progressively larger offsets
		// Define offsets to try (in degrees)
		offsets := []float64{0.1, 0.2, 0.5, 1.0}
		
		var foundElevation bool
		var dataSource string
		
		// Try each offset in each direction
		for _, offset := range offsets {
			// Define directions to try
			directions := []struct {
				latOffset float64
				lonOffset float64
				name      string
			}{
				{offset, 0, "north"},
				{-offset, 0, "south"},
				{0, offset, "east"},
				{0, -offset, "west"},
				{offset, offset, "northeast"},
				{offset, -offset, "northwest"},
				{-offset, offset, "southeast"},
				{-offset, -offset, "southwest"},
			}
			
			// Try each direction
			for _, dir := range directions {
				newLat := lat + dir.latOffset
				newLon := lon + dir.lonOffset
				
				// Clamp latitude to valid range (-90 to 90)
				if newLat > 90 {
					newLat = 90
				} else if newLat < -90 {
					newLat = -90
				}
				
				// Try to get elevation at this offset point
				tempElevation, tempErr := marsTerrainService.GetElevationAt(newLat, newLon)
				if tempErr == nil {
					elevation = tempElevation
					foundElevation = true
					dataSource = fmt.Sprintf("interpolated from %s (%g° offset)", dir.name, offset)
					break
				}
			}
			
			if foundElevation {
				break
			}
		}
		
		if !foundElevation {
			http.Error(w, fmt.Sprintf("No elevation data available at or near coordinates: %s", err), http.StatusNotFound)
			return
		}
		
		// Return the interpolated elevation data
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"latitude":  lat,
			"longitude": lon,
			"elevation": elevation,
			"source":    dataSource,
		})
		return
	}
	
	// If we're here, the original coordinates worked
	// Determine the data source for information
	var dataSource string
	dataFile, _ := marsTerrainService.findBestFileForLocation(lat, lon)
	if dataFile != nil {
		if dataFile.IsPolar {
			dataSource = "high-resolution polar data"
		} else {
			dataSource = "medium-resolution regional data"
		}
	} else {
		dataSource = "unknown" // Should not happen, but just in case
	}
	
	// Return the elevation data
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"latitude":  lat,
		"longitude": lon,
		"elevation": elevation,
		"source":    dataSource,
	})
}

// HandleMarsChunk handles requests for terrain chunks
func HandleMarsChunk(w http.ResponseWriter, r *http.Request) {
	if marsTerrainService == nil {
		http.Error(w, "Mars terrain data not available", http.StatusServiceUnavailable)
		return
	}

	// Get parameters
	minLatStr := r.URL.Query().Get("minLat")
	maxLatStr := r.URL.Query().Get("maxLat")
	minLonStr := r.URL.Query().Get("minLon")
	maxLonStr := r.URL.Query().Get("maxLon")
	resolutionStr := r.URL.Query().Get("resolution")
	
	if minLatStr == "" || maxLatStr == "" || minLonStr == "" || maxLonStr == "" {
		http.Error(w, "Missing coordinate parameters", http.StatusBadRequest)
		return
	}
	
	minLat, err := strconv.ParseFloat(minLatStr, 64)
	if err != nil {
		http.Error(w, "Invalid minLat value", http.StatusBadRequest)
		return
	}
	
	maxLat, err := strconv.ParseFloat(maxLatStr, 64)
	if err != nil {
		http.Error(w, "Invalid maxLat value", http.StatusBadRequest)
		return
	}
	
	minLon, err := strconv.ParseFloat(minLonStr, 64)
	if err != nil {
		http.Error(w, "Invalid minLon value", http.StatusBadRequest)
		return
	}
	
	maxLon, err := strconv.ParseFloat(maxLonStr, 64)
	if err != nil {
		http.Error(w, "Invalid maxLon value", http.StatusBadRequest)
		return
	}
	
	// Default resolution to 64x64
	resolution := 64
	if resolutionStr != "" {
		res, err := strconv.Atoi(resolutionStr)
		if err == nil && res > 0 {
			resolution = res
		}
	}
	
	// Get chunk
	chunk, err := marsTerrainService.GetChunk(minLat, maxLat, minLon, maxLon, resolution)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error getting terrain chunk: %v", err), http.StatusInternalServerError)
		return
	}
	
	// Return as JSON
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(chunk)
} 