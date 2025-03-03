// This script generates a favicon.ico file for Mars Interloper
// Requires: npm install canvas to-ico

const { createCanvas } = require('canvas');
const toIco = require('to-ico');
const fs = require('fs');

// Ensure assets directory exists
if (!fs.existsSync('./web')){
    fs.mkdirSync('./web');
}

// Create a canvas for our Mars icon
const canvas = createCanvas(256, 256);
const ctx = canvas.getContext('2d');

// Background (black space)
ctx.fillStyle = '#000000';
ctx.fillRect(0, 0, 256, 256);

// Draw Mars (red planet)
ctx.fillStyle = '#c1440e';
ctx.beginPath();
ctx.arc(128, 128, 110, 0, Math.PI * 2);
ctx.fill();

// Add some crater details
ctx.fillStyle = '#a02c02';
// Crater 1
ctx.beginPath();
ctx.arc(90, 100, 25, 0, Math.PI * 2);
ctx.fill();

// Crater 2
ctx.beginPath();
ctx.arc(150, 170, 35, 0, Math.PI * 2);
ctx.fill();

// Crater 3
ctx.beginPath();
ctx.arc(180, 90, 20, 0, Math.PI * 2);
ctx.fill();

// Convert canvas to buffer
const buffer = canvas.toBuffer();

// Convert to .ico format and save
toIco(buffer).then(buf => {
    fs.writeFileSync('./web/favicon.ico', buf);
    ////console.log('favicon.ico has been created successfully');
}).catch(err => {
    console.error('Error creating favicon:', err);
}); 