import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class AssetManager {
    constructor(scene) {
        this.scene = scene;
        
        // Initialize the loading manager first
        this.loadingManager = new THREE.LoadingManager();
        this.setupLoadingManager();
        
        // Initialize loaders with the loading manager
        this.textureLoader = new THREE.TextureLoader(this.loadingManager);
        this.gltfLoader = new GLTFLoader(this.loadingManager);
        
        this.assets = {
            textures: {},
            models: {}
        };
    }
    
    setupLoadingManager() {
        this.loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
            const progress = (itemsLoaded / itemsTotal) * 100;
            ////console.log(`Loading: ${progress.toFixed(2)}% (${itemsLoaded}/${itemsTotal})`);
            
            // Update loading UI if it exists
            const loadingProgress = document.getElementById('loading-progress');
            if (loadingProgress) {
                loadingProgress.style.width = `${progress}%`;
            }
        };
        
        this.loadingManager.onLoad = () => {
            ////console.log('MarsInterloper: All assets loaded successfully');
            
            // Hide loading screen if it exists
            const loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen) {
                loadingScreen.style.display = 'none';
            }
        };
        
        this.loadingManager.onError = (url) => {
            console.error(`MarsInterloper: Error loading ${url}`);
            
            // Still hide loading screen even on error after a short delay
            setTimeout(() => {
                const loadingScreen = document.getElementById('loading-screen');
                if (loadingScreen) {
                    loadingScreen.style.display = 'none';
                }
            }, 3000);
        };
    }
    
    loadTexture(name, path, fallbackColor = 0xff0000) {
        return new Promise((resolve) => {
            // Add an item to the loading manager's tracking
            this.loadingManager.itemStart(path);
            
            this.textureLoader.load(
                path,
                (texture) => {
                    this.assets.textures[name] = texture;
                    // Mark the item as loaded
                    this.loadingManager.itemEnd(path);
                    resolve(texture);
                },
                undefined,
                (error) => {
                    console.warn(`MarsInterloper: Failed to load texture: ${path}`, error);
                    
                    // Create a canvas texture as fallback
                    const canvas = document.createElement('canvas');
                    canvas.width = 512;
                    canvas.height = 512;
                    const context = canvas.getContext('2d');
                    
                    // Fill with fallback color
                    context.fillStyle = `#${fallbackColor.toString(16).padStart(6, '0')}`;
                    context.fillRect(0, 0, canvas.width, canvas.height);
                    
                    // Add some visual noise for texture
                    for (let x = 0; x < canvas.width; x += 4) {
                        for (let y = 0; y < canvas.height; y += 4) {
                            const value = Math.random() * 0.2 + 0.8;
                            const r = Math.floor(((fallbackColor >> 16) & 255) * value);
                            const g = Math.floor(((fallbackColor >> 8) & 255) * value);
                            const b = Math.floor((fallbackColor & 255) * value);
                            
                            context.fillStyle = `rgb(${r}, ${g}, ${b})`;
                            context.fillRect(x, y, 4, 4);
                        }
                    }
                    
                    const fallbackTexture = new THREE.CanvasTexture(canvas);
                    this.assets.textures[name] = fallbackTexture;
                    
                    // Mark the item as loaded (even though it's the fallback)
                    this.loadingManager.itemEnd(path);
                    resolve(fallbackTexture);
                }
            );
        });
    }
    
    loadModel(name, path) {
        return new Promise((resolve, reject) => {
            // Add an item to the loading manager's tracking
            this.loadingManager.itemStart(path);
            
            this.gltfLoader.load(
                path,
                (gltf) => {
                    this.assets.models[name] = gltf;
                    // Mark the item as loaded
                    this.loadingManager.itemEnd(path);
                    resolve(gltf);
                },
                undefined,
                (error) => {
                    console.error(`MarsInterloper: Failed to load model: ${path}`, error);
                    // Mark the item as errored but still "done"
                    this.loadingManager.itemError(path);
                    reject(error);
                }
            );
        });
    }
    
    getTexture(name) {
        return this.assets.textures[name];
    }
    
    getModel(name) {
        return this.assets.models[name];
    }
    
    getStarshipModel() {
        return this.assets.models['starship'];
    }
    
    
    async loadGameAssets() {
        ////console.log('MarsInterloper: Loading game assets');
        
        // Load the starship model
        try {
            await this.loadModel('starship', '/assets/spacex_starship-with_landing_legs_deployed.glb');
            ////console.log('MarsInterloper: Starship model loaded successfully');
        } catch (error) {
            console.error('MarsInterloper: Error loading starship model:', error);
        }
        
        // Load Mars color texture
        try {
            const marsTexture = await this.loadTexture('mars_color', '/assets/textures/mars/mars_color_4k.jpg', 0xc1440e);
            
            // Configure Mars texture for both globe and terrain use
            if (marsTexture) {
                // For terrain use - ensure we don't repeat the texture
                marsTexture.wrapS = THREE.ClampToEdgeWrapping;
                marsTexture.wrapT = THREE.ClampToEdgeWrapping;
                marsTexture.minFilter = THREE.LinearMipmapLinearFilter;
                marsTexture.generateMipmaps = true;
                console.log('MarsInterloper: Mars color texture configured for location-specific mapping');
            }
            
            console.log('MarsInterloper: Mars color texture loaded successfully');
        } catch (error) {
            console.error('MarsInterloper: Error loading Mars color texture:', error);
        }
        
        // Manually trigger a "complete" event if needed
        setTimeout(() => {
            if (document.getElementById('loading-screen')) {
                document.getElementById('loading-screen').style.display = 'none';
                ////console.log('MarsInterloper: Manually hiding loading screen');
            }
        }, 1000);
    }
    
    createRocks(count = 100, radius = 300) {
        const rocks = new THREE.Group();
        
        for (let i = 0; i < count; i++) {
            // Random position within radius
            const theta = Math.random() * Math.PI * 2;
            const r = Math.random() * radius;
            const x = r * Math.cos(theta);
            const z = r * Math.sin(theta);
            
            // Random size for the rock
            const size = 0.5 + Math.random() * 2.5;
            
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
            
            // Distort vertices a bit to make rocks look more natural
            const vertices = rockGeometry.attributes.position;
            for (let v = 0; v < vertices.count; v++) {
                const vx = vertices.getX(v);
                const vy = vertices.getY(v);
                const vz = vertices.getZ(v);
                
                const distortion = Math.random() * 0.2 + 0.9;
                vertices.setX(v, vx * distortion);
                vertices.setY(v, vy * distortion);
                vertices.setZ(v, vz * distortion);
            }
            rockGeometry.computeVertexNormals();
            
            // Vary the rock color slightly
            const colorVariation = Math.random() * 0.1 - 0.05;
            const red = 0.6 + colorVariation;
            const g = 0.3 + colorVariation;
            const b = 0.2 + colorVariation;
            
            const rockMaterial = new THREE.MeshStandardMaterial({
                color: new THREE.Color(red, g, b),
                roughness: 0.8,
                metalness: 0.2
            });
            
            const rock = new THREE.Mesh(rockGeometry, rockMaterial);
            
            // Position the rock on the terrain
            rock.position.set(x, 0, z);
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
        ////console.log(`MarsInterloper: Added ${count} rocks to the scene`);
        return rocks;
    }
} 