import * as THREE from 'three';
import { FPSCounter } from './modules/FPSCounter.js';
import { StatsDisplay } from './modules/StatsDisplay.js';
import { SceneManager } from './modules/SceneManager.js';
import { TerrainManager } from './modules/TerrainManager.js';
import { SkyManager } from './modules/SkyManager.js';
import { PlayerController } from './modules/PlayerController.js';
import { AssetManager } from './modules/AssetManager.js';
import { CharacterManager } from './modules/CharacterManager.js';
import { PhysicsManager } from './modules/PhysicsManager.js';
import { MultiplayerManager } from './modules/MultiplayerManager.js';
import { IntroAnimationManager } from './modules/IntroAnimationManager.js';
import { TaskManager } from './modules/TaskManager.js';
import { MobileControlsManager } from './modules/MobileControlsManager.js';

class MarsInterloper {
    constructor() {
        //Console.log('MarsInterloper: Initializing game');
        
        // Initialize game properties
        this.running = false;
        this.clock = new THREE.Clock();
        this.deltaTime = 0;
        this.elapsedTime = 0;
        this.controlsVisible = false;
        this.controlsOverlay = null;
        
        // Mars time simulation
        this.marsTimeHours = 22; // Start at night for better star viewing
        this.marsTimeCycleDuration = 1477; // Mars day is 24h 37m (1477 minutes)
        
        // Initialize scene manager first (needed for physics)
        this.sceneManager = new SceneManager();
        
        // Initialize physics manager with scene reference
        this.physics = new PhysicsManager(this.sceneManager.scene);
        
        // Initialize managers
        this.assets = new AssetManager(this.sceneManager.scene);
        this.terrain = new TerrainManager(this.sceneManager.scene, this.assets, this.physics, { playerController: null });
        
        // Initialize SkyManager with scene and camera reference
        this.sky = new SkyManager(this.sceneManager.scene, this.sceneManager.camera);
        
        // Initialize player controller (now with physics)
        this.player = new PlayerController(
            this.sceneManager.camera, 
            this.sceneManager.renderer.domElement,
            this.terrain,
            this.physics
        );
        
        // Initialize mobile controls manager
        this.mobileControls = new MobileControlsManager(this.player);
        
        // Initialize character manager
        this.characters = new CharacterManager(this.sceneManager.scene, this.player);
        
        // Initialize multiplayer manager
        this.multiplayer = new MultiplayerManager(this.sceneManager.scene, this.player);
        
        // Initialize stats display (FPS + location)
        this.statsDisplay = new StatsDisplay(this.player, this.terrain);
        
        // Initialize intro animation manager (but don't start it yet)
        this.introAnimation = new IntroAnimationManager(
            this.sceneManager.scene,
            this.sceneManager.camera,
            this.sceneManager.renderer
        );
        
        // Task manager for landmark missions (initialized after terrain is ready)
        this.taskManager = null;
        
        // Game state
        this.showingIntroAnimation = false;
        
        // Initialize game objects container
        this.gameObjects = [];
        
        // Bind methods
        this.animate = this.animate.bind(this);
        this.resize = this.resize.bind(this);
        
        // Add key listener for controls display
        window.addEventListener('keydown', (event) => {
            // Press 'H' key to toggle controls help
            if (event.key === 'H' || event.key === 'h') {
                this.displayControlsHelp();
            }
        });
        
        // Setup event listeners
        window.addEventListener('resize', this.resize);
    }
    
    async init() {
        try {
            // Load game assets first so textures are available
            await this.assets.loadGameAssets();
            //Console.log('MarsInterloper: Assets loaded successfully');
            
            // Set the asset manager reference in the SkyManager
            this.sky.setAssetManager(this.assets);
            
            // Once assets are loaded, pass them to the multiplayer manager
            this.multiplayer.setAssetManager(this.assets);
            
            // Connect terrain manager to multiplayer for correct ground positioning
            if (this.terrain) {
                this.multiplayer.setTerrainManager(this.terrain);
                console.log('MarsInterloper: Connected terrain manager to multiplayer system for ground positioning');
            }
            
            // Initialize multiplayer connection after setting asset manager
            this.multiplayer.connect();
            
            // Initialize physics 
            await this.physics.init();
            //Console.log('MarsInterloper: Physics initialized successfully');
            
            // Initialize managers that use physics and assets
            await this.terrain.init();
            //Console.log('MarsInterloper: Terrain initialized successfully');
            
            // Connect the terrain manager to the physics system
            this.physics.setTerrainManager(this.terrain);
            //Console.log('MarsInterloper: Connected terrain to physics system');
            
            // Get the accurate terrain height at the starting position
            let startX = 0;
            let startZ = 0;
            let terrainHeight = 0;
            const playerHeight = 1.8;
            
            if (this.terrain) {
                // Sample multiple points around spawn location to find the highest terrain point
                const sampleRadius = 1.0;
                const samplePoints = [
                    [startX, startZ],
                    [startX + sampleRadius, startZ],
                    [startX - sampleRadius, startZ],
                    [startX, startZ + sampleRadius],
                    [startX, startZ - sampleRadius],
                    [startX + sampleRadius, startZ + sampleRadius],
                    [startX - sampleRadius, startZ - sampleRadius],
                    [startX + sampleRadius, startZ - sampleRadius],
                    [startX - sampleRadius, startZ + sampleRadius]
                ];
                
                // Get height at center point
                terrainHeight = this.terrain.getTerrainHeightAt(startX, startZ);
                
                // Check surrounding points for higher terrain
                for (const [x, z] of samplePoints) {
                    const height = this.terrain.getTerrainHeightAt(x, z);
                    if (height !== undefined && !isNaN(height) && height > terrainHeight) {
                        terrainHeight = height;
                    }
                }
                
                if (terrainHeight !== undefined && !isNaN(terrainHeight)) {
                    console.log(`PHYSICS-INIT: Maximum terrain height at spawn area: ${terrainHeight.toFixed(2)}`);
                } else {
                    terrainHeight = 0;
                    console.warn('PHYSICS-INIT: Could not get valid terrain height, using default height 0');
                }
            }
            
            // Add a safe buffer to ensure player doesn't spawn in the ground
            const safeBuffer = 2.0; // Generous buffer to prevent underground spawning
            
            // Force player to start safely above terrain
            const startingY = terrainHeight + playerHeight + safeBuffer;
            this.physics.dummyPlayerPosition.set(startX, startingY, startZ);
            this.physics.dummyPlayerVelocity.set(0, 0, 0); // No initial velocity
            console.log(`PHYSICS-INIT: Forced player to start above terrain: (${startX}, ${startingY.toFixed(2)}, ${startZ})`);
            console.log(`PHYSICS-INIT: Player is ${(startingY - terrainHeight).toFixed(2)} units above terrain surface`);
            
            // Initialize sky with special error handling
            try {
                //Console.log('MarsInterloper: Starting sky initialization');
                if (typeof this.sky.init !== 'function') {
                    console.error('MarsInterloper: this.sky.init is not a function!', this.sky);
                    // Create a new SkyManager instance as a fix
                    //Console.log('MarsInterloper: Re-creating SkyManager');
                    this.sky = new SkyManager(this.sceneManager.scene, this.sceneManager.camera);
                }
                
                await this.sky.init();
                
                // Get Mars coordinates from the terrain manager (default is Jezero Crater)
                const marsLat = this.terrain.marsPosition.latitude;
                const marsLon = this.terrain.marsPosition.longitude;
                
                // Load the Mars night sky data for the current position
                await this.sky.loadMarsNightSky(marsLat, marsLon, this.marsTimeHours);
                
                //Console.log('MarsInterloper: Sky initialized successfully');
            } catch (error) {
                console.error('MarsInterloper: Error initializing sky:', error);
                // Game can continue without the sky
            }
            
            // Initialize player
            this.player.physicsManager = this.physics;  // Ensure physics manager is set
            this.player.terrainManager = this.terrain;  // Ensure terrain manager is set
            await this.player.init();
            //Console.log('MarsInterloper: Player initialized successfully');
            
            // Double-check that the physics position is still correct after player init
            this.physics.dummyPlayerPosition.set(startX, startingY, startZ);
            //Console.log(`PHYSICS-INIT: Reinforced player position after init: (${startX}, ${startingY.toFixed(2)}, ${startZ})`);
            
            // Ensure physics system knows when movement is occurring 
            this.physics.isPlayerMoving = () => {
                return this.player.moveForward || this.player.moveBackward || 
                       this.player.moveLeft || this.player.moveRight;
            };
            //Console.log('MarsInterloper: Physics-player connection established');
            
            // Add the astronaut character
            try {
                // Create astronaut and link to player controller
                this.characters.playerController = this.player;  // Ensure player controller is set
                this.characters.createAstronaut(this.assets.astronautModel);
                //Console.log('MarsInterloper: Astronaut character created successfully');
                
                // Connect player controller and character manager
                this.player.setCharacterManager(this.characters);
                //Console.log('MarsInterloper: Player and character manager connected');
                
                // Ensure terrain manager is available to character manager through player controller
                if (this.player.terrainManager && !this.characters.terrainManager) {
                    this.characters.terrainManager = this.player.terrainManager;
                    //Console.log('MarsInterloper: Terrain manager linked to character manager');
                }
                
                // Initialize character physics
                this.characters.createAstronautPhysics();
                //Console.log('MarsInterloper: Astronaut physics created');
                
                // Set initial camera mode
                this.player.cameraMode = 'third-person';
                this.characters.setCameraMode(this.player.cameraMode);
                //Console.log('MarsInterloper: Initial camera mode set to third-person');
                
                // Display controls instruction
                this.displayControlsHelp();
            } catch (error) {
                console.warn('MarsInterloper: Failed to create astronaut character', error);
                // Game can continue without astronaut
            }
            
            // Create some physics objects for testing
            try {
                this.createPhysicsObjects();
            } catch (physicsError) {
                console.warn('MarsInterloper: Failed to create physics objects', physicsError);
                // Game can continue without physics objects
            }
            
            // Start game loop
            this.running = true;
            this.animate();
            
            // Instead of directly hiding loading screen, check if chunks are still loading
            if (this.terrain && this.terrain.isLoadingChunks) {
                // Update loading message to indicate terrain chunks are being loaded
                const loadingScreen = document.getElementById('loading-screen');
                if (loadingScreen) {
                    const loadingMsg = loadingScreen.querySelector('p');
                    if (loadingMsg) {
                        loadingMsg.textContent = 'Loading terrain chunks... Please wait';
                    }
                    // Start checking chunk loading status
                    this.checkChunkLoadingStatus();
                }
            } else {
                // If no chunks are loading, hide loading screen immediately
                this.hideLoadingScreen();
            }
            
            // Now set the playerController reference in terrain manager
            this.terrain.playerController = this.player;
            
            // Start intro animation and hide loading screen
            this.showIntroAnimation();
            
            // Auto-start on mobile after initialization is complete
            if (this.mobileControls && this.mobileControls.isMobileDevice()) {
                // Wait a bit for the intro to start
                setTimeout(() => {
                    this.autoStartOnMobile();
                }, 500);
            }
            
            //Console.log('MarsInterloper: Game initialized successfully');
        } catch (error) {
            console.error('MarsInterloper: Failed to initialize game', error);
            // Hide loading screen even on error
            this.hideLoadingScreen();
            
            // Show an error message to the user
            const errorDiv = document.createElement('div');
            errorDiv.style.position = 'absolute';
            errorDiv.style.top = '20px';
            errorDiv.style.left = '50%';
            errorDiv.style.transform = 'translateX(-50%)';
            errorDiv.style.padding = '10px';
            errorDiv.style.background = 'rgba(255,0,0,0.7)';
            errorDiv.style.color = 'white';
            errorDiv.style.borderRadius = '5px';
            errorDiv.innerHTML = 'Error loading Mars environment.<br>Please refresh the page to try again.';
            document.body.appendChild(errorDiv);
        }
    }
    
    createPhysicsObjects() {
        try {
            //Console.log('MarsInterloper: Creating physics test objects');
            
            // Check if physics manager is ready
            if (!this.physics) {
                console.warn('MarsInterloper: Physics manager not available');
                return;
            }
            
            // Comment out the box stack creation
            /*
            // Create a stack of boxes (visual only with simplified physics)
            const boxSize = 2;
            for (let i = 0; i < 5; i++) {
                try {
                    // PhysicsManager.createBox already adds the box to the scene
                    const box = this.physics.createBox(
                        new THREE.Vector3(10, 5 + (i * boxSize * 1.2), 0),
                        new THREE.Vector3(boxSize, boxSize, boxSize),
                        1,  // mass
                        0x22aadd // color
                    );
                    
                    if (!box) {
                        console.warn(`MarsInterloper: Box ${i} creation returned null`);
                    }
                } catch (boxError) {
                    console.error('MarsInterloper: Failed to create physics box', boxError);
                    continue;
                }
            }
            */
            
            //Console.log('MarsInterloper: Physics objects created');
        } catch (error) {
            console.error('MarsInterloper: Failed to create physics objects', error);
        }
    }
    
    setupLoadingScreenFailsafe() {
        // Safety mechanism - hide loading screen after 10 seconds no matter what
        setTimeout(() => {
            this.hideLoadingScreen();
        }, 10000);
    }
    
    hideLoadingScreen() {
        // Hide loading screen
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            // Only hide if chunks aren't actively loading
            if (!this.terrain || !this.terrain.isLoadingChunks) {
                loadingScreen.style.display = 'none';
                //Console.log('MarsInterloper: Loading screen hidden');
            } else {
                // Update loading message to show chunk loading status
                const loadingMsg = loadingScreen.querySelector('p');
                if (loadingMsg) {
                    loadingMsg.textContent = 'Loading terrain chunks... Please wait';
                }
                
                // Keep checking until chunks are done loading
                setTimeout(() => this.checkChunkLoadingStatus(), 500);
            }
        }
    }
    
    // New method to check if chunks are still loading
    checkChunkLoadingStatus() {
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen && loadingScreen.style.display !== 'none') {
            if (!this.terrain || !this.terrain.isLoadingChunks) {
                loadingScreen.style.display = 'none';
                //Console.log('MarsInterloper: Loading screen hidden after chunks loaded');
            } else {
                // Update progress bar based on chunks loading status
                const progressBar = document.getElementById('loading-progress');
                if (progressBar && this.terrain.chunksLoadedCount !== undefined && this.terrain.totalChunksToLoad !== undefined) {
                    const progress = Math.min(100, Math.round((this.terrain.chunksLoadedCount / this.terrain.totalChunksToLoad) * 100));
                    progressBar.style.width = `${progress}%`;
                }
                
                // Check again soon
                setTimeout(() => this.checkChunkLoadingStatus(), 500);
            }
        }
    }
    
    animate() {
        if (!this.running) {
            requestAnimationFrame(this.animate.bind(this));
            
            // Even if the game is not running (player hasn't clicked "Play")
            // we still need to render the scene for the intro animation
            if (this.showingIntroAnimation) {
                // The intro animation handles its own rendering
                return;
            }
            
            // Just update the sky for the menu background
            this.updateMarsTime();
            this.sky.update(this.deltaTime);
            
            // Render the scene
            this.sceneManager.render();
            return;
        }
        
        requestAnimationFrame(this.animate.bind(this));
        
        // Update time
        this.deltaTime = this.clock.getDelta();
        this.elapsedTime = this.clock.getElapsedTime();
        
        // Update Mars time - one full day/night cycle over marsTimeCycleDuration seconds
        this.marsTimeHours = (this.marsTimeHours + (this.deltaTime * 24 / this.marsTimeCycleDuration)) % 24;
        
        // Update physics world
        this.physics.update(this.deltaTime);
        
        // Update player physics
        this.player.updateWithPhysics(this.deltaTime);
        
        // Update player (after physics)
        this.player.update(this.deltaTime);
        
        // Update mobile controls (if active)
        if (this.mobileControls && this.mobileControls.enabled) {
            // The mobile controls manager doesn't need an update method
            // as it uses event listeners, but we could add one if needed
        }
        
        // Update dynamic terrain chunks based on player position
        if (this.terrain && typeof this.terrain.updateChunks === 'function') {
            const playerPosition = this.physics.dummyPlayerPosition || this.player.position;
            //Console.log(`TERRAIN-CHUNKS: Checking for chunk updates at player position (${playerPosition.x.toFixed(2)}, ${playerPosition.z.toFixed(2)})`);
            
            // Check if chunks were not loading before and are now
            const wasLoading = this.terrain.isLoadingChunks;
            
            // Update chunks
            this.terrain.updateChunks(playerPosition);
            
            // If chunks started loading, update loading screen
            if (!wasLoading && this.terrain.isLoadingChunks) {
                const loadingScreen = document.getElementById('loading-screen');
                if (loadingScreen) {
                    loadingScreen.style.display = 'block';
                    const loadingMsg = loadingScreen.querySelector('p');
                    if (loadingMsg) {
                        loadingMsg.textContent = 'Loading new terrain chunks... Please wait';
                    }
                    this.checkChunkLoadingStatus();
                }
            }
            
            // Update Mars night sky based on player position if terrain has Mars coordinates
            if (this.sky && this.terrain.marsPosition) {
                // Convert player's world position to Mars coordinates
                const marsCoords = this.terrain.worldPositionToMarsCoordinates(
                    playerPosition.x, 
                    playerPosition.z
                );
                
                // Update the sky with the new Mars position and time
                this.sky.updateForPosition(
                    marsCoords.latitude,
                    marsCoords.longitude,
                    this.marsTimeHours
                );
            }
        }
        
        // Update sky animations (Mars globe rotation, etc.)
        this.sky.update(this.deltaTime);
        
        // Update game objects
        this.updateGameObjects();
        
        // Update multiplayer
        if (this.multiplayer) {
            this.multiplayer.update(this.deltaTime, this.elapsedTime);
        }
        
        // Update task manager if initialized
        if (this.taskManager) {
            this.taskManager.update(this.deltaTime);
        } else if (this.terrain && this.terrain.loadedChunks.size > 0) {
            // Initialize task manager once terrain is loaded
            this.initTaskManager();
        }
        
        // Render scene
        this.sceneManager.render();
        
        // Update stats display
        this.statsDisplay.update();
        
        // Update terrain debug display if enabled
        if (this.terrain) {
            this.terrain.updateDebugInfo();
        }
    }
    
    updateGameObjects() {
        // Update all game objects
        for (const obj of this.gameObjects) {
            if (obj.update) {
                obj.update(this.deltaTime, this.elapsedTime);
            }
        }
    }
    
    resize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        this.sceneManager.resize(width, height);
    }
    
    stop() {
        this.running = false;
        
        // Clean up multiplayer resources
        if (this.multiplayer) {
            this.multiplayer.dispose();
        }
        
        //Console.log('MarsInterloper: Game stopped');
    }
    
    // Helper method to lock the pointer (useful for debugging)
    lockPointer() {
        if (this.player && this.player.controls) {
            try {
                // Only call this method from a user gesture event handler
                //Console.log('MarsInterloper: User requested pointer lock through API');
                this.player.lockPointer();
                return 'Attempting to lock pointer. This will only work if called from a user gesture event.';
            } catch (error) {
                console.error('MarsInterloper: Error attempting to lock pointer', error);
                return 'Error locking pointer: ' + error.message;
            }
        }
        return 'Player controls not available';
    }
    
    // Helper method to unlock the pointer (useful for debugging)
    unlockPointer() {
        if (this.player && this.player.controls) {
            try {
                //Console.log('MarsInterloper: User requested to unlock pointer through API');
                this.player.unlockPointer();
                return 'Pointer unlocked. Click on the game to re-lock.';
            } catch (error) {
                console.error('MarsInterloper: Error unlocking pointer', error);
                return 'Error unlocking pointer: ' + error.message;
            }
        }
        return 'Player controls not available';
    }
    
    // Add a method to display controls help
    displayControlsHelp() {
        try {
            //Console.log('MarsInterloper: Displaying controls help');
            
            // Check if on mobile - don't show controls help on mobile
            if (this.mobileControls && this.mobileControls.isMobileDevice()) {
                return; // Skip showing controls on mobile
            }
            
            // Toggle controls visibility
            if (this.controlsVisible && this.controlsOverlay) {
                document.body.removeChild(this.controlsOverlay);
                this.controlsVisible = false;
                return;
            }
            
            // Create a simple controls overlay
            this.controlsOverlay = document.createElement('div');
            this.controlsOverlay.style.position = 'absolute';
            this.controlsOverlay.style.bottom = '20px';
            this.controlsOverlay.style.left = '20px';
            this.controlsOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            this.controlsOverlay.style.color = 'white';
            this.controlsOverlay.style.padding = '10px';
            this.controlsOverlay.style.borderRadius = '5px';
            this.controlsOverlay.style.fontFamily = 'Arial, sans-serif';
            this.controlsOverlay.style.zIndex = '1000';
            this.controlsOverlay.style.fontSize = '14px';
            
            this.controlsOverlay.innerHTML = `
                <h3 style="margin-top: 0; margin-bottom: 10px;">Controls</h3>
                <p><b>WASD/Arrows</b>: Move</p>
                <p><b>Mouse</b>: Look around</p>
                <p><b>Space</b>: Jump/Climb objects (like the Starship)</p>
                <p><b>V</b>: Toggle camera view (First/Third Person)</p>
                <p><b>B</b>: Toggle distance to center display</p>
                <p><b>T</b>: Toggle terrain debug info</p>
                <p><b>H</b>: Toggle this controls panel</p>
                <h3 style="margin-top: 15px; margin-bottom: 10px;">Missions</h3>
                <p>Current mission details are shown in the top-right corner.</p>
            `;
            
            document.body.appendChild(this.controlsOverlay);
            this.controlsVisible = true;
        } catch (error) {
            console.warn('MarsInterloper: Failed to display controls help', error);
        }
    }
    
    // Show intro animation with starship and astronaut
    showIntroAnimation() {
        // Hide the blocker initially (so it doesn't appear during intro)
        const blocker = document.getElementById('blocker');
        if (blocker) {
            blocker.style.display = 'none';
        }
        
        // Set animation state
        this.showingIntroAnimation = true;
        
        // Initialize the intro animation with the loaded astronaut model
        // and a callback for when it completes, plus the starship model
        this.introAnimation.init(
            this.assets.getModel('astronaut'), 
            () => {
                // Animation is complete, show the "click to play" screen
                this.completeIntroAnimation();
            },
            this.assets.getModel('starship')
        );
    }
    
    // Handle completion of intro animation
    completeIntroAnimation() {
        // Save the reference to the starship model before cleanup
        const introStarship = this.introAnimation.starship;
        
        // Make sure the starship isn't removed from the scene during cleanup
        if (introStarship) {
            console.log('MarsInterloper: Preserving starship from intro animation at position', 
                `(${introStarship.position.x.toFixed(2)}, ${introStarship.position.y.toFixed(2)}, ${introStarship.position.z.toFixed(2)})`);
        }
        
        // Tell the animation manager to cleanup everything EXCEPT the starship
        this.introAnimation.cleanup(false); // Pass false to indicate not to remove the starship
        
        // Set animation state
        this.showingIntroAnimation = false;
        
        // Now add the Starship to the world from the intro animation (without changing its position)
        this.addStarshipToWorld(introStarship);
        
        // Show the "click to play" screen
        const blocker = document.getElementById('blocker');
        if (blocker) {
            blocker.style.display = 'flex';
        }
        
        // Reset camera position to the player's perspective
        this.sceneManager.camera.position.set(0, 1.7, 0);
        this.sceneManager.camera.rotation.set(0, 0, 0);
    }
    
    // Method to add the starship to the world at the correct height
    addStarshipToWorld(introStarship = null) {
        try {
            console.log('MarsInterloper: Adding starship to world');
            
            if (!introStarship) {
                console.error('MarsInterloper: Failed to add starship - intro starship not available');
                return;
            }
            
            console.log('MarsInterloper: Using starship directly from the intro animation');
            
            // IMPORTANT: Explicitly add the starship to the scene to ensure it's visible
            this.sceneManager.scene.add(introStarship);
            console.log('MarsInterloper: Explicitly added starship to scene to ensure visibility');
            
            // Add a spotlight pointing at the starship to make it more visible
            const spotLight = new THREE.SpotLight(0xffffff, 2);
            spotLight.position.set(
                introStarship.position.x, 
                introStarship.position.y + 20, 
                introStarship.position.z
            );
            spotLight.target = introStarship;
            spotLight.angle = Math.PI / 6;
            spotLight.penumbra = 0.1;
            spotLight.decay = 1;
            spotLight.distance = 50;
            spotLight.castShadow = true;
            this.sceneManager.scene.add(spotLight);
            console.log('MarsInterloper: Added spotlight to highlight starship');
            
            // Save the starship position for climbing detection (using its current position)
            this.starshipPosition = {
                x: introStarship.position.x,
                y: introStarship.position.y,
                z: introStarship.position.z
            };
            
            console.log(`MarsInterloper: Using starship at its original animation position (${introStarship.position.x.toFixed(2)}, ${introStarship.position.y.toFixed(2)}, ${introStarship.position.z.toFixed(2)})`);
            
            // Add collision properties for the starship
            if (this.physics && this.physics.createStaticBox) {
                // Parameters for the collision box (adjust based on starship dimensions)
                const width = 5;
                const height = 10;
                const depth = 5;
                
                try {
                    // Create a static collision box for the starship at its original position
                    this.physics.createStaticBox(
                        new THREE.Vector3(introStarship.position.x, introStarship.position.y, introStarship.position.z),
                        new THREE.Vector3(width/2, height/2, depth/2),
                        false,  // Make it invisible (was visible for debugging)
                        'Starship'
                    );
                    
                    console.log(`MarsInterloper: Added collision box for starship at its original position (${introStarship.position.x.toFixed(2)}, ${introStarship.position.y.toFixed(2)}, ${introStarship.position.z.toFixed(2)})`);
                } catch (error) {
                    console.error('MarsInterloper: Error creating starship collision box:', error);
                    
                    // Alternative approach - try older method if available
                    if (typeof this.physics.createBox === 'function') {
                        try {
                            console.log('MarsInterloper: Attempting to create starship collision with createBox as fallback');
                            const box = this.physics.createBox(
                                new THREE.Vector3(introStarship.position.x, introStarship.position.y, introStarship.position.z),
                                new THREE.Vector3(width, height, depth),
                                0,  // Mass of 0 for static object
                                0x888888, // Gray color - made invisible via physics.createBox
                                true,     // Is static
                                true      // Make invisible
                            );
                            
                            if (box) {
                                console.log('MarsInterloper: Created starship collision box using createBox fallback');
                            }
                        } catch (fallbackError) {
                            console.error('MarsInterloper: Fallback collision creation also failed:', fallbackError);
                        }
                    }
                }
            } else {
                console.warn('MarsInterloper: Could not create collision for starship - physics or createStaticBox method not available');
                console.log('MarsInterloper: Available physics methods:', this.physics ? Object.keys(this.physics).filter(key => typeof this.physics[key] === 'function') : 'physics not available');
            }
            
            // Debug: Count and list all objects in the scene to verify the starship is there
            let starshipFound = false;
            let objectCount = 0;
            this.sceneManager.scene.traverse((object) => {
                objectCount++;
                // Check if this might be our starship
                if (object === introStarship) {
                    starshipFound = true;
                    console.log('MarsInterloper: CONFIRMED starship is in the scene!');
                }
            });
            console.log(`MarsInterloper: Scene contains ${objectCount} objects. Starship found: ${starshipFound}`);
            
            console.log('MarsInterloper: Starship from intro animation kept in place successfully');
        } catch (error) {
            console.error('MarsInterloper: Failed to add starship to world', error);
        }
    }
    
    // Add this method to initialize the task manager after terrain is ready
    initTaskManager() {
        // Only initialize if it hasn't been initialized yet
        if (!this.taskManager && this.terrain) {
            this.taskManager = new TaskManager(
                this.sceneManager.scene,
                this.player,
                this.terrain
            );
            console.log('MarsInterloper: Task manager initialized with landmark missions');
        }
    }
    
    // Method to update Mars time for menu background
    updateMarsTime() {
        // Simple Mars time update for menu background
        if (!this.deltaTime) {
            this.deltaTime = this.clock ? this.clock.getDelta() : 0.016; // Default to 60fps if clock not started
        }
        
        // Update Mars time - one full day/night cycle over marsTimeCycleDuration seconds
        this.marsTimeHours = (this.marsTimeHours + (this.deltaTime * 24 / this.marsTimeCycleDuration)) % 24;
    }
    
    /**
     * Auto-start the game on mobile devices
     * Bypasses the "Click to Play" screen
     */
    autoStartOnMobile() {
        try {
            console.log('MarsInterloper: Auto-starting game on mobile device');
            
            // Skip intro animation if it's playing
            if (this.showingIntroAnimation && this.introAnimation) {
                // Don't actually skip the intro - we want to keep it
                // Just make sure the game starts after it finishes
                console.log('MarsInterloper: Setting up auto-start after intro animation completes');
                
                // Store reference to original callback if it exists
                const originalOnComplete = this.introAnimation.onComplete;
                
                // Set new onComplete callback
                this.introAnimation.onComplete = () => {
                    console.log('MarsInterloper: Intro animation completed, auto-starting game');
                    
                    // Call original callback if it exists
                    if (typeof originalOnComplete === 'function') {
                        originalOnComplete();
                    }
                    
                    // Auto-lock pointer and start game
                    this.player.lockPointer();
                    // Start game (set running to true)
                    this.running = true;
                };
            } else {
                console.log('MarsInterloper: No intro animation playing, auto-starting game immediately');
                // Auto-lock pointer and start game immediately
                this.player.lockPointer();
                // Start game (set running to true)
                this.running = true;
            }
        } catch (error) {
            console.error('MarsInterloper: Error auto-starting game on mobile', error);
        }
    }
}

// Start the game when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const game = new MarsInterloper();
    game.init();
    
    // Make the game accessible from the console for debugging
    window.game = game;
});

// Export the game class for possible use in other modules
export { MarsInterloper }; 