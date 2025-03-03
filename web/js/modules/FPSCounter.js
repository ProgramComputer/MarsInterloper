// FPS Counter class
export class FPSCounter {
    constructor() {
        this.fps = 0;
        this.frames = 0;
        this.lastTime = performance.now();
        
        // Create FPS display
        this.display = document.createElement('div');
        this.display.id = 'fps-counter';
        this.display.style.position = 'fixed';
        this.display.style.top = '10px';
        this.display.style.left = '10px';
        this.display.style.color = 'white';
        this.display.style.background = 'rgba(0, 0, 0, 0.5)';
        this.display.style.padding = '5px 10px';
        this.display.style.borderRadius = '5px';
        this.display.style.fontFamily = 'monospace';
        this.display.style.fontSize = '14px';
        this.display.style.zIndex = '1000';
        this.display.textContent = 'FPS: --';
        document.body.appendChild(this.display);
        
        // Start FPS update loop
        this.update();
    }
    
    update() {
        this.frames++;
        
        const currentTime = performance.now();
        const elapsedTime = currentTime - this.lastTime;
        
        // Update FPS once per second
        if (elapsedTime >= 1000) {
            this.fps = Math.round((this.frames * 1000) / elapsedTime);
            this.display.textContent = `FPS: ${this.fps}`;
            
            this.frames = 0;
            this.lastTime = currentTime;
        }
        
        requestAnimationFrame(() => this.update());
    }
} 