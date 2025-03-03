import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

export class PlayerController {
    constructor(camera, domElement, terrainManager = null, physicsManager = null) {
        // Core properties
        this.camera = camera;
        this.domElement = domElement;
        this.position = new THREE.Vector3(0, 0, 0);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.direction = new THREE.Vector3(0, 0, -1);
        this.characterManager = null;
        this.physicsManager = physicsManager;
        this.terrainManager = terrainManager;
        
        // Controls and UI elements
        this.controls = null;
        this.blocker = document.getElementById('blocker');
        this.instructions = document.getElementById('instructions');
        this.enabled = false;
        
        // Movement inputs
        this.moveForward = false;
        this.moveBackward = false;
        this.moveLeft = false;
        this.moveRight = false;
        this.jump = false;
        
        // Camera and control settings
        this.cameraMode = 'first-person'; // 'first-person' or 'third-person'
        this.movementStrength = 30; // Default movement strength
        this.acceleration = 1.0;
        this.playerHeight = 2.0;
        
        // Debug flags
        this.showDebugInfo = false;
        
        // Check if UI elements exist
        if (!this.blocker || !this.instructions) {
            console.error('MarsInterloper: Missing UI elements for pointer lock control. blocker:', !!this.blocker, 'instructions:', !!this.instructions);
        }
    }
    
    init() {
        //console.log('MarsInterloper: Initializing player controller with proper ground alignment');
        
        // Create controls
        try {
            this.controls = new PointerLockControls(this.camera, this.domElement);
            //console.log('MarsInterloper: PointerLockControls initialized');
        } catch (error) {
            console.error('MarsInterloper: Error initializing PointerLockControls', error);
        }
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Set a better starting position based on terrain if available
        if (this.terrainManager) {
            try {
                // Get coordinates at a block level (aligned to block size)
                const startX = 0;
                const startZ = 0;
                
                // Get terrain height at starting position
                const terrainHeight = this.terrainManager.getTerrainHeightAt(startX, startZ);
                //console.log(`MarsInterloper: Starting terrain height at (${startX}, ${startZ}): ${terrainHeight}`);
                
                if (terrainHeight !== undefined && !isNaN(terrainHeight)) {
                    // Start slightly above terrain with minimum height check to avoid underground spawning
                    const minStartHeight = 5; // Minimum starting height to ensure visibility
                    
                    // FIXED: Use the same small ground buffer as in PhysicsManager
                    const groundBuffer = 0.1;
                    
                    // Adjusted starting height to match the ground properly
                    const startHeight = Math.max(terrainHeight + groundBuffer, minStartHeight);
                    
                    this.position.set(startX, startHeight, startZ);
                    //console.log(`MarsInterloper: Starting player at position: (${this.position.x}, ${this.position.y}, ${this.position.z})`);
                    //console.log(`MarsInterloper: Player is ${this.position.y - terrainHeight} units above terrain`);
                    
                    // If physics is available, set initial position there too
                    if (this.physicsManager) {
                        this.physicsManager.setPosition(this.position);
                        // Force the player to the ground to ensure proper terrain contact at start
                        if (typeof this.physicsManager.forceToGround === 'function') {
                            //console.log('MarsInterloper: Forcing player to ground at initialization');
                            this.physicsManager.forceToGround();
                        } else {
                            // Apply a small downward velocity to help the player settle on the terrain
                            this.physicsManager.dummyPlayerVelocity.set(0, -2.0, 0);
                            //console.log('MarsInterloper: Added downward velocity to help player settle');
                        }
                    }
                    
                    // When the character manager creates the astronaut, it will be at this position
                } else {
                    console.warn('MarsInterloper: Could not retrieve terrain height, using default position');
                    this.position.set(0, 5, 0); // Lower default height from 18 to 5
                    
                    if (this.physicsManager) {
                        this.physicsManager.setPosition(this.position);
                        // Still try to force to ground even with default position
                        if (typeof this.physicsManager.forceToGround === 'function') {
                            this.physicsManager.forceToGround();
                        }
                    }
                }
            } catch (error) {
                console.error('MarsInterloper: Error setting initial position', error);
                this.position.set(0, 5, 0); // Lower from 18 to 5
                
                if (this.physicsManager) {
                    this.physicsManager.setPosition(this.position);
                    // Try to recover by forcing to ground
                    if (typeof this.physicsManager.forceToGround === 'function') {
                        this.physicsManager.forceToGround();
                    }
                }
            }
        } else {
            //console.log('MarsInterloper: Terrain manager not available, using default position');
            this.position.set(0, 5, 0); // Lower from 18 to 5
            
            if (this.physicsManager) {
                this.physicsManager.setPosition(this.position);
            }
        }
    }
    
    // Method to set character manager reference
    setCharacterManager(characterManager) {
        this.characterManager = characterManager;
        ////console.log('MarsInterloper: Character manager linked to player controller');
    }
    
    createPlayerPhysics() {
        try {
            // Create an invisible mesh to represent the player's physical body
            // Use a box to match the physics shape
            const playerGeometry = new THREE.BoxGeometry(1, this.playerHeight, 1);
            const playerMaterial = new THREE.MeshBasicMaterial({ 
                color: 0xff0000, 
                wireframe: true,
                visible: false // Make it invisible
            });
            
            this.playerObject = new THREE.Mesh(playerGeometry, playerMaterial);
            this.playerObject.position.copy(this.camera.position);
            
            // Create the physics body with simplified physics
            this.playerBody = this.physicsManager.createPlayerBody(this.playerObject);
            
            if (!this.playerBody) {
                throw new Error('Player physics body creation failed');
            }
            
            ////console.log('MarsInterloper: Player physics created with simplified system');
        } catch (error) {
            console.error('MarsInterloper: Failed to create player physics', error);
            // The player controller can still work without physics
            this.playerBody = null;
        }
    }
    
    // Set up event listeners for player input
    setupEventListeners() {
        // Event listeners for keyboard input
        document.addEventListener('keydown', (event) => {
            this.handleKeyDown(event);
        });
        
        document.addEventListener('keyup', (event) => {
            this.handleKeyUp(event);
        });
        
        // Mouse movement for camera control already handled by PointerLockControls
        
        // Set up event listeners for controls
        if (this.instructions && this.controls) {
            ////console.log('MarsInterloper: Setting up instructions click handler for pointer lock');
            this.instructions.addEventListener('click', () => {
                ////console.log('MarsInterloper: Instructions clicked, requesting pointer lock');
                // Add a small delay to ensure the browser recognizes it as a user gesture
                setTimeout(() => {
                    try {
                        this.controls.lock();
                    } catch (error) {
                        console.error('MarsInterloper: Error locking pointer on instructions click', error);
                    }
                }, 10);
            });
        } else {
            console.error('MarsInterloper: Cannot set up pointer lock events - missing instructions or controls');
        }
        
        if (this.controls) {
            this.controls.addEventListener('lock', () => {
                ////console.log('MarsInterloper: Pointer lock successful');
                if (this.instructions) this.instructions.style.display = 'none';
                if (this.blocker) this.blocker.style.display = 'none';
                this.enabled = true;
            });
            
            this.controls.addEventListener('unlock', () => {
                ////console.log('MarsInterloper: Pointer unlocked');
                if (this.blocker) this.blocker.style.display = 'block';
                if (this.instructions) this.instructions.style.display = '';
                this.enabled = false;
            });
        }
    }
    
    // Handle keydown events
    handleKeyDown(event) {
        if (!this.enabled) return;
        
        switch (event.code) {
            case 'KeyW':
            case 'ArrowUp':
                this.moveBackward = true;
                break;
            case 'KeyS':
            case 'ArrowDown':
                this.moveForward = true;
                break;
            case 'KeyA':
            case 'ArrowLeft':
                this.moveLeft = true;
                break;
            case 'KeyD':
            case 'ArrowRight':
                this.moveRight = true;
                break;
            case 'Space':
                const canJump = this.checkGroundContact();
                if (canJump) {
                    // Try to climb first if facing an object, otherwise jump
                    const climbSuccessful = this.climbObject();
                    if (climbSuccessful) {
                        //console.log('CLIMB: Started climbing object');
                    } else {
                        // Regular jump if not climbing
                        this.jump = true;
                        //console.log('JUMP: Jump initiated - on ground');
                    }
                } else {
                    //console.log('JUMP/CLIMB: Cannot jump or climb - not on ground');
                }
                break;
            case 'KeyV':
                this.toggleCameraMode();
                break;
            case 'KeyK':
                this.toggleDebugInfo();
                break;
        }
    }
    
    // Handle keyup events
    handleKeyUp(event) {
        if (!this.enabled) return;
        
        switch (event.code) {
            case 'KeyW':
            case 'ArrowUp':
                this.moveBackward = false;
                break;
            case 'KeyS':
            case 'ArrowDown':
                this.moveForward = false;
                break;
            case 'KeyA':
            case 'ArrowLeft':
                this.moveLeft = false;
                break;
            case 'KeyD':
            case 'ArrowRight':
                this.moveRight = false;
                break;
            case 'Space':
                this.jump = false;
                break;
        }
    }
    
    update(deltaTime) {
        // Update character animations based on player movement
        if (this.characterManager) {
            this.characterManager.update(deltaTime);
        }
    }
    
    // Get the current player position
    getPosition() {
        // Always return the physics-based position
        return this.position;
    }
    
    // Get the current player direction
    getDirection() {
        return this.direction;
    }
    
    // Check if player is on ground for jump control
    checkGroundContact() {
        if (!this.physicsManager) return false;
        
        // Request ground contact status directly from physics manager
        // This ensures jump checks use the same ground detection as physics
        const onGround = this.physicsManager.isOnGround;
        const canJump = this.physicsManager.canJump;
        
        // Also check height difference to detect if player is over a hole
        const playerPos = this.physicsManager.getPosition();
        let potentialHole = false;
        
        if (this.terrainManager && playerPos) {
            try {
                // Get current ground height
                const currentHeight = this.terrainManager.getTerrainHeightAt(
                    playerPos.x, playerPos.z
                );
                
                // Sample around to check for holes
                const samples = [
                    {x: playerPos.x + 0.5, z: playerPos.z},
                    {x: playerPos.x - 0.5, z: playerPos.z},
                    {x: playerPos.x, z: playerPos.z + 0.5},
                    {x: playerPos.x, z: playerPos.z - 0.5}
                ];
                
                let minHeight = currentHeight;
                for (const sample of samples) {
                    const sampleHeight = this.terrainManager.getTerrainHeightAt(
                        sample.x, sample.z
                    );
                    if (!isNaN(sampleHeight)) {
                        minHeight = Math.min(minHeight, sampleHeight);
                    }
                }
                
                // If we detect a significant drop, player might be over a hole
                potentialHole = (currentHeight - minHeight) > 0.8;
                
                // Log info about potential holes
                if (potentialHole) {
                    //console.log(`PLAYER-CHECK: Potential hole detected. Height differential: ${(currentHeight - minHeight).toFixed(2)}`);
                }
            } catch (e) {
                console.warn("Error checking for holes:", e);
            }
        }
        
        //console.log(`GROUND-CHECK: isOnGround=${onGround}, canJump=${canJump}, overHole=${potentialHole}`);
        
        // If player is over a hole, don't allow jumping even if reported as on ground
        if (potentialHole) {
            return false;
        }
        
        // Return canJump instead of just onGround - more accurate for jumping
        return canJump;
    }
    
    // Toggle between first and third person camera modes
    toggleCameraMode() {
        this.cameraMode = this.cameraMode === 'first-person' ? 'third-person' : 'first-person';
        ////console.log(`MarsInterloper: Camera mode set to ${this.cameraMode}`);
        
        // Notify character manager of camera mode change
        if (this.characterManager) {
            this.characterManager.setCameraMode(this.cameraMode);
        }
    }
    
    toggleDebugInfo() {
        this.showDebugInfo = !this.showDebugInfo;
        ////console.log(`MarsInterloper: Debug info ${this.showDebugInfo ? 'enabled' : 'disabled'}`);
    }
    
    updateWithPhysics(deltaTime) {
        if (!this.physicsManager) return;
        
        // Get camera direction (forward vector)
        const cameraDirection = new THREE.Vector3(0, 0, -1);
        cameraDirection.applyQuaternion(this.camera.quaternion);
        cameraDirection.y = 0; // Keep movement horizontal
        cameraDirection.normalize(); // Ensure unit vector
        
        // Camera right vector
        const cameraRight = new THREE.Vector3(1, 0, 0);
        cameraRight.applyQuaternion(this.camera.quaternion);
        cameraRight.y = 0; // Keep movement horizontal
        cameraRight.normalize(); // Ensure unit vector
        
        // Only log camera vectors if player is moving
        const isMoving = this.moveForward || this.moveBackward || this.moveLeft || this.moveRight;
        if (isMoving) {
            ////console.log(`MarsInterloper: Camera direction: (${cameraDirection.x.toFixed(2)}, ${cameraDirection.y.toFixed(2)}, ${cameraDirection.z.toFixed(2)})`);
            ////console.log(`MarsInterloper: Camera right: (${cameraRight.x.toFixed(2)}, ${cameraRight.y.toFixed(2)}, ${cameraRight.z.toFixed(2)})`);
        }
        
        // Calculate the movement vector based on inputs
        let moveX = 0;
        let moveZ = 0;
        
        if (this.moveForward) moveZ -= 1;
        if (this.moveBackward) moveZ += 1;
        if (this.moveLeft) moveX -= 1;
        if (this.moveRight) moveX += 1;
        
        // Only log movement inputs if player is moving
        if (isMoving) {
            ////console.log(`MarsInterloper: Input movement: forward=${this.moveForward}, backward=${this.moveBackward}, left=${this.moveLeft}, right=${this.moveRight}`);
        }
        
        // Normalize the movement vector so diagonal movement isn't faster
        const length = Math.sqrt(moveX * moveX + moveZ * moveZ);
        if (length > 0) {
            moveX /= length;
            moveZ /= length;
        }
        
        // Apply camera direction to movement (WASD is relative to camera view)
        const finalMoveX = moveX * cameraRight.x + moveZ * cameraDirection.x;
        const finalMoveZ = moveX * cameraRight.z + moveZ * cameraDirection.z;
        
        // Only log final movement vector if player is moving
        if (isMoving) {
            ////console.log(`MarsInterloper: Final movement vector: (${finalMoveX.toFixed(2)}, ${finalMoveZ.toFixed(2)})`);
        }
        
        // Update if the player is moving (for animation)
        if (this.characterManager) {
            this.characterManager.isMoving = (length > 0);
        }
        
        // Apply movement force to player through physics manager
        if (length > 0) {
            // Calculate final force with acceleration
            const moveForce = {
                x: finalMoveX * this.movementStrength * this.acceleration,
                y: 0,
                z: finalMoveZ * this.movementStrength * this.acceleration
            };
            
            // Log movement details for debugging
            ////console.log(`MarsInterloper: Movement force: (${moveForce.x.toFixed(2)}, ${moveForce.z.toFixed(2)}), ` + 
                        //`acceleration: ${this.acceleration}, movementStrength: ${this.movementStrength}`);
            
            // Validate moveForce to avoid NaN values
            if (!isNaN(moveForce.x) && !isNaN(moveForce.y) && !isNaN(moveForce.z)) {
                // Apply force to the physics system
                this.physicsManager.applyForce(null, moveForce);
                
                // Update player direction based on movement (for astronaut rotation)
                this.direction.set(finalMoveX, 0, finalMoveZ).normalize();
                ////console.log(`MarsInterloper: Player direction updated: (${this.direction.x.toFixed(2)}, ${this.direction.y.toFixed(2)}, ${this.direction.z.toFixed(2)})`);
            } else {
                console.warn('MarsInterloper: Invalid movement force detected:', moveForce);
            }
        }
        
        // Handle jumping
        if (this.jump) {
            // Check if we can jump
            const canJump = this.checkGroundContact();
            
            if (canJump) {
                // Apply jump force - higher on Mars due to lower gravity
                const jumpForce = {
                    x: 0,
                    y: 20, // Reduced from 60 to 20 for more realistic Mars jumps
                    z: 0
                };
                
                //console.log('JUMP-COMMAND: Mars jump initiated (realistic for Mars gravity)');
                
                this.physicsManager.applyImpulse(null, jumpForce);
            } else {
                //console.log('JUMP-COMMAND: Cannot jump - not on ground');
            }
            
            // Reset jump flag
            this.jump = false;
        }
        
        // Update player position from physics system
        const physicsPosition = this.physicsManager.getPosition();
        if (physicsPosition) {
            this.position.copy(physicsPosition);
            this.velocity.copy(this.physicsManager.getVelocity());
            
            // Only log position and velocity if actively moving or debug info enabled
            if (isMoving || this.showDebugInfo) {
                ////console.log(`PLAYER-ASTRONAUT: Physics position: (${physicsPosition.x.toFixed(2)}, ${physicsPosition.y.toFixed(2)}, ${physicsPosition.z.toFixed(2)})`);
                ////console.log(`PLAYER-ASTRONAUT: Physics velocity: (${this.velocity.x.toFixed(2)}, ${this.velocity.y.toFixed(2)}, ${this.velocity.z.toFixed(2)})`);
            }
            
            // First-person camera should follow player's head position
            if (this.camera && this.cameraMode === 'first-person') {
                const headHeight = 1.7; // Eye level height
                this.camera.position.set(
                    this.position.x,
                    this.position.y + headHeight,
                    this.position.z
                );
                
                // In first-person mode, ensure controls are locked
                if (this.controls && !this.controls.isLocked) {
                    this.controls.lock();
                }
            }
        }
    }
    
    // Add explicit methods for pointer lock control
    lockPointer() {
        if (this.controls) {
            try {
                ////console.log('MarsInterloper: Manually requesting pointer lock');
                // Only request pointer lock if it's from a user event handler
                if (document.pointerLockElement !== this.domElement) {
                    this.controls.lock();
                }
            } catch (error) {
                console.error('MarsInterloper: Error in manual pointer lock request', error);
            }
        } else {
            console.error('MarsInterloper: Cannot lock pointer - controls not initialized');
        }
    }
    
    unlockPointer() {
        if (this.controls) {
            try {
                ////console.log('MarsInterloper: Manually unlocking pointer');
                this.controls.unlock();
            } catch (error) {
                console.error('MarsInterloper: Error unlocking pointer', error);
            }
        } else {
            console.error('MarsInterloper: Cannot unlock pointer - controls not initialized');
        }
    }

    // Initialize player with a mesh
    initPlayer(scene, camera, physicsManager, terrainManager) {
        this.scene = scene;
        this.camera = camera;
        this.physicsManager = physicsManager;
        this.terrainManager = terrainManager;
        
        // Create a container for the player and camera
        this.playerContainer = new THREE.Object3D();
        this.scene.add(this.playerContainer);
        
        // Initially position the player at a valid ground position
        this.playerContainer.position.set(0, 0, 0);
        
        // If we have terrain manager, adjust the initial height based on the terrain
        if (this.terrainManager) {
            // Get the terrain height at the player's initial position
            const initialTerrainHeight = this.terrainManager.getTerrainHeightAt(0, 0);
            //console.log(`PLAYER INIT: Initial terrain height at (0,0): ${initialTerrainHeight}`);
            
            // Set player Y position to be at the ground level plus a small offset
            // to ensure the player starts above the ground
            const groundBuffer = this.physicsManager ? this.physicsManager.groundContactBuffer : 1.0;
            const playerStartHeight = initialTerrainHeight + groundBuffer;
            
            // Update the player container position
            this.playerContainer.position.y = playerStartHeight;
            
            //console.log(`PLAYER INIT: Positioning player at Y: ${playerStartHeight} (terrain + buffer)`);
        } else {
            console.warn("PLAYER INIT: No terrain manager available, using default height");
            this.playerContainer.position.y = 1.0; // Default height if no terrain manager
        }
        
        // Add camera to player container
        this.playerContainer.add(camera);
        
        // Adjust camera height to simulate player height
        this.camera.position.y = this.playerHeight;
        
        // Create visible player model for third-person or shadows
        if (this.showPlayerModel) {
            this.createPlayerModel();
        }
        
        // Register with physics manager if available
        if (this.physicsManager) {
            this.physicsManager.setPlayer(this.playerContainer);
        }
        
        // Movement initialization
        this.initializeMovement();
        
        // Debug helpers
        if (this.showDebugHelpers) {
            this.addDebugHelpers();
        }
        
        //console.log("PLAYER INIT: Player controller initialized");
    }

    // Add ability to climb objects like the Starship
    climbObject() {
        // Only allow climbing when on ground
        if (!this.physicsManager || !this.physicsManager.isOnGround) {
            return false;
        }
        
        // Get player's current position and looking direction
        const position = this.physicsManager.getPosition();
        
        // Get the direction player is facing
        const lookingDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        
        // Normalize the direction vector
        lookingDirection.normalize();
        
        // Calculate a point 1.5 units ahead of the player (increased from 1 unit for better detection)
        const forwardPosition = new THREE.Vector3(
            position.x + lookingDirection.x * 1.5,
            position.y,
            position.z + lookingDirection.z * 1.5
        );
        
        // Check if there's a static object ahead that can be climbed
        // This requires the physics manager to have static colliders defined
        if (this.physicsManager.staticColliders && this.physicsManager.staticColliders.length > 0) {
            // Check each static collider
            for (const collider of this.physicsManager.staticColliders) {
                if (collider.type === 'staticBox') {
                    // Skip objects that are too high to climb
                    const climbHeightLimit = 3.0; // Maximum climb height (increased from 2.0)
                    const playerHeight = this.physicsManager.playerHeight;
                    
                    // Check if the object's bottom is above player height or top is too high
                    const objectBottomY = collider.position.y - collider.halfSize.y;
                    const objectTopY = collider.position.y + collider.halfSize.y;
                    
                    if (objectBottomY > position.y + playerHeight ||
                        objectBottomY > position.y + climbHeightLimit) {
                        // Object is too high to climb
                        continue;
                    }
                    
                    // Calculate distances to the box in xz plane (horizontal only)
                    const boxMinX = collider.position.x - collider.halfSize.x;
                    const boxMaxX = collider.position.x + collider.halfSize.x;
                    const boxMinZ = collider.position.z - collider.halfSize.z;
                    const boxMaxZ = collider.position.z + collider.halfSize.z;
                    
                    // Check if forward position is inside or very close to the box
                    // Increased detection distance from 0.5 to 0.8 for better results
                    const closeDistance = 0.8;
                    const canClimbX = (forwardPosition.x >= boxMinX - closeDistance && forwardPosition.x <= boxMaxX + closeDistance);
                    const canClimbZ = (forwardPosition.z >= boxMinZ - closeDistance && forwardPosition.z <= boxMaxZ + closeDistance);
                    
                    if (canClimbX && canClimbZ) {
                        // We're close enough to climb this object
                        //console.log(`PlayerController: Climbing object (${collider.name || 'unnamed'})`);
                        
                        // Apply an upward impulse to simulate climbing
                        this.physicsManager.dummyPlayerVelocity.y = 6.0; // Stronger upward impulse (increased from 5.0)
                        this.physicsManager.dummyPlayerVelocity.x = lookingDirection.x * 3.0; // Stronger forward momentum (increased from 2.0)
                        this.physicsManager.dummyPlayerVelocity.z = lookingDirection.z * 3.0;
                        
                        // Mark as not on ground during climbing
                        this.physicsManager.isOnGround = false;
                        
                        // Brief cooldown on jumping after climbing
                        this.physicsManager.canJump = false;
                        setTimeout(() => {
                            this.physicsManager.canJump = true;
                        }, 500);
                        
                        return true;
                    }
                }
            }
        }
        
        // Special case for the Starship (if we can't rely on static colliders)
        // This checks if we're near the Starship position that was saved during game initialization
        if (window.game && window.game.starshipPosition) {
            const starshipPos = window.game.starshipPosition;
            const distanceToStarship = new THREE.Vector3(
                position.x - starshipPos.x,
                0, // Ignore Y distance
                position.z - starshipPos.z
            ).length();
            
            // Check if we're close to the Starship and facing it
            if (distanceToStarship < 5.0) {
                // Calculate dot product to see if we're facing the Starship
                const dirToStarship = new THREE.Vector3(
                    starshipPos.x - position.x,
                    0,
                    starshipPos.z - position.z
                ).normalize();
                
                const facingDot = lookingDirection.dot(dirToStarship);
                
                // If we're facing the Starship (dot product > 0.7)
                if (facingDot > 0.7) {
                    //console.log(`PlayerController: Climbing Starship (special case)`);
                    
                    // Apply stronger impulse for the Starship
                    this.physicsManager.dummyPlayerVelocity.y = 7.0;
                    this.physicsManager.dummyPlayerVelocity.x = lookingDirection.x * 4.0;
                    this.physicsManager.dummyPlayerVelocity.z = lookingDirection.z * 4.0;
                    
                    this.physicsManager.isOnGround = false;
                    this.physicsManager.canJump = false;
                    setTimeout(() => {
                        this.physicsManager.canJump = true;
                    }, 500);
                    
                    return true;
                }
            }
        }
        
        return false; // Nothing to climb
    }
} 