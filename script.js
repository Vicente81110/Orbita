const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();
canvas.addEventListener('contextmenu', e => e.preventDefault());

const G = 0.1; 
const PREDICTION_STEPS = 500; 
const WORLD_LIMIT_SQ = 25000 * 25000; // Límite de despawn
const CULLING_DIST_SQ = 2000 * 2000;  // Límite para optimización gravitacional

let currentTool = 'star';
let currentSize = 15;
let bodies = [];

let isDragging = false;
let dragStartScreen = { x: 0, y: 0 };
let dragCurrentScreen = { x: 0, y: 0 };
let dragStartWorld = { x: 0, y: 0 };
let mouseWorldPos = { x: 0, y: 0 };

let camera = { x: 0, y: 0, zoom: 1 };
let isPanning = false;
let panStartScreen = { x: 0, y: 0 };
let cameraStartPan = { x: 0, y: 0 };

const keys = { w: false, a: false, s: false, d: false };
window.addEventListener('keydown', e => { if(keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', e => { if(keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = false; });
let activeRocket = null; 

const themeSelector = document.getElementById('themeSelector');
const sizeSlider = document.getElementById('sizeSlider');
const sizeVal = document.getElementById('sizeVal');

themeSelector.addEventListener('change', (e) => document.documentElement.setAttribute('data-theme', e.target.value));
sizeSlider.addEventListener('input', (e) => { currentSize = parseInt(e.target.value); sizeVal.innerText = currentSize; });
document.getElementById('btnClear').addEventListener('click', () => { bodies = []; activeRocket = null; });
document.getElementById('btnSolarSystem').addEventListener('click', loadSolarSystemTemplate);

document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentTool = e.target.getAttribute('data-type');
    });
});

function screenToWorld(x, y) {
    return {
        x: (x - canvas.width / 2) / camera.zoom + camera.x,
        y: (y - canvas.height / 2) / camera.zoom + camera.y
    };
}

class Vector {
    constructor(x, y) { this.x = x; this.y = y; }
    add(v) { this.x += v.x; this.y += v.y; }
    sub(v) { return new Vector(this.x - v.x, this.y - v.y); }
    mult(n) { this.x *= n; this.y *= n; }
    magSq() { return this.x * this.x + this.y * this.y; }
    mag() { return Math.sqrt(this.magSq()); }
    normalize() { 
        let m = this.mag(); 
        if (m !== 0) { this.x /= m; this.y /= m; }
        return this;
    }
}

class Body {
    constructor(x, y, type, radius, vx = 0, vy = 0) {
        this.pos = new Vector(x, y);
        this.vel = new Vector(vx, vy);
        this.type = type;
        this.radius = radius;
        this.markedForDeletion = false;
        this.isHovered = false;
        this.history = [];
        this.frameCount = 0;
        this.angle = 0; 

        let density = 0;
        switch(type) {
            case 'star': density = 10; this.color = '#ffcc00'; this.isStatic = true; break;
            case 'planet': density = 1; this.color = '#0066ff'; this.isStatic = false; break;
            case 'asteroid': density = 0.5; this.color = '#888888'; this.isStatic = false; break;
            case 'rocket': density = 0.2; this.isStatic = false; this.radius = 6; break; 
        }
        this.mass = density * Math.pow(this.radius, 2);
    }

    applyGravity(otherBodies) {
        if (this.isStatic) return;
        let totalForce = new Vector(0, 0);
        
        for (let other of otherBodies) {
            if (other === this || other.markedForDeletion) continue;
            let dir = other.pos.sub(this.pos);
            let distSq = dir.magSq();
            
            if (distSq < (this.radius + other.radius)**2) continue; 

            // OPTIMIZACIÓN: Ignorar la gravedad de objetos pequeños muy lejanos
            if (distSq > CULLING_DIST_SQ && other.mass < 50) continue;

            let forceMag = (G * other.mass) / distSq;
            dir.normalize().mult(forceMag);
            totalForce.add(dir);
        }
        this.vel.add(totalForce);
    }

    update() {
        if (!this.isStatic) {
            if (this === activeRocket) {
                if (keys.a) this.angle -= 0.08;
                if (keys.d) this.angle += 0.08;
                if (keys.w) {
                    let thrust = 0.1;
                    this.vel.x += Math.cos(this.angle) * thrust;
                    this.vel.y += Math.sin(this.angle) * thrust;
                }
                if (keys.s) {
                    let thrust = 0.05;
                    this.vel.x -= Math.cos(this.angle) * thrust;
                    this.vel.y -= Math.sin(this.angle) * thrust;
                }
            }

            this.pos.add(this.vel);
            
            // DESPAWN: Marcar para borrar si excede los límites del mundo
            if (this.pos.magSq() > WORLD_LIMIT_SQ) {
                this.markedForDeletion = true;
                if (this === activeRocket) activeRocket = null;
            }
            
            this.frameCount++;
            if (this.frameCount % 5 === 0) {
                this.history.push(new Vector(this.pos.x, this.pos.y));
                if (this.history.length > 80) this.history.shift();
            }
        }
    }

    draw(ctx) {
        let isLight = document.documentElement.getAttribute('data-theme') === 'light';

        if (this.history.length > 1 && !this.isStatic) {
            ctx.beginPath();
            ctx.moveTo(this.history[0].x, this.history[0].y);
            for (let i = 1; i < this.history.length; i++) ctx.lineTo(this.history[i].x, this.history[i].y);
            ctx.strokeStyle = isLight ? `rgba(0, 0, 0, 0.2)` : `rgba(255, 255, 255, 0.3)`;
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        if (this.type === 'rocket') {
            ctx.save();
            ctx.translate(this.pos.x, this.pos.y);
            ctx.rotate(this.angle);
            ctx.beginPath();
            ctx.moveTo(this.radius * 2, 0); 
            ctx.lineTo(-this.radius, this.radius);
            ctx.lineTo(-this.radius, -this.radius);
            ctx.closePath();
            
            // Corrección de visibilidad del cohete según el tema
            ctx.fillStyle = isLight ? '#222222' : '#ffffff';
            ctx.fill();

            if (this === activeRocket) {
                ctx.strokeStyle = '#00ff00';
                ctx.lineWidth = 2 / camera.zoom;
                ctx.stroke();
                if (keys.w) {
                    ctx.beginPath();
                    ctx.moveTo(-this.radius, 0);
                    ctx.lineTo(-this.radius - 15, 0);
                    ctx.strokeStyle = '#ff6600';
                    ctx.lineWidth = 3 / camera.zoom;
                    ctx.stroke();
                }
            } else if (this.isHovered) {
                ctx.strokeStyle = '#ffff00';
                ctx.lineWidth = 2 / camera.zoom;
                ctx.stroke();
            }
            ctx.restore();
            return;
        }

        ctx.beginPath();
        ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        
        ctx.strokeStyle = this.isHovered ? (currentTool === 'eraser' ? '#ff0000' : '#ffff00') : '#000';
        ctx.lineWidth = this.isHovered ? 3 / camera.zoom : 1 / camera.zoom;
        ctx.stroke();
    }
}

function handleCollisions() {
    for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
            let b1 = bodies[i];
            let b2 = bodies[j];
            if (b1.markedForDeletion || b2.markedForDeletion) continue;

            let distSq = b2.pos.sub(b1.pos).magSq();
            let minRadiusSq = Math.pow(b1.radius + b2.radius, 2);

            if (distSq <= minRadiusSq) {
                let big = b1.mass >= b2.mass ? b1 : b2;
                let small = b1.mass < b2.mass ? b1 : b2;

                if (!big.isStatic) {
                    big.vel.x = (big.mass * big.vel.x + small.mass * small.vel.x) / (big.mass + small.mass);
                    big.vel.y = (big.mass * big.vel.y + small.mass * small.vel.y) / (big.mass + small.mass);
                }

                big.mass += small.mass;
                big.radius = Math.sqrt(big.radius * big.radius + small.radius * small.radius);
                small.markedForDeletion = true;

                if (small === activeRocket) activeRocket = null; 
            }
        }
    }
    bodies = bodies.filter(b => !b.markedForDeletion);
}

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.zoom *= (e.deltaY < 0) ? 1.1 : 0.9;
    camera.zoom = Math.max(0.05, Math.min(camera.zoom, 5));
});

canvas.addEventListener('mousedown', (e) => {
    // Si hay un cohete activo, el paneo con click derecho queda deshabilitado por el seguimiento automático
    if ((e.button === 2 || e.button === 1) && !activeRocket) {
        isPanning = true;
        panStartScreen = { x: e.clientX, y: e.clientY };
        cameraStartPan = { x: camera.x, y: camera.y };
        return;
    }

    let worldPos = screenToWorld(e.clientX, e.clientY);

    if (currentTool === 'eraser' || currentTool === 'select') {
        for (let i = bodies.length - 1; i >= 0; i--) {
            let b = bodies[i];
            let distSq = Math.pow(worldPos.x - b.pos.x, 2) + Math.pow(worldPos.y - b.pos.y, 2);
            if (distSq <= Math.pow(b.radius + (5/camera.zoom), 2)) {
                if (currentTool === 'eraser') {
                    b.markedForDeletion = true;
                    if (b === activeRocket) activeRocket = null;
                }
                if (currentTool === 'select' && b.type === 'rocket') activeRocket = b;
                break; 
            }
        }
        if (currentTool === 'eraser') bodies = bodies.filter(b => !b.markedForDeletion);
        return;
    }

    isDragging = true;
    dragStartScreen = { x: e.clientX, y: e.clientY };
    dragCurrentScreen = { x: e.clientX, y: e.clientY };
    dragStartWorld = worldPos;
});

canvas.addEventListener('mousemove', (e) => {
    mouseWorldPos = screenToWorld(e.clientX, e.clientY);

    if (isPanning && !activeRocket) {
        camera.x = cameraStartPan.x - ((e.clientX - panStartScreen.x) / camera.zoom);
        camera.y = cameraStartPan.y - ((e.clientY - panStartScreen.y) / camera.zoom);
        return;
    }

    if (isDragging) dragCurrentScreen = { x: e.clientX, y: e.clientY };

    if (currentTool === 'eraser' || currentTool === 'select') {
        bodies.forEach(b => {
            let distSq = Math.pow(mouseWorldPos.x - b.pos.x, 2) + Math.pow(mouseWorldPos.y - b.pos.y, 2);
            b.isHovered = distSq <= Math.pow(b.radius + (5/camera.zoom), 2);
            if (currentTool === 'select' && b.type !== 'rocket') b.isHovered = false; 
        });
    } else {
        bodies.forEach(b => b.isHovered = false);
    }
});

canvas.addEventListener('mouseup', (e) => {
    if (e.button === 2 || e.button === 1) { isPanning = false; return; }
    if (!isDragging) return;
    isDragging = false;
    
    if (currentTool === 'star') {
        bodies.push(new Body(dragStartWorld.x, dragStartWorld.y, 'star', currentSize));
    } else if (currentTool === 'planet' || currentTool === 'asteroid' || currentTool === 'rocket') {
        let vx = (dragStartScreen.x - dragCurrentScreen.x) * 0.05 / camera.zoom;
        let vy = (dragStartScreen.y - dragCurrentScreen.y) * 0.05 / camera.zoom;
        bodies.push(new Body(dragStartWorld.x, dragStartWorld.y, currentTool, currentTool === 'rocket' ? 6 : currentSize, vx, vy));
    }
});

function drawTrajectoryPrediction() {
    if (!isDragging || currentTool === 'star' || currentTool === 'eraser' || currentTool === 'select') return;

    let vx = (dragStartScreen.x - dragCurrentScreen.x) * 0.05 / camera.zoom;
    let vy = (dragStartScreen.y - dragCurrentScreen.y) * 0.05 / camera.zoom;
    let simBody = new Body(dragStartWorld.x, dragStartWorld.y, currentTool, currentTool === 'rocket' ? 6 : currentSize, vx, vy);

    ctx.beginPath();
    ctx.moveTo(simBody.pos.x, simBody.pos.y);

    for (let i = 0; i < PREDICTION_STEPS; i++) {
        simBody.applyGravity(bodies);
        simBody.update();
        ctx.lineTo(simBody.pos.x, simBody.pos.y);
    }

    ctx.strokeStyle = document.documentElement.getAttribute('data-theme') === 'light' ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)';
    ctx.setLineDash([5 / camera.zoom, 5 / camera.zoom]);
    ctx.lineWidth = 2 / camera.zoom;
    ctx.stroke();
    ctx.setLineDash([]); 
}

function loadSolarSystemTemplate() {
    bodies = [];
    activeRocket = null;
    camera = { x: 0, y: 0, zoom: 0.5 }; 
    
    let sun = new Body(0, 0, 'star', 40);
    bodies.push(sun);

    function addPlanet(distance, radius, colorHex) {
        let velocity = Math.sqrt((G * sun.mass) / distance);
        let planet = new Body(distance, 0, 'planet', radius, 0, velocity);
        planet.color = colorHex;
        bodies.push(planet);
        return planet; // Retornamos el objeto para usarlo de referencia
    }

    addPlanet(200, 6, '#aaaaaa');  // Mercurio
    addPlanet(300, 10, '#e6b800'); // Venus
    
    // Tierra
    let earth = addPlanet(450, 11, '#0066ff'); 
    
    // Sistema Luna (Satélite de la Tierra)
    let moonDistFromEarth = 25;
    let moonRadius = 4;
    // La velocidad relativa necesaria para orbitar la masa de la Tierra
    let moonRelativeVelocity = Math.sqrt((G * earth.mass) / moonDistFromEarth);
    // Vector de velocidad total: Velocidad de la Tierra + Velocidad Orbital de la Luna
    let moon = new Body(
        earth.pos.x + moonDistFromEarth, 
        earth.pos.y, 
        'asteroid', 
        moonRadius, 
        0, 
        earth.vel.y + moonRelativeVelocity
    );
    moon.color = '#ffffff';
    bodies.push(moon);

    addPlanet(600, 8, '#ff3300');  // Marte
    addPlanet(1000, 25, '#d9a05b'); // Júpiter
}

function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Seguimiento de cámara
    if (activeRocket) {
        camera.x = activeRocket.pos.x;
        camera.y = activeRocket.pos.y;
    }

    bodies.forEach(b => b.applyGravity(bodies));
    bodies.forEach(b => b.update());
    handleCollisions();

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    bodies.forEach(b => b.draw(ctx));

    if (isDragging && (currentTool === 'planet' || currentTool === 'asteroid' || currentTool === 'rocket')) {
        ctx.beginPath();
        ctx.moveTo(dragStartWorld.x, dragStartWorld.y);
        
        let dragVectorX = (dragStartScreen.x - dragCurrentScreen.x) / camera.zoom;
        let dragVectorY = (dragStartScreen.y - dragCurrentScreen.y) / camera.zoom;
        
        ctx.lineTo(dragStartWorld.x + dragVectorX, dragStartWorld.y + dragVectorY);
        ctx.strokeStyle = document.documentElement.getAttribute('data-theme') === 'light' ? '#000' : '#fff';
        ctx.lineWidth = 1 / camera.zoom;
        ctx.stroke();
        
        drawTrajectoryPrediction();
    } else if (isDragging && currentTool === 'star') {
        ctx.beginPath();
        ctx.arc(dragStartWorld.x, dragStartWorld.y, currentSize, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 204, 0, 0.3)';
        ctx.fill();
    }

    ctx.restore(); 
    requestAnimationFrame(loop);
}

loop();