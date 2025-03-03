import * as THREE from 'three';

export class SceneManager {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        
        this.initScene();
        this.setupResizeHandler();
        this.addLights();
    }
    
    initScene() {
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        
        // Enhanced fog for a more gradual horizon blend
        // Using exponential fog with a color that matches the terrain but darker
        this.scene.fog = new THREE.FogExp2(0x331100, 0.0025);
        
        // Create camera
        const fov = 75;
        const aspect = window.innerWidth / window.innerHeight;
        const near = 0.1;
        const far = 2000; // Increased far plane for better distance rendering
        this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
        
        // Create renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        // Add canvas to DOM
        document.getElementById('game-container').appendChild(this.renderer.domElement);
        
        ////console.log('MarsInterloper: Scene initialized');
    }
    
    setupResizeHandler() {
        window.addEventListener('resize', () => {
            this.resize(window.innerWidth, window.innerHeight);
        });
    }
    
    resize(width, height) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
    
    addLights() {
        // Ambient light - significantly brighter
        const ambientLight = new THREE.AmbientLight(0xffffff, 2.5);
        this.scene.add(ambientLight);
        
        // Directional light (sun)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
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
        
        // Hemisphere light for more natural environmental lighting
        const hemisphereLight = new THREE.HemisphereLight(0xffffbb, 0x080820, 1.0);
        this.scene.add(hemisphereLight);
        
        ////console.log('MarsInterloper: Lights added to scene');
    }
    
    render() {
        this.renderer.render(this.scene, this.camera);
    }
    
    add(object) {
        this.scene.add(object);
    }
    
    remove(object) {
        this.scene.remove(object);
    }
} 