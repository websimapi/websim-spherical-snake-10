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
    let h = -1000.0; // Start with a value that indicates 'no island influence'
    let hasIsland = false;

    const pNorm = pos.clone().normalize();
    const BASE_MAX_H = 1.0; 
    const BASE_RADIUS = 0.5; 

    // Match GLSL hash
    const hash = (v) => {
        const dot = v.x * 12.9898 + v.y * 78.233 + v.z * 54.53;
        const sinVal = Math.sin(dot) * 43758.5453;
        return sinVal - Math.floor(sinVal);
    };

    // Match GLSL Noise (Simple 3D sine mix)
    const getNoise = (p, seed) => {
        const s = 6.0;
        return Math.sin(p.x * s + seed) * Math.cos(p.y * s + seed) * Math.sin(p.z * s);
    };

    const smoothstep = (min, max, value) => {
        const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
        return x * x * (3 - 2 * x);
    };

    for(let i=0; i<islands.length; i++) {
        const isle = islands[i]; // { center: Vector3, progress: 0..1 }
        
        const seed = hash(isle.center);
        const rScale = 0.8 + 0.4 * seed; 
        const hScale = 0.8 + 0.4 * ((seed * 1.23) % 1); 

        const growth = isle.progress;
        
        // Add shape distortion (double layer for dynamic shape)
        const d1 = getNoise(pNorm, seed * 15.0);
        const d2 = getNoise(pNorm, seed * 30.0 + 4.0);
        const distortion = (d1 * 0.25 + d2 * 0.15);
        
        // Miniature -> Big Logic
        const sizeFactor = 0.05 + 0.95 * Math.pow(growth, 0.7); 
        const noisyRadius = BASE_RADIUS * rScale * (1.0 + distortion) * sizeFactor;

        // Calculate angular distance
        const dotProd = pNorm.dot(isle.center);
        const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dotProd)));
        
        if (angle < noisyRadius) {
            hasIsland = true;
            const d = angle / noisyRadius;
            
            // Shape: t goes 1 -> 0
            const t = 1.0 - d;
            const smoothShape = t * t * (3.0 - 2.0 * t); // Smoothstep
            const finalShape = Math.pow(smoothShape, 0.8); // Less flattened top, smoother
            
            // Rise from Core Logic
            const rise = growth * growth; 
            const depth = -earthRadius * 0.9 * (1.0 - rise);
            const shapeH = finalShape * BASE_MAX_H * hScale * sizeFactor;
            
            const islandH = depth + shapeH;
            
            // Blend islands if overlapping (take max)
            if (h === -1000.0) {
                h = islandH;
            } else {
                h = Math.max(h, islandH);
            }
        }
    }
    
    return hasIsland ? h : -1000.0;
}