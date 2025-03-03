import * as THREE from 'three';

export class TaskManager {
    constructor(scene, playerController, terrainManager) {
        this.scene = scene;
        this.playerController = playerController;
        this.terrainManager = terrainManager;
        
        // Mars landmarks data with game coordinates
        // Format: { name, latitude, longitude, description, radius }
        this.landmarks = [
            {
                name: "Jezero Crater",
                latitude: 18.4446,
                longitude: 77.4509,
                description: "Landing site of the Perseverance rover, contains ancient river delta.",
                radius: 100 // Game units radius for detection
            },
            {
                name: "Olympus Mons",
                latitude: 18.65,
                longitude: 226.2,
                description: "The largest volcano in the solar system.",
                radius: 150
            },
            {
                name: "Valles Marineris",
                latitude: -14.0,
                longitude: 301.0,
                description: "A vast canyon system that runs along the Martian equator.",
                radius: 100
            },
            {
                name: "Gale Crater",
                latitude: -5.4,
                longitude: 137.8,
                description: "Landing site of the Curiosity rover, contains Mount Sharp.",
                radius: 80
            },
            {
                name: "Utopia Planitia",
                latitude: 49.4,
                longitude: 118.2,
                description: "Large plain where Viking 2 landed.",
                radius: 120
            },
            {
                name: "Syrtis Major",
                latitude: 8.4,
                longitude: 69.5,
                description: "Dark volcanic region, one of the first features observed by telescope.",
                radius: 90
            },
            {
                name: "Arabia Terra",
                latitude: 20.0,
                longitude: 40.0,
                description: "Heavily cratered highlands region.",
                radius: 110
            }
        ];
        
        // Current task state
        this.currentTask = null;
        this.taskCompleted = false;
        
        // UI elements
        this.taskDisplay = null;
        this.notificationDisplay = null;
        
        // Initialize
        this.createTaskUI();
        this.assignRandomTask();
    }
    
    createTaskUI() {
        // Create task display container
        this.taskDisplay = document.createElement('div');
        this.taskDisplay.id = 'task-display';
        this.taskDisplay.style.position = 'fixed';
        this.taskDisplay.style.top = '10px';
        this.taskDisplay.style.right = '10px';
        this.taskDisplay.style.color = 'white';
        this.taskDisplay.style.background = 'rgba(0, 0, 0, 0.5)';
        this.taskDisplay.style.padding = '10px';
        this.taskDisplay.style.borderRadius = '5px';
        this.taskDisplay.style.fontFamily = 'monospace';
        this.taskDisplay.style.fontSize = '14px';
        this.taskDisplay.style.zIndex = '1000';
        this.taskDisplay.style.lineHeight = '1.5';
        this.taskDisplay.style.maxWidth = '300px';
        document.body.appendChild(this.taskDisplay);
        
        // Create notification display for task completion
        this.notificationDisplay = document.createElement('div');
        this.notificationDisplay.id = 'notification-display';
        this.notificationDisplay.style.position = 'fixed';
        this.notificationDisplay.style.top = '50%';
        this.notificationDisplay.style.left = '50%';
        this.notificationDisplay.style.transform = 'translate(-50%, -50%)';
        this.notificationDisplay.style.color = 'white';
        this.notificationDisplay.style.background = 'rgba(0, 0, 0, 0.7)';
        this.notificationDisplay.style.padding = '20px';
        this.notificationDisplay.style.borderRadius = '10px';
        this.notificationDisplay.style.fontFamily = 'sans-serif';
        this.notificationDisplay.style.fontSize = '18px';
        this.notificationDisplay.style.zIndex = '2000';
        this.notificationDisplay.style.textAlign = 'center';
        this.notificationDisplay.style.display = 'none';
        this.notificationDisplay.style.boxShadow = '0 0 20px rgba(255, 255, 255, 0.5)';
        document.body.appendChild(this.notificationDisplay);
    }
    
    assignRandomTask() {
        // Don't reassign the Jezero Crater as the first task (since player starts there)
        // After first task, any landmark can be chosen
        const availableLandmarks = this.currentTask ? 
            this.landmarks.filter(l => l.name !== this.currentTask.name) : 
            this.landmarks.filter(l => l.name !== "Jezero Crater");
            
        // Select random landmark
        const randomIndex = Math.floor(Math.random() * availableLandmarks.length);
        this.currentTask = availableLandmarks[randomIndex];
        this.taskCompleted = false;
        
        // Update UI
        this.updateTaskDisplay();
    }
    
    updateTaskDisplay() {
        if (!this.taskDisplay || !this.currentTask) return;
        
        this.taskDisplay.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 5px; font-size: 16px;">CURRENT MISSION</div>
            <div style="margin-bottom: 8px;">Travel to: <span style="color: #ffcc00;">${this.currentTask.name}</span></div>
            <div style="margin-bottom: 8px; font-style: italic; font-size: 12px;">${this.currentTask.description}</div>
            <div>Coordinates: ${this.currentTask.latitude.toFixed(2)}°N, ${this.currentTask.longitude.toFixed(2)}°E</div>
        `;
    }
    
    showNotification(message, duration = 5000) {
        if (!this.notificationDisplay) return;
        
        this.notificationDisplay.textContent = message;
        this.notificationDisplay.style.display = 'block';
        
        // Hide notification after duration
        setTimeout(() => {
            this.notificationDisplay.style.display = 'none';
        }, duration);
    }
    
    completeTask() {
        if (!this.currentTask) return;
        
        // Mark as completed and show notification
        this.taskCompleted = true;
        const completionMessage = `Mission Accomplished: ${this.currentTask.name} reached!`;
        this.showNotification(completionMessage);
        
        // Assign a new task after a delay
        setTimeout(() => {
            this.assignRandomTask();
            this.showNotification(`New Mission: Travel to ${this.currentTask.name}`);
        }, 3000);
    }
    
    update() {
        if (!this.playerController || !this.terrainManager || !this.currentTask || this.taskCompleted) return;
        
        // Get current player position
        const playerPosition = this.playerController.getPosition();
        
        // Convert current task coordinates to world position
        const targetWorldPos = this.terrainManager.marsCoordinatesToWorldPosition(
            this.currentTask.latitude,
            this.currentTask.longitude
        );
        
        if (!targetWorldPos) return;
        
        // Calculate 2D distance (ignoring height)
        const dx = targetWorldPos.x - playerPosition.x;
        const dz = targetWorldPos.z - playerPosition.z;
        const distanceToTarget = Math.sqrt(dx * dx + dz * dz);
        
        // Check if player is within the landmark radius
        if (distanceToTarget <= this.currentTask.radius) {
            this.completeTask();
        }
        
        // Update task display with distance
        if (this.taskDisplay) {
            const distanceText = distanceToTarget.toFixed(0);
            const distanceElem = document.createElement('div');
            distanceElem.style.marginTop = '8px';
            distanceElem.innerHTML = `Distance: <span style="color: ${distanceToTarget <= 200 ? '#00ff00' : 'white'};">${distanceText} units</span>`;
            
            // Only update the distance part of the display
            const existingDistanceElem = this.taskDisplay.querySelector('div:last-child');
            if (existingDistanceElem && existingDistanceElem.textContent.includes('Distance:')) {
                existingDistanceElem.replaceWith(distanceElem);
            } else {
                this.taskDisplay.appendChild(distanceElem);
            }
        }
    }
} 