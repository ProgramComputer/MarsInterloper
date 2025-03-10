import * as THREE from 'three';

export class PhysicsManager {
    constructor(scene = null) {
        this.scene = scene;
        // Mars gravity is 38% of Earth's gravity
        this.GRAVITY = -3.8; // Adjusted to better match Mars gravity (38% of Earth's -10)
        
        // Store player position and velocity for our own simple physics implementation
        this.dummyPlayerPosition = new THREE.Vector3(0, 5, 0); // Lower initial height (was 2)
        this.dummyPlayerVelocity = new THREE.Vector3(0, 0, 0);
        this.dummyPlayerObject = null;
        this.terrainManager = null; // Reference to terrain manager for height checks
        
        // Mars physics constants
        this.maxFallSpeed = 10;       // Reduced terminal velocity for Mars gravity
        this.maxJumpSpeed = 15;       // Maximum upward velocity to prevent flying off the map
        this.playerFriction = 0.92;   // Less friction on Mars surface
        this.isMoving = false;        // Track if player is moving for friction
        this.canJump = false;         // Track if player can jump
        this.isOnGround = false;      // Initialize isOnGround
        this.wasOnGround = false;     // Add tracking of previous ground state
        this.consecutiveErrors = 0;   // Track consecutive errors
        this.debugMode = false;       // Disable debug mode to hide debug visualizations
        this.forceGroundCheck = false; // Set to true in rare cases when player needs to be forced to ground
        
        // FIXED: Improved collision detection properties - adjusted values
        this.playerRadius = 0.4;           // Player collision radius (horizontal)
        this.playerHeight = 1.8;           // Player height (vertical)
        this.groundBuffer = 0.1;           // Height above ground to maintain (decreased from 1.0 to 0.1 to fix floating issue)
        this.groundContactThreshold = 1.0; // Threshold for ground contact detection (increased from 0.6 for better detection)
        this.slopeMaxAngle = 45;           // Maximum slope angle player can climb in degrees
        this.samplePoints = [];            // Sample points for terrain detection
        this.isOnSlope = false;            // Flag to indicate if player is on a slope
        this.slopeAngle = 0;               // Current slope angle in degrees
        this.slopeDirection = new THREE.Vector3(); // Direction of the slope
        this.surfaceNormal = new THREE.Vector3(0, 1, 0); // Current surface normal
        
        // Add terrain chunk tracking
        this.terrainChunks = new Map(); // Map of chunk key to physics data
        
        // Initialize sample points for terrain detection
        this._initializeSamplePoints();
        
        ////console.log('MarsInterloper: Using Mars-realistic physics system (38% Earth gravity)');
    }
    
    // NEW METHOD: Get the current player position
    getPosition() {
        return this.dummyPlayerPosition.clone();
    }
    
    // NEW METHOD: Get the current player velocity
    getVelocity() {
        return this.dummyPlayerVelocity.clone();
    }
    
    // NEW METHOD: Set the player position directly
    setPosition(position) {
        if (position && position instanceof THREE.Vector3) {
            this.dummyPlayerPosition.copy(position);
            //console.log(`PhysicsManager: Set player position to (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);
        } else if (position && typeof position === 'object' && position.x !== undefined && position.y !== undefined && position.z !== undefined) {
            this.dummyPlayerPosition.set(position.x, position.y, position.z);
            //console.log(`PhysicsManager: Set player position to (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);
        } else {
            console.warn('PhysicsManager: Invalid position provided to setPosition');
        }
    }
    
    // NEW METHOD: Force player to ground level
    forceToGround() {
        if (!this.terrainManager) {
            console.warn('PhysicsManager: Cannot force to ground - no terrain manager available');
            return;
        }
        
        try {
            // Get current position
            const x = this.dummyPlayerPosition.x;
            const z = this.dummyPlayerPosition.z;
            
            // Sample multiple points around player to find highest terrain point
            const sampleRadius = 1.0;
            const numSamplePoints = 9; // Center + 8 points around
            let highestPoint = -Infinity;
            
            // Start with center point
            highestPoint = this.terrainManager.getTerrainHeightAt(x, z);
            
            // Sample points in a circle around the player
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2;
                const sampleX = x + Math.cos(angle) * sampleRadius;
                const sampleZ = z + Math.sin(angle) * sampleRadius;
                
                const height = this.terrainManager.getTerrainHeightAt(sampleX, sampleZ);
                if (!isNaN(height) && height > highestPoint) {
                    highestPoint = height;
                }
            }
            
            if (isNaN(highestPoint) || highestPoint === -Infinity) {
                console.warn(`PhysicsManager: Cannot force to ground - invalid terrain height at (${x.toFixed(2)}, ${z.toFixed(2)})`);
                return;
            }
            
            // Use a slightly larger buffer when forcing to ground to prevent falling through
            const forceGroundBuffer = 0.5; // Increased from default groundBuffer
            
            // Set player position to terrain height plus buffer
            const newY = highestPoint + forceGroundBuffer;
            
            console.log(`PhysicsManager: Forcing player to ground. Ground height: ${highestPoint.toFixed(2)}, New Y position: ${newY.toFixed(2)}`);
            
            // Update position and reset velocity
            this.dummyPlayerPosition.y = newY;
            this.dummyPlayerVelocity.y = 0;
            this.isOnGround = true;
            this.canJump = true;
        } catch (e) {
            console.warn('PhysicsManager: Error forcing player to ground:', e);
        }
    }
    
    // NEW: Initialize sample points for better ground detection
    _initializeSamplePoints() {
        this.samplePoints = [];
        
        // Center point
        this.samplePoints.push({x: 0, z: 0, weight: 1.0});
        
        // Create points in a circle around the center
        const numPoints = 8; // 8 points around center
        const radius = this.playerRadius * 0.7; // Sample within player radius
        
        for (let i = 0; i < numPoints; i++) {
            const angle = (i / numPoints) * Math.PI * 2;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            
            // Points closer to center have higher weight
            this.samplePoints.push({x, z, weight: 0.7});
        }
        
        // Add a few points directly ahead for better slope detection
        this.samplePoints.push({x: 0, z: this.playerRadius * 1.0, weight: 0.5, isFront: true});
        this.samplePoints.push({x: 0, z: this.playerRadius * 1.5, weight: 0.3, isFront: true});
        
        if (this.debugMode) {
            //console.log(`COLLISION-SYSTEM: Initialized ${this.samplePoints.length} sample points for terrain detection`);
        }
    }
    
    // Add method to set terrain manager reference
    setTerrainManager(terrainManager) {
        this.terrainManager = terrainManager;
        ////console.log('MarsInterloper: Terrain manager linked to physics system');
    }
    
    // NEW METHOD: Initialize our simplified physics system
    createDummyPhysics() {
        // Reset any existing physics state
        this.dummyPlayerPosition = new THREE.Vector3(0, 5, 0);
        this.dummyPlayerVelocity = new THREE.Vector3(0, 0, 0);
        
        // Initialize physics flags
        this.isOnGround = false;
        this.canJump = false;
        this.wasOnGround = false;
        this.isMoving = false;
        this.isOnSlope = false;
        this.slopeAngle = 0;
        this.consecutiveErrors = 0;
        
        // Clear any stored terrain chunks
        if (this.terrainChunks) {
            this.terrainChunks.clear();
        } else {
            this.terrainChunks = new Map();
        }
        
        //console.log('PhysicsManager: Initialized simplified Mars physics system (38% Earth gravity)');
        return true;
    }
    
    async init() {
        try {
            ////console.log('MarsInterloper: Initializing Minecraft-like physics');
            
            // Initialize our simplified physics system
            this.createDummyPhysics();
            
            ////console.log('MarsInterloper: Physics initialized successfully');
            return true;
        } catch (error) {
            console.error('MarsInterloper: Failed to initialize physics', error);
            return false;
        }
    }
    
    update(deltaTime) {
        // Only proceed if terrain manager is available
        if (!this.terrainManager) {
            console.warn('PhysicsManager: No terrain manager available for physics updates');
            return;
        }

        // Calculate gravity force based on time - using Mars gravity constant
        const gravityStep = this.GRAVITY * deltaTime;
        
        // Only apply gravity if not on ground or if moving upward (jumping)
        if (!this.isOnGround || this.dummyPlayerVelocity.y > 0) {
            this.dummyPlayerVelocity.y += gravityStep;
            
            // Cap falling speed - Mars has lower terminal velocity
            if (this.dummyPlayerVelocity.y < -this.maxFallSpeed) {
                this.dummyPlayerVelocity.y = -this.maxFallSpeed;
            }
            
            // Check and adjust height while in air
            this._checkAirHeight();
        }
        
        // Get current position for slope calculations
        const currentX = this.dummyPlayerPosition.x;
        const currentZ = this.dummyPlayerPosition.z;
        
        // If on ground, check for slope to adjust friction
        let slopeFrictionModifier = 1.0;
        if (this.isOnGround && this.terrainManager) {
            try {
                // Sample terrain heights to detect slope
                // Check slightly ahead and behind to determine slope direction and steepness
                const sampleDistance = 1.0;
                const forwardX = currentX + sampleDistance;
                const forwardZ = currentZ;
                const backwardX = currentX - sampleDistance;
                const backwardZ = currentZ;
                const rightX = currentX;
                const rightZ = currentZ + sampleDistance;
                const leftX = currentX;
                const leftZ = currentZ - sampleDistance;
                
                // Get heights at sample points
                const centerHeight = this.terrainManager.getTerrainHeightAt(currentX, currentZ);
                const forwardHeight = this.terrainManager.getTerrainHeightAt(forwardX, forwardZ);
                const backwardHeight = this.terrainManager.getTerrainHeightAt(backwardX, backwardZ);
                const rightHeight = this.terrainManager.getTerrainHeightAt(rightX, rightZ);
                const leftHeight = this.terrainManager.getTerrainHeightAt(leftX, leftZ);
                
                // Calculate max slope steepness
                const xSlope = Math.abs(forwardHeight - backwardHeight) / (sampleDistance * 2);
                const zSlope = Math.abs(rightHeight - leftHeight) / (sampleDistance * 2);
                const maxSlope = Math.max(xSlope, zSlope);
                
                // Adjust friction based on slope steepness
                // Steeper slopes = less friction (more sliding)
                if (maxSlope > 0.1) { // Only apply for noticeable slopes
                    // On Mars, steeper slopes should result in more sliding due to low gravity
                    // Map slope from 0.1-0.5 to friction reduction of 0-30%
                    const slopeEffect = Math.min(1.0, (maxSlope - 0.1) / 0.4);
                    slopeFrictionModifier = 1.0 - (slopeEffect * 0.3);
                    
                    if (this.debugMode && maxSlope > 0.2) {
                        //console.log(`SLOPE-FRICTION: Detected slope of ${maxSlope.toFixed(2)}, friction modifier: ${slopeFrictionModifier.toFixed(2)}`);
                    }
                }
            } catch (error) {
                // Ignore slope detection errors - use default friction
                console.warn("SLOPE-DETECTION-ERROR: Failed to detect slope", error);
            }
        }
        
        // Apply air resistance/friction - less on Mars due to thin atmosphere
        // And now modified by slope when on ground
        const baseFriction = this.isOnGround ? this.playerFriction : 0.98; // Higher value (less friction) in air
        const airFriction = this.isOnGround ? baseFriction * slopeFrictionModifier : baseFriction;
        
        // Apply friction to horizontal movement
        this.dummyPlayerVelocity.x *= airFriction;
        this.dummyPlayerVelocity.z *= airFriction;
        
        // If velocity is very small, set to zero to prevent micro-movement
        if (Math.abs(this.dummyPlayerVelocity.x) < 0.01) this.dummyPlayerVelocity.x = 0;
        if (Math.abs(this.dummyPlayerVelocity.z) < 0.01) this.dummyPlayerVelocity.z = 0;
        
        // Scale velocities by time
        const stepX = this.dummyPlayerVelocity.x * deltaTime;
        const stepY = this.dummyPlayerVelocity.y * deltaTime;
        const stepZ = this.dummyPlayerVelocity.z * deltaTime;
        
        // Calculate new position using temporary variables (don't apply yet)
        const newX = this.dummyPlayerPosition.x + stepX;
        const newY = this.dummyPlayerPosition.y + stepY;
        const newZ = this.dummyPlayerPosition.z + stepZ;
        
        // FIX: Improved ground and slope detection system
        // Sample multiple points to get better terrain information
        const terrainData = this._getSampleTerrainData(newX, newZ);
        
        // Get terrain height at player position - handle errors gracefully
        let groundHeight = terrainData.baseHeight;
        let isOnSlope = terrainData.isOnSlope;
        let slopeAngle = terrainData.slopeAngle;
        
        // CRITICAL FIX: Store last ground height to detect sudden changes (holes)
        if (!this.lastGroundHeight) {
            this.lastGroundHeight = groundHeight;
        }
        
        // Check if we're potentially over a hole or depression
        const heightDrop = this.lastGroundHeight - groundHeight;
        const potentialHole = heightDrop > 1.0; // If ground drops by more than 1 unit
        
        if (potentialHole) {
            //console.log(`HOLE-DETECTED: Ground dropped by ${heightDrop.toFixed(2)} units (from ${this.lastGroundHeight.toFixed(2)} to ${groundHeight.toFixed(2)})`);
        }
        
        // Update last ground height
        this.lastGroundHeight = groundHeight;
        
        if (isOnSlope && this.isMoving) {
            //console.log(`SLOPE-DETECTED: Angle ${slopeAngle.toFixed(1)}°, Direction [${terrainData.slopeDirection.x.toFixed(2)}, ${terrainData.slopeDirection.z.toFixed(2)}]`);
            
            // Check if we're moving uphill
            const movingUphill = this._isMovingUphill(terrainData.slopeDirection);
            
            if (movingUphill) {
                // Calculate dot product between movement and slope direction
                const moveDot = this._getMovementDotProduct(terrainData.slopeDirection);
                
                // Calculate upward force based on slope steepness and alignment
                const maxClimbAngle = 45; // Max angle player can climb
                const climbFactor = Math.min(1.0, Math.max(0, (maxClimbAngle - slopeAngle) / maxClimbAngle));
                const alignmentFactor = Math.max(0, moveDot); // How aligned movement is with slope
                
                // IMPROVED: Significantly increase upward force for better slope climbing
                // Multiplied by 60.0 (was 40.0) to provide even stronger climbing ability
                const upwardForce = deltaTime * 60.0 * climbFactor * alignmentFactor;
                
                if (upwardForce > 0.01) {
                    // Add upward velocity to help climb the slope
                    this.dummyPlayerVelocity.y = Math.max(this.dummyPlayerVelocity.y, upwardForce);
                    
                    //console.log(`UPHILL-ASSIST: Added ${upwardForce.toFixed(2)} upward velocity for slope climbing (slopeAngle=${slopeAngle.toFixed(1)}°, climbFactor=${climbFactor.toFixed(2)}, alignmentFactor=${alignmentFactor.toFixed(2)})`);
                    
                    // ENHANCED: Improved steep slope climbing assistance
                    if (slopeAngle > 15 && alignmentFactor > 0.4) {
                        // Calculate a more substantial boost in Y position based on slope steepness
                        const positionBoost = deltaTime * slopeAngle * 0.04 * alignmentFactor;
                        this.dummyPlayerPosition.y += positionBoost;
                        //console.log(`SLOPE-BOOST: Added ${positionBoost.toFixed(3)} to Y position for steep slope`);
                        
                        // Also provide a small forward push to help with very steep slopes
                        if (slopeAngle > 30) {
                            const forwardBoost = deltaTime * 2.0 * (slopeAngle / 45);
                            this.dummyPlayerVelocity.x *= (1.0 + forwardBoost * this.dummyPlayerVelocity.x / Math.abs(this.dummyPlayerVelocity.x || 1));
                            this.dummyPlayerVelocity.z *= (1.0 + forwardBoost * this.dummyPlayerVelocity.z / Math.abs(this.dummyPlayerVelocity.z || 1));
                            //console.log(`FORWARD-BOOST: Added ${(forwardBoost * 100).toFixed(1)}% to forward velocity for very steep slope`);
                        }
                    }
                }
            } else if (slopeAngle > 30) {
                // For steep downhill slopes, add extra friction
                const steepnessFactor = (slopeAngle - 30) / 30; // 0 to 1 for steepness beyond 30°
                this.dummyPlayerVelocity.x *= (1.0 - steepnessFactor * 0.3);
                this.dummyPlayerVelocity.z *= (1.0 - steepnessFactor * 0.3);
                
                //console.log(`DOWNHILL-CONTROL: Added ${(steepnessFactor * 30).toFixed(0)}% friction for steep ${slopeAngle.toFixed(1)}° downhill`);
            }
        }
        
        // Apply horizontal movement
        this.dummyPlayerPosition.x = newX;
        this.dummyPlayerPosition.z = newZ;
        
        // Check for collisions with static objects
        if (this.staticColliders && this.staticColliders.length > 0) {
            // Get the player's current position and radius
            const playerPosition = this.dummyPlayerPosition.clone();
            const playerRadius = this.playerRadius;
            
            // Iterate through each static collider to check for collisions
            for (const box of this.staticColliders) {
                // Find the closest point on the box to the player
                const closestPoint = new THREE.Vector3(
                    Math.max(box.min.x, Math.min(playerPosition.x, box.max.x)),
                    Math.max(box.min.y, Math.min(playerPosition.y, box.max.y)),
                    Math.max(box.min.z, Math.min(playerPosition.z, box.max.z))
                );
                
                // Calculate the distance from the closest point to the player's center
                const distance = playerPosition.distanceTo(closestPoint);
                
                // If the distance is less than the player's radius, we have a collision
                if (distance < playerRadius) {
                    //console.log(`COLLISION: Player collided with static box "${box.name}" at (${box.position.x.toFixed(2)}, ${box.position.y.toFixed(2)}, ${box.position.z.toFixed(2)})`);
                    
                    // Calculate the normal vector from the closest point to the player
                    const normal = new THREE.Vector3().subVectors(playerPosition, closestPoint).normalize();
                    
                    // Calculate the penetration depth
                    const penetrationDepth = playerRadius - distance;
                    
                    // Move the player away from the collision point
                    this.dummyPlayerPosition.addScaledVector(normal, penetrationDepth);
                    
                    // Reflect the velocity component in the direction of the normal
                    const velocityAlongNormal = this.dummyPlayerVelocity.dot(normal);
                    
                    // Only bounce if the velocity is towards the object
                    if (velocityAlongNormal < 0) {
                        // Apply bounce with reduced magnitude (friction)
                        const bounceCoefficient = 0.3; // Lower for less bouncy collisions
                        this.dummyPlayerVelocity.addScaledVector(normal, -velocityAlongNormal * (1 + bounceCoefficient));
                    }
                }
            }
        }
        
        // Check for collision with ground - player height is approximately 1.8 units
        const playerHeight = this.playerHeight; // Use the property value (1.8)
        
        // FIXED: Use a more forgiving ground contact threshold to make jumping easier
        // Increased from 0.3 to 0.6 to allow jumping when slightly above ground
        const groundContactThreshold = potentialHole ? 0.1 : 0.6;
        
        // Calculate the player's distance from ground
        // Positive value means above ground, negative means below ground
        const distanceToGround = newY - groundHeight;
        
        // CRITICAL FIX: Allow falling into holes by always updating Y position first
        this.dummyPlayerPosition.y = newY;
        
        // Track air time to ensure smooth transitions
        if (!this.airTime) this.airTime = 0;
        if (!this.isOnGround) this.airTime += deltaTime;
        else this.airTime = 0;
        
        // Log collision check if player is moving or debug is enabled
        if (this.isMoving || this.debugMode) {
            //console.log(`TERRAIN-CHECK: PlayerY=${newY.toFixed(2)}, GroundLevel=${groundHeight.toFixed(2)}, PlayerHeight=${playerHeight.toFixed(2)}, DistanceToGround=${distanceToGround.toFixed(2)}, Slope=${isOnSlope?'Yes':'No'}, SlopeAngle=${slopeAngle.toFixed(1)}°, PossibleHole=${potentialHole?'Yes':'No'}`);
        }
        
        // NEW: Check if player is intentionally trying to move downward
        const isIntentionallyFalling = this.dummyPlayerVelocity.y < -0.5; // If falling with significant velocity
        
        // CRITICAL FIX: If we're over a potential hole, don't snap to ground unless really needed
        if ((potentialHole || isIntentionallyFalling) && distanceToGround > -0.5) {
            // Over a hole and not significantly below ground - let gravity handle it
            this.isOnGround = false;
            this.canJump = false;
            //console.log(`HOLE-RESPONSE: Allowing fall into hole/crater (distance to ground: ${distanceToGround.toFixed(2)}, velocity: ${this.dummyPlayerVelocity.y.toFixed(2)})`);
        }
        // Normal ground collision handling - below ground level
        else if (distanceToGround <= 0) {
            // Player is below ground level - force to exact ground level with a buffer
            const groundBuffer = this.groundBuffer; // Use consistent buffer height
            
            // Check if we're in a crater or depression using Mars elevation data
            let inDepression = false;
            let depressionFactor = 1.0;
            
            if (this.terrainManager && this.terrainManager.worldPositionToMarsCoordinates) {
                try {
                    const marsCoords = this.terrainManager.worldPositionToMarsCoordinates(this.dummyPlayerPosition.x, this.dummyPlayerPosition.z);
                    if (marsCoords && marsCoords.elevation && marsCoords.elevation < -250) {
                        // We're in a significant depression
                        inDepression = true;
                        
                        // Calculate depth factor - deeper means more adjustment
                        depressionFactor = Math.max(0.5, 1.0 - (Math.abs(marsCoords.elevation) / 2000));
                    }
                } catch (e) {
                    // Ignore errors
                }
            }
            
            // Apply ground snapping gradually for natural movement
            // If in depression, use a gentler snap speed
            const snapSpeed = inDepression 
                ? Math.min(0.4, 2.0 * deltaTime * depressionFactor) 
                : Math.min(1.0, 5.0 * deltaTime);
            
            // DEBUG: Log player positioning in detail
            //console.log(`GROUND-COLLISION: Setting position from ${this.dummyPlayerPosition.y.toFixed(2)} to ${(groundHeight + groundBuffer).toFixed(2)}`);
            
            // Use lerp for smooth transition
            this.dummyPlayerPosition.y = THREE.MathUtils.lerp(
                this.dummyPlayerPosition.y,
                groundHeight + groundBuffer,
                snapSpeed
            );
            
            // Zero out vertical velocity gradually
            // Be more permissive with downward velocity in depressions
            const velocityDampen = inDepression ? 0.9 : 0.8;
            this.dummyPlayerVelocity.y *= velocityDampen;
            if (Math.abs(this.dummyPlayerVelocity.y) < 0.1) this.dummyPlayerVelocity.y = 0;
            
            this.isOnGround = true;
            this.canJump = true; // Enable jumping when on ground
        }
        // Handle Y position when player is slightly above ground but within contact threshold
        else if (distanceToGround <= groundContactThreshold) {
            // FIXED: Allow jumping when near ground for better player experience
            this.isOnGround = true;
            this.canJump = true;
            
            // NEW: Check if player has upward velocity that should override ground snapping
            const hasUpwardMomentum = this.dummyPlayerVelocity.y > 0.1;
            
            // NEW: Check if player is intentionally falling
            if (isIntentionallyFalling) {
                // Let gravity take over - don't snap to ground
                //console.log(`INTENTIONAL-FALL: Allowing player to fall with velocity ${this.dummyPlayerVelocity.y.toFixed(2)}`);
            }
            // Only snap to ground if moving downward slowly (falling, not jumping) and not over potential hole
            else if (this.dummyPlayerVelocity.y <= 0 && !hasUpwardMomentum && !potentialHole) {
                // IMPROVED: More aggressive ground snapping for better visual contact
                const snapSpeed = Math.min(1.0, 8.0 * deltaTime); // Increased from 5.0 to 8.0 for faster snapping
                
                // Use lerp for smooth transition to ground level
                this.dummyPlayerPosition.y = THREE.MathUtils.lerp(
                    this.dummyPlayerPosition.y,
                    groundHeight + this.groundBuffer,
                    snapSpeed
                );
                
                // Gradually reduce vertical velocity
                this.dummyPlayerVelocity.y *= 0.7; // More aggressive damping (was 0.8)
                if (Math.abs(this.dummyPlayerVelocity.y) < 0.1) this.dummyPlayerVelocity.y = 0;
            }
        } else {
            // Player is not on ground
            this.isOnGround = false;
            
            // Only reset jump capability when falling (not when initially jumping)
            if (this.dummyPlayerVelocity.y < 0 && !this.canJump) {
                this.canJump = false;
            }
            
            // DEBUG: Log player in air state
            if (this.debugMode) {
                //console.log(`PLAYER-IN-AIR: Y: ${this.dummyPlayerPosition.y.toFixed(2)}, Distance To Ground: ${distanceToGround.toFixed(2)}, Vertical Velocity: ${this.dummyPlayerVelocity.y.toFixed(2)}`);
            }
        }
        
        // Track previous ground state for next frame
        this.wasOnGround = this.isOnGround;
    }
    
    // NEW: Enhanced terrain sampling system to better detect slopes
    _getSampleTerrainData(x, z) {
        const result = {
            baseHeight: 0,
            isOnSlope: false,
            slopeAngle: 0,
            slopeDirection: { x: 0, z: 0 }
        };
        
        if (!this.terrainManager) return result;
        
        try {
            // Get direct terrain height at player's position - crucial for hole detection
            const directHeight = this.terrainManager.getTerrainHeightAt(x, z);
            
            if (isNaN(directHeight)) {
                console.warn(`TERRAIN-ERROR: Invalid center height at (${x.toFixed(2)}, ${z.toFixed(2)})`);
                return result;
            }
            
            // CRITICAL FIX: Always use the direct height at player position 
            // This ensures player falls into holes/depressions
            result.baseHeight = directHeight;
            
            // Only perform additional sampling for slope detection, not for base height
            const centerHeightData = this._getTerrainHeightWithVariance(x, z);
            
            // If we detected variance in the interpolation, we're already on a slope
            if (centerHeightData.variance > 0.3) {
                //console.log(`TERRAIN-DIRECT-VARIANCE: Detected variance of ${centerHeightData.variance.toFixed(2)} at position (${x.toFixed(1)}, ${z.toFixed(1)}), treating as slope`);
                result.isOnSlope = true;
                result.slopeAngle = Math.min(45, centerHeightData.variance * 15); // Approximate slope angle
            }
            
            // Sample around the player to determine slopes
            const sampleDistance = 2.0;
            
            // Sample in a more comprehensive pattern
            // IMPROVED: Added more sample points in more directions
            const samples = [
                { x: x + sampleDistance, z: z, label: "Front" },
                { x: x - sampleDistance, z: z, label: "Back" },
                { x: x, z: z + sampleDistance, label: "Right" },
                { x: x, z: z - sampleDistance, label: "Left" },
                // Add diagonal sample points
                { x: x + sampleDistance, z: z + sampleDistance, label: "FrontRight" },
                { x: x + sampleDistance, z: z - sampleDistance, label: "FrontLeft" },
                { x: x - sampleDistance, z: z + sampleDistance, label: "BackRight" },
                { x: x - sampleDistance, z: z - sampleDistance, label: "BackLeft" },
                // Add extended sample points for more gradual slopes
                { x: x + sampleDistance * 1.5, z: z, label: "ExtendedFront" },
                { x: x, z: z + sampleDistance * 1.5, label: "ExtendedRight" }
            ];
            
            // Get heights at each point
            const heights = [];
            let maxHeight = directHeight;
            let minHeight = directHeight;
            let heightDiffSum = 0;
            
            // DEBUG: Detailed terrain sampling log
            //console.log(`TERRAIN-SAMPLING: Center position (${x.toFixed(1)}, ${z.toFixed(1)}), Height: ${directHeight.toFixed(2)}`);
            
            for (let i = 0; i < samples.length; i++) {
                const sample = samples[i];
                try {
                    const height = this.terrainManager.getTerrainHeightAt(sample.x, sample.z);
                    
                    if (!isNaN(height)) {
                        sample.height = height;
                        heights.push(height);
                        
                        maxHeight = Math.max(maxHeight, height);
                        minHeight = Math.min(minHeight, height);
                        
                        // Track total height difference from center
                        heightDiffSum += Math.abs(height - directHeight);
                        
                        // LOG HEIGHT DIFFERENCES - especially useful for hole detection
                        const heightDiff = height - directHeight;
                        if (Math.abs(heightDiff) > 1.0) {
                            //console.log(`TERRAIN-HOLE-DETECT: Large height difference of ${heightDiff.toFixed(2)} units detected at ${sample.label}`);
                        }
                    }
                } catch (error) {
                    // Skip invalid samples
                    console.warn(`TERRAIN-SAMPLE-ERROR for ${sample.label}: ${error.message}`);
                }
            }
            
            // Calculate slope statistics
            const heightVariation = maxHeight - minHeight;
            const avgHeightDiff = heightDiffSum / samples.length;
            
            // DEBUG: Check if we're over a hole/crater
            if (minHeight < directHeight - 1.0) {
                //console.log(`POSSIBLE-HOLE-DETECTED: Center height ${directHeight.toFixed(2)}, minimum nearby height ${minHeight.toFixed(2)}, difference ${(directHeight - minHeight).toFixed(2)}`);
            }
            
            // LOWERED THRESHOLD: Detect more subtle slopes (0.15 -> 0.10)
            // If sufficient height variation, classify as slope
            if (heightVariation > 0.10 || avgHeightDiff > 0.05 || centerHeightData.variance > 0.3) {
                result.isOnSlope = true;
                
                // Find highest point to determine slope direction
                let highestSample = null;
                let highestHeight = -Infinity;
                
                for (const sample of samples) {
                    if (sample.height !== undefined && sample.height > highestHeight) {
                        highestHeight = sample.height;
                        highestSample = sample;
                    }
                }
                
                if (highestSample) {
                    // Calculate slope direction (from player to highest point)
                    const dirX = highestSample.x - x;
                    const dirZ = highestSample.z - z;
                    const dirLength = Math.sqrt(dirX*dirX + dirZ*dirZ);
                    
                    if (dirLength > 0) {
                        result.slopeDirection.x = dirX / dirLength;
                        result.slopeDirection.z = dirZ / dirLength;
                    }
                    
                    // Calculate approximate slope angle (in degrees)
                    const heightDiff = highestHeight - directHeight;
                    result.slopeAngle = Math.atan2(heightDiff, dirLength) * (180 / Math.PI);
                }
            }
            
            return result;
        } catch (error) {
            // Use the new error handler
            const contextInfo = `getSampleTerrainData(${x.toFixed(2)}, ${z.toFixed(2)})`;
            return this.handlePhysicsError(error, contextInfo, result);
        }
    }
    
    // NEW: Helper method to get terrain height and detect interpolation variance
    _getTerrainHeightWithVariance(x, z) {
        // Set a flag to catch interpolation logs
        this._lastInterpolationVariance = 0;
        
        try {
            // Get the terrain height
            const height = this.terrainManager.getTerrainHeightAt(x, z);
            
            // Return the height and detected variance
            return {
                height,
                variance: this._lastInterpolationVariance
            };
        } catch (error) {
            // Use the new error handler
            const contextInfo = `getTerrainHeightWithVariance(${x.toFixed(2)}, ${z.toFixed(2)})`;
            return this.handlePhysicsError(error, contextInfo, { height: 0, variance: 0 });
        }
    }
    
    // NEW METHOD: Handle physics errors gracefully
    handlePhysicsError(error, contextInfo, fallbackValue) {
        this.consecutiveErrors++;
        
        // Log error but avoid flooding the console
        if (this.consecutiveErrors < 10) {
            console.warn(`PHYSICS-ERROR in ${contextInfo}: ${error.message}`);
        } else if (this.consecutiveErrors === 10) {
            console.warn(`PHYSICS-ERROR: Too many consecutive errors, suppressing further logs`);
        }
        
        // Reset consecutive errors if there are too many (to prevent integer overflow)
        if (this.consecutiveErrors > 10000) {
            this.consecutiveErrors = 100;
        }
        
        // Return fallback value to allow physics to continue without crashing
        return fallbackValue;
    }
    
    // NEW: Check if player is moving uphill based on slope direction
    _isMovingUphill(slopeDirection) {
        // If no velocity, we're not moving uphill
        if (Math.abs(this.dummyPlayerVelocity.x) < 0.01 && Math.abs(this.dummyPlayerVelocity.z) < 0.01) {
            return false;
        }
        
        // Get normalized velocity vector
        const velocityLength = Math.sqrt(
            this.dummyPlayerVelocity.x * this.dummyPlayerVelocity.x + 
            this.dummyPlayerVelocity.z * this.dummyPlayerVelocity.z
        );
        
        if (velocityLength < 0.01) return false;
        
        const normalizedVelocityX = this.dummyPlayerVelocity.x / velocityLength;
        const normalizedVelocityZ = this.dummyPlayerVelocity.z / velocityLength;
        
        // Calculate dot product between velocity and slope direction
        // Dot product is positive when moving uphill (velocity aligned with slope direction)
        const dotProduct = -(normalizedVelocityX * slopeDirection.x + normalizedVelocityZ * slopeDirection.z);
        
        // DEBUG: Log detailed slope movement check
        //console.log(`SLOPE-CLIMB-CHECK: Velocity=[${normalizedVelocityX.toFixed(2)}, ${normalizedVelocityZ.toFixed(2)}], SlopeDir=[${slopeDirection.x.toFixed(2)}, ${slopeDirection.z.toFixed(2)}], DotProduct=${dotProduct.toFixed(2)}, IsUphill=${dotProduct > 0}`);
        
        return dotProduct > 0; // Positive dot product means moving uphill
    }
    
    // NEW: Get dot product between movement direction and slope direction
    _getMovementDotProduct(slopeDirection) {
        // Get normalized velocity vector
        const velocityLength = Math.sqrt(
            this.dummyPlayerVelocity.x * this.dummyPlayerVelocity.x + 
            this.dummyPlayerVelocity.z * this.dummyPlayerVelocity.z
        );
        
        if (velocityLength < 0.01) return 0;
        
        const normalizedVelocityX = this.dummyPlayerVelocity.x / velocityLength;
        const normalizedVelocityZ = this.dummyPlayerVelocity.z / velocityLength;
        
        // Calculate dot product between velocity and slope direction
        // Negate the dot product because slope direction points to high ground
        // So moving against slope direction = moving uphill
        const dotProduct = -(normalizedVelocityX * slopeDirection.x + normalizedVelocityZ * slopeDirection.z);
        
        // DEBUG: Log detailed alignment value
        //console.log(`SLOPE-ALIGNMENT: Value=${dotProduct.toFixed(3)}, VelocityMagnitude=${velocityLength.toFixed(2)}`);
        
        return dotProduct;
    }
    
    createRigidBody() {
        // Create a simple rigid body for the astronaut's physics
        // This is a stub that returns an object with expected methods
        return {
            translation: () => {
                return {
                    x: this.dummyPlayerPosition.x,
                    y: this.dummyPlayerPosition.y,
                    z: this.dummyPlayerPosition.z
                };
            },
            
            // Add any other methods needed for compatibility
            velocity: () => {
                return {
                    x: this.dummyPlayerVelocity.x,
                    y: this.dummyPlayerVelocity.y,
                    z: this.dummyPlayerVelocity.z
                };
            }
        };
    }
    
    createTerrainBody(terrainMesh, terrainSize, terrainResolution, terrainMaxHeight, heightData, options = {}) {
        // Extract options or use defaults
        const offsetX = options.offsetX || 0;
        const offsetZ = options.offsetZ || 0;
        const isChunk = options.isChunk || false;
        const chunkKey = options.chunkKey || "0,0";
        const expandSize = options.expandSize || 0; // New parameter for overlapping chunks
        
        //console.log(`PHYSICS: Creating terrain body for ${isChunk ? 'chunk '+chunkKey : 'main terrain'} at (${offsetX}, ${offsetZ})`);
        
        // If this is a chunk, add it to the chunks collection
        if (isChunk) {
            // Calculate adjusted bounds with expansion for chunk physics bodies
            // This ensures each chunk's physics extends beyond its visual bounds to prevent gaps
            const physicsWorldX = offsetX - terrainSize/2 - expandSize/2;
            const physicsWorldZ = offsetZ - terrainSize/2 - expandSize/2;
            const physicsSize = terrainSize + expandSize; // Expanded size with overlap
            
            // Add the chunk to the physics system with expanded bounds
            this.addTerrainChunk(
                chunkKey, 
                terrainMesh, 
                heightData, 
                physicsWorldX, 
                physicsWorldZ,
                physicsSize, 
                terrainResolution
            );
            
            //console.log(`PHYSICS-OVERLAP: Chunk ${chunkKey} physics body expanded by ${expandSize} units to prevent gaps. Physics bounds: [${physicsWorldX.toFixed(1)} to ${(physicsWorldX+physicsSize).toFixed(1)}] x [${physicsWorldZ.toFixed(1)} to ${(physicsWorldZ+physicsSize).toFixed(1)}]`);
        }
        
        // For simplified physics we don't need to return anything
        return null;
    }
    
    createPlayerBody(player) {
        // Store reference to the player mesh
        this.dummyPlayerObject = player;
        this.dummyPlayerPosition.copy(player.position);
        
        // Initialize jump capability
        this.canJump = false;
        
        ////console.log('MarsInterloper: Player physics body created with Minecraft-like physics');
        
        // Return a dummy rigid body with our methods
        return this.createRigidBody();
    }
    
    // NEW METHOD: Add a terrain chunk to the physics system
    addTerrainChunk(chunkKey, terrainMesh, heightData, worldX, worldZ, size, resolution) {
        if (!this.terrainChunks) {
            this.terrainChunks = new Map();
        }
        
        // Store the chunk with its physics data
        this.terrainChunks.set(chunkKey, {
            key: chunkKey,
            mesh: terrainMesh,
            heightData: heightData,
            worldX: worldX,
            worldZ: worldZ,
            size: size,
            resolution: resolution,
            enabled: true
        });
        
        //console.log(`PHYSICS-CHUNK: Added terrain chunk ${chunkKey} to physics system (${worldX.toFixed(1)}, ${worldZ.toFixed(1)}) - size ${size.toFixed(1)} resolution ${resolution}`);
        
        // Return a reference to the chunk for the caller
        return this.terrainChunks.get(chunkKey);
    }
    
    createBox(position, size, mass = 1, color = 0xffffff, isStatic = false, isInvisible = false) {
        try {
            // Create a box mesh
            const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
            const material = new THREE.MeshStandardMaterial({ 
                color: color,
                transparent: isInvisible,
                opacity: isInvisible ? 0 : 1
            });
            const box = new THREE.Mesh(geometry, material);
            box.position.copy(position);
            box.castShadow = !isInvisible;
            box.receiveShadow = !isInvisible;
            
            this.scene.add(box);
            
            return box;
        } catch (error) {
            console.error('MarsInterloper: Failed to create box', error);
            return null;
        }
    }
    
    // Create a static box collider that doesn't move but can be collided with
    createStaticBox(position, halfSize, visible = false, name = 'StaticBox') {
        try {
            //console.log(`Creating static box at position (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}) with half-size (${halfSize.x.toFixed(2)}, ${halfSize.y.toFixed(2)}, ${halfSize.z.toFixed(2)})`);
            
            // Initialize static colliders array if it doesn't exist
            if (!this.staticColliders) {
                this.staticColliders = [];
                //console.log('Initialized static colliders array');
            }
            
            // Create the collider properties
            const collider = {
                position: position.clone(),
                halfSize: halfSize.clone(),
                min: new THREE.Vector3(
                    position.x - halfSize.x,
                    position.y - halfSize.y,
                    position.z - halfSize.z
                ),
                max: new THREE.Vector3(
                    position.x + halfSize.x,
                    position.y + halfSize.y,
                    position.z + halfSize.z
                ),
                name: name
            };
            
            // Add visual representation if requested
            if (visible) {
                // Create a wireframe box to visualize the collider
                const geometry = new THREE.BoxGeometry(
                    halfSize.x * 2, 
                    halfSize.y * 2, 
                    halfSize.z * 2
                );
                const material = new THREE.MeshBasicMaterial({ 
                    color: 0x00ff00, 
                    wireframe: true 
                });
                const visualBox = new THREE.Mesh(geometry, material);
                visualBox.position.copy(position);
                this.scene.add(visualBox);
                
                // Store the visual representation
                collider.visual = visualBox;
            }
            
            // Add the collider to our list
            this.staticColliders.push(collider);
            //console.log(`Added static box collider "${name}" - Total static colliders: ${this.staticColliders.length}`);
            
            return collider;
        } catch (error) {
            console.error('MarsInterloper: Failed to create static box', error);
            return null;
        }
    }
    
    createSphere(position, radius, mass = 1, color = 0xffffff) {
        try {
            // Create a sphere mesh
            const geometry = new THREE.SphereGeometry(radius, 32, 32);
            const material = new THREE.MeshStandardMaterial({ color: color });
            const sphere = new THREE.Mesh(geometry, material);
            sphere.position.copy(position);
            sphere.castShadow = true;
            sphere.receiveShadow = true;
            
            this.scene.add(sphere);
            
            return sphere;
        } catch (error) {
            console.error('MarsInterloper: Failed to create sphere', error);
            return null;
        }
    }
    
    createCuboidCollider() {
        return null;
    }
    
    applyForce(body, force) {
        // In our simple physics implementation, we just apply the force directly to velocity
        // Validate force to avoid NaN issues
        if (force && !isNaN(force.x) && !isNaN(force.y) && !isNaN(force.z)) {
            // Increase force multiplier for more responsive movement (0.01 -> 0.05)
            this.dummyPlayerVelocity.x += force.x * 0.05; // Increased for better control
            this.dummyPlayerVelocity.y += force.y * 0.05;
            this.dummyPlayerVelocity.z += force.z * 0.05;
            
            // Log the velocity after applying force
            ////console.log(`MarsInterloper: Velocity after force: (${this.dummyPlayerVelocity.x.toFixed(2)}, ${this.dummyPlayerVelocity.y.toFixed(2)}, ${this.dummyPlayerVelocity.z.toFixed(2)})`);
            
            // Set the moving flag to indicate player is applying movement force
        }
    }
    
    // NEW METHOD: Apply an impulse (instant change in velocity)
    applyImpulse(body, impulse) {
        // Validate impulse to avoid NaN issues
        if (impulse && !isNaN(impulse.x) && !isNaN(impulse.y) && !isNaN(impulse.z)) {
            // Check if this is a jump impulse
            const isJump = impulse.y > 0;
            
            // Only allow jumping if on the ground
            if (isJump && !this.isOnGround && !this.canJump) {
                //console.log('PHYSICS-JUMP-DENIED: Cannot jump when not on ground');
                return; // Don't apply the impulse at all
            }
            
            // For jumping, we want a more significant and immediate effect
            // Apply impulse directly to velocity - especially important for Y (jump) component
            this.dummyPlayerVelocity.x += impulse.x;
            this.dummyPlayerVelocity.y += impulse.y;
            this.dummyPlayerVelocity.z += impulse.z;
            
            // Enforce maximum jump velocity to prevent flying off the map
            if (this.dummyPlayerVelocity.y > this.maxJumpSpeed) {
                //console.log(`PHYSICS-JUMP-LIMITED: Limiting upward velocity from ${this.dummyPlayerVelocity.y.toFixed(2)} to ${this.maxJumpSpeed.toFixed(2)}`);
                this.dummyPlayerVelocity.y = this.maxJumpSpeed;
            }
            
            // If this was a jump, reset ground state to allow falling and prevent double jumps
            if (isJump) {
                //console.log(`PHYSICS-JUMP-APPLIED: Jump impulse applied. New velocity: (${this.dummyPlayerVelocity.x.toFixed(2)}, ${this.dummyPlayerVelocity.y.toFixed(2)}, ${this.dummyPlayerVelocity.z.toFixed(2)})`);
                this.isOnGround = false;
                this.canJump = false; // Prevent double-jumping
            }
        }
    }
    
    // Helper method to check and adjust player height while in the air
    _checkAirHeight() {
        if (!this.terrainManager) return;
        
        try {
            // Only check if we're actually in the air
            if (!this.isOnGround) {
                const x = this.dummyPlayerPosition.x;
                const z = this.dummyPlayerPosition.z;
                const y = this.dummyPlayerPosition.y;
                
                // Get terrain height at current position
                const groundHeight = this.terrainManager.getTerrainHeightAt(x, z);
                
                if (isNaN(groundHeight)) return;
                
                // Calculate minimum allowed height (ground + buffer - small margin)
                const minHeight = groundHeight + this.groundBuffer * 0.5; // Allow going a bit lower while in air
                
                // Get the raw terrain elevation through the terrain manager if possible
                let groundElevation = 0;
                let depthAdjustment = 1.0; // Default adjustment factor
                
                if (this.terrainManager.worldPositionToMarsCoordinates) {
                    try {
                        // Get Mars coordinates for current position
                        const marsCoords = this.terrainManager.worldPositionToMarsCoordinates(x, z);
                        
                        // Check if in a deep depression or crater (negative elevation)
                        if (marsCoords && marsCoords.elevation && marsCoords.elevation < -250) {
                            // Increase adjustment factor for deeper craters
                            // This helps prevent bouncing out of deep depressions
                            const depthFactor = Math.min(1.0, Math.abs(marsCoords.elevation) / 2000);
                            depthAdjustment = 0.25 + depthAdjustment * depthFactor;
                            
                            // Lower the ground buffer for smoother movement in deep areas
                            depthAdjustment *= 0.5;
                        }
                    } catch (e) {
                        // Ignore errors in elevation check
                    }
                }
                
                // If player is too low but not actually hitting ground, adjust height gradually
                if (y < minHeight && y > groundHeight) {
                    // Calculate how far below minimum height we are (0 to 1)
                    const depthFactor = (minHeight - y) / (minHeight - groundHeight);
                    
                    // Apply upward correction force proportional to depth 
                    // The deeper we are, the stronger the correction
                    // Apply depthAdjustment to be more permissive in crater areas
                    const correctionForce = Math.min(2.0, 5.0 * depthFactor * depthFactor) * depthAdjustment;
                    
                    // Apply correction force to velocity
                    this.dummyPlayerVelocity.y += correctionForce * 0.02;
                    
                    // If moving downward, reduce downward velocity
                    if (this.dummyPlayerVelocity.y < 0) {
                        this.dummyPlayerVelocity.y *= (1.0 - 0.2 * depthFactor);
                    }
                    
                    // If we have airTime, interpolate position directly
                    if (this.airTime > 0.1) {
                        // Smoother correction for longer air time
                        // Use depthAdjustment to be more permissive in crater areas
                        const liftFactor = Math.min(0.05, 0.2 * depthFactor * 0.016) * depthAdjustment;
                        this.dummyPlayerPosition.y = THREE.MathUtils.lerp(
                            this.dummyPlayerPosition.y,
                            minHeight,
                            liftFactor
                        );
                    }
                }
            }
        } catch (error) {
            console.warn('PhysicsManager: Error in air height adjustment:', error);
        }
    }
}