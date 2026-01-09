import * as THREE from 'three';

/**
 * Projects a target point onto the tangent plane of the source point on a sphere.
 * Used to determine steering direction.
 */
export function getTangentDirection(sourcePos, targetPos, sphereCenter) {
    // Normal at source position
    const normal = new THREE.Vector3().subVectors(sourcePos, sphereCenter).normalize();
    
    // Vector from source to target
    const toTarget = new THREE.Vector3().subVectors(targetPos, sourcePos);
    
    // Project toTarget onto the plane defined by normal
    // v_proj = v - (v . n) * n
    const projection = toTarget.clone().sub(normal.clone().multiplyScalar(toTarget.dot(normal)));
    
    return projection.normalize();
}

/**
 * Returns a random point on the surface of a sphere of given radius.
 */
export function getRandomPointOnSphere(radius) {
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    
    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.sin(phi) * Math.sin(theta);
    const z = radius * Math.cos(phi);
    
    return new THREE.Vector3(x, y, z);
}

/**
 * Calculates the ripple height offset at a specific position on the sphere.
 * Matches the logic in the Earth shader.
 */
export function getRippleHeight(pos, time, centers, startTimes, intensities, earthRadius = 10.0) {
    let totalRipple = 0.0;
    const pNorm = pos.clone().normalize();
    
    for(let i=0; i<5; i++) {
        const startTime = startTimes[i];
        if (startTime < 0.0) continue;
        
        const age = time - startTime;
        if (age < 0.0 || age > 2.0) continue;
        
        const center = centers[i]; 
        const cNorm = center.clone().normalize();
        
        const dotProd = pNorm.dot(cNorm);
        const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dotProd)));
        const dist = angle * earthRadius;
        
        const speed = 8.0; 
        const waveCenter = age * speed;
        const distDiff = dist - waveCenter;
        
        if (Math.abs(distDiff) < 2.0) {
            let ripple = Math.sin(distDiff * 3.0) * Math.exp(-distDiff * distDiff);
            ripple *= (1.0 - age / 2.0);
            ripple *= intensities[i];
            totalRipple += ripple;
        }
    }
    return totalRipple;
}

export function getIslandHeight(pos, islands, earthRadius) {
    let h = -1000.0; 
    let hasIsland = false;

    const pNorm = pos.clone().normalize();
    const BASE_RADIUS = 1.3; // Broader base for better beaches

    const hash = (v) => {
        const dot = v.x * 12.9898 + v.y * 78.233 + v.z * 54.53;
        const sinVal = Math.sin(dot) * 43758.5453;
        return sinVal - Math.floor(sinVal);
    };

    const getNoise = (p, seed) => {
        const s = 6.0;
        return Math.sin(p.x * s + seed) * Math.cos(p.y * s + seed) * Math.sin(p.z * s);
    };

    const smoothstep = (min, max, value) => {
        const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
        return x * x * (3 - 2 * x);
    };

    for(let i=0; i<islands.length; i++) {
        const isle = islands[i];
        const center = isle.center;
        
        const seed = hash(center);
        const growth = isle.progress;
        
        // Animation
        const scale = 0.05 + 0.95 * smoothstep(0.0, 1.0, growth);
        const depthOffset = -earthRadius * 0.9 * (1.0 - growth);
        
        // Irregular Coastline
        const noise = getNoise(pNorm, seed * 15.0);
        const radiusVar = 1.0 + noise * 0.4;
        const currentRadius = BASE_RADIUS * scale * radiusVar;

        const dotProd = pNorm.dot(center);
        const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dotProd)));
        
        if (angle < currentRadius) {
            hasIsland = true;
            
            const d = angle / currentRadius; // 0 (center) to 1 (edge)
            const t = 1.0 - d;             // 1 (center) to 0 (edge)
            
            // Profile: Plains Top + Jagged Deep Underside
            
            // Top: Flat plateau (Plains)
            // Rises from water level at t=0.45
            const topH = 1.5 * scale * smoothstep(0.45, 0.65, t);
            
            // Bottom: Deep cone (Underside)
            // Drops deep from water level at t=0.45
            const underH = -6.0 * scale * (1.0 - smoothstep(0.0, 0.45, t));
            
            // Detail
            const detail = getNoise(pNorm.clone().multiplyScalar(12.0), seed + 5.0) * 0.3 * scale;
            
            // Jaggedness on underside
            const jagged = (t < 0.5) ? (noise * 2.0 * scale) : 0.0;
            
            const finalH = depthOffset + topH + underH + detail + jagged;
            
            if (h === -1000.0) {
                h = finalH;
            } else {
                h = Math.max(h, finalH);
            }
        }
    }
    
    return hasIsland ? h : -1000.0;
}