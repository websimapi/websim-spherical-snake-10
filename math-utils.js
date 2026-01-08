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
    const BASE_MAX_H = 1.0; 
    const BASE_RADIUS = 0.4; 

    // Simple pseudo-random hash to match shader logic
    const hash = (v) => {
        // Use absolute values to avoid negative zero issues, simple dot product hash
        const dot = v.x * 12.9898 + v.y * 78.233 + v.z * 54.53;
        const sinVal = Math.sin(dot);
        return Math.abs(sinVal * 43758.5453) % 1;
    };

    for(let i=0; i<islands.length; i++) {
        const isle = islands[i]; // { center: Vector3, progress: 0..1 }
        
        // Use center to create unique characteristics for this island
        const seed = hash(isle.center);
        const rScale = 0.8 + 0.5 * seed; // Variation in width
        const hScale = 0.6 + 0.5 * ((seed * 1.23) % 1); // Variation in height

        // Oozing effect: Grow radius and height with progress
        // Use smoothstep-like growth for progress to make it feel viscous
        const growth = isle.progress;
        
        const currentRadius = BASE_RADIUS * rScale * Math.min(1.0, growth);
        const currentMaxH = BASE_MAX_H * hScale * Math.min(1.0, growth);

        if (currentRadius <= 0.001) continue;

        const dotProd = pNorm.dot(isle.center);
        const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dotProd)));
        
        if (angle < currentRadius) {
            const d = angle / currentRadius;
            
            // Shape function: smoothstep(1, 0, d)
            // t goes from 1 (center) to 0 (edge)
            const t = 1.0 - d;
            // smoothstep formula: t * t * (3 - 2 * t)
            const smoothShape = t * t * (3.0 - 2.0 * t);
            
            // Flatten the top to make it less pointy and more land-like
            // sqrt (pow 0.5) pushes values closer to 1, widening the peak
            const finalShape = Math.pow(smoothShape, 0.5);
            
            h += finalShape * currentMaxH;
        }
    }
    return h;
}