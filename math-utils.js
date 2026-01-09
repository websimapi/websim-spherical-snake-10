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
    const BASE_RADIUS = 0.8; 

    const hash = (v) => {
        const dot = v.x * 12.9898 + v.y * 78.233 + v.z * 54.53;
        const sinVal = Math.sin(dot) * 43758.5453;
        return sinVal - Math.floor(sinVal);
    };

    const getNoise = (p, seed) => {
        const s = 8.0;
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
        
        // Match Shader Logic
        const scale = 0.05 + 0.95 * smoothstep(0.0, 1.0, growth);
        const depthOffset = -earthRadius * 0.9 * (1.0 - growth);
        
        // Noise for irregular coastline
        const noise = getNoise(pNorm, seed * 12.0);
        const radiusVar = 1.0 + noise * 0.25;
        const currentRadius = BASE_RADIUS * scale * radiusVar;

        const dotProd = pNorm.dot(center);
        const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dotProd)));
        
        if (angle < currentRadius) {
            hasIsland = true;
            
            const d = angle / currentRadius;
            const t = 1.0 - d;
            
            // Shape Profile: Bulky (convex)
            let profile = smoothstep(0.0, 1.0, t);
            profile = Math.pow(profile, 0.4);

            // Heights
            const topH = 3.5 * scale; 
            const botH = -2.5 * scale; 
            
            // Detail
            const pDetail = pNorm.clone().multiplyScalar(4.0);
            const detail = getNoise(pDetail, seed + 1.0) * 0.5 * scale * t;
            
            // Mix
            const baseH = botH + (topH - botH) * profile;
            const finalH = depthOffset + baseH + detail;
            
            if (h === -1000.0) {
                h = finalH;
            } else {
                h = Math.max(h, finalH);
            }
        }
    }
    
    return hasIsland ? h : -1000.0;
}