import * as THREE from 'three';

/**
 * MobileControlsManager class
 * Manages touch controls for mobile devices using nipple.js
 */
export class MobileControlsManager {
    constructor(playerController) {
        this.playerController = playerController;
        this.enabled = false;
        this.joysticks = {
            movement: null,  // Left joystick for movement (WASD equivalent)
            camera: null     // Right joystick for camera control (mouse equivalent)
        };
        
        // Control sensitivity settings
        this.sensitivity = {
            yaw: 0.08,     // Horizontal camera rotation speed
            pitch: 0.06,   // Vertical camera rotation speed
            movement: 1.0  // Movement speed multiplier
        };
        
        // Track special actions
        this.longPressTimer = null;
        this.longPressThreshold = 500; // ms
        this.doubleTapTimer = null;
        this.doubleTapThreshold = 300; // ms
        this.lastTapTime = 0;
        
        // Initialize when device is detected as mobile
        this.init();
    }
    
    /**
     * Initialize mobile controls
     */
    init() {
        // Only initialize if on a mobile device
        if (this.isMobileDevice()) {
            console.log("MarsInterloper: Mobile device detected, initializing touch controls");
            this.enabled = true;
            this.createTouchControls();
            
            // Handle resize events
            window.addEventListener('resize', () => {
                this.destroyTouchControls();
                this.createTouchControls();
            });
        } else {
            console.log("MarsInterloper: Not a mobile device, touch controls disabled");
        }
    }
    
    /**
     * Check if the current device is a mobile device
     * @returns {boolean} True if device is mobile
     */
    isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
               (window.innerWidth <= 800 && window.innerHeight <= 600);
    }
    
    /**
     * Create touch control elements with nipple.js
     */
    createTouchControls() {
        // Check if nipple.js is available
        if (typeof nipplejs === 'undefined') {
            console.error("MarsInterloper: nipple.js is not loaded. Please include it in your project.");
            this.loadNippleJS();
            return;
        }
        
        // Create container for controls
        const controlsContainer = document.createElement('div');
        controlsContainer.id = 'mobile-controls';
        controlsContainer.style.position = 'fixed';
        controlsContainer.style.bottom = '0';
        controlsContainer.style.left = '0';
        controlsContainer.style.width = '100%';
        controlsContainer.style.height = '150px';
        controlsContainer.style.paddingBottom = '20px';
        controlsContainer.style.display = 'flex';
        controlsContainer.style.justifyContent = 'space-between';
        controlsContainer.style.zIndex = '1000';
        controlsContainer.style.backgroundColor = 'transparent';
        controlsContainer.style.pointerEvents = 'none'; // Container doesn't block clicks

        // Create movement joystick zone (left side)
        const movementZone = document.createElement('div');
        movementZone.id = 'movement-zone';
        movementZone.style.width = '40%';
        movementZone.style.height = '100%';
        movementZone.style.position = 'relative';
        movementZone.style.pointerEvents = 'auto'; // This element receives events

        // Add label for movement joystick
        const movementLabel = document.createElement('div');
        movementLabel.innerHTML = 'MOVE<br><span style="font-size: 0.8em; font-weight: normal;">Long-press for Jump</span>';
        movementLabel.style.position = 'absolute';
        movementLabel.style.bottom = '10px';
        movementLabel.style.width = '100%';
        movementLabel.style.textAlign = 'center';
        movementLabel.style.color = 'white';
        movementLabel.style.fontWeight = 'bold';
        movementLabel.style.textShadow = '1px 1px 2px black';
        movementLabel.style.userSelect = 'none';
        movementLabel.style.pointerEvents = 'none'; // Label doesn't block clicks
        movementZone.appendChild(movementLabel);

        // Create camera joystick zone (right side)
        const cameraZone = document.createElement('div');
        cameraZone.id = 'camera-zone';
        cameraZone.style.width = '40%';
        cameraZone.style.height = '100%';
        cameraZone.style.position = 'relative';
        cameraZone.style.pointerEvents = 'auto'; // This element receives events

        // Add label for camera joystick
        const cameraLabel = document.createElement('div');
        cameraLabel.innerHTML = 'LOOK<br><span style="font-size: 0.8em; font-weight: normal;">Rotate to Look Around</span>';
        cameraLabel.style.position = 'absolute';
        cameraLabel.style.bottom = '10px';
        cameraLabel.style.width = '100%';
        cameraLabel.style.textAlign = 'center';
        cameraLabel.style.color = 'white';
        cameraLabel.style.fontWeight = 'bold';
        cameraLabel.style.textShadow = '1px 1px 2px black';
        cameraLabel.style.userSelect = 'none';
        cameraLabel.style.pointerEvents = 'none'; // Label doesn't block clicks
        cameraZone.appendChild(cameraLabel);

        // Add zones to container
        controlsContainer.appendChild(movementZone);
        controlsContainer.appendChild(cameraZone);

        // Add to document
        document.body.appendChild(controlsContainer);

        // Create nipple joysticks
        this.createJoysticks(movementZone, cameraZone);
    }
    
    /**
     * Create nipple.js joysticks
     */
    createJoysticks(movementZone, cameraZone) {
        // Create movement joystick (left)
        this.joysticks.movement = nipplejs.create({
            zone: movementZone,
            mode: 'static',
            position: { left: '50%', top: '50%' },
            color: 'rgba(255, 100, 100, 0.8)',
            size: 100
        });

        // Create camera joystick (right)
        this.joysticks.camera = nipplejs.create({
            zone: cameraZone,
            mode: 'static',
            position: { left: '50%', top: '50%' },
            color: 'rgba(100, 100, 255, 0.8)',
            size: 100
        });

        // Add event listeners for movement joystick
        this.setupMovementJoystick();
        
        // Add event listeners for camera joystick
        this.setupCameraJoystick();
    }
    
    /**
     * Setup movement joystick events
     */
    setupMovementJoystick() {
        // Movement control (WASD equivalent)
        this.joysticks.movement.on('start', (evt) => {
            // Start long press timer for jump
            this.longPressTimer = setTimeout(() => {
                this.handleJump();
            }, this.longPressThreshold);
        });
        
        this.joysticks.movement.on('move', (evt, data) => {
            // Calculate direction vector from joystick
            const forward = -data.vector.y; // Forward is negative Y
            const right = data.vector.x;    // Right is positive X
            
            // Apply movement to player controller
            this.handleMovement(forward, right, data.distance/50); // Normalize distance
        });
        
        this.joysticks.movement.on('end', () => {
            // Clear long press timer
            if (this.longPressTimer) {
                clearTimeout(this.longPressTimer);
                this.longPressTimer = null;
            }
            
            // Stop movement
            this.handleMovement(0, 0, 0);
        });
    }
    
    /**
     * Setup camera joystick events
     */
    setupCameraJoystick() {
        // Camera control (mouse equivalent)
        this.joysticks.camera.on('start', (evt) => {
            // Removed double-tap detection code
            // Reset camera rotation state when starting touch
            this.resetCameraRotation();
        });
        
        this.joysticks.camera.on('move', (evt, data) => {
            // Apply camera rotation
            // X movement rotates camera horizontally (yaw)
            // Y movement rotates camera vertically (pitch)
            this.handleCameraLook(data.vector.x, data.vector.y, data.distance/50);
        });
        
        this.joysticks.camera.on('end', () => {
            // Stop camera movement
            this.handleCameraLook(0, 0, 0);
            // Reset rotation state after touch ends
            this.resetCameraRotation();
        });
    }
    
    /**
     * Handle movement from joystick
     */
    handleMovement(forward, right, intensity) {
        if (!this.playerController || !this.enabled) return;
        
        // Adjust movement threshold based on sensitivity
        const threshold = 0.1 / this.sensitivity.movement;
        
        // Update player controller movement flags
        this.playerController.moveForward = forward > threshold;
        this.playerController.moveBackward = forward < -threshold;
        this.playerController.moveRight = right > threshold;
        this.playerController.moveLeft = right < -threshold;
        
        // Store movement intensity for analog control if needed
        this.playerController.movementIntensity = intensity * this.sensitivity.movement;
    }
    
    /**
     * Handle jump action (long press)
     */
    handleJump() {
        if (!this.playerController || !this.enabled) return;
        
        // Trigger jump in player controller
        this.playerController.jump = true;
        
        // Visual feedback for jump
        this.showActionFeedback('JUMP!', 'movement-zone');
    }
    
    /**
     * Handle camera view toggle (double tap)
     */
    handleCameraToggle() {
        if (!this.playerController || !this.enabled) return;
        
        // Toggle camera mode
        this.playerController.toggleCameraMode();
        
        // Visual feedback for camera toggle
        this.showActionFeedback('VIEW CHANGED', 'camera-zone');
    }
    
    /**
     * Handle camera look from joystick
     */
    handleCameraLook(yaw, pitch, intensity) {
        if (!this.playerController || !this.enabled || !this.playerController.controls) return;
        
        // Apply rotation to camera
        if (yaw !== 0 || pitch !== 0) {
            // Scale factors for sensitivity
            const yawScale = this.sensitivity.yaw * intensity;  
            const pitchScale = this.sensitivity.pitch * intensity;
            
            // Get the current camera quaternion
            const camera = this.playerController.camera;
            
            // Create rotation quaternions for yaw (horizontal) and pitch (vertical)
            // Yaw: rotate around Y axis
            const yawQuat = new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0, 1, 0), -yaw * yawScale
            );
            
            // Pitch: rotate around X axis
            const pitchQuat = new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(1, 0, 0), -pitch * pitchScale
            );
            
            // Apply yaw rotation (multiply the camera's quaternion by the yaw quaternion)
            camera.quaternion.multiply(yawQuat);
            
            // Apply pitch rotation (create a temporary quaternion with the current camera quaternion,
            // then apply the pitch rotation)
            const tempQuat = camera.quaternion.clone();
            camera.quaternion.multiply(pitchQuat);
            
            // Limit pitch to avoid camera flipping by checking if the up vector is below a threshold
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
            if (up.y < 0.1) {
                // If camera is looking too far up or down, revert to previous quaternion
                camera.quaternion.copy(tempQuat);
            }
            
            // Update the PointerLockControls internal state if possible
            if (this.playerController.controls.getObject) {
                // Force update the controls object to match the camera quaternion
                this.playerController.controls.getObject().quaternion.copy(camera.quaternion);
            }
        }
    }
    
    /**
     * Show visual feedback for an action
     */
    showActionFeedback(text, zoneId) {
        const zone = document.getElementById(zoneId);
        if (!zone) return;
        
        const feedback = document.createElement('div');
        feedback.textContent = text;
        feedback.style.position = 'absolute';
        feedback.style.top = '40%';
        feedback.style.left = '50%';
        feedback.style.transform = 'translate(-50%, -50%)';
        feedback.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
        feedback.style.color = 'black';
        feedback.style.padding = '8px 12px';
        feedback.style.borderRadius = '4px';
        feedback.style.fontWeight = 'bold';
        feedback.style.pointerEvents = 'none';
        feedback.style.zIndex = '1001';
        feedback.style.opacity = '0';
        feedback.style.transition = 'opacity 0.2s ease-in-out';
        
        zone.appendChild(feedback);
        
        // Animate the feedback
        setTimeout(() => feedback.style.opacity = '1', 10);
        setTimeout(() => {
            feedback.style.opacity = '0';
            setTimeout(() => feedback.remove(), 200);
        }, 800);
    }
    
    /**
     * Load nipple.js dynamically if not available
     */
    loadNippleJS() {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/nipplejs/0.10.1/nipplejs.min.js';
        script.onload = () => {
            console.log("MarsInterloper: nipple.js loaded successfully");
            this.createTouchControls();
        };
        script.onerror = () => {
            console.error("MarsInterloper: Failed to load nipple.js");
        };
        document.head.appendChild(script);
    }
    
    /**
     * Reset camera rotation state
     * Used when switching between touch and mouse control
     */
    resetCameraRotation() {
        if (!this.playerController || !this.playerController.camera) return;
        
        // Reset any ongoing rotations to prevent conflicts
        // between touch and mouse controls
        if (this.playerController.controls && this.playerController.controls.getObject) {
            // Sync the camera quaternion with the controls object
            this.playerController.camera.quaternion.copy(
                this.playerController.controls.getObject().quaternion
            );
        }
    }
    
    /**
     * Destroy touch controls
     */
    destroyTouchControls() {
        // Destroy joysticks
        if (this.joysticks.movement) {
            this.joysticks.movement.destroy();
            this.joysticks.movement = null;
        }
        
        if (this.joysticks.camera) {
            this.joysticks.camera.destroy();
            this.joysticks.camera = null;
        }
        
        // Remove container
        const container = document.getElementById('mobile-controls');
        if (container) {
            container.remove();
        }
    }
}

export default MobileControlsManager; 