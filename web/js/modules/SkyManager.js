import * as THREE from 'three';
import { apiGet } from '../utils/api.js';

export class SkyManager {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
        
        this.skyDome = null;
        this.atmosphereGlow = null;
        this.marsDust = null;
        this.marsGlobe = null; // Add reference to Mars globe
        this.marsLight = null; // Reference to Mars directional light
        this.marsAmbientLight = null; // Reference to Mars ambient light
        this.stars = [];
        this.starMaterials = new Map(); // Cache star materials by color
        
        // Configuration
        this.skyRadius = 1000; // Distance to sky dome
        this.starSizeBase = 0.5; // Base size for stars
        this.starSizeFactor = 0.8; // Size multiplier based on magnitude
        this.isNightTime = true; // Whether it's night on Mars
        
        // Star cache
        this.starDataCache = new Map(); // Cache by location + time
        this.currentStars = []; // Currently visible stars
        this.currentLocation = {
            latitude: 0,
            longitude: 0,
            timeHours: 12 // Default to midnight
        };
        
        // Reference to asset manager (to be set later)
        this.assetManager = null;
        
        // Mars globe animation
        this.marsRotationSpeed = 0.0005; // Rotation speed in radians per frame
        this.marsOrbitalSpeed = 0.00005; // Orbital movement speed
        this.marsOrbitalRadius = 5; // Small radius for subtle movement
        this.marsOrbitalAngle = 0; // Current angle in the orbital movement
        this.marsInitialPosition = null; // Will store the initial position
    }
    
    init() {
        return new Promise((resolve) => {
            // Create sky dome
            this.createSkyDome();
            
            // Create Martian atmosphere effects
            this.createAtmosphereGlow();
            this.addMartianDust();
            
            // Create Mars globe in the sky
            this.createMarsGlobe();
            
            //console.log('MarsInterloper: Sky system initialized with Martian atmosphere');
            resolve();
        });
    }
    
    createSkyDome() {
        // Create a large sphere for the sky
        const geometry = new THREE.SphereGeometry(this.skyRadius, 32, 32);
        // Make it render on the inside
        geometry.scale(-1, 1, 1);
        
        // Create material for sky - dark blue with reddish tint for Mars night
        const material = new THREE.MeshBasicMaterial({
            color: 0x110011, // Very dark with reddish tint
            side: THREE.BackSide,
            depthWrite: false,
            fog: false
        });
        
        this.skyDome = new THREE.Mesh(geometry, material);
        this.scene.add(this.skyDome);
    }
    
    createAtmosphereGlow() {
        // Create a gradient sphere just above the horizon to simulate atmospheric scattering
        const glowGeometry = new THREE.SphereGeometry(this.skyRadius * 0.99, 32, 32);
        
        // Custom shader material for the atmospheric glow
        const vertexShader = `
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;
        
        const fragmentShader = `
            uniform vec3 glowColor;
            uniform float coefficient;
            uniform float power;
            
            varying vec3 vNormal;
            varying vec3 vWorldPosition;
            
            void main() {
                // Calculate height-based color (stronger near horizon)
                float height = normalize(vWorldPosition).y;
                float atmosphereIntensity = pow(1.0 - abs(height), power) * coefficient;
                
                // Red-orange Mars atmosphere glow
                vec3 marsGlow = glowColor * atmosphereIntensity;
                gl_FragColor = vec4(marsGlow, atmosphereIntensity * 0.7);
            }
        `;
        
        const uniforms = {
            glowColor: { value: new THREE.Color(0xff3300) },
            coefficient: { value: 0.5 },
            power: { value: 2.0 }
        };
        
        const glowMaterial = new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            transparent: true,
            fog: false
        });
        
        this.atmosphereGlow = new THREE.Mesh(glowGeometry, glowMaterial);
        this.scene.add(this.atmosphereGlow);
    }
    
    addMartianDust() {
        // Create dust particles in the Martian atmosphere
        const particleCount = 2000;
        const particleGeometry = new THREE.BufferGeometry();
        const particlePositions = new Float32Array(particleCount * 3);
        const particleColors = new Float32Array(particleCount * 3);
        
        // Generate random positions in a hemisphere above the camera
        for (let i = 0; i < particleCount; i++) {
            // Position in spherical coordinates
            const radius = 100 + Math.random() * 300; // Between 100 and 400 units
            const theta = Math.random() * Math.PI; // Hemisphere (0 to PI)
            const phi = Math.random() * Math.PI * 2; // Full circle (0 to 2*PI)
            
            // Convert to Cartesian coordinates
            const x = radius * Math.sin(theta) * Math.cos(phi);
            const y = radius * Math.cos(theta); // y is up
            const z = radius * Math.sin(theta) * Math.sin(phi);
            
            particlePositions[i * 3] = x;
            particlePositions[i * 3 + 1] = y;
            particlePositions[i * 3 + 2] = z;
            
            // Dust color (reddish orange)
            const brightness = 0.3 + Math.random() * 0.5; // Between 0.3 and 0.8
            particleColors[i * 3] = brightness; // Red
            particleColors[i * 3 + 1] = brightness * 0.5; // Green
            particleColors[i * 3 + 2] = brightness * 0.1; // Blue
        }
        
        particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
        particleGeometry.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));
        
        const particleMaterial = new THREE.PointsMaterial({
            size: 0.5,
            vertexColors: true,
            transparent: true,
            opacity: 0.6,
            fog: true
        });
        
        this.marsDust = new THREE.Points(particleGeometry, particleMaterial);
        this.scene.add(this.marsDust);
    }
    
    // Set the asset manager reference
    setAssetManager(assetManager) {
        this.assetManager = assetManager;
        // If we already created the Mars globe, update its texture
        if (this.marsGlobe) {
            this.updateMarsGlobeTexture();
        }
    }
    
    createMarsGlobe() {
        // Default material with Mars color in case texture isn't available
        const material = new THREE.MeshBasicMaterial({
            color: 0xc1440e, // Mars orange-red
            fog: false
        });
        
        // Calculate position in the sky - place in distance as a reference planet
        // Position it 80% of the way to the sky dome radius
        const distanceFactor = 0.8;
        const elevation = 30; // Degrees above horizon
        const azimuth = 45; // Degrees from north (clockwise)
        
        // Convert to radians
        const elevRad = elevation * (Math.PI / 180);
        const azimuthRad = azimuth * (Math.PI / 180);
        
        // Calculate position using spherical coordinates
        const radius = this.skyRadius * distanceFactor;
        const x = radius * Math.cos(elevRad) * Math.sin(azimuthRad);
        const y = radius * Math.sin(elevRad);
        const z = radius * Math.cos(elevRad) * Math.cos(azimuthRad);
        
        // Create Mars sphere with appropriate size
        // Mars should appear as a small but clear planet in the sky
        const marsSize = this.skyRadius * 0.03; // 3% of sky dome radius
        const geometry = new THREE.SphereGeometry(marsSize, 32, 32);
        
        // Create the Mars globe mesh
        this.marsGlobe = new THREE.Mesh(geometry, material);
        this.marsGlobe.position.set(x, y, z);
        
        // Store the initial position for orbital movement
        this.marsInitialPosition = new THREE.Vector3(x, y, z);
        
        // Apply a slight rotation to show interesting Mars features
        this.marsGlobe.rotation.y = Math.PI / 4;
        
        // Add lighting for the Mars globe
        // Create a directional light to simulate sunlight
        this.marsLight = new THREE.DirectionalLight(0xffffff, 1.5);
        // Position the light to create a nice partial illumination of Mars
        this.marsLight.position.set(x + marsSize * 5, y + marsSize * 3, z + marsSize * 5);
        this.marsLight.target = this.marsGlobe;
        
        // Only illuminate the Mars globe, not affect other scene elements
        this.marsLight.target.updateMatrixWorld();
        this.scene.add(this.marsLight);
        
        // Add ambient light to prevent the dark side from being completely black
        this.marsAmbientLight = new THREE.AmbientLight(0x222222);
        this.scene.add(this.marsAmbientLight);
        
        // Add to scene
        this.scene.add(this.marsGlobe);
        console.log('MarsInterloper: Mars globe added to sky with lighting');
        
        // Update texture if asset manager is available
        this.updateMarsGlobeTexture();
    }
    
    updateMarsGlobeTexture() {
        // Only proceed if we have both a Mars globe and an asset manager
        if (!this.marsGlobe || !this.assetManager) {
            return;
        }
        
        // Get the mars_color texture from the asset manager
        const texture = this.assetManager.getTexture('mars_color');
        
        if (texture) {
            // Create a MeshPhongMaterial for better lighting effects
            const marsMaterial = new THREE.MeshStandardMaterial({
                map: texture,
                color: 0xffffff,
                bumpMap: texture,  // Use the color map as a bump map as well
                bumpScale: 0.005,  // Subtle bumps
                roughness: 0.9,    // Mars is quite rough
                metalness: 0.0,    // Non-metallic
                emissive: 0x000000,
                fog: false
            });
            
            // Replace the material
            if (this.marsGlobe.material) {
                this.marsGlobe.material.dispose();
            }
            this.marsGlobe.material = marsMaterial;
            
            console.log('MarsInterloper: Mars globe texture updated with enhanced material');
        } else {
            console.warn('MarsInterloper: Mars color texture not found in asset manager');
        }
    }
    
    async loadMarsNightSky(latitude, longitude, timeHours = 12, limit = 500) {
        // Create a cache key based on location and time
        // Round to nearest degree and hour to reduce cache entries
        const cacheKey = `${Math.round(latitude)},${Math.round(longitude)},${Math.round(timeHours)}`;
        
        // Check cache first
        if (this.starDataCache.has(cacheKey)) {
            this.renderStars(this.starDataCache.get(cacheKey));
            return;
        }
        
        try {
            // Use API utility to fetch star data from backend
            const data = await apiGet('/api/mars/sky', {
                lat: latitude,
                lon: longitude,
                time: timeHours,
                limit: limit
            });
            
            // Store in cache
            this.starDataCache.set(cacheKey, data);
            
            // Update current location
            this.currentLocation = {
                latitude,
                longitude,
                timeHours
            };
            
            // Render stars
            this.renderStars(data);
            
            //console.log(`MarsInterloper: Loaded Mars night sky with ${data.stars.length} stars`);
        } catch (error) {
            console.error('Error loading Mars night sky:', error);
        }
    }
    
    renderStars(skyData) {
        // Clear existing stars
        this.clearStars();
        
        // Reference to stars for updating
        this.currentStars = skyData.stars;
        
        // Create stars
        for (const star of skyData.stars) {
            // Skip stars below horizon
            if (star.altitude < 0) continue;
            
            // Convert altitude/azimuth to 3D position on sky dome
            const position = this.altAzToVector3(star.altitude, star.azimuth);
            
            // Calculate star size based on magnitude
            // Brighter stars (lower magnitude) should be larger
            const magnitude = Math.min(6.5, Math.max(-1.5, star.magnitude));
            
            // Enhanced size calculation - make stars more visible
            // Stars are now 3x larger than before but maintain relative sizing
            const size = this.starSizeBase * 3 * Math.pow(2, (2 - magnitude) * this.starSizeFactor);
            
            // Create star
            this.createStar(position, size, star.color, star.hip);
        }
        
        //console.log(`MarsInterloper: Rendered ${this.stars.length} stars in Mars night sky`);
    }
    
    createStar(position, size, color, id) {
        // Get or create material for this star color
        let material;
        if (this.starMaterials.has(color)) {
            material = this.starMaterials.get(color);
        } else {
            // Create a material with a glow effect
            material = new THREE.MeshBasicMaterial({
                color: new THREE.Color(color),
                transparent: true,
                opacity: 1.0, // Full opacity for better visibility
                fog: false
            });
            this.starMaterials.set(color, material);
        }
        
        // Create star with glow effect
        const glowSize = size * 2.5; // Glow is larger than the star itself
        
        // The actual star (core)
        const geometry = new THREE.SphereGeometry(size, 8, 8);
        const star = new THREE.Mesh(geometry, material);
        star.position.copy(position);
        
        // Create glow sphere around the star
        const glowGeometry = new THREE.SphereGeometry(glowSize, 16, 16);
        const glowMaterial = new THREE.ShaderMaterial({
            uniforms: {
                "c": { value: 0.2 },
                "p": { value: 1.2 },
                glowColor: { value: new THREE.Color(color) },
                viewVector: { value: new THREE.Vector3() }
            },
            vertexShader: `
                uniform vec3 viewVector;
                varying float intensity;
                void main() {
                    vec3 vNormal = normalize(normalMatrix * normal);
                    vec3 vNormel = normalize(normalMatrix * viewVector);
                    intensity = pow(0.5 - dot(vNormal, vNormel), 1.0);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 glowColor;
                uniform float c;
                uniform float p;
                varying float intensity;
                void main() {
                    vec3 glow = glowColor * c * pow(intensity, p);
                    gl_FragColor = vec4(glow, intensity);
                }
            `,
            side: THREE.FrontSide,
            blending: THREE.AdditiveBlending,
            transparent: true,
            fog: false
        });
        
        const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
        glowMesh.position.copy(position);
        
        // Store ID for interaction
        star.userData = { id, type: 'star', magnitude: Math.min(6.5, Math.max(-1.5, id % 6)) };
        
        // Add star and glow to scene and track them
        this.scene.add(star);
        this.scene.add(glowMesh);
        this.stars.push(star);
        this.stars.push(glowMesh); // Track glow for disposal
        
        return star;
    }
    
    clearStars() {
        // Remove all stars from scene
        for (const star of this.stars) {
            this.scene.remove(star);
            star.geometry.dispose();
        }
        
        // Clear array
        this.stars = [];
    }
    
    // Convert altitude and azimuth to a 3D position on the sky dome
    altAzToVector3(altitude, azimuth) {
        // Convert degrees to radians
        const altRad = altitude * Math.PI / 180;
        const azRad = azimuth * Math.PI / 180;
        
        // Calculate position
        // In astronomy, azimuth is measured from North (0°) clockwise, so we subtract from 90°
        const x = this.skyRadius * Math.cos(altRad) * Math.sin(Math.PI/2 - azRad);
        const y = this.skyRadius * Math.sin(altRad);
        const z = this.skyRadius * Math.cos(altRad) * Math.cos(Math.PI/2 - azRad);
        
        return new THREE.Vector3(x, y, z);
    }
    
    // Update sky based on time of day
    updateSkyForTime(timeHours) {
        // Simple day/night cycle
        const isDayTime = timeHours >= 6 && timeHours <= 18;
        
        if (isDayTime) {
            // Day sky - light blue with reddish tint
            if (this.skyDome) {
                this.skyDome.material.color.set(0xd8c8c0); // Pinkish light blue for Mars day
            }
            
            // Hide stars during day
            for (const star of this.stars) {
                star.visible = false;
            }
            
            // Update atmosphere glow
            if (this.atmosphereGlow && this.atmosphereGlow.material.uniforms) {
                this.atmosphereGlow.material.uniforms.glowColor.value.set(0xff6644);
                this.atmosphereGlow.material.uniforms.coefficient.value = 0.3;
            }
            
            // Make dust more visible in day
            if (this.marsDust && this.marsDust.material) {
                this.marsDust.material.opacity = 0.8;
            }
            
            this.isNightTime = false;
        } else {
            // Night sky - dark purplish
            if (this.skyDome) {
                this.skyDome.material.color.set(0x110011);
            }
            
            // Show stars at night
            for (const star of this.stars) {
                star.visible = true;
            }
            
            // Update atmosphere glow
            if (this.atmosphereGlow && this.atmosphereGlow.material.uniforms) {
                this.atmosphereGlow.material.uniforms.glowColor.value.set(0xff3300);
                this.atmosphereGlow.material.uniforms.coefficient.value = 0.5;
            }
            
            // Make dust less visible at night
            if (this.marsDust && this.marsDust.material) {
                this.marsDust.material.opacity = 0.4;
            }
            
            this.isNightTime = true;
        }
    }
    
    // Update sky for player's Mars position
    async updateForPosition(marsLat, marsLon, timeHours) {
        // Check if we've moved enough to warrant an update (more than 5 degrees)
        const latDiff = Math.abs(marsLat - this.currentLocation.latitude);
        const lonDiff = Math.abs(marsLon - this.currentLocation.longitude);
        const timeDiff = Math.abs(timeHours - this.currentLocation.timeHours);
        
        if (latDiff > 5 || lonDiff > 5 || timeDiff > 1) {
            // Load new star data for this position
            await this.loadMarsNightSky(marsLat, marsLon, timeHours);
        }
        
        // Update day/night cycle regardless
        this.updateSkyForTime(timeHours);
        
        // Store current location and time
        this.currentLocation.latitude = marsLat;
        this.currentLocation.longitude = marsLon;
        this.currentLocation.timeHours = timeHours;
    }
    
    // Dispose resources
    dispose() {
        // Clean up sky dome
        if (this.skyDome) {
            this.scene.remove(this.skyDome);
            this.skyDome.geometry.dispose();
            this.skyDome.material.dispose();
            this.skyDome = null;
        }
        // Clean up atmosphere glow
        if (this.atmosphereGlow) {
            this.scene.remove(this.atmosphereGlow);
            this.atmosphereGlow.geometry.dispose();
            this.atmosphereGlow.material.dispose();
            this.atmosphereGlow = null;
        }
        // Clean up Mars dust
        if (this.marsDust) {
            this.scene.remove(this.marsDust);
            this.marsDust.geometry.dispose();
            this.marsDust.material.dispose();
            this.marsDust = null;
        }
        // Clean up Mars globe
        if (this.marsGlobe) {
            this.scene.remove(this.marsGlobe);
            this.marsGlobe.geometry.dispose();
            this.marsGlobe.material.dispose();
            this.marsGlobe = null;
        }
        // Clean up Mars lighting
        if (this.marsLight) {
            this.scene.remove(this.marsLight);
            this.marsLight = null;
        }
        if (this.marsAmbientLight) {
            this.scene.remove(this.marsAmbientLight);
            this.marsAmbientLight = null;
        }
        // Clean up stars
        this.clearStars();
        // Clear caches
        this.starMaterials.clear();
        this.starDataCache.clear();
    }
    
    // Update method to be called in the animation loop
    update(deltaTime) {
        // Animate Mars globe rotation
        if (this.marsGlobe && this.marsInitialPosition) {
            // Rotate Mars slowly around its axis
            this.marsGlobe.rotation.y += this.marsRotationSpeed * deltaTime;
            
            // Keep rotation within 0-2π range
            if (this.marsGlobe.rotation.y > Math.PI * 2) {
                this.marsGlobe.rotation.y -= Math.PI * 2;
            }
            
            // Add subtle orbital movement
            this.marsOrbitalAngle += this.marsOrbitalSpeed * deltaTime;
            if (this.marsOrbitalAngle > Math.PI * 2) {
                this.marsOrbitalAngle -= Math.PI * 2;
            }
            
            // Calculate new position with a small circular movement
            const offsetX = Math.cos(this.marsOrbitalAngle) * this.marsOrbitalRadius;
            const offsetY = Math.sin(this.marsOrbitalAngle) * this.marsOrbitalRadius;
            
            // Update Mars position
            this.marsGlobe.position.x = this.marsInitialPosition.x + offsetX;
            this.marsGlobe.position.y = this.marsInitialPosition.y + offsetY;
            
            // Update light position to follow Mars
            if (this.marsLight) {
                const marsSize = this.marsGlobe.geometry.parameters.radius;
                this.marsLight.position.set(
                    this.marsGlobe.position.x + marsSize * 5,
                    this.marsGlobe.position.y + marsSize * 3,
                    this.marsGlobe.position.z + marsSize * 5
                );
            }
        }
        
        // Update dust particles if needed
        if (this.marsDust) {
            // Slowly rotate the dust cloud for a dynamic effect
            this.marsDust.rotation.y += 0.0001 * deltaTime;
            
            // Update dust position to follow camera
            if (this.camera) {
                this.marsDust.position.copy(this.camera.position);
            }
        }
    }
} 