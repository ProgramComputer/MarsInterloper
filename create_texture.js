const fs = require('fs');
const { createCanvas } = require('canvas');

// Create a canvas
const width = 1024;
const height = 1024;
const canvas = createCanvas(width, height);
const ctx = canvas.getContext('2d');

// Base color for Mars terrain
ctx.fillStyle = '#e55e2b';
ctx.fillRect(0, 0, width, height);

// Add noise/variation for terrain details
for (let x = 0; x < width; x += 4) {
    for (let y = 0; y < height; y += 4) {
        const value = Math.random() * 0.3 + 0.7; // Higher base value
        const r = Math.floor(230 * value); // Brighter red
        const g = Math.floor(95 * value);
        const b = Math.floor(30 * value);
        
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(x, y, 4, 4);
    }
}

// Add some larger features like craters and highlands
for (let i = 0; i < 20; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const radius = 20 + Math.random() * 60;
    
    // Crater or highland
    const isCrater = Math.random() > 0.5;
    
    if (isCrater) {
        // Dark crater
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, 'rgba(120, 50, 30, 0.8)');
        gradient.addColorStop(0.7, 'rgba(150, 60, 40, 0.6)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    } else {
        // Light highland
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, 'rgba(255, 150, 100, 0.8)');
        gradient.addColorStop(0.7, 'rgba(240, 130, 80, 0.6)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Save the image
const buffer = canvas.toBuffer('image/jpeg');
fs.writeFileSync('assets/textures/mars_terrain.jpg', buffer);

////console.log('Mars terrain texture generated successfully.'); 