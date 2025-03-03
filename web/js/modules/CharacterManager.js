import * as THREE from 'three';

export class CharacterManager {
    constructor(scene, playerController) {
        this.scene = scene;
        this.playerController = playerController; // Renamed from player to playerController for clarity
        this.astronaut = null;
        this.astronautAnimations = null;
        
        // Camera settings for third-person mode
        this.thirdPersonDistance = 12;
        this.thirdPersonHeight = 5;
        this.thirdPersonAngle = Math.PI / 6; // 30 degrees in radians, look down angle
        this.currentCameraOffset = new THREE.Vector3(0, this.thirdPersonHeight, this.thirdPersonDistance);
        this.cameraTransitionSpeed = 15.0;
        
        // Animation speeds
        this.walkSpeed = 0.8;
        this.runSpeed = 1.2;
        this.isMoving = false;
        this.animationClock = new THREE.Clock();
        
        // Character parts for animation
        this.leftArm = null;
        this.rightArm = null;
        this.leftLeg = null;
        this.rightLeg = null;
        
        // Physics body for the astronaut
        this.astronautBody = null;
    }
    
    // New method that main.js references
    createAstronaut(model) {
        // Call our existing initAstronaut method
        this.initAstronaut(model);
    }
    
    initAstronaut(model) {
        if (model) {
            ////console.log('MarsInterloper: Using loaded astronaut model');
            // Use the loaded model
            this.astronaut = model.scene.clone();
            this.setupLoadedAstronaut();
        } else {
            ////console.log('MarsInterloper: Creating procedural astronaut');
            // Create a procedural astronaut placeholder
            this.createDetailedAstronaut();
        }
        
        // Ensure the astronaut is properly oriented
        this.astronaut.rotation.x = 0; // Ensure no pitch rotation
        this.astronaut.rotation.z = 0; // Ensure no roll rotation
        
        // Position the astronaut behind the player
        this.updateAstronautPosition();
        
        // Add astronaut to scene
        this.scene.add(this.astronaut);
        ////console.log('MarsInterloper: Astronaut added to scene');
        
        // Create physics body for direct control mode
        this.createAstronautPhysics();
    }
    
    setupLoadedAstronaut() {
        if (!this.astronaut) return;
        
        // If model is loaded from external file, find animation objects
        this.astronaut.traverse((child) => {
            // Apply shadows to all meshes in the loaded model
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                
                // Apply front-side rendering to all materials to prevent seeing inside the model
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        // Handle multi-material objects
                        child.material.forEach(material => {
                            material.side = THREE.FrontSide;
                        });
                    } else {
                        // Single material
                        child.material.side = THREE.FrontSide;
                    }
                }
            }
            
            // Find limbs for animation (based on common naming conventions)
            const name = child.name.toLowerCase();
            if (name.includes('leftarm') || name.includes('left_arm') || name.includes('arm_l')) {
                this.leftArm = child;
            } else if (name.includes('rightarm') || name.includes('right_arm') || name.includes('arm_r')) {
                this.rightArm = child;
            } else if (name.includes('leftleg') || name.includes('left_leg') || name.includes('leg_l')) {
                this.leftLeg = child;
            } else if (name.includes('rightleg') || name.includes('right_leg') || name.includes('leg_r')) {
                this.rightLeg = child;
            }
        });
        
        // Restore original scale
        this.astronaut.scale.set(0.5, 0.5, 0.5);
        
        // Set proper orientation (facing forward and standing upright)
        this.astronaut.rotation.set(0, Math.PI, 0); // Face forward, stand upright
        
        ////console.log('MarsInterloper: Astronaut model setup complete');
    }
    
    createDetailedAstronaut() {
        // Create a more detailed procedural astronaut using primitive shapes
        this.astronaut = new THREE.Group();
        
        // Set initial rotation to ensure the astronaut is upright
        this.astronaut.rotation.set(0, Math.PI, 0); // Only y-rotation to face forward
        
        // Create astronaut body (space suit) - central torso
        const bodyGeometry = new THREE.CapsuleGeometry(0.4, 1.0, 4, 8);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff, // White space suit
            roughness: 0.7,
            metalness: 0.2,
            side: THREE.FrontSide // Only render front faces
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 0.8;
        body.castShadow = true;
        body.receiveShadow = true;
        this.astronaut.add(body);
        
        // Create helmet (slightly bigger than head)
        const helmetGeometry = new THREE.SphereGeometry(0.35, 16, 16);
        const helmetMaterial = new THREE.MeshStandardMaterial({
            color: 0x888888,
            roughness: 0.1,
            metalness: 0.8,
            transparent: true,
            opacity: 0.7,
            side: THREE.FrontSide // Only render front faces
        });
        const helmet = new THREE.Mesh(helmetGeometry, helmetMaterial);
        helmet.position.y = 1.65;
        helmet.castShadow = true;
        this.astronaut.add(helmet);
        
        // Visor (face shield)
        const visorGeometry = new THREE.SphereGeometry(0.25, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
        const visorMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.05,
            metalness: 0.9,
            transparent: true,
            opacity: 0.7,
            side: THREE.FrontSide // Only render front faces
        });
        const visor = new THREE.Mesh(visorGeometry, visorMaterial);
        visor.position.set(0, 1.65, -0.15);
        visor.rotation.x = Math.PI * 0.5;
        visor.castShadow = true;
        this.astronaut.add(visor);
        
        // Create backpack
        const backpackGeometry = new THREE.BoxGeometry(0.5, 0.7, 0.3);
        const backpackMaterial = new THREE.MeshStandardMaterial({
            color: 0xdddddd,
            roughness: 0.8,
            side: THREE.FrontSide // Only render front faces
        });
        const backpack = new THREE.Mesh(backpackGeometry, backpackMaterial);
        backpack.position.z = 0.35;
        backpack.position.y = 0.9;
        backpack.castShadow = true;
        this.astronaut.add(backpack);
        
        // Life support details on backpack
        const tankGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.6, 16);
        const tankMaterial = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            roughness: 0.3,
            metalness: 0.7,
            side: THREE.FrontSide // Only render front faces
        });
        
        // Left tank
        const leftTank = new THREE.Mesh(tankGeometry, tankMaterial);
        leftTank.position.set(0.15, 0.9, 0.45);
        leftTank.castShadow = true;
        this.astronaut.add(leftTank);
        
        // Right tank
        const rightTank = new THREE.Mesh(tankGeometry, tankMaterial);
        rightTank.position.set(-0.15, 0.9, 0.45);
        rightTank.castShadow = true;
        this.astronaut.add(rightTank);
        
        // Create upper arms (shoulders to elbows)
        const upperArmGeometry = new THREE.CapsuleGeometry(0.15, 0.4, 4, 8);
        const limbMaterial = new THREE.MeshStandardMaterial({
            color: 0xeeeeee,
            roughness: 0.7,
            side: THREE.FrontSide // Only render front faces
        });
        
        // Left upper arm with joint
        const leftUpperArmGroup = new THREE.Group();
        leftUpperArmGroup.position.set(0.5, 1.2, 0);
        this.astronaut.add(leftUpperArmGroup);
        
        const leftUpperArm = new THREE.Mesh(upperArmGeometry, limbMaterial);
        leftUpperArm.position.set(0, -0.2, 0);
        leftUpperArm.castShadow = true;
        leftUpperArmGroup.add(leftUpperArm);
        
        // Right upper arm with joint
        const rightUpperArmGroup = new THREE.Group();
        rightUpperArmGroup.position.set(-0.5, 1.2, 0);
        this.astronaut.add(rightUpperArmGroup);
        
        const rightUpperArm = new THREE.Mesh(upperArmGeometry, limbMaterial);
        rightUpperArm.position.set(0, -0.2, 0);
        rightUpperArm.castShadow = true;
        rightUpperArmGroup.add(rightUpperArm);
        
        // Create lower arms (elbows to hands)
        const lowerArmGeometry = new THREE.CapsuleGeometry(0.12, 0.4, 4, 8);
        
        // Left lower arm with joint
        this.leftArm = new THREE.Group();
        this.leftArm.position.set(0, -0.45, 0);
        leftUpperArmGroup.add(this.leftArm);
        
        const leftLowerArm = new THREE.Mesh(lowerArmGeometry, limbMaterial);
        leftLowerArm.position.set(0, -0.2, 0);
        leftLowerArm.castShadow = true;
        this.leftArm.add(leftLowerArm);
        
        // Left glove (hand)
        const gloveGeometry = new THREE.SphereGeometry(0.15, 8, 8);
        const gloveMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.9
        });
        const leftGlove = new THREE.Mesh(gloveGeometry, gloveMaterial);
        leftGlove.position.set(0, -0.45, 0);
        leftGlove.scale.set(1, 0.8, 1);
        leftGlove.castShadow = true;
        this.leftArm.add(leftGlove);
        
        // Right lower arm with joint
        this.rightArm = new THREE.Group();
        this.rightArm.position.set(0, -0.45, 0);
        rightUpperArmGroup.add(this.rightArm);
        
        const rightLowerArm = new THREE.Mesh(lowerArmGeometry, limbMaterial);
        rightLowerArm.position.set(0, -0.2, 0);
        rightLowerArm.castShadow = true;
        this.rightArm.add(rightLowerArm);
        
        // Right glove (hand)
        const rightGlove = new THREE.Mesh(gloveGeometry, gloveMaterial);
        rightGlove.position.set(0, -0.45, 0);
        rightGlove.scale.set(1, 0.8, 1);
        rightGlove.castShadow = true;
        this.rightArm.add(rightGlove);
        
        // Create upper legs (hips to knees)
        const upperLegGeometry = new THREE.CapsuleGeometry(0.18, 0.4, 4, 8);
        
        // Left upper leg with joint
        const leftUpperLegGroup = new THREE.Group();
        leftUpperLegGroup.position.set(0.25, 0.4, 0);
        this.astronaut.add(leftUpperLegGroup);
        
        const leftUpperLeg = new THREE.Mesh(upperLegGeometry, limbMaterial);
        leftUpperLeg.position.set(0, -0.2, 0);
        leftUpperLeg.castShadow = true;
        leftUpperLegGroup.add(leftUpperLeg);
        
        // Right upper leg with joint
        const rightUpperLegGroup = new THREE.Group();
        rightUpperLegGroup.position.set(-0.25, 0.4, 0);
        this.astronaut.add(rightUpperLegGroup);
        
        const rightUpperLeg = new THREE.Mesh(upperLegGeometry, limbMaterial);
        rightUpperLeg.position.set(0, -0.2, 0);
        rightUpperLeg.castShadow = true;
        rightUpperLegGroup.add(rightUpperLeg);
        
        // Create lower legs (knees to feet)
        const lowerLegGeometry = new THREE.CapsuleGeometry(0.15, 0.4, 4, 8);
        
        // Left lower leg with joint
        this.leftLeg = new THREE.Group();
        this.leftLeg.position.set(0, -0.45, 0);
        leftUpperLegGroup.add(this.leftLeg);
        
        const leftLowerLeg = new THREE.Mesh(lowerLegGeometry, limbMaterial);
        leftLowerLeg.position.set(0, -0.2, 0);
        leftLowerLeg.castShadow = true;
        this.leftLeg.add(leftLowerLeg);
        
        // Left boot (foot)
        const bootGeometry = new THREE.BoxGeometry(0.2, 0.15, 0.35);
        const bootMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.9
        });
        const leftBoot = new THREE.Mesh(bootGeometry, bootMaterial);
        leftBoot.position.set(0, -0.45, 0.05);
        leftBoot.castShadow = true;
        this.leftLeg.add(leftBoot);
        
        // Right lower leg with joint
        this.rightLeg = new THREE.Group();
        this.rightLeg.position.set(0, -0.45, 0);
        rightUpperLegGroup.add(this.rightLeg);
        
        const rightLowerLeg = new THREE.Mesh(lowerLegGeometry, limbMaterial);
        rightLowerLeg.position.set(0, -0.2, 0);
        rightLowerLeg.castShadow = true;
        this.rightLeg.add(rightLowerLeg);
        
        // Right boot (foot)
        const rightBoot = new THREE.Mesh(bootGeometry, bootMaterial);
        rightBoot.position.set(0, -0.45, 0.05);
        rightBoot.castShadow = true;
        this.rightLeg.add(rightBoot);
        
        // NASA logo on chest
        const logoGeometry = new THREE.CircleGeometry(0.15, 16);
        const logoMaterial = new THREE.MeshBasicMaterial({
            color: 0x0b3d91 // NASA blue
        });
        const logo = new THREE.Mesh(logoGeometry, logoMaterial);
        logo.position.set(0, 1.1, -0.42);
        logo.rotation.x = -0.2;
        this.astronaut.add(logo);
        
        // American flag on shoulder
        const flagGeometry = new THREE.PlaneGeometry(0.15, 0.1);
        const flagMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            side: THREE.DoubleSide
        });
        const flag = new THREE.Mesh(flagGeometry, flagMaterial);
        flag.position.set(0.45, 1.3, -0.1);
        flag.rotation.y = -Math.PI / 2;
        this.astronaut.add(flag);
        
        ////console.log('MarsInterloper: Detailed procedural astronaut created');
    }
    
    createAstronautPhysics() {
        // Only create physics if we have access to the physics manager
        if (!this.playerController || !this.playerController.physicsManager) return;
        
        try {
            // Create a physics body for the astronaut in direct control mode
            const astronautHeight = 2.0;
            const physicsManager = this.playerController.physicsManager;
            
            // Use the astronaut's position for the physics body
            const astronautGeometry = new THREE.BoxGeometry(0.9, astronautHeight, 0.9);
            const astronautMaterial = new THREE.MeshBasicMaterial({ 
                color: 0xff0000, 
                wireframe: true,
                visible: false // Make it invisible instead of visible for debugging
            });
            
            const astronautPhysicsObject = new THREE.Mesh(astronautGeometry, astronautMaterial);
            
            // Adjust position to ensure physics body aligns with visual model
            // Position the physics body so its bottom is at the astronaut's feet
            astronautPhysicsObject.position.copy(this.astronaut.position);
            astronautPhysicsObject.position.y += astronautHeight / 2; // Raise by half height to align bottom with ground
            
            // Don't add to scene to avoid showing the debug wireframe
            // this.scene.add(astronautPhysicsObject);
            
            // Use the player's physics body directly since we're now treating them as one entity
            this.astronautBody = physicsManager.dummyPlayerObject;
            
            // Get terrain height at initial position if available
            let terrainHeight = 0;
            if (this.playerController.terrainManager) {
                const pos = this.astronaut.position;
                terrainHeight = this.playerController.terrainManager.getTerrainHeightAt(pos.x, pos.z);
                if (terrainHeight !== undefined && !isNaN(terrainHeight)) {
                    ////console.log(`PHYSICS-INIT: Initial terrain height at astronaut: ${terrainHeight.toFixed(2)}`);
                    ////console.log(`PHYSICS-INIT: Astronaut height above terrain: ${(pos.y - terrainHeight).toFixed(2)}`);
                }
            }
            
            ////console.log('MarsInterloper: Astronaut physics body created and linked to player physics');
            ////console.log(`PHYSICS-INIT: Astronaut physics position: ${astronautPhysicsObject.position.x.toFixed(2)}, ${astronautPhysicsObject.position.y.toFixed(2)}, ${astronautPhysicsObject.position.z.toFixed(2)}`);
            ////console.log(`PHYSICS-INIT: Physics body visible: ${astronautMaterial.visible}`);
        } catch (error) {
            console.error('MarsInterloper: Failed to create astronaut physics', error);
            // The astronaut can still work without physics
            this.astronautBody = null;
        }
    }
    
    updateAstronautPosition() {
        if (!this.astronaut || !this.playerController) return;
        
        // Only update position in follow mode
        if (this.controlMode === 'follow') {
            // Get player's position and direction
            const playerPosition = this.playerController.getPosition();
            const playerDirection = this.playerController.getDirection();
            
            // Calculate ideal camera position (Roblox-style)
            // 1. Position behind player based on direction
            const behindOffset = new THREE.Vector3(
                -playerDirection.x * this.thirdPersonDistance,
                0,
                -playerDirection.z * this.thirdPersonDistance
            );
            
            // 2. Add height offset
            behindOffset.y = this.thirdPersonHeight;
            
            // 3. Apply a slight tilt angle (look down at player)
            const angleOffset = new THREE.Vector3(
                playerDirection.x * Math.sin(this.thirdPersonAngle) * this.thirdPersonDistance * 0.5,
                0,
                playerDirection.z * Math.sin(this.thirdPersonAngle) * this.thirdPersonDistance * 0.5
            );
            
            behindOffset.add(angleOffset);
            
            // Calculate target astronaut position
            const targetPosition = new THREE.Vector3(
                playerPosition.x + behindOffset.x,
                playerPosition.y + behindOffset.y,
                playerPosition.z + behindOffset.z
            );
            
            // Smoothly move astronaut to new position (Roblox-style follow with slight delay)
            const smoothFactor = 0.15; // Lower = smoother/slower follow
            this.astronaut.position.lerp(targetPosition, smoothFactor);
            
            // Make astronaut face the same direction as player
            const targetRotationY = Math.atan2(playerDirection.x, playerDirection.z);
            
            // Smooth rotation (lerp)
                this.astronaut.rotation.y = targetRotationY;
            
            // Check if camera is looking toward the astronaut and hide if needed
            const cameraToAstronautVector = new THREE.Vector3(
                this.astronaut.position.x - playerPosition.x,
                this.astronaut.position.y - playerPosition.y,
                this.astronaut.position.z - playerPosition.z
            );
            cameraToAstronautVector.normalize();
            
            // Calculate dot product between camera direction and vector to astronaut
            const dotProduct = playerDirection.dot(cameraToAstronautVector);
            
            // Calculate distance to astronaut
            const distanceToAstronaut = this.astronaut.position.distanceTo(playerPosition);
            
            // Hide astronaut if camera is looking at it and close enough
            if (dotProduct < -0.7 && distanceToAstronaut < this.thirdPersonDistance * 0.5) {
                this.astronaut.visible = false;
            } else {
                this.astronaut.visible = true;
            }
        }
    }
    
    updateAstronautAnimation(deltaTime) {
        if (!this.astronaut) return;
        
        // Use a consistent animation speed instead of differentiating between run/walk
        const animationSpeed = this.walkSpeed;
        const time = this.animationClock.getElapsedTime() * animationSpeed;
        
        // Animate limbs when moving
        if (this.isMoving) {
            // Arms swing opposite to legs
            if (this.leftArm && this.rightArm) {
                this.leftArm.rotation.x = Math.sin(time) * 0.5;
                this.rightArm.rotation.x = Math.sin(time + Math.PI) * 0.5;
            }
            
            // Legs move in walking motion
            if (this.leftLeg && this.rightLeg) {
                this.leftLeg.rotation.x = Math.sin(time) * 0.7;
                this.rightLeg.rotation.x = Math.sin(time + Math.PI) * 0.7;
            }
        } else {
            // Reset to idle pose
            if (this.leftArm && this.rightArm) {
                this.leftArm.rotation.x = 0;
                this.rightArm.rotation.x = 0;
            }
            
            if (this.leftLeg && this.rightLeg) {
                this.leftLeg.rotation.x = 0;
                this.rightLeg.rotation.x = 0;
            }
        }
        
        // Add subtle idle animation (slight bobbing)
        if (this.astronaut) {
            const idleTime = performance.now() * 0.0005;
            if (!this.isMoving) {
                this.astronaut.position.y += Math.sin(idleTime * 2) * 0.005;
                
                // Subtle breathing animation
                if (this.leftArm && this.rightArm) {
                    this.leftArm.rotation.z = Math.sin(idleTime) * 0.05;
                    this.rightArm.rotation.z = Math.sin(idleTime) * 0.05;
                }
            }
        }
    }
    
    // Add a new method to adjust astronaut for direct control (first-person view)
    setupFirstPersonView(enable) {
        if (!this.astronaut) return;
        
        this.astronaut.traverse((child) => {
            if (child.isMesh) {
                // For procedural model, handle certain parts by position
                const isHead = (child.position && child.position.y > 1.4) ||
                              (child.parent && child.parent.position && child.parent.position.y > 1.4);
                
                // Also try to detect by name for loaded models
                const name = child.name.toLowerCase();
                const isNamedHead = name.includes('head') || name.includes('helmet') || 
                                  name.includes('visor') || name.includes('face');
                
                if (isHead || isNamedHead) {
                    // Hide head parts in first-person
                    if (enable) {
                        // Hide head parts
                        child.visible = false;
                    } else {
                        // Show head parts
                        child.visible = true;
                    }
                }
            }
        });
        
        ////console.log(`MarsInterloper: First-person view ${enable ? 'enabled' : 'disabled'}`);
    }
    
    toggleControlMode() {
        if (this.controlMode === 'follow') {
            this.controlMode = 'direct';
            ////console.log('MarsInterloper: Switched to direct astronaut control');
            // Set up astronaut for first-person view
            this.setupFirstPersonView(true);
        } else {
            this.controlMode = 'follow';
            ////console.log('MarsInterloper: Switched to follow mode');
            // Restore astronaut for third-person view
            this.setupFirstPersonView(false);
        }
    }
    
    // Handle direct control movement
    controlAstronaut(direction, isRunning) {
        if (this.controlMode !== 'direct') return;
        
        this.isMoving = (direction.lengthSq() > 0.1);
        
        if (this.isMoving && this.astronautBody) {
            // Get astronaut's facing direction
            const astronautDirection = new THREE.Vector3(0, 0, -1);
            astronautDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.astronaut.rotation.y);
            
            // Use a consistent speed instead of differentiating between run/walk
            const speed = 4.0;
            
            // Apply movement force based on input direction
            const moveForce = {
                x: astronautDirection.x * direction.z * speed + 
                   astronautDirection.z * direction.x * speed,
                y: 0,
                z: astronautDirection.z * direction.z * speed - 
                   astronautDirection.x * direction.x * speed
            };
            
            if (this.playerController && this.playerController.physicsManager) {
                this.playerController.physicsManager.applyForce(this.astronautBody, moveForce);
            }
        }
    }
    
    // Make the astronaut jump in direct control mode
    jumpAstronaut() {
        if (this.controlMode !== 'direct' || !this.astronautBody) return;
        
        const jumpForce = { x: 0, y: 10.0, z: 0 };
        
        if (this.playerController && this.playerController.physicsManager) {
            this.playerController.physicsManager.applyImpulse(this.astronautBody, jumpForce);
        }
    }
    
    update(deltaTime) {
        if (!this.astronaut) return;
        
        // Animate character
        this.updateAstronautAnimation(deltaTime);
        
        // Get player's position and direction from physics system
        if (this.playerController) {
            const playerPosition = this.playerController.getPosition(); // Now this returns the physics position directly
            const playerDirection = this.playerController.getDirection();
            const isMoving = this.isMoving || (this.playerController.moveForward || this.playerController.moveBackward || 
                                              this.playerController.moveLeft || this.playerController.moveRight);
            
            // Get terrain height at player position if available
            let terrainHeight = 0;
            if (this.playerController.terrainManager && typeof this.playerController.terrainManager.getTerrainHeightAt === 'function') {
                const blockX = Math.floor(playerPosition.x);
                const blockZ = Math.floor(playerPosition.z);
                const terrainHeightAtPlayer = this.playerController.terrainManager.getTerrainHeightAt(blockX, blockZ);
                
                if (terrainHeightAtPlayer !== undefined && !isNaN(terrainHeightAtPlayer)) {
                    terrainHeight = terrainHeightAtPlayer;
                    ////console.log(`ASTRONAUT-TERRAIN: Position(${blockX}, ${blockZ}), TerrainHeight=${terrainHeight.toFixed(2)}`);
                }
            }
            
            // Position the astronaut at the player's position
            // But adjust the Y position to ensure the astronaut stands on the ground
            const groundOffset = 0.9; // Offset to place feet on ground
            const feetPosition = terrainHeight + groundOffset;
            
            // Only adjust Y position to terrain height if we're close enough
            // This prevents teleporting the astronaut to terrain when player is far above
            const playerPhysicsY = playerPosition.y;
            const distanceToGround = playerPhysicsY - (terrainHeight + groundOffset + 1.8); // 1.8 is player height
            
            ////console.log(`ASTRONAUT-PHYSICS: Physics Y=${playerPhysicsY.toFixed(2)}, TerrainY=${terrainHeight.toFixed(2)}, DistanceToGround=${distanceToGround.toFixed(2)}`);
            
            this.astronaut.position.set(
                playerPosition.x,
                playerPhysicsY - groundOffset, // Position based on physics y with feet offset
                playerPosition.z
            );
            
            // Ensure the astronaut is correctly oriented (standing upright)
            this.astronaut.rotation.x = 0; // Ensure no pitch rotation
            this.astronaut.rotation.z = 0; // Ensure no roll rotation
            
            // Only log detailed position if player is moving
            if (isMoving || this.playerController.showDebugInfo) {
                ////console.log(`ASTRONAUT-POSITION: Astronaut=(${this.astronaut.position.x.toFixed(2)}, ${this.astronaut.position.y.toFixed(2)}, ${this.astronaut.position.z.toFixed(2)}), PhysicsPosition=(${playerPosition.x.toFixed(2)}, ${playerPosition.y.toFixed(2)}, ${playerPosition.z.toFixed(2)})`);
            }
            
            // Rotate astronaut to face the direction of movement when moving
            if (this.isMoving && playerDirection.lengthSq() > 0.1) {
                const targetRotation = Math.atan2(playerDirection.x, playerDirection.z);
                this.astronaut.rotation.y = targetRotation;
                
                if (isMoving) {
                    ////console.log(`ASTRONAUT-ROTATION: Rotation=${(this.astronaut.rotation.y * 180 / Math.PI).toFixed(2)} degrees`);
                }
            }
            
            // Handle camera positioning based on mode
            if (this.playerController.camera) {
                if (this.playerController.cameraMode === 'third-person') {
                    // In third-person mode, make astronaut visible
                    this.astronaut.visible = true;
                    
                    // In Roblox-style third-person, the camera orbits around the player
                    // The camera's orientation is controlled by the mouse, not by player movement
                    
                    // Calculate distance from camera to player
                    const cameraToPlayerDirection = new THREE.Vector3();
                    cameraToPlayerDirection.subVectors(this.playerController.camera.position, playerPosition).normalize();
                    
                    // Set target distance and height for camera
                    const targetDistance = this.thirdPersonDistance;
                    const targetHeight = this.thirdPersonHeight;
                    
                    // Use the camera's forward direction for positioning
                    const cameraForward = new THREE.Vector3(0, 0, -1);
                    cameraForward.applyQuaternion(this.playerController.camera.quaternion);
                    cameraForward.y = 0;
                    cameraForward.normalize();
                    
                    // Calculate orbit position
                    const orbitPosition = new THREE.Vector3();
                    orbitPosition.copy(playerPosition).addScaledVector(cameraForward, -targetDistance);
                    orbitPosition.y = playerPosition.y + targetHeight; // Set camera height
                    
                    // Apply tilt angle (look down at player)
                    const tiltOffset = new THREE.Vector3();
                    tiltOffset.copy(cameraForward).multiplyScalar(Math.sin(this.thirdPersonAngle) * targetDistance * 0.5);
                    orbitPosition.sub(tiltOffset);
                    
                    // Smooth camera transition
                    // Calculate target using the current camera quaternion (mouse control)
                    const targetOffset = new THREE.Vector3();
                    targetOffset.subVectors(orbitPosition, playerPosition);
                    this.currentCameraOffset.lerp(targetOffset, this.cameraTransitionSpeed * deltaTime);
                    
                    // Position camera
                    this.playerController.camera.position.copy(playerPosition).add(this.currentCameraOffset);
                    
                    // Look at player's head height
                    const lookAtPosition = new THREE.Vector3(
                        playerPosition.x,
                        playerPosition.y + 1.7, // Head height
                        playerPosition.z
                    );
                    
                    this.playerController.camera.lookAt(lookAtPosition);
                    
                    ////console.log(`MarsInterloper: Camera position: (${this.playerController.camera.position.x.toFixed(2)}, ${this.playerController.camera.position.y.toFixed(2)}, ${this.playerController.camera.position.z.toFixed(2)})`);
                    ////console.log(`MarsInterloper: Camera looking at: (${lookAtPosition.x.toFixed(2)}, ${lookAtPosition.y.toFixed(2)}, ${lookAtPosition.z.toFixed(2)})`);
                    
                } else if (this.playerController.cameraMode === 'first-person') {
                    // In first-person mode, astronaut should be invisible
                    this.astronaut.visible = false;
                    
                    // Camera position is handled by PlayerController.updateWithPhysics
                }
            }
        }
    }
    
    // Set the camera mode (first-person or third-person)
    setCameraMode(mode) {
        ////console.log(`MarsInterloper: CharacterManager setting camera mode to ${mode}`);
        
        if (this.astronaut) {
            if (mode === 'third-person') {
                // In third-person mode, astronaut should be visible
                this.astronaut.visible = true;
                
                // Reset camera offset when switching to third-person
                this.currentCameraOffset = new THREE.Vector3(0, this.thirdPersonHeight, this.thirdPersonDistance);
            } else {
                // In first-person mode, astronaut's head should not be visible
                // The visibility will be handled dynamically in the update method
                // when the camera is close to the astronaut
            }
        } else {
            console.warn('MarsInterloper: Cannot set camera mode - astronaut not created yet');
        }
    }
} 