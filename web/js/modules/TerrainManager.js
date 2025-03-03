import * as THREE from 'three';
import { apiGet } from '../utils/api.js';

// Add a safe console wrapper to prevent syntax errors
const safeConsole = {
    log: function() {
        try {
            console.log.apply(console, arguments);
        } catch (e) {
            // Fail silently
        }
    },
    warn: function() {
        try {
            console.warn.apply(console, arguments);
        } catch (e) {
            // Fail silently
        }
    },
    error: function() {
        try {
            console.error.apply(console, arguments);
        } catch (e) {
            // Fail silently
        }
    }
};

export class TerrainManager {
    constructor(scene, assetManager, physicsManager, options = {}) {
        this.scene = scene;
        this.assetManager = assetManager;
        this.physicsManager = physicsManager;
        this.terrain = null;
        this.terrainSize = options.terrainSize || 1000;
        this.terrainResolution = options.terrainResolution || 256;
        this.terrainMaxHeight = 20;
        this.heightData = null;
        
        // Chunk management properties
        this.chunkSize = 250; // Size of each terrain chunk
        this.chunkResolution = 128; // Resolution per chunk (reduced from 512 for better physics)
        this.physicsResolution = 128; // Lower resolution specifically for physics
        this.loadedChunks = new Map(); // Map of loaded chunks: key = "x,z", value = mesh
        this.chunkLoadDistance = 2; // How many chunks to load in each direction
        this.lastPlayerChunk = { x: 0, z: 0 }; // Track the last chunk the player was in
        this.chunkMaterial = null; // Will store the material for chunks
        
        // Debug visualization
        this.debugChunkBorders = false; // Set to true to visualize chunk borders
        
        // Mars coordinates for positioning
        this.marsPosition = {
            latitude: 18.4446,  // Default: Jezero Crater (Perseverance rover landing site)
            longitude: 77.4509
        };
        
        // Scale factor for Mars heights (real Mars has very large elevation differences)
        this.marsHeightScale = 10;  // Adjust as needed
        
        // Cache for Mars terrain chunks
        this.marsTerrainChunks = new Map(); // key = "minLat,maxLat,minLon,maxLon"
        
        // Flag for using real Mars data vs procedural
        this.useRealMarsData = options.useRealMarsData !== undefined ? options.useRealMarsData : true;
        
        // Chunk loading tracking for progress bar
        this.isLoadingChunks = false; // Flag to track if chunks are currently loading
        this.chunksLoadedCount = 0;   // Number of chunks loaded in current batch
        this.totalChunksToLoad = 0;   // Total number of chunks to load in current batch
        
        // Debug properties
        this.showTerrainDebug = false;
        this.playerController = options.playerController || null;
        this.debugInfoDisplay = null;
        this.lastDebugUpdate = 0; // Add timestamp for throttling debug updates
        this.debugUpdateInterval = 500; // Update every 500ms (2 times per second)
        
        // Height interpolation cache and fallbacks
        this.lastValidHeight = 0; // Store the last valid height for fallback
        this.heightErrorCount = 0; // Track errors to avoid console spam
        
        // Add key binding for terrain debug toggle
        window.addEventListener('keydown', (event) => {
            // Use 'T' key for terrain debug
            if (event.key === 'T' || event.key === 't') {
                this.toggleTerrainDebug();
            }
        });
    }
    
    init() {
        return new Promise(async (resolve) => {
            // Initialize heightData with a default safe array, even if we'll replace it later
            // This ensures that heightData is never undefined
            if (!this.heightData) {
                const safeSize = this.terrainResolution * this.terrainResolution;
                this.heightData = new Float32Array(safeSize);
                // Fill with default safe height
                for (let i = 0; i < safeSize; i++) {
                    this.heightData[i] = 0.5;
                }
                console.log(`TERRAIN-INIT: Created default heightData array of size ${safeSize}`);
            }
            
            if (this.useRealMarsData) {
                try {
                    // Try to load real Mars terrain data from backend API
                    await this.loadMarsTerrainChunk(
                        this.marsPosition.latitude - 1,  // minLat
                        this.marsPosition.latitude + 1,  // maxLat
                        this.marsPosition.longitude - 1, // minLon
                        this.marsPosition.longitude + 1  // maxLon
                    );
                    
                    // Verify that height data was properly loaded
                    if (!this.heightData || this.heightData.length === 0) {
                        throw new Error('Mars data loaded but heightData is empty');
                    }
                } catch (error) {
                    console.warn('MarsInterloper: Could not load Mars data, falling back to procedural terrain', error);
                    // Important: reset useRealMarsData flag but DON'T null out heightData, use the default one
                    this.useRealMarsData = false;
                    // Keep the default heightData instead of setting it to null
                }
            }
            
            if (!this.useRealMarsData) {
                // Fall back to texture-based or procedural terrain
                const terrainTexture = this.assetManager.getTexture('terrain');
                await new Promise(resolveTexture => {
                    this.generateHeightmap(terrainTexture, resolveTexture);
                });
                
                // Triple-check that height data is valid after procedural generation
                if (!this.heightData || this.heightData.length === 0) {
                    console.warn('MarsInterloper: Heightmap generation failed, creating emergency fallback terrain');
                    // Emergency fallback: Simple procedural heightmap with guaranteed variation
                    this.createEmergencyProceduralTerrain();
                }
            }
            
            // Create terrain geometry
            this.createTerrain();
            
            // Add terrain to physics
            if (this.physicsManager) {
                this.createTerrainPhysics();
            }
            
            //console.log('MarsInterloper: Terrain initialized');
            resolve();
        });
    }
    
    // New method to load Mars terrain chunk from API
    async loadMarsTerrainChunk(minLat, maxLat, minLon, maxLon, resolution = 512) {
        // Create a unique key for this chunk
        const chunkKey = `${minLat.toFixed(2)},${maxLat.toFixed(2)},${minLon.toFixed(2)},${maxLon.toFixed(2)}`;
        
        // Check if already loaded
        if (this.marsTerrainChunks.has(chunkKey)) {
            return this.marsTerrainChunks.get(chunkKey);
        }
        
        //console.log(`Fetching Mars terrain data for area: ${minLat.toFixed(2)}°N to ${maxLat.toFixed(2)}°N, ${minLon.toFixed(2)}°E to ${maxLon.toFixed(2)}°E`);
        
        try {
            // Use the API utility to fetch from backend with API key
            const chunk = await apiGet('/api/mars/chunk', {
                minLat: minLat,
                maxLat: maxLat,
                minLon: minLon,
                maxLon: maxLon,
                resolution: resolution
            });
            
            // Verify the chunk data structure
            if (!chunk.elevation || !Array.isArray(chunk.elevation)) {
                throw new Error("Invalid terrain data: missing elevation array");
            }
            
            // Log some sample heights for debugging
            /*console.log("Sample height points:", 
                chunk.elevation.slice(0, 5), 
                chunk.elevation.slice(Math.floor(chunk.elevation.length/2), Math.floor(chunk.elevation.length/2)+5));
            /*console.log(`Received terrain chunk: ${chunk.width}x${chunk.height}, elevation array length: ${chunk.elevation.length}`);*/
            
            // Store in cache
            this.marsTerrainChunks.set(chunkKey, chunk);
            
            // Create or update heightmap data
            if (!this.heightData) {
                this.heightData = new Float32Array(chunk.width * chunk.height);
                this.terrainResolution = chunk.width;
            }
            
            // Find the min and max heights to determine proper scaling
            let minHeight = Number.MAX_VALUE;
            let maxHeight = Number.MIN_VALUE;
            
            for (let i = 0; i < chunk.elevation.length; i++) {
                // Get the height value
                let heightValue = chunk.elevation[i];
                
                // Handle invalid values
                if (isNaN(heightValue)) {
                    heightValue = 0;
                }
                
                // Handle extremely large positive and negative values which could be errors
                // Typical Mars terrain elevation should be between -8000 and +21000 meters
                if (Math.abs(heightValue) > 50000) {
                    // For extreme values, use local average or default to 0
                    heightValue = 0;
                }
                
                minHeight = Math.min(minHeight, heightValue);
                maxHeight = Math.max(maxHeight, heightValue);
            }
            
            //console.log(`Elevation range: ${minHeight.toFixed(2)} to ${maxHeight.toFixed(2)} meters`);
            
            // Remove normalization - don't add an offset to negative elevations
            const heightOffset = 0;
            
            // Store these values for consistent calculations throughout the code
            this.marsHeightOffset = heightOffset;
            this.marsHeightRange = maxHeight - minHeight;
            
            // Normalize heights to game scale and copy to heightmap
            // We'll use the actual min/max range to ensure good visual contrast
            const heightRange = maxHeight - minHeight;
            const heightScale = this.terrainMaxHeight / heightRange;
            
            // Copy and scale elevation data to heightmap
            for (let i = 0; i < chunk.height; i++) {
                for (let j = 0; j < chunk.width; j++) {
                    const index = i * chunk.width + j;
                    if (index < chunk.elevation.length) {
                        // Apply direct scaling - negative Mars elevations should be lower in game
                        const scaledHeight = chunk.elevation[index] * heightScale;
                        // Remove minimum height constraint for high fidelity
                        this.heightData[index] = scaledHeight;
                    } else {
                        // Handle missing data points with default value
                        this.heightData[index] = 0;
                    }
                }
            }
            
            // Add debug helpers to visualize ground level
            // Commented out to remove green debug visualizations
            // this.addGroundLevelDebugHelpers(minHeight, maxHeight);
            
            return chunk;
        } catch (error) {
            console.error("Failed to parse terrain JSON data:", error);
            throw new Error(`Failed to parse terrain data: ${error.message}`);
        }
    }
    
    // Add debug visualization for ground level
    addGroundLevelDebugHelpers(minHeight, maxHeight) {
        // Create a horizontal plane at what should be "ground level"
        const planeSize = this.terrainSize * 0.5;
        const groundPlaneGeometry = new THREE.PlaneGeometry(planeSize, planeSize);
        const groundPlaneMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x00ff00, 
            transparent: true, 
            opacity: 0.3, 
            side: THREE.DoubleSide 
        });
        const groundPlane = new THREE.Mesh(groundPlaneGeometry, groundPlaneMaterial);
        
        // Position the plane at y=0 (what should be ground level)
        groundPlane.rotation.x = -Math.PI / 2;
        groundPlane.position.y = 0;
        this.scene.add(groundPlane);
        
        // Also add a small coordinate axes to visualize the origin
        const axesHelper = new THREE.AxesHelper(10);
        this.scene.add(axesHelper);
        
        //console.log("Added ground level visualization at y=0");
    }
    
    // New method to set initial Mars position
    setMarsPosition(latitude, longitude) {
        this.marsPosition.latitude = latitude;
        this.marsPosition.longitude = longitude;
        //console.log(`MarsInterloper: Position set to ${latitude}°N, ${longitude}°E on Mars`);
    }
    
    // New method to update terrain based on player position
    async updateTerrainForMarsPosition(latitude, longitude) {
        // Check if we need to load a new chunk
        const latDist = Math.abs(latitude - this.marsPosition.latitude);
        const lonDist = Math.abs(longitude - this.marsPosition.longitude);
        
        if (latDist > 0.5 || lonDist > 0.5) {
            // Update current position
            this.marsPosition.latitude = latitude;
            this.marsPosition.longitude = longitude;
            
            try {
                // Load new terrain chunk
                await this.loadMarsTerrainChunk(
                    latitude - 1,
                    latitude + 1,
                    longitude - 1,
                    longitude + 1
                );
                
                // Update terrain geometry
                this.updateTerrainGeometry();
                //console.log(`MarsInterloper: Loaded new Mars terrain at ${latitude.toFixed(4)}°N, ${longitude.toFixed(4)}°E`);
            } catch (error) {
                console.warn('Failed to load new Mars terrain chunk:', error);
            }
        }
    }
    
    // Add method to convert between Mars coordinates and world coordinates
    marsCoordinatesToWorldPosition(latitude, longitude) {
        // This is a simplified conversion - adjust as needed for your world scale
        const centerLat = this.marsPosition.latitude;
        const centerLon = this.marsPosition.longitude;
        
        // Calculate offsets in degrees
        const latOffset = latitude - centerLat;
        const lonOffset = longitude - centerLon;
        
        // Convert to world units - approximate scale where 1 degree = 59km on Mars
        // We'll scale this to fit our game world
        const worldScale = this.terrainSize / 4; // 4 degrees of terrain in our world size
        
        const x = lonOffset * worldScale;
        const z = -latOffset * worldScale; // Negative because +Z is south in our world
        
        return { x, z };
    }
    
    // Convert game world X,Z position to Mars lat/lon coordinates
    worldPositionToMarsCoordinates(x, z) {
        // If we don't have Mars position reference, return default coordinates
        if (!this.marsPosition) {
            return { latitude: 0, longitude: 0 };
        }
        
        // Fixed: Use a much smaller scale to keep coordinates in valid ranges
        // For a terrain size of 1000, we'll map to just 2 degrees of Mars
        const degreesCoverage = 2.0; // Much smaller coverage (2 degrees instead of 10)
        const scale = this.terrainSize / degreesCoverage;
        
        // Calculate latitude and longitude offsets based on position
        const latOffset = (z / scale) * degreesCoverage;
        const lonOffset = (x / scale) * degreesCoverage;
        
        // Add offsets to our Mars position reference point
        const lat = this.marsPosition.latitude + latOffset;
        const lon = this.marsPosition.longitude + lonOffset;
        
        // Ensure latitude stays within valid range (-90 to 90)
        const clampedLat = Math.max(-90, Math.min(90, lat));
        
        // Normalize longitude to 0-360 range
        let normalizedLon = ((lon % 360) + 360) % 360;
        
        // Get elevation if we have the API available
        let elevation = null;
        try {
            // Make a synchronous check for cached elevation data
            const elevationData = this.getElevationFromCache(clampedLat, normalizedLon);
            if (elevationData !== null) {
                elevation = elevationData;
            }
        } catch (e) {
            // Ignore errors in elevation check
        }
        
        return { latitude: clampedLat, longitude: normalizedLon, elevation };
    }
    
    // Helper method to get elevation data from cache
    getElevationFromCache(lat, lon) {
        // Implement a simple cache to avoid API calls
        // This is a synchronous method that only returns cached data
        if (!this.elevationCache) {
            this.elevationCache = new Map();
            return null;
        }
        
        // Use a low-precision key to increase cache hits
        const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
        return this.elevationCache.get(key) || null;
    }
    
    generateHeightmap(texture, callback) {
        // Create a canvas to read the texture data
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const width = this.terrainResolution;
        const height = this.terrainResolution;
        
        canvas.width = width;
        canvas.height = height;
        
        // Check if texture and texture.image are valid
        if (!texture || !texture.image) {
            console.warn('MarsInterloper: Texture for terrain heightmap is missing, using procedural fallback');
            // Create procedural heightmap data
            this.heightData = new Float32Array(width * height);
            
            // Function for deterministic "random" values
            const deterministicNoise = (x, y) => {
                // Simple deterministic noise function
                const val = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
                return val - Math.floor(val);
            };
            
            // Generate some interesting terrain features procedurally
            for (let i = 0; i < height; i++) {
                for (let j = 0; j < width; j++) {
                    const index = i * width + j;
                    
                    // Generate some perlin-like noise
                    const centerX = width / 2;
                    const centerY = height / 2;
                    const distX = j - centerX;
                    const distY = i - centerY;
                    const dist = Math.sqrt(distX * distX + distY * distY) / (width / 2);
                    
                    // Create some crater-like features
                    let elevation = 5.0 * (1.0 - dist * 0.8); // Higher in the middle
                    
                    // Add deterministic noise for consistency
                    const noise = deterministicNoise(j * 0.1, i * 0.1);
                    elevation += noise * 3.0; // Same scale as original Math.random() * 3.0
                    
                    // Store the elevation
                    this.heightData[index] = elevation;
                }
            }
            
            // Now add realistic Martian craters
            this.addRealisticCraters();
            
            ////console.log('MarsInterloper: Procedural heightmap generated with realistic craters');
            callback();
            return;
        }
        
        // Draw the texture to the canvas
        const image = texture.image;
        context.drawImage(image, 0, 0, width, height);
        
        // Get the image data
        const imageData = context.getImageData(0, 0, width, height).data;
        
        // Convert image data to height data
        this.heightData = new Float32Array(width * height);
        
        for (let i = 0; i < this.heightData.length; i++) {
            // Use the red channel for height (grayscale image)
            this.heightData[i] = imageData[i * 4] / 255 * this.terrainMaxHeight;
        }
        
        callback();
    }
    
    createTerrain() {
        //console.log('MarsInterloper: Creating terrain with proper ground level positioning');
        
        // Define terrain dimensions
        const terrainWidth = this.terrainSize;
        const terrainDepth = this.terrainSize;
        const terrainResolution = this.terrainResolution;
        
        // Create a noise generator for terrain
        const seed = 12345; // Fixed seed for consistent terrain
        
        // Initialize heightmap array if not already created
        if (!this.heightData) {
            this.heightData = [];
            
            // Generate terrain data using noise
            // This will create a more natural-looking Martian landscape
            for (let i = 0; i < terrainResolution; i++) {
                for (let j = 0; j < terrainResolution; j++) {
                    const x = i / terrainResolution;
                    const y = j / terrainResolution;
                    
                    // Multi-octave noise for more realistic terrain features
                    // Use multiple frequencies to create varied features at different scales
                    const largeFeatures = this.deterministicNoise(x * 2, y * 2) * 0.5;
                    const mediumFeatures = this.deterministicNoise(x * 5, y * 5) * 0.3;
                    const smallFeatures = this.deterministicNoise(x * 10, y * 10) * 0.15;
                    const microDetails = this.deterministicNoise(x * 25, y * 25) * 0.05;
                    
                    // Combine features with different weights
                    let height = largeFeatures + mediumFeatures + smallFeatures + microDetails;
                    
                    // Apply additional noise patterns for dunes, ridges, and erosion features
                    // Add some ridge formations using absolute sine wave patterns
                    const ridges = Math.abs(Math.sin(x * 15 + this.deterministicNoise(x, y) * 3)) * 0.1;
                    
                    // Create some crater-like depressions
                    const distFromCenter = Math.sqrt(Math.pow(x - 0.5, 2) + Math.pow(y - 0.5, 2));
                    const craterEffect = Math.max(0, 0.08 - distFromCenter * 0.15);
                    
                    // Add weathering and erosion patterns
                    const erosion = this.deterministicNoise(x * 50, y * 50) * 0.03;
                    
                    // Combine all effects
                    height = height + ridges - craterEffect + erosion;
                    
                    // Scale to terrain height
                    height = height * this.terrainMaxHeight;
                    
                    // Ensure we don't go below zero height (no need for Mars ocean)
                    height = Math.max(0.5, height);
                    
                    // Add to height data array
                    this.heightData.push(height);
                }
            }
            
            // Add realistic Martian craters to the terrain
            this.addRealisticCraters();
        }
        
        //console.log('MarsInterloper: Terrain heightmap generated');
        
        // Create terrain geometry from heightmap
        const geometry = new THREE.PlaneGeometry(
            this.terrainSize,
            this.terrainSize,
            this.terrainResolution - 1,
            this.terrainResolution - 1
        );
        
        // Apply height data to vertices with proper vertex coordinate mapping
        const vertices = geometry.attributes.position.array;
        for (let i = 0, j = 0, l = vertices.length; i < l; i++, j += 3) {
            // Vertex coordinates in geometry are [x, y, z] 
            // When we rotate the plane, z becomes y (height)
            vertices[j + 2] = this.heightData[i];
        }
        
        // Configure UV coordinates for the main terrain
        this.configureTerrainUVs(geometry, (normalizedX, normalizedY) => {
            // Convert normalized position to world space coordinates
            const worldX = (normalizedX - 0.5) * this.terrainSize;
            const worldZ = (normalizedY - 0.5) * this.terrainSize;
            return { x: worldX, z: worldZ };
        });
        
        // Update normals for lighting
        geometry.computeVertexNormals();
        
        // Create material with Mars texture
        const marsTexture = this.assetManager.getTexture('mars_color');
        
        // Configure texture for location-specific mapping
        if (marsTexture) {
            marsTexture.wrapS = THREE.ClampToEdgeWrapping;
            marsTexture.wrapT = THREE.ClampToEdgeWrapping;
            marsTexture.repeat.set(1, 1);
        }
        
        const material = new THREE.MeshStandardMaterial({
            map: marsTexture,
            roughness: 0.8,
            metalness: 0.2,
            wireframe: false
        });
        
        // Create terrain mesh
        this.terrain = new THREE.Mesh(geometry, material);
        
        // Rotate to make it flat on the ground
        this.terrain.rotation.x = -Math.PI / 2;
        
        // Center the terrain
        this.terrain.position.set(0, 0, 0);
        
        // Log sample height points to verify rendering
        const cornerX = -this.terrainSize/2 + 10;
        const cornerZ = -this.terrainSize/2 + 10;
        const centerX = 0;
        const centerZ = 0;
        
        const cornerHeight = this.getTerrainHeightAt(cornerX, cornerZ);
        const centerHeight = this.getTerrainHeightAt(centerX, centerZ);
        
        //console.log(`TERRAIN-DEBUG: Corner height at (${cornerX}, ${cornerZ}): ${cornerHeight.toFixed(2)}`);
        //console.log(`TERRAIN-DEBUG: Center height at (${centerX}, ${centerZ}): ${centerHeight.toFixed(2)}`);
        
        // Optimize for static terrain
        this.terrain.matrixAutoUpdate = false;
        this.terrain.updateMatrix();
        
        // Allow the terrain to have shadows
        this.terrain.receiveShadow = true;
        
        // Add to scene
        this.scene.add(this.terrain);
        
        // Mark the original terrain chunk as loaded
        this.loadedChunks.set("0,0", this.terrain);
        //console.log('MarsInterloper: Terrain created and marked as central chunk');
        
        // Add debug helper to visualize the ground level
        // Commented out to remove debug visualizations
        // this.addGroundLevelDebugHelper();
    }
    
    // Add this helper method to debug the ground level
    addGroundLevelDebugHelper() {
        // Create a grid helper at y=0 to visualize the ground plane
        const gridHelper = new THREE.GridHelper(100, 20, 0xff0000, 0xffffff);
        gridHelper.position.set(0, 0, 0);
        this.scene.add(gridHelper);
        
        // Create a small sphere at the player spawn point
        const geometry = new THREE.SphereGeometry(0.5, 16, 16);
        const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const marker = new THREE.Mesh(geometry, material);
        
        // Get the proper height at the center
        const centerHeight = this.getTerrainHeightAt(0, 0);
        marker.position.set(0, centerHeight, 0);
        this.scene.add(marker);
        
        //console.log(`GROUND-DEBUG: Added visual marker at position (0, ${centerHeight}, 0)`);
    }
    
    createTerrainPhysics() {
        try {
            // Check if physics and terrain are ready
            if (!this.physicsManager || !this.terrain) {
                console.warn('MarsInterloper: Cannot create terrain physics - physics engine or terrain not ready');
                return;
            }
            
            // Downsample height data for physics if needed
            let physicsHeightData = this.heightData;
            
            // If visual resolution is higher than physics resolution, downsample for physics
            if (this.terrainResolution > this.physicsResolution && this.heightData) {
                //console.log(`TERRAIN-PHYSICS: Downsampling main terrain from resolution ${this.terrainResolution} to ${this.physicsResolution} for physics`);
                physicsHeightData = this.downsampleHeightData(this.heightData, this.terrainResolution, this.physicsResolution);
            }
            
            // Create a simplified terrain physics representation
            this.physicsManager.createTerrainBody(
                this.terrain,
                this.terrainSize,
                this.physicsResolution, // Use physics resolution instead of visual resolution
                this.terrainMaxHeight,
                physicsHeightData,
                { 
                    offsetX: 0, 
                    offsetZ: 0,
                    isChunk: false,
                    chunkKey: "0,0"
                }
            );
            
            ////console.log('MarsInterloper: Terrain physics created');
        } catch (error) {
            console.error('MarsInterloper: Failed to create terrain physics', error);
            // The game can still run without terrain physics
        }
    }
    
    // Create the terrain material that will be reused for chunks
    createTerrainMaterial() {
        // Get the Mars color texture from the asset manager
        let marsTexture = this.assetManager.getTexture('mars_color');
        
        // Create a fallback texture if the Mars texture fails to load
        if (!marsTexture) {
            const fallbackTexture = new THREE.TextureLoader().load('./assets/textures/mars_fallback.jpg');
            marsTexture = fallbackTexture;
        }
        
        // Configure texture for equirectangular projection mapping
        if (marsTexture) {
            // Use ClampToEdgeWrapping to prevent texture repetition
            marsTexture.wrapS = THREE.ClampToEdgeWrapping;
            marsTexture.wrapT = THREE.ClampToEdgeWrapping;
            
            // Set texture filtering for better quality
            marsTexture.minFilter = THREE.LinearMipmapLinearFilter;
            marsTexture.magFilter = THREE.LinearFilter;
            
            // Generate mipmaps for better performance at distance
            marsTexture.generateMipmaps = true;
            
            // No need for repeat as we're mapping 0-1 UV range to the entire texture
            marsTexture.repeat.set(1, 1);
        }
        
        // Create material with Mars texture
        this.chunkMaterial = new THREE.MeshStandardMaterial({
            map: marsTexture,
            roughness: 0.8,
            metalness: 0.2,
            wireframe: false,
            flatShading: false,    // Ensure smooth shading across vertices
            precision: 'highp',    // Use high precision for better color accuracy
            dithering: true        // Enable dithering for smoother color transitions
        });
        
        return this.chunkMaterial;
    }
    
    // Method to check if new chunks should be loaded based on player position
    updateChunks(playerPosition) {
        if (!playerPosition) {
            console.warn('TerrainManager: Cannot update chunks - invalid player position');
            return;
        }
        
        // Calculate which chunk the player is currently in
        // Adjust for terrain centering by adding half terrain size
        const halfTerrainSize = this.terrainSize / 2;
        const chunkX = Math.floor((playerPosition.x + halfTerrainSize) / this.chunkSize);
        const chunkZ = Math.floor((playerPosition.z + halfTerrainSize) / this.chunkSize);
        
        // If player hasn't changed chunks, no need to update
        if (chunkX === this.lastPlayerChunk.x && chunkZ === this.lastPlayerChunk.z) {
            return;
        }
        
        //console.log(`TERRAIN-CHUNKS: Player moved to new chunk (${chunkX}, ${chunkZ}) at position (${playerPosition.x.toFixed(2)}, ${playerPosition.z.toFixed(2)})`);
        
        // Update last player chunk
        this.lastPlayerChunk.x = chunkX;
        this.lastPlayerChunk.z = chunkZ;
        
        // Determine which chunks should be loaded
        const chunksToLoad = [];
        const loadedChunkKeys = new Set();
        
        for (let x = chunkX - this.chunkLoadDistance; x <= chunkX + this.chunkLoadDistance; x++) {
            for (let z = chunkZ - this.chunkLoadDistance; z <= chunkZ + this.chunkLoadDistance; z++) {
                const chunkKey = `${x},${z}`;
                loadedChunkKeys.add(chunkKey);
                
                // Skip the original terrain chunk at 0,0
                if (x === 0 && z === 0 && this.terrain) {
                    continue;
                }
                
                // If chunk isn't already loaded, add it to the load list
                if (!this.loadedChunks.has(chunkKey)) {
                    chunksToLoad.push({ x, z, key: chunkKey });
                }
            }
        }
        
        // Load new chunks
        if (chunksToLoad.length > 0) {
            //console.log(`TERRAIN-CHUNKS: Loading ${chunksToLoad.length} new chunks`);
            
            // Set loading tracking variables
            this.isLoadingChunks = true;
            this.chunksLoadedCount = 0;
            this.totalChunksToLoad = chunksToLoad.length;
            
            // Generate each chunk
            chunksToLoad.forEach(chunk => {
                this.generateChunk(chunk.x, chunk.z, chunk.key);
                this.chunksLoadedCount++;
                
                // Check if we're done loading chunks
                if (this.chunksLoadedCount >= this.totalChunksToLoad) {
                    this.isLoadingChunks = false;
                }
            });
        }
        
        // Collect chunks to unload (that are too far away)
        const chunksToUnload = [];
        for (const [key, chunk] of this.loadedChunks.entries()) {
            // Skip the original terrain chunk - always keep it loaded
            if (key === "0,0" && chunk === this.terrain) {
                continue;
            }
            
            if (!loadedChunkKeys.has(key)) {
                chunksToUnload.push(key);
            }
        }
        
        // Unload distant chunks
        if (chunksToUnload.length > 0) {
            //console.log(`TERRAIN-CHUNKS: Unloading ${chunksToUnload.length} distant chunks`);
            chunksToUnload.forEach(key => {
                // Get the chunk mesh
                const chunk = this.loadedChunks.get(key);
                
                // Remove chunk from scene
                if (chunk) {
                    this.scene.remove(chunk);
                    
                    // Properly dispose geometry and material
                    if (chunk.geometry) {
                        chunk.geometry.dispose();
                    }
                    
                    // We don't dispose material since it's shared
                }
                
                // Remove physics body for this chunk
                if (this.physicsManager && typeof this.physicsManager.removeTerrainChunk === 'function') {
                    this.physicsManager.removeTerrainChunk(key);
                }
                
                // Remove from loaded chunks
                this.loadedChunks.delete(key);
                
                //console.log(`TERRAIN-CHUNKS: Unloaded chunk ${key}`);
            });
        }
    }
    
    // Generate a new terrain chunk
    generateChunk(chunkX, chunkZ, chunkKey) {
        // Calculate world position of chunk
        // Original terrain is centered at (0,0) and extends from -500 to 500 in both directions
        // We need to adjust chunk positioning to account for this centering
        const halfTerrainSize = this.terrainSize / 2;
        const worldX = chunkX * this.chunkSize - halfTerrainSize;
        const worldZ = chunkZ * this.chunkSize - halfTerrainSize;
        
        // Generate height data for this chunk
        const chunkHeightData = this.generateChunkHeightmap(chunkX, chunkZ);
        
        // Increase overlap amount to eliminate visible borders/seams
        const OVERLAP_AMOUNT = 15.0; // Significantly increased from 5.0 to 15.0 to eliminate visible borders
        
        // Create geometry for chunk with much larger overlapping edges to eliminate gaps
        const geometry = new THREE.PlaneGeometry(
            this.chunkSize + OVERLAP_AMOUNT, // Much larger to ensure complete overlap with adjacent chunks
            this.chunkSize + OVERLAP_AMOUNT,
            this.chunkResolution - 1,
            this.chunkResolution - 1
        );
        
        // Apply height data to vertices
        const vertices = geometry.attributes.position.array;
        for (let i = 0, j = 0, l = vertices.length; i < l; i++, j += 3) {
            // Apply heightmap to z (will be rotated)
            vertices[j + 2] = chunkHeightData[i];
        }
        
        // Configure UV coordinates for the chunk
        const OVERLAP_HALF = OVERLAP_AMOUNT / 2;
        this.configureTerrainUVs(geometry, (normalizedX, normalizedY) => {
            // Account for the overlap amount in the UV calculation
            const effectiveSize = this.chunkSize + OVERLAP_AMOUNT;
            const offsetRatio = OVERLAP_AMOUNT / (2 * effectiveSize);
            
            // Adjust normalized coordinates to account for overlap
            const adjustedX = offsetRatio + normalizedX * (1 - 2 * offsetRatio);
            const adjustedY = offsetRatio + normalizedY * (1 - 2 * offsetRatio);
            
            // Convert normalized position to world space coordinates
            const worldPosX = worldX + (adjustedX * effectiveSize) - OVERLAP_HALF;
            const worldPosZ = worldZ + (adjustedY * effectiveSize) - OVERLAP_HALF;
            
            return { x: worldPosX, z: worldPosZ };
        });
        
        // Update normals for lighting
        geometry.computeVertexNormals();
        
        // Use the same material as the main terrain
        const material = this.chunkMaterial || this.createTerrainMaterial();
        
        // Create terrain mesh
        const chunkMesh = new THREE.Mesh(geometry, material);
        
        // Rotate to make it flat on the ground
        chunkMesh.rotation.x = -Math.PI / 2;
        
        // Position at chunk location
        chunkMesh.position.set(
            worldX + this.chunkSize / 2, 
            0, 
            worldZ + this.chunkSize / 2
        );
        
        // Add to scene
        this.scene.add(chunkMesh);
        
        // Create physics body if physics manager is available
        if (this.physicsManager) {
            this.createChunkPhysics(chunkKey, chunkMesh, chunkHeightData, worldX, worldZ);
        }
        
        // Add to loaded chunks
        this.loadedChunks.set(chunkKey, chunkMesh);
        
        return chunkMesh;
    }
    
    // Create physics representation for a terrain chunk
    createChunkPhysics(chunkKey, chunkMesh, chunkHeightData, worldX, worldZ) {
        try {
            // Check if physics is ready
            if (!this.physicsManager) {
                console.warn('TerrainManager: Cannot create chunk physics - physics engine not ready');
                return;
            }
            
            // Create a simplified terrain physics representation for this chunk
            // This will ensure the chunk has physical presence even if not using addTerrainChunk
            //console.log(`TERRAIN-PHYSICS: Creating physics for chunk ${chunkKey} at (${worldX}, ${worldZ})`);
            
            // Significantly expand the physics body to ensure overlapping with adjacent chunks
            // This prevents falling through cracks between chunks
            const options = { 
                offsetX: worldX + this.chunkSize/2, 
                offsetZ: worldZ + this.chunkSize/2,
                isChunk: true,
                chunkKey: chunkKey,
                // Increased from 0.5 to 5.0 to match visual mesh overlap
                expandSize: 5.0 
            };
            
            // Generate downsampled height data for physics if using high-resolution visual chunks
            let physicsHeightData = chunkHeightData;
            
            // If visual resolution is higher than physics resolution, downsample for physics
            if (this.chunkResolution > this.physicsResolution && chunkHeightData) {
                //console.log(`TERRAIN-PHYSICS: Downsampling chunk ${chunkKey} from resolution ${this.chunkResolution} to ${this.physicsResolution} for physics`);
                physicsHeightData = this.downsampleHeightData(chunkHeightData, this.chunkResolution, this.physicsResolution);
            }
            
            // Call physics manager with enhanced options and downsampled height data
            this.physicsManager.createTerrainBody(
                chunkMesh,
                this.chunkSize,
                this.physicsResolution, // Use physics resolution instead of visual resolution
                this.terrainMaxHeight, 
                physicsHeightData,
                options
            );
            
            // Verify physics creation with bounds check
            //console.log(`TERRAIN-PHYSICS: Physics body created for chunk ${chunkKey} with bounds: [${worldX} to ${worldX+this.chunkSize}] x [${worldZ} to ${worldZ+this.chunkSize}] (expanded by ${options.expandSize} units)`);
            
        } catch (error) {
            console.error(`TerrainManager: Failed to create physics for chunk ${chunkKey}`, error);
        }
    }
    
    // New method to downsample height data for physics
    downsampleHeightData(originalData, originalResolution, targetResolution) {
        if (!originalData || originalResolution <= targetResolution) {
            return originalData;
        }
        
        // Calculate downsampling ratio
        const ratio = originalResolution / targetResolution;
        
        // Create new array for downsampled data
        const downsampledData = new Float32Array(targetResolution * targetResolution);
        
        // Perform downsampling by averaging nearby points
        for (let z = 0; z < targetResolution; z++) {
            for (let x = 0; x < targetResolution; x++) {
                // Find the corresponding region in the original data
                const startX = Math.floor(x * ratio);
                const startZ = Math.floor(z * ratio);
                const endX = Math.min(Math.floor((x + 1) * ratio), originalResolution - 1);
                const endZ = Math.min(Math.floor((z + 1) * ratio), originalResolution - 1);
                
                // Average the height values in this region
                let sum = 0;
                let count = 0;
                
                for (let oz = startZ; oz <= endZ; oz++) {
                    for (let ox = startX; ox <= endX; ox++) {
                        sum += originalData[oz * originalResolution + ox];
                        count++;
                    }
                }
                
                // Store the average in the downsampled data
                downsampledData[z * targetResolution + x] = sum / count;
            }
        }
        
        return downsampledData;
    }
    
    // Generate heightmap for a specific chunk
    generateChunkHeightmap(chunkX, chunkZ) {
        const width = this.chunkResolution;
        const height = this.chunkResolution;
        const heightData = new Float32Array(width * height);
        
        // Seed based on chunk position to ensure consistent generation
        const seed = chunkX * 10000 + chunkZ;
        
        // Calculate world position of this chunk
        const halfTerrainSize = this.terrainSize / 2;
        const worldX = chunkX * this.chunkSize - halfTerrainSize;
        const worldZ = chunkZ * this.chunkSize - halfTerrainSize;
        
        // Convert world position to Mars coordinates to check if we're in a special region
        const marsCoords = this.worldPositionToMarsCoordinates(worldX, worldZ);
        
        // Special handling for Olympus Mons region
        const isOlympusMonsRegion = 
            marsCoords.latitude >= 16 && marsCoords.latitude <= 21 && 
            marsCoords.longitude >= 224 && marsCoords.longitude <= 228;
        
        // If we're in Olympus Mons region, use a special heightmap generation
        if (isOlympusMonsRegion && this.useRealMarsData) {
            // For Olympus Mons, create a simplified volcanic cone shape
            // This is a fallback when real data causes issues
            const olympusCenterX = 18.65; // Latitude
            const olympusCenterZ = 226.2; // Longitude
            
            // Calculate distance from center of Olympus Mons
            const distLat = marsCoords.latitude - olympusCenterX;
            const distLon = marsCoords.longitude - olympusCenterZ;
            const distFromCenter = Math.sqrt(distLat * distLat + distLon * distLon);
            
            // Generate a simplified volcanic cone for Olympus Mons
            for (let i = 0; i < height; i++) {
                for (let j = 0; j < width; j++) {
                    const index = i * width + j;
                    
                    // Calculate Mars coordinates for this specific point
                    const pointWorldI = worldZ + (i / (height - 1)) * this.chunkSize;
                    const pointWorldJ = worldX + (j / (width - 1)) * this.chunkSize;
                    const pointMarsCoords = this.worldPositionToMarsCoordinates(pointWorldJ, pointWorldI);
                    
                    // Calculate distance from center of Olympus Mons for this specific point
                    const pointDistLat = pointMarsCoords.latitude - olympusCenterX;
                    const pointDistLon = pointMarsCoords.longitude - olympusCenterZ;
                    const pointDistFromCenter = Math.sqrt(pointDistLat * pointDistLat + pointDistLon * pointDistLon);
                    
                    // Create a volcanic cone shape - higher near center, lower at edges
                    // Maximum height at center is 22km (scaled to game units)
                    const maxHeight = 22.0; // Game units for peak
                    const baseRadius = 2.5; // Degrees of latitude/longitude
                    
                    if (pointDistFromCenter <= baseRadius) {
                        // Inside the volcano - use cone formula
                        const normalizedDist = pointDistFromCenter / baseRadius;
                        heightData[index] = maxHeight * (1.0 - normalizedDist * normalizedDist);
                    } else {
                        // Outside the volcano - use base terrain height
                        heightData[index] = 0.5 + Math.random() * 0.2;
                    }
                }
            }
            
            return heightData;
        }
        
        // Standard terrain generation for non-special regions
        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                const index = i * width + j;
                
                // Calculate world coordinates for this point in the chunk
                const worldI = worldZ + (i / (height - 1)) * this.chunkSize;
                const worldJ = worldX + (j / (width - 1)) * this.chunkSize;
                
                // Map to the same coordinate space as the initial terrain generation
                // This ensures the pattern continues seamlessly
                const mappedX = ((worldJ + halfTerrainSize) / this.terrainSize) * this.terrainResolution;
                const mappedY = ((worldI + halfTerrainSize) / this.terrainSize) * this.terrainResolution;
                
                // Generate noise using the exact same algorithm as the initial terrain
                const centerX = this.terrainResolution / 2;
                const centerY = this.terrainResolution / 2;
                const distX = mappedX - centerX;
                const distY = mappedY - centerY;
                const dist = Math.sqrt(distX * distX + distY * distY) / (this.terrainResolution / 2);
                
                // Same elevation formula as initial terrain
                let elevation = 5.0 * (1.0 - dist * 0.8); // Higher in the middle
                
                // Add the same noise as initial terrain - use deterministic noise based on seed
                // Use a consistent hash to replace the Math.random() call
                const noiseVal = Math.sin(worldJ * 0.1 + worldI * 0.1 + seed * 0.01) * 
                                Math.cos(worldJ * 0.15 + worldI * 0.05 + seed * 0.02);
                elevation += (noiseVal + 1) * 1.5; // Similar scale to the original Math.random() * 3.0
                
                // Store the elevation
                heightData[index] = elevation;
            }
        }
        
        // Still run the blending for smooth transitions between chunks
        if (Math.abs(chunkX) <= 3 && Math.abs(chunkZ) <= 3 && this.heightData) {
            this.blendWithOriginalTerrain(heightData, chunkX, chunkZ);
        }
        
        return heightData;
    }
    
    // Blend new chunks with original terrain for smooth transition
    blendWithOriginalTerrain(chunkHeightData, chunkX, chunkZ) {
        const width = this.chunkResolution;
        const height = this.chunkResolution;
        
        // Track sample heights for debugging
        const samplePos = [
            { x: 0, z: 0 },                           // Bottom-left
            { x: width - 1, z: 0 },                   // Bottom-right
            { x: 0, z: height - 1 },                  // Top-left
            { x: width - 1, z: height - 1 }           // Top-right
        ];
        
        // Record heights before blending for debugging
        const preBlendHeights = samplePos.map(pos => chunkHeightData[pos.z * width + pos.x]);
        
        // Constants for edge detection - IMPROVED for better blending
        const EDGE_REGION_SIZE = 0.25; // Increased from 0.175 for wider blending region
        const STRONG_BLEND_FACTOR = 0.98; // More aggressive blending (was 0.95)
        
        // Project chunk coordinates to world space for sampling
        const halfTerrainSize = this.terrainSize / 2;
        const worldMinX = chunkX * this.chunkSize - halfTerrainSize;
        const worldMinZ = chunkZ * this.chunkSize - halfTerrainSize;
        
        // For each point in the height data
        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                // Calculate normalized position within chunk (0-1)
                const normalizedI = i / (height - 1);
                const normalizedJ = j / (width - 1);
                
                // Determine if we're in an edge region that needs blending
                const isLeftEdge = normalizedJ < EDGE_REGION_SIZE;
                const isRightEdge = normalizedJ > (1 - EDGE_REGION_SIZE);
                const isBottomEdge = normalizedI < EDGE_REGION_SIZE;
                const isTopEdge = normalizedI > (1 - EDGE_REGION_SIZE);
                
                // Skip if not in an edge region
                if (!isLeftEdge && !isRightEdge && !isBottomEdge && !isTopEdge) {
                    continue;
                }
                
                // Calculate world position for this point
                const worldX = worldMinX + (j / (width - 1)) * this.chunkSize;
                const worldZ = worldMinZ + (i / (height - 1)) * this.chunkSize;
                
                // Get height from original terrain at this world position
                let originalHeight;
                try {
                    // Use calculateInterpolatedHeight for smoother blending
                    originalHeight = this.calculateInterpolatedHeight(worldX, worldZ);
                } catch (e) {
                    // If error, skip this point
                    continue;
                }
                
                // Skip if original height is invalid
                if (isNaN(originalHeight)) {
                    continue;
                }
                
                // Calculate blend factor based on distance from edge
                // The closer to the edge, the stronger the blend
                let blendFactor = 0;
                
                if (isLeftEdge) {
                    blendFactor = Math.max(blendFactor, STRONG_BLEND_FACTOR * (1 - normalizedJ / EDGE_REGION_SIZE));
                }
                if (isRightEdge) {
                    blendFactor = Math.max(blendFactor, STRONG_BLEND_FACTOR * (1 - (1 - normalizedJ) / EDGE_REGION_SIZE));
                }
                            if (isBottomEdge) {
                    blendFactor = Math.max(blendFactor, STRONG_BLEND_FACTOR * (1 - normalizedI / EDGE_REGION_SIZE));
                }
                if (isTopEdge) {
                    blendFactor = Math.max(blendFactor, STRONG_BLEND_FACTOR * (1 - (1 - normalizedI) / EDGE_REGION_SIZE));
                }
                
                // Apply cubic easing to blend factor for smoother transition
                blendFactor = blendFactor * blendFactor * (3 - 2 * blendFactor);
                
                // Get current height from chunk data
                const index = i * width + j;
                const currentHeight = chunkHeightData[index];
                
                // IMPROVED: Limit maximum height difference to prevent extreme transitions
                const heightDifference = originalHeight - currentHeight;
                const maxAllowedDifference = 5.0; // Maximum height difference allowed
                const clampedDifference = Math.max(-maxAllowedDifference, Math.min(maxAllowedDifference, heightDifference));
                
                // Apply blended height with clamped difference
                chunkHeightData[index] = currentHeight + (clampedDifference * blendFactor);
            }
        }
    }
    
    // Calculate height at an exact terrain position with interpolation
    calculateInterpolatedHeight(x, z) {
        // If within original terrain bounds, use the original height data with bilinear interpolation
        const halfSize = this.terrainSize / 2;
        if (Math.abs(x) <= halfSize && Math.abs(z) <= halfSize && this.terrain && this.heightData) {
            // Convert world coordinates to heightmap coordinates
            const normalizedX = (x + halfSize) / this.terrainSize;
            const normalizedZ = (z + halfSize) / this.terrainSize;
            
            // Calculate fractional indices
            const xIndex = normalizedX * (this.terrainResolution - 1);
            const zIndex = normalizedZ * (this.terrainResolution - 1);
            
            // Get integer and fractional parts
            const x0 = Math.floor(xIndex);
            const z0 = Math.floor(zIndex);
            const xFrac = xIndex - x0;
            const zFrac = zIndex - z0;
            
            // Make sure we're within bounds
            if (x0 >= 0 && x0 < this.terrainResolution - 1 &&
                z0 >= 0 && z0 < this.terrainResolution - 1) {
                
                // Get heights at four corners
                const h00 = this.heightData[z0 * this.terrainResolution + x0];
                const h10 = this.heightData[z0 * this.terrainResolution + (x0 + 1)];
                const h01 = this.heightData[(z0 + 1) * this.terrainResolution + x0];
                const h11 = this.heightData[(z0 + 1) * this.terrainResolution + (x0 + 1)];
                
                // Bilinear interpolation
                const h0 = h00 * (1 - xFrac) + h10 * xFrac;
                const h1 = h01 * (1 - xFrac) + h11 * xFrac;
                
                // Check if we're near the edge of the original terrain
                const edgeDistance = Math.min(
                    normalizedX, 1 - normalizedX,
                    normalizedZ, 1 - normalizedZ
                );
                
                // If we're near the edge, blend with surrounding chunks
                if (edgeDistance < 0.1) {
                    // Get standard interpolated height
                    const originalHeight = h0 * (1 - zFrac) + h1 * zFrac;
                    
                    // Sample height from adjacent chunks
                    const chunkHeight = this.getTerrainHeightAt(x, z);
                    
                    // Blend between original and chunk height near edges
                    const edgeBlendFactor = Math.max(0, 1 - edgeDistance * 10) * 0.85;
                    return originalHeight * (1 - edgeBlendFactor) + chunkHeight * edgeBlendFactor;
                }
                
                return h0 * (1 - zFrac) + h1 * zFrac;
            }
        }
        
        // For positions outside original terrain, or if original lookup failed
        // Use the enhanced getTerrainHeightAt method which handles chunk blending
        return this.getTerrainHeightAt(x, z);
    }
    
    // Override getTerrainHeightAt to work with chunks
    getTerrainHeightAt(x, z) {
        try {
            const halfSize = this.terrainSize / 2;
            
            // Limit error logging to avoid console spam
            if (this.heightErrorCount > 1000) {
                // Reset counter periodically to allow occasional logging
                if (Math.random() < 0.01) this.heightErrorCount = 0;
                // But don't spam the console
            } else {
                this.heightErrorCount++;
            }
            
            // Check if we're within the bounds of the original terrain
            if (Math.abs(x) <= halfSize && Math.abs(z) <= halfSize && this.terrain && this.heightData) {
                // Calculate normalized coordinates in the range [0, 1]
                const normalizedX = (x + halfSize) / this.terrainSize;
                const normalizedZ = (z + halfSize) / this.terrainSize;
                
                // Use bilinear interpolation to get a smooth height
                const height = this.getInterpolatedHeight(normalizedX, normalizedZ, this.terrainResolution, this.heightData);
                
                // Update last valid height
                this.lastValidHeight = height;
                
                return height;
            }
            
            // For areas outside original terrain, determine which chunk to use 
            // Handle chunk boundaries with more precision
            const chunkX = Math.floor((x + halfSize) / this.chunkSize);
            const chunkZ = Math.floor((z + halfSize) / this.chunkSize);
            const chunkKey = `${chunkX},${chunkZ}`;
            
            // Calculate exact position within chunk
            const localX = ((x + halfSize) - chunkX * this.chunkSize) / this.chunkSize;
            const localZ = ((z + halfSize) - chunkZ * this.chunkSize) / this.chunkSize;
            
            // Check if we're near a chunk boundary
            const chunkBoundary = {
                left: localX < 0.1,
                right: localX > 0.9,
                bottom: localZ < 0.1,
                top: localZ > 0.9
            };
            
            // Determine if we're near a corner
            const isNearCorner = (chunkBoundary.left || chunkBoundary.right) && 
                                (chunkBoundary.bottom || chunkBoundary.top);
            
            // Get height from current chunk
            let height = this.samplerChunkHeightAt(chunkX, chunkZ, localX, localZ);
            
            // If height is invalid, try using a fallback
            if (isNaN(height)) {
                if (this.lastValidHeight !== undefined) {
                    if (this.heightErrorCount < 10) { // Limit logging
                        console.warn(`TERRAIN-ERROR: Invalid height at (${x.toFixed(1)}, ${z.toFixed(1)}), using fallback height ${this.lastValidHeight.toFixed(2)}`);
                    }
                    return this.lastValidHeight;
                } else {
                    if (this.heightErrorCount < 10) { // Limit logging
                        console.warn(`TERRAIN-ERROR: Invalid height at (${x.toFixed(1)}, ${z.toFixed(1)}), using default height 0`);
                    }
                    return 0; // Default fallback
                }
            }
            
            // Update last valid height
            this.lastValidHeight = height;
            
            // If not near any edge, we can return the current height directly
            if (!chunkBoundary.left && !chunkBoundary.right && !chunkBoundary.bottom && !chunkBoundary.top) {
                return height;
            }
            
            // Check if we're near any edge - if so, blend with adjacent chunks
            const isNearEdge = chunkBoundary.left || chunkBoundary.right || 
                            chunkBoundary.bottom || chunkBoundary.top;
            
            if (isNearEdge) {
                try {
                    // Calculate adjacent chunk coordinates
                    let adjChunkX = chunkX;
                    let adjChunkZ = chunkZ;
                    
                    if (chunkBoundary.left) adjChunkX -= 1;
                    else if (chunkBoundary.right) adjChunkX += 1;
                    
                    if (chunkBoundary.bottom) adjChunkZ -= 1;
                    else if (chunkBoundary.top) adjChunkZ += 1;
                    
                    // Calculate blend factor based on distance from edge
                    let blendFactor = 0;
                    
                    if (chunkBoundary.left) blendFactor = Math.max(blendFactor, 1 - (localX * 10));
                    else if (chunkBoundary.right) blendFactor = Math.max(blendFactor, 1 - ((1 - localX) * 10));
                    
                    if (chunkBoundary.bottom) blendFactor = Math.max(blendFactor, 1 - (localZ * 10));
                    else if (chunkBoundary.top) blendFactor = Math.max(blendFactor, 1 - ((1 - localZ) * 10));
                    
                    // Adjust blend factor to be stronger near corners - use significant blending (95%)
                    if (isNearCorner) blendFactor = Math.pow(blendFactor, 0.5) * 0.95; // Stronger corner blending
                    else blendFactor *= 0.85; // Strong edge blending (85%)
                    
                    // Calculate position in adjacent chunk
                    let adjLocalX = localX;
                    let adjLocalZ = localZ;
                    
                    if (chunkBoundary.left) adjLocalX = 1 - (0.1 - localX) * 10; // Map 0.0-0.1 to 0.0-1.0
                    else if (chunkBoundary.right) adjLocalX = (localX - 0.9) * 10; // Map 0.9-1.0 to 0.0-1.0
                    
                    if (chunkBoundary.bottom) adjLocalZ = 1 - (0.1 - localZ) * 10;
                    else if (chunkBoundary.top) adjLocalZ = (localZ - 0.9) * 10;
                    
                    // Clamp to valid range
                    adjLocalX = Math.max(0, Math.min(1, adjLocalX));
                    adjLocalZ = Math.max(0, Math.min(1, adjLocalZ));
                    
                    // Sample height from adjacent chunk
                    const adjHeight = this.samplerChunkHeightAt(adjChunkX, adjChunkZ, adjLocalX, adjLocalZ);
                    
                    // If adjacent height is valid, blend with current height
                    if (!isNaN(adjHeight)) {
                        // Blend heights - stronger blending at edges
                        const blendedHeight = height * (1 - blendFactor) + adjHeight * blendFactor;
                        
                        // Update the last valid height
                        this.lastValidHeight = blendedHeight;
                        
                        if (Math.random() < 0.01) {
                            /* console.log(`TERRAIN-HEIGHT: Blending chunks ${chunkKey} and ${adjChunkX},${adjChunkZ} at (${x.toFixed(1)}, ${z.toFixed(1)}): ${blendedHeight.toFixed(2)}`); */
                        }
                        
                        // When transition between chunks with significant height difference, 
                        // prefer the adjacent height value to avoid "cliffs"
                        if (Math.abs(height - adjHeight) > 1.0) {
                            // Return a height that is heavily biased toward the adjacent chunk
                            return height * 0.15 + adjHeight * 0.85;
                        }
                        
                        return blendedHeight;
                    }
                } catch (e) {
                    // Error getting adjacent height - continue with current height
                    /* console.warn(`TERRAIN-ERROR: Failed to get adjacent height at (${x.toFixed(1)}, ${z.toFixed(1)})`, e); */
                }
            }
            
            if (Math.random() < 0.01) {
                /* console.log(`TERRAIN-HEIGHT: Using chunk ${chunkKey} for height at (${x.toFixed(1)}, ${z.toFixed(1)}): ${height.toFixed(2)}`); */
            }
            
            return height;
        } catch (error) {
            // Global error handler for the entire method
            /* console.warn(`TERRAIN-ERROR: Critical error in getTerrainHeightAt(${x}, ${z}):`, error); */
            
            // Always try to return a valid height
            return this.lastValidHeight !== undefined ? this.lastValidHeight : 0;
        }
    }
    
    // NEW: Add a bilinear interpolation function to get smooth terrain height
    getInterpolatedHeight(normalizedX, normalizedZ, resolution, heightData) {
        // Add robust coordinate clamping at the beginning of the function
        // Ensure normalized coordinates are within [0, 1] range
        normalizedX = Math.max(0, Math.min(1, normalizedX));
        normalizedZ = Math.max(0, Math.min(1, normalizedZ));
        
        // Enhanced check for invalid height data
        if (!heightData) {
            console.warn('TERRAIN-ERROR: Invalid or missing height data in getInterpolatedHeight');
            return 0.5; // Default safe height
        }
        
        // Check if heightData is an array-like object (Float32Array, Array, etc.)
        // This is more permissive than Array.isArray and allows typed arrays like Float32Array
        if (!heightData.length || typeof heightData.length !== 'number') {
            console.warn('TERRAIN-ERROR: Height data is not an array-like object');
            return 0.5;
        }
        
        if (!resolution || resolution <= 1) {
            console.warn('TERRAIN-ERROR: Invalid resolution in getInterpolatedHeight:', resolution);
            return 0.5;
        }
        
        // Convert normalized coordinates to exact grid positions
        const exactX = normalizedX * (resolution - 1);
        const exactZ = normalizedZ * (resolution - 1);
        
        // Get the four grid points surrounding this position
        // Apply additional safety clamps to ensure these are always in bounds
        const x0 = Math.max(0, Math.min(Math.floor(exactX), resolution - 2));
        const z0 = Math.max(0, Math.min(Math.floor(exactZ), resolution - 2));
        const x1 = Math.min(x0 + 1, resolution - 1);
        const z1 = Math.min(z0 + 1, resolution - 1);
        
        // Calculate the fractional parts (for interpolation weights)
        const fractX = exactX - x0;
        const fractZ = exactZ - z0;
        
        // Check array size to prevent access issues
        if (heightData.length < resolution * resolution) {
            console.warn(`TERRAIN-ERROR: Height data array too small: ${heightData.length} vs needed ${resolution * resolution}`);
            return 0.5;
        }
        
        // Get heights at the four corners with additional safety checks
        let h00, h01, h10, h11;
        
        try {
            h00 = heightData[z0 * resolution + x0];
            h01 = heightData[z0 * resolution + x1];
            h10 = heightData[z1 * resolution + x0];
            h11 = heightData[z1 * resolution + x1];
        } catch (e) {
            console.warn('TERRAIN-ERROR: Exception accessing height data:', e);
            return 0.5;
        }
        
        // Protect against NaN values and ensure minimum height
        const safeH00 = isNaN(h00) ? 0.5 : Math.max(0.5, h00);
        const safeH01 = isNaN(h01) ? 0.5 : Math.max(0.5, h01);
        const safeH10 = isNaN(h10) ? 0.5 : Math.max(0.5, h10);
        const safeH11 = isNaN(h11) ? 0.5 : Math.max(0.5, h11);
        
        // Calculate variance to detect problems
        const heightVariance = Math.max(
            Math.abs(safeH00 - safeH01),
            Math.abs(safeH00 - safeH10),
            Math.abs(safeH00 - safeH11),
            Math.abs(safeH01 - safeH10),
            Math.abs(safeH01 - safeH11),
            Math.abs(safeH10 - safeH11)
        );
        
        // Bilinear interpolation formula
        // First interpolate the top edge (h00 to h01)
        const topEdge = safeH00 * (1 - fractX) + safeH01 * fractX;
        // Then interpolate the bottom edge (h10 to h11)
        const bottomEdge = safeH10 * (1 - fractX) + safeH11 * fractX;
        // Finally interpolate between top and bottom
        const interpolatedHeight = topEdge * (1 - fractZ) + bottomEdge * fractZ;
        
        // Ensure the interpolated height is at least 0.5 to prevent falling through terrain
        const finalHeight = Math.max(0.5, interpolatedHeight);
        
        // Store this as the last valid height
        this.lastValidHeight = finalHeight;
        
        // Handle extreme values or variance
        if (heightVariance > 100 || Math.abs(interpolatedHeight) > 1000 ||
            Math.abs(safeH00) > 1000 || Math.abs(safeH01) > 1000 || 
            Math.abs(safeH10) > 1000 || Math.abs(safeH11) > 1000) {
            
            // Instead of using a constant value, calculate a reasonable average
            const averageHeight = Math.max(0.5, (safeH00 + safeH01 + safeH10 + safeH11) / 4);
            this.lastValidHeight = averageHeight;
            return averageHeight;
        }
        
        // For debugging, add variance information occasionally
        if (Math.random() < 0.001) {
            //console.log(`TERRAIN-INTERPOLATION: At (${normalizedX.toFixed(3)}, ${normalizedZ.toFixed(3)}), four corners: [${safeH00.toFixed(2)}, ${safeH01.toFixed(2)}, ${safeH10.toFixed(2)}, ${safeH11.toFixed(2)}], interpolated to ${finalHeight.toFixed(2)}, variance: ${heightVariance.toFixed(2)}`);
        }
        
        return finalHeight;
    }
    
    // Emergency fallback method for sampling chunk heights to prevent recursion
    samplerChunkHeightAt(chunkX, chunkZ, localX, localZ) {
        // Get the chunk
        const adjChunk = this.loadedChunks.get(`${chunkX},${chunkZ}`);
        if (!adjChunk || !adjChunk.geometry) {
            // Enhanced error handling for missing chunks
            if (this.lastValidHeight !== undefined) {
                return this.lastValidHeight;
            }
            return NaN; // No valid height
        }
        
        // Ensure geometry attributes exist
        if (!adjChunk.geometry.attributes || !adjChunk.geometry.attributes.position || !adjChunk.geometry.attributes.position.array) {
            console.warn(`TERRAIN-ERROR: Chunk ${chunkX},${chunkZ} has incomplete geometry`);
            return this.lastValidHeight !== undefined ? this.lastValidHeight : NaN;
        }
        
        // Direct heightmap sampling without recursive calls
        const exactX = localX * (this.terrainResolution - 1);
        const exactZ = localZ * (this.terrainResolution - 1);
        
        const x0 = Math.floor(exactX);
        const z0 = Math.floor(exactZ);
        const x1 = Math.min(x0 + 1, this.terrainResolution - 1);
        const z1 = Math.min(z0 + 1, this.terrainResolution - 1);
        
        const fractX = exactX - x0;
        const fractZ = exactZ - z0;
        
        // Safely get heights (bounds checking) with try-catch
        let h00 = 0, h01 = 0, h10 = 0, h11 = 0;
        
        try {
            if (x0 >= 0 && x0 < this.terrainResolution && z0 >= 0 && z0 < this.terrainResolution) {
                h00 = adjChunk.geometry.attributes.position.array[(z0 * this.terrainResolution + x0) * 3 + 2] || 0;
            }
            
            if (x1 >= 0 && x1 < this.terrainResolution && z0 >= 0 && z0 < this.terrainResolution) {
                h10 = adjChunk.geometry.attributes.position.array[(z0 * this.terrainResolution + x1) * 3 + 2] || 0;
            }
            
            if (x0 >= 0 && x0 < this.terrainResolution && z1 >= 0 && z1 < this.terrainResolution) {
                h01 = adjChunk.geometry.attributes.position.array[(z1 * this.terrainResolution + x0) * 3 + 2] || 0;
            }
            
            if (x1 >= 0 && x1 < this.terrainResolution && z1 >= 0 && z1 < this.terrainResolution) {
                h11 = adjChunk.geometry.attributes.position.array[(z1 * this.terrainResolution + x1) * 3 + 2] || 0;
            }
        } catch (error) {
            console.warn(`TERRAIN-ERROR: Error accessing height data in chunk ${chunkX},${chunkZ}:`, error);
            return this.lastValidHeight !== undefined ? this.lastValidHeight : 0;
        }
        
        // Check for NaN values
        if (isNaN(h00)) h00 = 0;
        if (isNaN(h01)) h01 = 0;
        if (isNaN(h10)) h10 = 0;
        if (isNaN(h11)) h11 = 0;
        
        // Bilinear interpolation
        const topEdge = h00 * (1 - fractX) + h10 * fractX;
        const bottomEdge = h01 * (1 - fractX) + h11 * fractX;
        const interpolatedHeight = topEdge * (1 - fractZ) + bottomEdge * fractZ;
        
        // Store this as the last valid height
        this.lastValidHeight = interpolatedHeight;
        
        return interpolatedHeight;
    }
    
    // Add this new method after the generateHeightmap method
    addRealisticCraters() {
        if (!this.heightData) {
            console.warn('TerrainManager: Cannot add craters - heightmap not initialized');
            return;
        }
        
        ////console.log('TerrainManager: Adding realistic Martian craters to terrain');
        
        const width = this.terrainResolution;
        const height = this.terrainResolution;
        
        // Crater parameters
        const craterParams = {
            smallCount: 20 + Math.floor(Math.random() * 30),  // 20-50 small craters
            mediumCount: 5 + Math.floor(Math.random() * 10),  // 5-15 medium craters
            largeCount: 1 + Math.floor(Math.random() * 3),    // 1-4 large craters
            
            // Size ranges (in grid units)
            smallMinRadius: 1,
            smallMaxRadius: 3,
            mediumMinRadius: 4,
            mediumMaxRadius: 7,
            largeMinRadius: 8,
            largeMaxRadius: 12,
            
            // Depth ranges (in height units)
            smallDepth: 0.5 + Math.random() * 1.0,   // 0.5-1.5 units deep
            mediumDepth: 1.0 + Math.random() * 2.0,  // 1.0-3.0 units deep
            largeDepth: 2.0 + Math.random() * 3.0,   // 2.0-5.0 units deep
            
            // Rim parameters
            rimHeightFactor: 0.3,  // Rim height relative to crater depth
            rimWidthFactor: 0.15    // Rim width relative to crater radius
        };
        
        // Add small craters
        for (let i = 0; i < craterParams.smallCount; i++) {
            const radius = craterParams.smallMinRadius + 
                           Math.random() * (craterParams.smallMaxRadius - craterParams.smallMinRadius);
            const depth = craterParams.smallDepth * (0.8 + Math.random() * 0.4);
            const centerX = Math.floor(radius * 1.5 + Math.random() * (width - radius * 3));
            const centerY = Math.floor(radius * 1.5 + Math.random() * (height - radius * 3));
            
            this.createMartianCrater(centerX, centerY, radius, depth, craterParams.rimHeightFactor, craterParams.rimWidthFactor);
        }
        
        // Add medium craters
        for (let i = 0; i < craterParams.mediumCount; i++) {
            const radius = craterParams.mediumMinRadius + 
                           Math.random() * (craterParams.mediumMaxRadius - craterParams.mediumMinRadius);
            const depth = craterParams.mediumDepth * (0.8 + Math.random() * 0.4);
            
            // More careful placement to avoid edges
            const centerX = Math.floor(radius * 2 + Math.random() * (width - radius * 4));
            const centerY = Math.floor(radius * 2 + Math.random() * (height - radius * 4));
            
            this.createMartianCrater(centerX, centerY, radius, depth, craterParams.rimHeightFactor, craterParams.rimWidthFactor);
        }
        
        // Add large craters - placed more deliberately in different quadrants
        for (let i = 0; i < craterParams.largeCount; i++) {
            const radius = craterParams.largeMinRadius + 
                           Math.random() * (craterParams.largeMaxRadius - craterParams.largeMinRadius);
            const depth = craterParams.largeDepth * (0.8 + Math.random() * 0.4);
            
            // Divide the map into quadrants for better distribution
            const quadX = Math.floor(i % 2);
            const quadY = Math.floor(i / 2);
            
            const startX = width * 0.2 + quadX * width * 0.4;
            const startY = height * 0.2 + quadY * height * 0.4;
            
            const centerX = Math.floor(startX + Math.random() * (width * 0.2));
            const centerY = Math.floor(startY + Math.random() * (height * 0.2));
            
            this.createMartianCrater(centerX, centerY, radius, depth, craterParams.rimHeightFactor, craterParams.rimWidthFactor);
        }
        
        ////console.log(`TerrainManager: Added ${craterParams.smallCount + craterParams.mediumCount + craterParams.largeCount} Martian craters`);
    }
    
    // Create a realistic Martian crater at the specified position
    createMartianCrater(centerX, centerY, radius, depth, rimHeightFactor, rimWidthFactor) {
        const width = this.terrainResolution;
        
        // Calculate crater parameters
        const rimHeight = depth * rimHeightFactor;
        const rimWidth = radius * rimWidthFactor;
        const craterFloor = depth * 0.2; // Flat floor in center of crater
        
        // Iterate over the area of the crater
        for (let y = Math.max(0, Math.floor(centerY - radius - rimWidth)); 
             y <= Math.min(this.terrainResolution - 1, Math.ceil(centerY + radius + rimWidth)); 
             y++) {
            
            for (let x = Math.max(0, Math.floor(centerX - radius - rimWidth)); 
                 x <= Math.min(this.terrainResolution - 1, Math.ceil(centerX + radius + rimWidth)); 
                 x++) {
                
                // Calculate distance from center
                const dx = x - centerX;
                const dy = y - centerY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                // Skip points outside crater's affected area
                if (distance > radius + rimWidth) continue;
                
                // Get array index and current height
                const index = y * width + x;
                const currentHeight = this.heightData[index];
                
                // Calculate height modification
                let heightMod = 0;
                
                if (distance <= radius - craterFloor) {
                    // Inside crater center (flat floor with slight randomness)
                    heightMod = -depth + (Math.random() * 0.1);
                } else if (distance < radius) {
                    // Inside crater wall (bowl shape)
                    const normalizedDist = (distance - (radius - craterFloor)) / craterFloor;
                    heightMod = -depth + (depth * 0.8 * normalizedDist * normalizedDist);
                } else {
                    // At the rim
                    const rimPos = (distance - radius) / rimWidth;
                    // Cosine curve for smooth rim shape (1 at rim peak, 0 at edges)
                    const rimFactor = Math.cos(Math.min(1, rimPos) * Math.PI) * 0.5 + 0.5;
                    heightMod = rimHeight * rimFactor;
                }
                
                // Apply the height modification
                this.heightData[index] = currentHeight + heightMod;
            }
        }
        
        // Add small secondary craters for large craters
        if (radius > 5 && Math.random() < 0.7) {
            const secondaryCount = Math.floor(radius * 0.7);
            
            for (let i = 0; i < secondaryCount; i++) {
                const angle = Math.random() * Math.PI * 2;
                const distance = radius * (1.1 + Math.random() * 0.5);
                
                const secX = Math.floor(centerX + Math.cos(angle) * distance);
                const secY = Math.floor(centerY + Math.sin(angle) * distance);
                
                if (secX >= 0 && secX < width && secY >= 0 && secY < this.terrainResolution) {
                    // Create a small secondary crater
                    const secRadius = 0.5 + Math.random() * 1.5;
                    const secDepth = 0.3 + Math.random() * 0.7;
                    this.createMartianCrater(secX, secY, secRadius, secDepth, 0.2, 0.1);
                }
            }
        }
    }
    
    // Add emergency procedural terrain generation method
    createEmergencyProceduralTerrain() {
        const width = this.terrainResolution;
        const height = this.terrainResolution;
        
        //console.log('MarsInterloper: Creating emergency procedural terrain with guaranteed height variation');
        
        // Create fresh heightmap data
        this.heightData = new Float32Array(width * height);
        
        // Use a more dramatic terrain generation algorithm with guaranteed variation
        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                const index = i * width + j;
                
                // Create a strong diagonal gradient (guaranteed variation)
                const baseHeight = (i + j) / (width + height) * 20;
                
                // Add dramatic ripples
                const ripples = Math.sin(i * 0.2) * Math.cos(j * 0.2) * 5;
                
                // Add medium-sized ridges
                const ridges = Math.abs(Math.sin(i * 0.05 + j * 0.05) * 8);
                
                // Add some random bumps (using determinstic algorithm for repeatability)
                const s1 = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
                const s2 = Math.cos(i * 39.284 + j * 18.828) * 23421.5453;
                const noise1 = (s1 - Math.floor(s1)) * 3;  // Range 0-3
                const noise2 = (s2 - Math.floor(s2)) * 2;  // Range 0-2
                
                // Combine all features for dramatic but deterministic terrain
                const combinedHeight = baseHeight + ripples + ridges + noise1 + noise2;
                
                // Store with sufficient magnitude to matter for physics
                this.heightData[index] = combinedHeight;
                
                // Debug - log a few sample heights to verify variation
                if (i % 50 === 0 && j % 50 === 0) {
                    //console.log(`TERRAIN-DEBUG: Emergency terrain height at (${i},${j}): ${combinedHeight.toFixed(2)}`);
                }
            }
        }
        
        // Add a few dramatic craters for Martian feel
        const craterCount = Math.floor(Math.sqrt(width * height) / 5);
        for (let c = 0; c < craterCount; c++) {
            const centerX = Math.floor(Math.random() * width);
            const centerY = Math.floor(Math.random() * height);
            const radius = 5 + Math.random() * 20;  // Larger craters
            const depth = 3 + Math.random() * 7;    // Deeper craters
            
            this.createMartianCrater(centerX, centerY, radius, depth, 0.5, 0.3);
        }
        
        //console.log(`MarsInterloper: Emergency procedural terrain created with ${craterCount} craters and guaranteed height variation`);
    }
    
    // Add a new debug method to check terrain data source
    debugTerrainDataSource(latitude, longitude, worldX, worldZ) {
        // Ensure worldX and worldZ are within valid terrain bounds
        const terrainHalfSize = this.terrainSize / 2;
        
        // Clamp world coordinates to terrain bounds to avoid coordinate mapping issues
        const clampedWorldX = Math.max(-terrainHalfSize, Math.min(terrainHalfSize, worldX));
        const clampedWorldZ = Math.max(-terrainHalfSize, Math.min(terrainHalfSize, worldZ));
        
        // Normalize coordinates properly within [0,1] range
        const normalizedX = (clampedWorldX + terrainHalfSize) / this.terrainSize;
        const normalizedZ = (clampedWorldZ + terrainHalfSize) / this.terrainSize;
        
        // Initialize elevation cache if needed
        if (!this.elevationCache) {
            this.elevationCache = new Map();
        }
        
        // Use API utility to get the actual Mars elevation data
        apiGet('/api/mars/elevation', { lat: latitude, lon: longitude })
            .then(data => {
                // Store elevation in cache for use by physics
                const cacheKey = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
                this.elevationCache.set(cacheKey, data.elevation);
                
                // Check if heightData is available before trying to get terrain height
                let gameHeight = 0.5; // Default height if heightData is not available
                
                if (this.heightData && this.heightData.length >= this.terrainResolution * this.terrainResolution) {
                    // Get the height from our game's terrain at this position - use normalized coordinates
                    gameHeight = this.getInterpolatedHeight(
                        normalizedX, 
                        normalizedZ, 
                    this.terrainResolution, 
                    this.heightData
                );
                } else {
                    console.warn('TERRAIN-DEBUG: Cannot get game height, heightData not available or incomplete');
                }
                
                // Get the expected world height based on Mars data (scaled to game world)
                // Note: Mars has elevations from about -8500m to +22000m
                // Game typically scales this down significantly
                
                // Use direct scaling - negative Mars elevations should be lower in game
                
                // Use the same height range scaling as the terrain generation
                const heightRange = this.marsHeightRange || 30000; // Default to typical Mars elevation range if not set
                const heightScale = this.terrainMaxHeight / heightRange;
                
                // Calculate the expected height with direct scaling
                const scaledMarsHeight = data.elevation * heightScale;
                
                // Try to determine which MOLA data file might be used
                let dataResolution = "unknown";
                let dataFile = "unknown";
                
                // Check latitude range to guess which file is being used
                if (latitude >= 73 && latitude <= 90) {
                    dataResolution = "512 ppd";
                    dataFile = "megt_n_512_x (North Polar)";
                } else if (latitude >= -90 && latitude <= -73) {
                    dataResolution = "512 ppd";
                    dataFile = "megt_s_512_x (South Polar)";
                } else {
                    dataResolution = "128 ppd";
                    if (latitude >= 0 && latitude < 44) {
                        dataFile = "megt00n000xx (Equatorial North)";
                    } else if (latitude >= -44 && latitude < 0) {
                        dataFile = "megt00s000xx (Equatorial South)";
                    } else {
                        dataFile = "megtxxnxxxx (Mid-latitude)";
                    }
                }
                
                // Update on-screen debug display
                this.updateDebugDisplay({
                    worldPos: `(${clampedWorldX.toFixed(2)}, ${clampedWorldZ.toFixed(2)})`,
                    marsCoords: `${latitude.toFixed(6)}°, ${longitude.toFixed(6)}°`,
                    marsElevation: `${data.elevation} m`,
                    gameHeight: `${gameHeight.toFixed(2)} units`,
                    scaledHeight: `${scaledMarsHeight.toFixed(2)} units`,
                    difference: `${(gameHeight - scaledMarsHeight).toFixed(2)} units`,
                    dataSource: `${dataFile} (${dataResolution})`,
                    offsetInfo: `Direct mapping (no safety)`
                });
            })
            .catch(error => {
                console.error('Error fetching Mars elevation data:', error);
            });
    }
    
    // Create or update the on-screen debug display
    updateDebugDisplay(info) {
        if (!this.debugInfoDisplay) {
            // Create debug display container if it doesn't exist
            this.debugInfoDisplay = document.createElement('div');
            this.debugInfoDisplay.id = 'terrain-debug-display';
            this.debugInfoDisplay.style.position = 'fixed';
            this.debugInfoDisplay.style.bottom = '10px';
            this.debugInfoDisplay.style.right = '10px';
            this.debugInfoDisplay.style.color = '#00ff00';
            this.debugInfoDisplay.style.background = 'rgba(0, 0, 0, 0.7)';
            this.debugInfoDisplay.style.padding = '10px';
            this.debugInfoDisplay.style.borderRadius = '5px';
            this.debugInfoDisplay.style.fontFamily = 'monospace';
            this.debugInfoDisplay.style.fontSize = '12px';
            this.debugInfoDisplay.style.zIndex = '1000';
            this.debugInfoDisplay.style.maxWidth = '300px';
            document.body.appendChild(this.debugInfoDisplay);
        }
        
        // Update content
        this.debugInfoDisplay.innerHTML = `
            <h3 style="margin: 0 0 5px 0; color: #ffff00;">Terrain Debug Info</h3>
            <div><strong>World Position:</strong> ${info.worldPos}</div>
            <div><strong>Mars Coords:</strong> ${info.marsCoords}</div>
            <div><strong>Mars Elevation:</strong> ${info.marsElevation}</div>
            <div><strong>Game Height:</strong> ${info.gameHeight}</div>
            <div><strong>Expected Height:</strong> ${info.scaledHeight}</div>
            <div><strong>Difference:</strong> ${info.difference}</div>
            <hr style="border: 1px solid #555; margin: 5px 0;">
            <div><strong>Data Source:</strong> ${info.dataSource}</div>
            <div><strong>MOLA Processing:</strong> Direct mapping (no safety)</div>
            <div><strong>Ground Buffer:</strong> 0.1 units</div>
        `;
    }
    
    // Add a method to toggle terrain debugging
    toggleTerrainDebug() {
        this.showTerrainDebug = !this.showTerrainDebug;
        //console.log(`Terrain debugging ${this.showTerrainDebug ? 'enabled' : 'disabled'}`);
        
        // Show or hide the debug display
        if (this.debugInfoDisplay) {
            this.debugInfoDisplay.style.display = this.showTerrainDebug ? 'block' : 'none';
        }
        
        // If enabled, immediately debug current position
        if (this.showTerrainDebug && this.playerController) {
            const position = this.playerController.getPosition();
            const marsCoords = this.worldPositionToMarsCoordinates(position.x, position.z);
            this.debugTerrainDataSource(marsCoords.latitude, marsCoords.longitude, position.x, position.z);
        }
    }
    
    // Add a method to update terrain debug info continuously
    updateDebugInfo() {
        // Only update if debug is enabled and we have a player controller
        if (!this.showTerrainDebug || !this.playerController) {
            return;
        }
        
        // Throttle updates to avoid too many API calls
        const now = Date.now();
        if (now - this.lastDebugUpdate < this.debugUpdateInterval) {
            return;
        }
        
        // Update timestamp
        this.lastDebugUpdate = now;
        
        // Get current position and update debug display
        const position = this.playerController.getPosition();
        const marsCoords = this.worldPositionToMarsCoordinates(position.x, position.z);
        this.debugTerrainDataSource(marsCoords.latitude, marsCoords.longitude, position.x, position.z);
    }
    
    // Helper function to convert Mars coordinates to texture coordinates
    marsToTextureCoords(latitude, longitude) {
        // Ensure latitude is in range -90 to 90
        const clampedLat = Math.max(-90, Math.min(90, latitude));
        
        // Ensure longitude is in range 0 to 360
        const normalizedLon = ((longitude % 360) + 360) % 360;
        
        // Standard equirectangular projection formula
        const textureU = normalizedLon / 360;
        const textureV = (90 - clampedLat) / 180;
        
        // Ensure UV coordinates are in valid 0-1 range
        const clampedU = Math.max(0, Math.min(1, textureU));
        const clampedV = Math.max(0, Math.min(1, textureV));
        
        return { u: clampedU, v: clampedV };
    }
    
    // Configure proper UV coordinates for the terrain to map the texture correctly
    configureTerrainUVs(geometry, worldToPositionFunc) {
        const uvs = geometry.attributes.uv.array;
        const width = Math.sqrt(uvs.length / 2); // Assuming square grid
        
        // For each vertex in the terrain
        for (let i = 0, j = 0; i < uvs.length; i += 2, j++) {
            // Find the vertex position in the grid
            const x = j % width;
            const y = Math.floor(j / width);
            
            // Normalize grid position to 0-1 range
            const normalizedX = x / (width - 1);
            const normalizedY = y / (width - 1);
            
            // Convert to world position using the provided function
            const worldPos = worldToPositionFunc(normalizedX, normalizedY);
            
            // Convert world coordinates to Mars coordinates
            const marsCoords = this.worldPositionToMarsCoordinates(worldPos.x, worldPos.z);
            
            // Convert Mars coordinates to texture coordinates
            const texCoords = this.marsToTextureCoords(marsCoords.latitude, marsCoords.longitude);
            
            // Assign texture coordinates
            uvs[i] = texCoords.u;
            uvs[i + 1] = texCoords.v;
        }
    }
} 