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
    let h = 0.0;
    const pNorm = pos.clone().normalize();
    const ISLAND_MAX_HEIGHT = 1.5; 
    const ISLAND_RADIUS_ANGLE = 0.3; // radians

    for(let i=0; i<islands.length; i++) {
        const isle = islands[i]; // { center: Vector3, progress: 0..1 }
        
        const dotProd = pNorm.dot(isle.center);
        // dotProd 1.0 is center, decreasing as we go out
        // We want a bump function. 
        // angle = acos(dot)
        // height = smoothstep(radius, 0, angle) * maxH * progress
        
        // simpler approximation using dot directly for performance
        // if dot > cos(radius)
        
        // Let's use cosine falloff
        // angle 0 -> 1.0
        // angle RADIUS -> 0.0
        
        const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dotProd)));
        
        if (angle < ISLAND_RADIUS_ANGLE) {
            // Normalized distance from center 0..1
            const d = angle / ISLAND_RADIUS_ANGLE; 
            // Cosine shape: (cos(d*PI) + 1) * 0.5
            const shape = (Math.cos(d * Math.PI) + 1.0) * 0.5;
            
            h += shape * ISLAND_MAX_HEIGHT * isle.progress;
        }
    }
    return h;
}