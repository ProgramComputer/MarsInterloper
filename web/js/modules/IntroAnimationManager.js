import * as THREE from 'three';

export class IntroAnimationManager {
    constructor(scene, camera, renderer) {
        // Save references to existing scene, camera, and renderer
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        
        // Create clock for animation timing
        this.clock = new THREE.Clock();
        
        // Animation properties
        this.animationDuration = 12000; // 12 seconds for the entire animation
        this.startTime = null;
        this.animationComplete = false;
        
        // Path for the astronaut animation
        this.curve = null;
        
        // Path for camera animation
        this.cameraCurve = null;
        
        // Animation elements
        this.starship = null;
        this.astronaut = null;
        this.rocks = null;
        
        // Lighting for intro scene
        this.lights = [];
        
        // Store original camera position and target to restore later
        this.originalCameraPosition = camera.position.clone();
        this.originalCameraRotation = camera.rotation.clone();
        
        // Callback to run when animation is complete
        this.onComplete = null;
        
        // Camera following option
        this.cameraFollowEnabled = true;
        
        // Bind methods
        this.animate = this.animate.bind(this);
    }
    
    init(astronautModel, onComplete, starshipModel, debug = false, enableCameraFollow = true) {
        // Save callback
        this.onComplete = onComplete;
        this.cameraFollowEnabled = enableCameraFollow;
        
        // Save starship model reference and log it
        this.starshipModel = starshipModel;
        console.log('MarsInterloper: Starship model in IntroAnimationManager:', this.starshipModel);
        
        // Setup the scene elements
        this.setupLighting();
        
        // First, load or create the astronaut (we'll use it as a reference for scale)
        this.setupAstronaut(astronautModel);
        
        // Measure the astronaut to use as a reference
        const astronautDimensions = this.getAstronautDimensions();
        console.log('MarsInterloper: Astronaut dimensions:', astronautDimensions);
        
        // Now create and position the starship relative to the astronaut's size
        this.createStarship(astronautDimensions);
        
        // Define the path for the astronaut to follow
        this.definePath();
        
        // Setup the camera path for the space-to-surface animation
        this.setupCameraPath();
        
        // Position camera for the start of the animation
        this.setupCamera();
        
        // Add Mars rocks to scene for visuals
        this.addMarsRocks();
        
        // If debug mode is enabled, visualize the path
        if (debug) {
            this.visualizeAnimationPath();
        }
        
        // Start the animation loop
        this.animate(0);
    }
    
    setupLighting() {
        // Mars environment with appropriate lighting and ground
        
        // Create a more detailed Mars ground plane
        const groundSize = 300; // Larger ground to match main game
        const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize, 32, 32);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0xAB5C2E, // Mars reddish-orange color to match main game
            roughness: 0.9,
            metalness: 0.1,
            flatShading: false
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = 0;
        ground.receiveShadow = true;
        this.scene.add(ground);
        this.ground = ground;
        
        // Ambient light - lower intensity to match Mars environment
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
        this.scene.add(ambientLight);
        this.lights.push(ambientLight);
        
        // Directional light (sun) - with Mars-appropriate color
        const directionalLight = new THREE.DirectionalLight(0xfff0dd, 1.8);
        directionalLight.position.set(50, 100, 50);
        directionalLight.castShadow = true;
        
        // Configure shadow properties
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 500;
        directionalLight.shadow.camera.left = -100;
        directionalLight.shadow.camera.right = 100;
        directionalLight.shadow.camera.top = 100;
        directionalLight.shadow.camera.bottom = -100;
        directionalLight.shadow.bias = -0.0001;
        
        this.scene.add(directionalLight);
        this.lights.push(directionalLight);
        
        // Hemisphere light for more natural Mars environmental lighting
        const hemisphereLight = new THREE.HemisphereLight(0xffffbb, 0x080820, 0.6);
        this.scene.add(hemisphereLight);
        this.lights.push(hemisphereLight);
        
        // Add Mars dust/fog
        this.scene.fog = new THREE.FogExp2(0x331100, 0.0025);
        
        // Add some Mars rocks for realism
        this.addMarsRocks();
    }
    
    addMarsRocks() {
        // Add some scattered rocks to the scene for visual interest
        const rocks = new THREE.Group();
        
        // Create 50 random rocks
        for (let i = 0; i < 50; i++) {
            // Random position within a 100m radius
            const theta = Math.random() * Math.PI * 2;
            const r = 15 + Math.random() * 85; // Keep some distance from center
            const x = r * Math.cos(theta);
            const z = r * Math.sin(theta);
            
            // Random size for the rock
            const size = 0.5 + Math.random() * 2;
            
            // Create rock with random geometry
            let rockGeometry;
            const rockType = Math.floor(Math.random() * 3);
            
            switch (rockType) {
                case 0:
                    rockGeometry = new THREE.DodecahedronGeometry(size, 0);
                    break;
                case 1:
                    rockGeometry = new THREE.OctahedronGeometry(size, 0);
                    break;
                default:
                    rockGeometry = new THREE.TetrahedronGeometry(size, 0);
            }
            
            // Apply some random noise to the geometry
            const positions = rockGeometry.attributes.position;
            for (let j = 0; j < positions.count; j++) {
                const x = positions.getX(j);
                const y = positions.getY(j);
                const z = positions.getZ(j);
                
                // Apply noise
                positions.setX(j, x + (Math.random() - 0.5) * 0.3);
                positions.setY(j, y + (Math.random() - 0.5) * 0.3);
                positions.setZ(j, z + (Math.random() - 0.5) * 0.3);
            }
            
            // Update the geometry
            rockGeometry.computeVertexNormals();
            
            // Create a material that matches Mars rocks
            const rockMaterial = new THREE.MeshStandardMaterial({
                color: new THREE.Color(
                    0.5 + Math.random() * 0.2, // Red
                    0.25 + Math.random() * 0.15, // Green
                    0.15 + Math.random() * 0.1  // Blue
                ),
                roughness: 0.8 + Math.random() * 0.2,
                metalness: 0.1 + Math.random() * 0.1
            });
            
            const rock = new THREE.Mesh(rockGeometry, rockMaterial);
            
            // Position and rotate the rock randomly
            rock.position.set(x, size * 0.5, z); // Half-buried in the ground
            rock.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );
            
            rock.castShadow = true;
            rock.receiveShadow = true;
            
            rocks.add(rock);
        }
        
        this.scene.add(rocks);
        this.rocks = rocks;
    }
    
    createStarship(astronautDimensions) {
        console.log('MarsInterloper: Creating starship with model:', 
                   this.starshipModel ? 'Model available' : 'No model available', 
                   this.starshipModel && this.starshipModel.scene ? 'Scene available' : 'No scene');
        
        // Use astronaut dimensions or defaults if not provided
        const dimensions = astronautDimensions || {
            height: 1.8,
            width: 0.6,
            doorHeight: 1.0,
            scale: 1.0
        };
        
        // Calculate starship dimensions relative to astronaut
        // A SpaceX Starship is about 50m tall, human is ~1.8m
        const starshipToHumanRatio = 28; // Ratio of starship height to human height
        const starshipHeight = dimensions.height * starshipToHumanRatio;
        
        // Position the door at a height proportional to the astronaut
        // Door should be positioned at a realistic height for the astronaut to use
        const doorHeight = dimensions.doorHeight * 1.2; // Slightly higher than astronaut's appropriate height
        
        // Calculate the appropriate Y position for the starship
        // We want the bottom of the starship to be at ground level (y=0)
        // And the door to be at the right height above the ground
        const starshipBottomY = 0;
        const starshipCenterY = starshipHeight / 2;
        const starshipY = starshipCenterY;
        
        if (this.starshipModel && this.starshipModel.scene) {
            // Use the loaded starship model
            this.starship = this.starshipModel.scene.clone();
            
            // Calculate appropriate scale based on astronaut size
            // We want the starship to be starshipToHumanRatio times taller than the astronaut
            const boundingBox = new THREE.Box3().setFromObject(this.starship);
            const size = new THREE.Vector3();
            boundingBox.getSize(size);
            const modelHeight = size.y;
            
            // Calculate scale to make the starship the right height compared to astronaut
            const targetScale = starshipHeight / modelHeight;
            console.log('MarsInterloper: Scaling starship to match astronaut. Target height:', 
                       starshipHeight, 'Current height:', modelHeight, 'Scale:', targetScale);
            
            // Scale and position the starship model appropriately
            this.starship.scale.set(targetScale, targetScale, targetScale);
            
            // Rotate to match our scene orientation - facing the animation path
            this.starship.rotation.y = Math.PI; // Rotate to face the animation path
            
            // Position the starship so it rests on the ground
            this.starship.position.set(0, starshipY, 0);
            
            // Apply shadows to all meshes in the loaded model
            this.starship.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    
                    // Improve material quality if needed
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(mat => {
                                mat.metalness = Math.min(mat.metalness || 0, 0.8);
                                mat.roughness = Math.max(mat.roughness || 0.3, 0.2);
                            });
                        } else {
                            child.material.metalness = Math.min(child.material.metalness || 0, 0.8);
                            child.material.roughness = Math.max(child.material.roughness || 0.3, 0.2);
                        }
                    }
                }
            });
            
            // Store door position for the animation path
            // For the real model, we need to approximate the door position
            this.doorPosition = new THREE.Vector3(0, doorHeight, 5);
            
            // Add a ramp from the door to the ground for a more realistic exit
            this.addExitRamp(this.doorPosition, new THREE.Vector3(0, 0, 15));
            
            // Add starship to scene
            this.scene.add(this.starship);
            
            console.log('MarsInterloper: Using loaded starship model for intro animation');
        } else {
            // Create a procedural starship proportional to the astronaut
            console.log('MarsInterloper: No starship model available, creating procedural starship based on astronaut dimensions');
            
            // Calculate procedural starship proportions based on astronaut height
            const bodyRadius = dimensions.height * 1.5;
            const bodyHeight = starshipHeight * 0.8; // Body takes up 80% of total height
            
            // Create a more detailed starship lander than just a box
            const starshipGroup = new THREE.Group();
            
            // Main body - a metallic cylinder
            const bodyGeometry = new THREE.CylinderGeometry(bodyRadius, bodyRadius, bodyHeight, 16); 
            const bodyMaterial = new THREE.MeshStandardMaterial({ 
                color: 0xCCCCCC, // Lighter color for visibility
                metalness: 0.8, 
                roughness: 0.2 
            });
            const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
            body.castShadow = true;
            body.receiveShadow = true;
            starshipGroup.add(body);
            
            // Top dome
            const domeGeometry = new THREE.SphereGeometry(bodyRadius, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
            const domeMaterial = new THREE.MeshStandardMaterial({ 
                color: 0xAAAAAA, // Lighter
                metalness: 0.7, 
                roughness: 0.3 
            });
            const dome = new THREE.Mesh(domeGeometry, domeMaterial);
            dome.position.y = bodyHeight/2; // Position on top of body
            dome.rotation.x = Math.PI;
            dome.castShadow = true;
            dome.receiveShadow = true;
            starshipGroup.add(dome);
            
            // Landing legs (4)
            const legRadius = bodyRadius * 0.1;
            const legHeight = bodyHeight * 0.3;
            const legGeometry = new THREE.CylinderGeometry(legRadius, legRadius, legHeight, 8);
            const legMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x444444, 
                metalness: 0.5, 
                roughness: 0.5 
            });
            
            const angles = [0, Math.PI/2, Math.PI, Math.PI*1.5];
            angles.forEach(angle => {
                const leg = new THREE.Mesh(legGeometry, legMaterial);
                leg.position.set(
                    Math.sin(angle) * bodyRadius, 
                    -bodyHeight/2 - legHeight/2, 
                    Math.cos(angle) * bodyRadius
                );
                leg.rotation.z = Math.PI/8; // Angle out a bit
                leg.rotation.y = angle;
                leg.castShadow = true;
                leg.receiveShadow = true;
                starshipGroup.add(leg);
                
                // Foot pad for each leg
                const footRadius = legRadius * 3;
                const footGeometry = new THREE.CylinderGeometry(footRadius, footRadius, legRadius, 8);
                const footMaterial = new THREE.MeshStandardMaterial({ 
                    color: 0x333333, 
                    metalness: 0.3, 
                    roughness: 0.7 
                });
                const foot = new THREE.Mesh(footGeometry, footMaterial);
                foot.position.set(
                    Math.sin(angle) * bodyRadius * 1.3, 
                    -bodyHeight/2 - legHeight, 
                    Math.cos(angle) * bodyRadius * 1.3
                );
                foot.castShadow = true;
                foot.receiveShadow = true;
                starshipGroup.add(foot);
            });
            
            // Door/exit point - positioned on the side facing the animation path
            const doorWidth = dimensions.width * 1.3; // Wider than astronaut
            const doorHeight = dimensions.height * 1.2; // Taller than astronaut
            const doorDepth = dimensions.width * 0.2;
            const doorGeometry = new THREE.BoxGeometry(doorWidth, doorHeight, doorDepth);
            const doorMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x333333, 
                metalness: 0.6, 
                roughness: 0.4 
            });
            const door = new THREE.Mesh(doorGeometry, doorMaterial);
            
            // Position door at appropriate height for astronaut
            const doorPositionY = -bodyHeight/2 + astronautDimensions.doorHeight;
            door.position.set(0, doorPositionY, bodyRadius);
            door.castShadow = true;
            door.receiveShadow = true;
            starshipGroup.add(door);
            
            // Store door position for the animation path
            this.doorPosition = new THREE.Vector3(0, doorPositionY + starshipY, bodyRadius);
            
            // Add a ramp from the door to the ground for a more realistic exit
            this.addExitRamp(this.doorPosition, new THREE.Vector3(0, 0, 15));
            
            // Position the starship so it rests on the ground
            starshipGroup.position.set(0, starshipY, 0);
            
            // Add starship to scene
            this.starship = starshipGroup;
            this.scene.add(this.starship);
            
            console.log('MarsInterloper: Using procedural starship model for intro animation');
        }
        
        // Add a bright highlight to make the starship more visible
        const highlightLight = new THREE.PointLight(0xFFFFFF, 5, 50);
        highlightLight.position.set(0, starshipHeight/2, 0);
        this.scene.add(highlightLight);
        this.lights.push(highlightLight);
    }
    
    setupAstronaut(astronautModel) {
        if (astronautModel && astronautModel.scene) {
            // Use the loaded astronaut model
            this.astronaut = astronautModel.scene.clone();
            
            // Apply proper scaling and adjustments
            this.astronaut.scale.set(1, 1, 1);
            
            // Ensure all meshes have shadows enabled
            this.astronaut.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    
                    // Ensure materials look good
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(mat => {
                                // Improve material quality
                                mat.metalness = Math.min(mat.metalness || 0, 0.7);
                                mat.roughness = Math.max(mat.roughness || 0.3, 0.3);
                            });
                        } else {
                            child.material.metalness = Math.min(child.material.metalness || 0, 0.7);
                            child.material.roughness = Math.max(child.material.roughness || 0.3, 0.3);
                        }
                    }
                }
            });
            
            console.log('MarsInterloper: Using loaded astronaut model for intro animation');
        } else {
            // Create a simple placeholder astronaut if the model isn't available
            const astronautGroup = new THREE.Group();
            
            // Simple astronaut body
            const bodyGeometry = new THREE.CylinderGeometry(0.5, 0.5, 2, 8);
            const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xFFFFFF });
            const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
            body.position.y = 1;
            astronautGroup.add(body);
            
            // Head
            const headGeometry = new THREE.SphereGeometry(0.5, 16, 16);
            const headMaterial = new THREE.MeshStandardMaterial({ color: 0xFFFFFF });
            const head = new THREE.Mesh(headGeometry, headMaterial);
            head.position.y = 2.5;
            astronautGroup.add(head);
            
            // Visor
            const visorGeometry = new THREE.SphereGeometry(0.4, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
            const visorMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x000088, 
                metalness: 0.8, 
                roughness: 0.2 
            });
            const visor = new THREE.Mesh(visorGeometry, visorMaterial);
            visor.rotation.x = Math.PI * 0.5;
            visor.position.y = 2.5;
            visor.position.z = 0.2;
            astronautGroup.add(visor);
            
            this.astronaut = astronautGroup;
            console.log('MarsInterloper: Using procedural astronaut model for intro animation');
        }
        
        // Start position - will be animated along the path
        // Let the definePath method handle the precise position
    }
    
    definePath() {
        // Use the door position that was calculated in createStarship
        const doorPosition = this.doorPosition || new THREE.Vector3(0, 5, 5);
        
        console.log('MarsInterloper: Creating astronaut path starting from door position:', doorPosition);
        
        // Get the ground height at the end point (usually 0)
        const groundHeight = 0;
        
        // Create a path that starts at the door and gradually descends to the ground
        const points = [
            doorPosition,                                               // Start at the door
            new THREE.Vector3(doorPosition.x, doorPosition.y * 0.8, doorPosition.z + 3),   // Step out from the ship
            new THREE.Vector3(doorPosition.x, doorPosition.y * 0.4, doorPosition.z + 7),   // Moving down the ramp
            new THREE.Vector3(doorPosition.x + 5, groundHeight, doorPosition.z + 10),      // Reaching the ground
            new THREE.Vector3(doorPosition.x + 10, groundHeight, doorPosition.z + 13),     // Moving away on the ground
            new THREE.Vector3(doorPosition.x + 15, groundHeight, doorPosition.z + 13),     // Continuing to explore
            new THREE.Vector3(doorPosition.x + 20, groundHeight, doorPosition.z + 10),     // Final position
        ];
        
        this.curve = new THREE.CatmullRomCurve3(points);
        
        // Position the astronaut at the start point (doorway of the starship)
        if (this.astronaut) {
            // Set initial position to the first point on the path (the doorway)
            this.astronaut.position.copy(doorPosition);
            
            // Rotate the astronaut to face outward from the ship
            this.astronaut.lookAt(points[1]);
            
            // Add astronaut to scene now that it's properly positioned
            this.scene.add(this.astronaut);
            
            console.log('MarsInterloper: Positioned astronaut at starship door for animation');
        } else {
            console.warn('MarsInterloper: Astronaut model not available for animation');
        }
    }
    
    setupCamera() {
        // Position camera at the start of the space-to-surface animation path
        if (this.cameraCurve) {
            // Get the first point on the camera path
            const startPosition = this.cameraCurve.getPointAt(0);
            this.camera.position.copy(startPosition);
            
            // Look at the position where the starship is
            this.camera.lookAt(0, 15, 0);
            
            console.log('MarsInterloper: Positioned camera for space-to-surface animation');
        } else {
            // Fallback to static camera if no curve is defined
            this.camera.position.set(100, 100, 100);
            this.camera.lookAt(0, 15, 0);
            console.log('MarsInterloper: Using fallback camera position');
        }
    }
    
    // Dynamic camera that follows the astronaut during animation
    updateCamera(progress) {
        if (!this.camera || !this.cameraFollowEnabled) return;
        
        // Only start moving the camera once the astronaut has left the ship
        if (progress > 0.2) {
            // Calculate a good position to view the astronaut from
            // As the astronaut moves forward, the camera gradually follows
            const targetPosition = this.curve.getPointAt(Math.max(0, progress - 0.2));
            
            // Offset the camera to view from behind and above
            const cameraOffset = new THREE.Vector3(15, 10, 15);
            
            // Smoothly move the camera
            this.camera.position.lerp(new THREE.Vector3(
                targetPosition.x + cameraOffset.x,
                targetPosition.y + cameraOffset.y,
                targetPosition.z + cameraOffset.z
            ), 0.02); // Smooth transition speed
            
            // Make the camera look ahead on the path
            const lookAtPosition = this.curve.getPointAt(Math.min(progress + 0.1, 1));
            this.camera.lookAt(lookAtPosition);
        }
    }
    
    animate(time) {
        if (this.animationComplete) return;
        
        requestAnimationFrame(this.animate.bind(this));
        
        if (!this.startTime) {
            this.startTime = time;
        }
        
        // Calculate how far we are through the animation (0 to 1)
        const elapsed = time - this.startTime;
        let t = elapsed / this.animationDuration;
        
        // If animation is complete
        if (t >= 1) {
            t = 1;
            this.animationComplete = true;
            
            if (this.onComplete) {
                setTimeout(() => this.onComplete(), 500);
            }
        }
        
        // Create a smoother motion with easing
        const easedT = this.easeInOutQuad(t);
        
        // First half of the animation: camera moves along its path
        if (t < 0.5) {
            // Normalize t to 0-1 for the camera path
            const cameraT = t * 2; // Scale to 0-1 during first half
            
            if (this.cameraCurve) {
                // Get position along the camera curve
                const cameraPosition = this.cameraCurve.getPointAt(cameraT);
                this.camera.position.copy(cameraPosition);
                
                // During the first half, look at the starship
                this.camera.lookAt(0, 15, 0);
                
                // Keep astronaut at starting position until camera intro finishes
                if (this.astronaut && this.curve) {
                    const startPoint = this.curve.getPointAt(0);
                    this.astronaut.position.copy(startPoint);
                }
            }
        } 
        // Second half: astronaut moves and camera follows if enabled
        else {
            // Normalize t to 0-1 for the astronaut animation
            const astronautT = (t - 0.5) * 2; // Scale to 0-1 during second half
            const easedAstronautT = this.easeInOutQuad(astronautT);
            
            if (this.astronaut && this.curve) {
                // Get position along the curve
                const position = this.curve.getPointAt(easedAstronautT);
                this.astronaut.position.copy(position);
                
                // Get direction along path for orientation
                const tangent = this.curve.getTangentAt(easedAstronautT);
                
                // Orient astronaut along path
                if (tangent.x !== 0 || tangent.z !== 0) {
                    const angle = Math.atan2(tangent.x, tangent.z);
                    this.astronaut.rotation.y = angle;
                }
                
                // Call the updateCamera method if camera following is enabled
                if (this.cameraFollowEnabled) {
                    this.updateCamera(easedAstronautT);
                }
            }
        }
        
        // Render the scene
        this.renderer.render(this.scene, this.camera);
    }
    
    // Easing function for smoother animation
    easeInOutQuad(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }
    
    // Clean up method to remove objects when done
    cleanup(removeStarship = true) {
        // Remove starship from scene only if removeStarship is true
        if (this.starship && removeStarship) {
            this.scene.remove(this.starship);
            this.starship = null;
            console.log('MarsInterloper: Removed starship during cleanup');
        } else if (this.starship) {
            // IMPORTANT: Don't remove from scene and don't set to null
            // Just log that we're preserving it
            console.log('MarsInterloper: Preserved starship during cleanup at position:', 
                `(${this.starship.position.x.toFixed(2)}, ${this.starship.position.y.toFixed(2)}, ${this.starship.position.z.toFixed(2)})`);
        }
        
        // Remove astronaut from scene
        if (this.astronaut) {
            this.scene.remove(this.astronaut);
            this.astronaut = null;
        }
        
        // Remove rocks from scene
        if (this.rocks) {
            this.scene.remove(this.rocks);
            this.rocks = null;
        }
        
        // Remove ground from scene
        if (this.ground) {
            this.scene.remove(this.ground);
            this.ground = null;
        }
        
        // Remove exit ramps from scene
        if (this.ramps && this.ramps.length > 0) {
            this.ramps.forEach(ramp => {
                if (ramp) {
                    this.scene.remove(ramp);
                }
            });
            this.ramps = [];
        }
        
        // Remove lights from scene
        if (this.lights && this.lights.length > 0) {
            this.lights.forEach(light => {
                if (light) {
                    this.scene.remove(light);
                }
            });
            this.lights = [];
        }
        
        // Remove fog from scene
        if (this.scene.fog) {
            this.scene.fog = null;
        }
        
        // Reset camera to original position
        if (this.originalCameraPosition && this.originalCameraRotation) {
            this.camera.position.copy(this.originalCameraPosition);
            this.camera.rotation.copy(this.originalCameraRotation);
        }
        
        // Reset animation state
        this.animationComplete = false;
        this.startTime = null;
        this.curve = null;
        this.cameraCurve = null;
        
        console.log('MarsInterloper: Intro animation cleaned up');
    }
    
    // Add a debug visualization of the animation path (optional)
    visualizeAnimationPath() {
        // Create a visual representation of the path
        if (this.curve) {
            // Create a line showing the animation path
            const points = this.curve.getPoints(50);
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({ color: 0xffff00 });
            const pathLine = new THREE.Line(geometry, material);
            this.scene.add(pathLine);
            
            // Add a visual marker at the door position (first point)
            const doorMarkerGeometry = new THREE.SphereGeometry(0.3, 16, 16);
            const doorMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
            const doorMarker = new THREE.Mesh(doorMarkerGeometry, doorMarkerMaterial);
            doorMarker.position.copy(points[0]);
            this.scene.add(doorMarker);
            
            console.log('MarsInterloper: Added debug visualization of animation path');
        }
    }
    
    // Create the camera animation path for the intro sequence
    setupCameraPath() {
        // Get the door position for reference
        const doorPosition = this.doorPosition || new THREE.Vector3(0, 5, 5);
        
        // Calculate camera path based on starship dimensions
        // If we have a starship, measure its height
        let starshipHeight = 50; // Default height
        let starshipRadius = 5;  // Default radius
        let starshipCenter = new THREE.Vector3(0, starshipHeight/2, 0);
        
        if (this.starship) {
            const boundingBox = new THREE.Box3().setFromObject(this.starship);
            const size = new THREE.Vector3();
            boundingBox.getSize(size);
            starshipHeight = size.y;
            starshipRadius = Math.max(size.x, size.z) / 2;
            
            // Get the center of the starship
            const center = new THREE.Vector3();
            boundingBox.getCenter(center);
            starshipCenter = center;
        }
        
        console.log('MarsInterloper: Measured starship height:', starshipHeight, 'radius:', starshipRadius);
        
        // Define a series of points for the camera to follow
        // Starting from far away (space view) and zooming in
        const cameraPoints = [
            new THREE.Vector3(starshipHeight * 10, starshipHeight * 10, starshipHeight * 10),    // Space view - very far out
            new THREE.Vector3(starshipHeight * 4, starshipHeight * 4, starshipHeight * 4),       // Starting to approach Mars
            new THREE.Vector3(starshipHeight * 2, starshipHeight * 2, starshipHeight * 2),       // Getting closer
            new THREE.Vector3(starshipHeight * 1.6, starshipHeight * 1.2, starshipHeight * 1.6), // Starting to circle
            new THREE.Vector3(starshipHeight * 1.2, starshipHeight, starshipHeight * 0.8),       // Side view of starship
            new THREE.Vector3(0, starshipHeight, starshipHeight * 1.2),                          // Front view of starship
            new THREE.Vector3(-starshipHeight * 0.8, starshipHeight * 0.8, starshipHeight * 0.8),// Continue circling
            new THREE.Vector3(-starshipHeight * 0.6, starshipHeight * 0.6, -starshipHeight * 0.6),// Another angle
            new THREE.Vector3(doorPosition.x + starshipHeight * 0.8, starshipHeight * 0.5, doorPosition.z + starshipHeight * 0.8) // Final position to view door
        ];
        
        // Create a smooth camera path through these points
        this.cameraCurve = new THREE.CatmullRomCurve3(cameraPoints);
        
        console.log('MarsInterloper: Camera path for space-to-surface animation created with', cameraPoints.length, 'points');
    }
    
    addExitRamp(start, end) {
        // Create a ramp from the starship door to the ground
        const rampLength = new THREE.Vector3().subVectors(end, start).length();
        const rampDirection = new THREE.Vector3().subVectors(end, start).normalize();
        
        // Create a ramp geometry (flat plane)
        const rampWidth = 2; // Width of the ramp
        const rampGeometry = new THREE.PlaneGeometry(rampWidth, rampLength);
        const rampMaterial = new THREE.MeshStandardMaterial({
            color: 0x888888,
            metalness: 0.6,
            roughness: 0.4,
            side: THREE.DoubleSide
        });
        
        const ramp = new THREE.Mesh(rampGeometry, rampMaterial);
        ramp.castShadow = true;
        ramp.receiveShadow = true;
        
        // Position the ramp between start and end points
        const midPoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
        ramp.position.copy(midPoint);
        
        // Orient the ramp to point from start to end
        // First, we need to rotate the plane from its default orientation
        ramp.rotation.x = Math.PI / 2; // First rotate it flat
        
        // Then rotate to match the angle of the ramp
        const angle = Math.atan2(start.y - end.y, Math.sqrt(Math.pow(start.z - end.z, 2) + Math.pow(start.x - end.x, 2)));
        ramp.rotation.x += angle;
        
        // Rotate around Y to face the correct direction
        const yAngle = Math.atan2(end.x - start.x, end.z - start.z);
        ramp.rotation.y = yAngle;
        
        // Add the ramp to the scene
        this.scene.add(ramp);
        
        // Store the ramp reference for cleanup
        if (!this.ramps) this.ramps = [];
        this.ramps.push(ramp);
        
        console.log('MarsInterloper: Added exit ramp from starship to ground');
    }
    
    getAstronautDimensions() {
        // If no astronaut is available, return default human dimensions
        if (!this.astronaut) {
            console.warn('MarsInterloper: No astronaut model available for reference. Using defaults.');
            return {
                height: 1.8,       // Default human height in meters
                width: 0.6,        // Default human width in meters
                doorHeight: 1.0,   // Default height from ground where the door should be
                scale: 1.0         // Default scale factor
            };
        }
        
        // Compute the bounding box to get accurate dimensions
        const boundingBox = new THREE.Box3().setFromObject(this.astronaut);
        const size = new THREE.Vector3();
        boundingBox.getSize(size);
        
        // Determine the astronaut's height, width, and depth
        const height = size.y;
        const width = Math.max(size.x, size.z);
        
        console.log('MarsInterloper: Measured astronaut height:', height, 'width:', width);
        
        // Use a reasonable door height based on astronaut height
        // For a 1.8m tall astronaut, door should be around 1m from ground
        // Scale proportionally for different astronaut heights
        const doorHeightRatio = 0.55; // Ratio of astronaut height for door position
        const doorHeight = height * doorHeightRatio;
        
        // Determine if the model needs scaling adjustment
        // A typical astronaut should be around 1.8-2m tall
        const targetHeight = 1.8;
        const scale = this.astronaut.scale.y * (targetHeight / height);
        
        return {
            height: height,
            width: width,
            doorHeight: doorHeight,
            scale: scale
        };
    }
} 