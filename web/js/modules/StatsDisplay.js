export class StatsDisplay {
    constructor(playerController, terrainManager = null) {
        this.playerController = playerController;
        this.terrainManager = terrainManager;
        this.fps = 0;
        this.frames = 0;
        this.lastTime = performance.now();
        this.marsRadius = 3389.5; // Mars radius in km
        this.showDistanceToOrigin = false; // NEW: Flag to toggle distance to origin display
        
        // Create stats display container
        this.display = document.createElement('div');
        this.display.id = 'stats-display';
        this.display.style.position = 'fixed';
        this.display.style.top = '10px';
        this.display.style.left = '10px';
        this.display.style.color = 'white';
        this.display.style.background = 'rgba(0, 0, 0, 0.5)';
        this.display.style.padding = '5px 10px';
        this.display.style.borderRadius = '5px';
        this.display.style.fontFamily = 'monospace';
        this.display.style.fontSize = '14px';
        this.display.style.zIndex = '1000';
        this.display.style.lineHeight = '1.5';
        document.body.appendChild(this.display);
        
        // Initialize display
        this.update();
        
        // NEW: Add key listener for toggling debug display
        window.addEventListener('keydown', (event) => {
            // Change from 'D' key to 'B' key (for Boundary/Border) to toggle distance display
            if (event.key === 'B' || event.key === 'b') {
                this.showDistanceToOrigin = !this.showDistanceToOrigin;
                //console.log(`Distance to origin display: ${this.showDistanceToOrigin ? 'enabled' : 'disabled'}`);
            }
        });
    }
    
    // NEW: Calculate distance to origin (Jezero Crater center)
    calculateDistanceToOrigin(position) {
        // 2D horizontal distance (ignoring y/height)
        const horizontalDistance = Math.sqrt(position.x * position.x + position.z * position.z);
        
        // Calculate approximate distance in meters - using the scale factor from TerrainManager
        // In TerrainManager, worldScale = terrainSize / 4 where 1 degree = 59km
        // We'll use similar approximation here (actual distance depends on latitude)
        const terrainSize = 1000; // Default terrain size
        const worldScale = terrainSize / 4;
        const kmPerDegree = 59; // Approximate km per degree at Mars equator
        
        // Convert to kilometers
        const distanceKm = (horizontalDistance / worldScale) * kmPerDegree;
        
        return {
            units: horizontalDistance.toFixed(2),
            km: distanceKm.toFixed(2)
        };
    }
    
    // NEW: Calculate direction from Jezero Crater to current position
    calculateDirectionFromJezero(position) {
        // Calculate angle in radians using atan2 - gives us angle in relation to positive z-axis
        // atan2(x, z) gives us the angle from positive z-axis toward positive x-axis
        const angleRad = Math.atan2(position.x, position.z);
        
        // Convert to degrees
        let angleDeg = angleRad * (180 / Math.PI);
        
        // Normalize to 0-360 range
        if (angleDeg < 0) {
            angleDeg += 360;
        }
        
        // Get compass direction
        const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", 
                            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
        
        // Each compass direction covers 22.5 degrees
        // Convert angle to compass direction index (0-15)
        const index = Math.round(angleDeg / 22.5) % 16;
        
        return {
            degrees: angleDeg.toFixed(1),
            compass: directions[index]
        };
    }
    
    update() {
        this.frames++;
        
        const currentTime = performance.now();
        const elapsedTime = currentTime - this.lastTime;
        
        // Update stats display once per second
        if (elapsedTime >= 1000) {
            this.fps = Math.round((this.frames * 1000) / elapsedTime);
            
            // Get player position
            const position = this.playerController.getPosition();
            
            // Get latitude and longitude
            let latitude, longitude;
            
            // If terrain manager is available and has Mars coordinates, use those
            if (this.terrainManager && this.terrainManager.worldPositionToMarsCoordinates) {
                const marsCoords = this.terrainManager.worldPositionToMarsCoordinates(
                    position.x, 
                    position.z
                );
                latitude = marsCoords.latitude;
                longitude = marsCoords.longitude;
            } else {
                // Fall back to basic spherical calculation
                const coords = this.convertPositionToLatLong(position);
                latitude = coords.latitude;
                longitude = coords.longitude;
            }
            
            // Build the display text
            let displayText = `
                FPS: ${this.fps}<br>
                Latitude: ${latitude.toFixed(6)}°<br>
                Longitude: ${longitude.toFixed(6)}°
            `;
            
            // NEW: Add distance to origin if enabled
            if (this.showDistanceToOrigin) {
                const distance = this.calculateDistanceToOrigin(position);
                const direction = this.calculateDirectionFromJezero(position);
                
                displayText += `<br>
                Distance to Jezero center: ${distance.units} units<br>
                Distance to Jezero center: ${distance.km} km<br>
                Direction from Jezero: ${direction.compass} (${direction.degrees}°)
                `;
            }
            
            // Update display
            this.display.innerHTML = displayText;
            
            this.frames = 0;
            this.lastTime = currentTime;
        }
        
        // Note: No requestAnimationFrame here - let the game's main loop call this
    }
    
    // Convert 3D position to Mars latitude/longitude
    convertPositionToLatLong(position) {
        // Calculate using spherical coordinates
        // Assuming the game's coordinate system has:
        // - Y axis as up/down
        // - X and Z forming the horizontal plane
        // - Center of Mars at (0,0,0)
        
        // Normalize position to Mars radius
        const x = position.x;
        const y = position.y;
        const z = position.z;
        
        // Calculate latitude (-90 to 90 degrees)
        // 0 at equator, 90 at north pole, -90 at south pole
        const latitude = Math.atan2(y, Math.sqrt(x * x + z * z)) * (180 / Math.PI);
        
        // Calculate longitude (-180 to 180 degrees)
        // 0 at prime meridian, positive eastward, negative westward
        let longitude = Math.atan2(x, z) * (180 / Math.PI);
        
        return { latitude, longitude };
    }
} 