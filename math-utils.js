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

// Smooth Maximum (Polynomial)
function smax(a, b, k) {
    const h = Math.max(k - Math.abs(a - b), 0.0) / k;
    return Math.max(a, b) + h * h * k * 0.25;
}

export function getIslandHeight(pos, islands, earthRadius) {
    let h = -1000.0; 
    
    // Reduced base radius to keep islands smaller relative to sphere
    // Allows for more water and distinct islands
    const BASE_RADIUS = 0.65; 
    
    const pNorm = pos.clone().normalize();

    const hash = (v) => {
        const dot = v.x * 12.9898 + v.y * 78.233 + v.z * 54.53;
        const sinVal = Math.sin(dot) * 43758.5453;
        return sinVal - Math.floor(sinVal);
    };

    // Improved noise with multiple frequencies for detail
    const getNoise = (p, seed) => {
        const s = 4.0;
        let n = Math.sin(p.x * s + seed) * Math.cos(p.y * s + seed) * Math.sin(p.z * s);
        n += 0.5 * (Math.sin(p.x * s * 2.0 + seed) * Math.cos(p.y * s * 2.0 + seed) * Math.sin(p.z * s * 2.0));
        return n * 0.66; // Normalize roughly
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
        const noise = getNoise(pNorm, seed * 10.0);
        const radiusVar = 1.0 + noise * 0.3;
        const currentRadius = BASE_RADIUS * scale * radiusVar;

        const dotProd = pNorm.dot(center);
        const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dotProd)));
        
        // Calculate raw height for this island
        // We calculate for a slightly wider range to allow soft blending at edges
        if (angle < currentRadius * 1.5) {
            const d = angle / currentRadius; // 0 (center) to 1 (edge)
            const t = Math.max(0, 1.0 - d); // 1 (center) to 0 (edge)
            
            // Profile: Smoother transition
            // Top: Flat plateau (Plains)
            const topH = 1.2 * scale * smoothstep(0.3, 0.6, t);
            
            // Bottom: Deep cone (Underside)
            const underH = -5.0 * scale * (1.0 - smoothstep(0.0, 0.4, t));
            
            // Detail
            const detail = getNoise(pNorm.clone().multiplyScalar(15.0), seed + 5.0) * 0.2 * scale * t;
            
            let finalH = depthOffset + topH + underH + detail;

            // Fade out completely at boundaries to prevent hard cuts before blending
            finalH -= (1.0 - smoothstep(0.0, 0.1, t)) * 10.0; 

            if (h === -1000.0) {
                h = finalH;
            } else {
                // Smooth blend
                h = smax(h, finalH, 0.5);
            }
        }
    }
    
    return h;
}

export function getTerrainNormal(pos, earthRadius, terrainFn) {
    const epsilon = 0.05;
    const h0 = terrainFn(pos);
    
    // Create tangent vectors
    const n = pos.clone().normalize();
    // Arbitrary tangent
    let t1 = new THREE.Vector3(0, 1, 0).cross(n);
    if (t1.lengthSq() < 0.001) t1 = new THREE.Vector3(1, 0, 0).cross(n);
    t1.normalize();
    const t2 = new THREE.Vector3().crossVectors(n, t1);
    
    // Sample nearby points
    const p1 = pos.clone().add(t1.clone().multiplyScalar(epsilon));
    const p2 = pos.clone().add(t2.clone().multiplyScalar(epsilon));
    
    const h1 = terrainFn(p1);
    const h2 = terrainFn(p2);
    
    // Compute positions on the terrain surface
    // h0 is height offset from radius
    const v0 = pos.clone().normalize().multiplyScalar(earthRadius + h0);
    const v1 = p1.normalize().multiplyScalar(earthRadius + h1);
    const v2 = p2.normalize().multiplyScalar(earthRadius + h2);
    
    // Compute normal from triangle
    const edge1 = new THREE.Vector3().subVectors(v1, v0);
    const edge2 = new THREE.Vector3().subVectors(v2, v0);
    
    const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
    return normal;
}