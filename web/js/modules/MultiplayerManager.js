import * as THREE from 'three';

export class MultiplayerManager {
    constructor(scene, playerController) {
        this.scene = scene;
        this.playerController = playerController;
        this.socket = null;
        this.connected = false;
        this.playerId = null;
        this.otherPlayers = new Map(); // Map of player IDs to their mesh objects
        this.playerModels = new Map(); // Map of player IDs to their model objects
        
        // Settings for synchronization
        this.updateInterval = 50; // milliseconds between updates (increased frequency from 100ms to 50ms)
        this.lastUpdateTime = 0;
        
        // Player model settings
        this.playerModelScale = 0.5;
        this.playerModelColor = 0x3498db; // Blue color for other players
        
        // Reference to the asset manager to access the astronaut model
        this.assetManager = null;
        
        // Terrain manager reference to properly position players on the ground
        this.terrainManager = null;
        
        // Astronaut model for cloning
        this.astronautModelTemplate = null;
        
        // Track player activity state
        this.playerLastUpdate = new Map(); // Map of player IDs to their last update time
        this.playerInactiveThreshold = 5000; // 5 seconds without updates = inactive player
        
        // Player animation data
        this.playerAnimations = new Map(); // Map of player IDs to their animation data
        this.playerLastPositions = new Map(); // Map of player IDs to their last positions for movement detection
        this.animationSpeed = 5; // Animation speed multiplier
    }
    
    /**
     * Set the asset manager to access game models
     */
    setAssetManager(assetManager) {
        this.assetManager = assetManager;
        
    }
    
    /**
     * Set the terrain manager to access terrain height data
     */
    setTerrainManager(terrainManager) {
        if (terrainManager) {
            this.terrainManager = terrainManager;
            //console.log('Successfully set terrain manager for multiplayer positioning');
        }
    }
    
    /**
     * Set the astronaut model template directly from character manager
     */
    setAstronautModelTemplate(model) {
        if (model) {
            this.astronautModelTemplate = model;
            //console.log('Successfully set detailed astronaut model for multiplayer');
        }
    }
    
    /**
     * Connect to the WebSocket server
     */
    connect() {
        // Determine WebSocket URL (using same host but ws:// protocol)
        const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        const wsUrl = `${protocol}${window.location.host}/ws`;
        
        ////console.log(`Connecting to WebSocket server at ${wsUrl}`);
        this.socket = new WebSocket(wsUrl);
        
        // Set up event handlers
        this.socket.onopen = this.onSocketOpen.bind(this);
        this.socket.onclose = this.onSocketClose.bind(this);
        this.socket.onerror = this.onSocketError.bind(this);
        this.socket.onmessage = this.onSocketMessage.bind(this);
    }
    
    /**
     * Handle WebSocket connection opened
     */
    onSocketOpen(event) {
        ////console.log('WebSocket connection established');
        this.connected = true;
    }
    
    /**
     * Handle WebSocket connection closed
     */
    onSocketClose(event) {
        ////console.log('WebSocket connection closed', event);
        this.connected = false;
        this.playerId = null;
        
        // Remove all other player models
        this.removeAllPlayers();
        
        // Try to reconnect after a short delay
        setTimeout(() => {
            if (!this.connected) {
                ////console.log('Attempting to reconnect...');
                this.connect();
            }
        }, 3000);
    }
    
    /**
     * Handle WebSocket errors
     */
    onSocketError(error) {
        console.error('WebSocket error:', error);
    }
    
    /**
     * Handle incoming WebSocket messages
     */
    onSocketMessage(event) {
        try {
            const message = JSON.parse(event.data);
            
            switch (message.type) {
                case 'connected':
                    this.handleConnected(message);
                    break;
                case 'newPlayer':
                    this.handleNewPlayer(message);
                    break;
                case 'playerUpdate':
                    this.handlePlayerUpdate(message);
                    break;
                case 'playerDisconnect':
                    this.handlePlayerDisconnect(message);
                    break;
                default:
                    console.warn('Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    }
    
    /**
     * Handle player connected message
     */
    handleConnected(message) {
        ////console.log('Connected to server with ID:', message.id);
        this.playerId = message.id;
    }
    
    /**
     * Handle new player message
     */
    handleNewPlayer(message) {
        ////console.log('New player joined:', message.id);
        this.createPlayerModel(message.id, message.position, message.rotation);
    }
    
    /**
     * Handle player update message
     */
    handlePlayerUpdate(message) {
        // Update position and rotation of another player
        const player = this.otherPlayers.get(message.id);
        if (player) {
            // Get the last known position for this player
            const lastPosition = this.playerLastPositions.get(message.id);
            
            // Record the time this player was last updated
            this.playerLastUpdate.set(message.id, Date.now());
            
            // Get correct terrain height at the player's position
            let terrainHeight = 0;
            if (this.terrainManager) {
                terrainHeight = this.terrainManager.getTerrainHeightAt(message.position[0], message.position[2]);
                if (terrainHeight === undefined || isNaN(terrainHeight)) {
                    terrainHeight = 0;
                }
            }
            
            // Position the player at the correct height above the terrain
            // Use a small offset (0.1) to ensure the player is slightly above ground
            player.position.set(
                message.position[0],
                terrainHeight + 0.1, // Place directly on terrain instead of fixed offset
                message.position[2]
            );
            
            // Update rotation with smooth interpolation
            player.rotation.set(
                0, // Don't apply pitch rotation to the model
                message.rotation[1], // Only use yaw rotation for direction
                0  // Don't apply roll rotation to the model
            );
            
            // Detect if player is moving by comparing current position to last position
            if (lastPosition) {
                const dx = message.position[0] - lastPosition.x;
                const dz = message.position[2] - lastPosition.z;
                const distanceMoved = Math.sqrt(dx * dx + dz * dz);
                
                // Get the animation data for this player
                const animData = this.playerAnimations.get(message.id);
                
                // If player has moved more than a small threshold, consider them moving
                if (distanceMoved > 0.05 && animData) {
                    animData.isMoving = true;
                    animData.movementTime += 0.1; // Increment animation time
                } else if (animData) {
                    animData.isMoving = false;
                    animData.movementTime = 0; // Reset animation time when stationary
                }
                
                // Apply the animation if player is moving
                if (animData && animData.isMoving) {
                    this.animatePlayerLimbs(player, animData.movementTime);
                } else if (animData && !animData.isMoving) {
                    this.resetPlayerLimbs(player);
                }
            }
            
            // Store current position as last position for next update
            this.playerLastPositions.set(message.id, {
                x: message.position[0],
                y: message.position[1],
                z: message.position[2]
            });
        }
    }
    
    /**
     * Handle player disconnect message
     */
    handlePlayerDisconnect(message) {
        ////console.log('Player disconnected:', message.id);
        this.removePlayer(message.id);
    }
    
    /**
     * Create a 3D model for a player
     */
    createPlayerModel(playerId, position, rotation) {
        try {
            let playerModel;
            
            // Create a detailed astronaut model directly - not relying on template
            playerModel = new THREE.Group();
            
            // Create astronaut body (space suit) - central torso
            const bodyGeometry = new THREE.CapsuleGeometry(0.4, 1.0, 4, 8);
            const bodyMaterial = new THREE.MeshStandardMaterial({
                color: 0xffffff, // White space suit
                roughness: 0.7,
                metalness: 0.2
            });
            const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
            body.position.y = 0.8;
            body.castShadow = true;
            body.receiveShadow = true;
            playerModel.add(body);
            
            // Create helmet (slightly bigger than head)
            const helmetGeometry = new THREE.SphereGeometry(0.35, 16, 16);
            const helmetMaterial = new THREE.MeshStandardMaterial({
                color: 0x888888,
                roughness: 0.1,
                metalness: 0.8,
                transparent: true,
                opacity: 0.7
            });
            const helmet = new THREE.Mesh(helmetGeometry, helmetMaterial);
            helmet.position.y = 1.65;
            helmet.castShadow = true;
            playerModel.add(helmet);
            
            // Visor (face shield) - blue for multiplayer characters
            const visorGeometry = new THREE.SphereGeometry(0.25, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
            const visorMaterial = new THREE.MeshStandardMaterial({
                color: 0x0055ff, // Blue visor for multiplayer
                roughness: 0.05,
                metalness: 0.9,
                transparent: true,
                opacity: 0.7
            });
            const visor = new THREE.Mesh(visorGeometry, visorMaterial);
            visor.position.set(0, 1.65, -0.15);
            visor.rotation.x = Math.PI * 0.5;
            visor.castShadow = true;
            playerModel.add(visor);
            
            // Create backpack
            const backpackGeometry = new THREE.BoxGeometry(0.5, 0.7, 0.3);
            const backpackMaterial = new THREE.MeshStandardMaterial({
                color: 0xdddddd,
                roughness: 0.8
            });
            const backpack = new THREE.Mesh(backpackGeometry, backpackMaterial);
            backpack.position.z = 0.35;
            backpack.position.y = 0.9;
            backpack.castShadow = true;
            playerModel.add(backpack);
            
            // Life support details on backpack
            const tankGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.6, 16);
            const tankMaterial = new THREE.MeshStandardMaterial({
                color: 0xcccccc,
                roughness: 0.3,
                metalness: 0.7
            });
            
            // Left tank
            const leftTank = new THREE.Mesh(tankGeometry, tankMaterial);
            leftTank.position.set(0.15, 0.9, 0.45);
            leftTank.castShadow = true;
            playerModel.add(leftTank);
            
            // Right tank
            const rightTank = new THREE.Mesh(tankGeometry, tankMaterial);
            rightTank.position.set(-0.15, 0.9, 0.45);
            rightTank.castShadow = true;
            playerModel.add(rightTank);
            
            // Create arms
            const armGeometry = new THREE.CapsuleGeometry(0.15, 0.4, 4, 8);
            const limbMaterial = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                roughness: 0.6,
                metalness: 0.2
            });
            
            // Left arm (upper)
            const leftUpperArm = new THREE.Mesh(armGeometry, limbMaterial);
            leftUpperArm.position.set(-0.5, 1.3, 0);
            leftUpperArm.rotation.z = Math.PI * 0.15;
            leftUpperArm.defaultRotationZ = Math.PI * 0.15; // Store default rotation
            leftUpperArm.castShadow = true;
            playerModel.add(leftUpperArm);
            
            // Right arm (upper)
            const rightUpperArm = new THREE.Mesh(armGeometry, limbMaterial);
            rightUpperArm.position.set(0.5, 1.3, 0);
            rightUpperArm.rotation.z = -Math.PI * 0.15;
            rightUpperArm.defaultRotationZ = -Math.PI * 0.15; // Store default rotation
            rightUpperArm.castShadow = true;
            playerModel.add(rightUpperArm);
            
            // Create forearms
            const forearmGeometry = new THREE.CapsuleGeometry(0.12, 0.4, 4, 8);
            
            // Left forearm
            const leftForearm = new THREE.Mesh(forearmGeometry, limbMaterial);
            leftForearm.position.set(-0.7, 0.9, 0);
            leftForearm.castShadow = true;
            playerModel.add(leftForearm);
            
            // Right forearm
            const rightForearm = new THREE.Mesh(forearmGeometry, limbMaterial);
            rightForearm.position.set(0.7, 0.9, 0);
            rightForearm.castShadow = true;
            playerModel.add(rightForearm);
            
            // Create legs
            const legGeometry = new THREE.CapsuleGeometry(0.2, 0.4, 4, 8);
            
            // Left leg (upper)
            const leftUpperLeg = new THREE.Mesh(legGeometry, limbMaterial);
            leftUpperLeg.position.set(-0.25, 0.4, 0);
            leftUpperLeg.castShadow = true;
            playerModel.add(leftUpperLeg);
            
            // Right leg (upper)
            const rightUpperLeg = new THREE.Mesh(legGeometry, limbMaterial);
            rightUpperLeg.position.set(0.25, 0.4, 0);
            rightUpperLeg.castShadow = true;
            playerModel.add(rightUpperLeg);
            
            // Create calves
            const calfGeometry = new THREE.CapsuleGeometry(0.15, 0.4, 4, 8);
            
            // Left calf
            const leftCalf = new THREE.Mesh(calfGeometry, limbMaterial);
            leftCalf.position.set(-0.25, -0.1, 0);
            leftCalf.castShadow = true;
            playerModel.add(leftCalf);
            
            // Right calf
            const rightCalf = new THREE.Mesh(calfGeometry, limbMaterial);
            rightCalf.position.set(0.25, -0.1, 0);
            rightCalf.castShadow = true;
            playerModel.add(rightCalf);
            
            // Create boots
            const bootGeometry = new THREE.BoxGeometry(0.2, 0.15, 0.3);
            const bootMaterial = new THREE.MeshStandardMaterial({
                color: 0x333333,
                roughness: 0.9
            });
            
            // Left boot
            const leftBoot = new THREE.Mesh(bootGeometry, bootMaterial);
            leftBoot.position.set(-0.25, -0.45, 0);
            leftBoot.castShadow = true;
            playerModel.add(leftBoot);
            
            // Right boot
            const rightBoot = new THREE.Mesh(bootGeometry, bootMaterial);
            rightBoot.position.set(0.25, -0.45, 0);
            rightBoot.castShadow = true;
            playerModel.add(rightBoot);
            
            // Get correct terrain height at the player's position
            let terrainHeight = 0;
            if (this.terrainManager) {
                terrainHeight = this.terrainManager.getTerrainHeightAt(position[0], position[2]);
                if (terrainHeight === undefined || isNaN(terrainHeight)) {
                    terrainHeight = 0;
                }
            }
            
            // Record the time this player was first seen
            this.playerLastUpdate.set(playerId, Date.now());
            
            // Initialize animation data for this player
            this.playerAnimations.set(playerId, {
                isMoving: false,
                movementTime: 0
            });
            
            // Store initial position for movement detection
            this.playerLastPositions.set(playerId, {
                x: position[0],
                y: position[1],
                z: position[2]
            });
            
            // Position the player model at the correct terrain height
            playerModel.position.set(
                position[0],
                terrainHeight + 0.1, // Place directly on terrain instead of fixed offset
                position[2]
            );
            
            playerModel.rotation.set(
                0, // Don't apply pitch rotation to the model
                rotation[1], // Only use yaw rotation for direction
                0  // Don't apply roll rotation to the model
            );
            
            // Add the player model to the scene
            this.scene.add(playerModel);
            
            // Store the player model
            this.otherPlayers.set(playerId, playerModel);
            
            //console.log('Created detailed astronaut model for multiplayer player');
            return playerModel;
        } catch (error) {
            console.error('Error creating player model:', error);
            
            // Fallback to a simple model if there's an error
            const geometry = new THREE.CapsuleGeometry(0.5, 1.0, 4, 8);
            const material = new THREE.MeshStandardMaterial({ 
                color: this.playerModelColor,
                roughness: 0.7,
                metalness: 0.3
            });
            
            const fallbackModel = new THREE.Mesh(geometry, material);
            fallbackModel.castShadow = true;
            fallbackModel.receiveShadow = true;
            
            // Position the fallback model
            fallbackModel.position.set(
                position[0],
                position[1] - 1.0, // Height offset adjusted for the detailed model
                position[2]
            );
            
            fallbackModel.rotation.set(
                0, // Don't apply pitch rotation to the model
                rotation[1], // Only use yaw rotation for direction
                0  // Don't apply roll rotation to the model
            );
            
            // Add the fallback model to the scene
            this.scene.add(fallbackModel);
            
            // Store the fallback model
            this.otherPlayers.set(playerId, fallbackModel);
            
            return fallbackModel;
        }
    }
    
    /**
     * Remove a player model from the scene
     */
    removePlayer(playerId) {
        const playerMesh = this.otherPlayers.get(playerId);
        if (playerMesh) {
            this.scene.remove(playerMesh);
            this.otherPlayers.delete(playerId);
        }
    }
    
    /**
     * Remove all player models from the scene
     */
    removeAllPlayers() {
        this.otherPlayers.forEach((playerMesh, playerId) => {
            this.scene.remove(playerMesh);
        });
        
        this.otherPlayers.clear();
    }
    
    /**
     * Update method called by the game loop
     */
    update(deltaTime, elapsedTime) {
        if (!this.connected || !this.playerId) {
            return;
        }
        
        // Send position updates at fixed intervals
        this.lastUpdateTime += deltaTime * 1000; // Convert to milliseconds
        
        if (this.lastUpdateTime >= this.updateInterval) {
            this.sendPlayerUpdate();
            this.lastUpdateTime = 0;
        }
        
        // Update animation for moving players
        this.otherPlayers.forEach((playerModel, playerId) => {
            const animData = this.playerAnimations.get(playerId);
            if (animData && animData.isMoving) {
                animData.movementTime += deltaTime;
                this.animatePlayerLimbs(playerModel, animData.movementTime);
            }
        });
        
        // Check for inactive players and update their positions
        const currentTime = Date.now();
        this.otherPlayers.forEach((playerModel, playerId) => {
            const lastUpdate = this.playerLastUpdate.get(playerId) || 0;
            const timeSinceUpdate = currentTime - lastUpdate;
            
            // If player has been inactive, reposition them to correct terrain height
            if (timeSinceUpdate > this.playerInactiveThreshold && this.terrainManager) {
                // Get player's current position
                const position = playerModel.position;
                
                // Get correct terrain height
                const terrainHeight = this.terrainManager.getTerrainHeightAt(position.x, position.z);
                if (terrainHeight !== undefined && !isNaN(terrainHeight)) {
                    // Smoothly adjust height to terrain
                    playerModel.position.y = terrainHeight + 0.1;
                }
                
                // Also make sure inactive players aren't animating
                const animData = this.playerAnimations.get(playerId);
                if (animData) {
                    animData.isMoving = false;
                    this.resetPlayerLimbs(playerModel);
                }
            }
        });
    }
    
    /**
     * Send player position and rotation to the server
     */
    sendPlayerUpdate() {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        
        // Get player position and rotation
        const position = this.playerController.camera.position;
        const rotation = this.playerController.camera.rotation;
        
        const update = {
            id: this.playerId,
            position: [position.x, position.y, position.z],
            rotation: [rotation.x, rotation.y, rotation.z]
        };
        
        // Send update to the server
        this.socket.send(JSON.stringify(update));
    }
    
    /**
     * Clean up resources when the manager is destroyed
     */
    dispose() {
        this.removeAllPlayers();
        
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
    }
    
    /**
     * Animate player limbs for walking animation
     */
    animatePlayerLimbs(playerModel, time) {
        // Find the limbs in the player model
        const leftUpperLeg = playerModel.children.find(child => 
            child.position.x < 0 && child.position.y > 0 && child.position.y < 0.5);
        const rightUpperLeg = playerModel.children.find(child => 
            child.position.x > 0 && child.position.y > 0 && child.position.y < 0.5);
        const leftCalf = playerModel.children.find(child => 
            child.position.x < 0 && child.position.y < 0);
        const rightCalf = playerModel.children.find(child => 
            child.position.x > 0 && child.position.y < 0);
        const leftUpperArm = playerModel.children.find(child => 
            child.position.x < 0 && child.position.y > 1);
        const rightUpperArm = playerModel.children.find(child => 
            child.position.x > 0 && child.position.y > 1);
        const leftForearm = playerModel.children.find(child => 
            child.position.x < 0 && child.position.y > 0.5 && child.position.y < 1);
        const rightForearm = playerModel.children.find(child => 
            child.position.x > 0 && child.position.y > 0.5 && child.position.y < 1);
        
        if (leftUpperLeg && rightUpperLeg) {
            // Create a walking animation by oscillating the leg angles
            const legAngle = Math.sin(time * this.animationSpeed) * 0.4;
            
            // Alternate legs
            leftUpperLeg.rotation.x = legAngle;
            rightUpperLeg.rotation.x = -legAngle;
            
            // Adjust calves to maintain natural swing
            if (leftCalf && rightCalf) {
                leftCalf.rotation.x = Math.abs(legAngle * 0.5);
                rightCalf.rotation.x = Math.abs(-legAngle * 0.5);
            }
        }
        
        if (leftUpperArm && rightUpperArm) {
            // Arms move opposite to legs
            const armAngle = -Math.sin(time * this.animationSpeed) * 0.3;
            
            // Alternate arms
            leftUpperArm.rotation.x = armAngle;
            rightUpperArm.rotation.x = -armAngle;
            
            // Adjust forearms for a natural swing
            if (leftForearm && rightForearm) {
                leftForearm.rotation.x = Math.abs(armAngle * 0.3);
                rightForearm.rotation.x = Math.abs(-armAngle * 0.3);
            }
        }
    }
    
    /**
     * Reset player limbs to default position
     */
    resetPlayerLimbs(playerModel) {
        // Reset all limbs to their default positions
        playerModel.children.forEach(child => {
            if (child.rotation) {
                child.rotation.x = 0;
                child.rotation.z = child.defaultRotationZ || 0;
            }
        });
    }
} 