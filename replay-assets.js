import * as THREE from 'three';

const islandVertexShaderChunk = `
    varying vec3 vWorldPos;
    varying float vHeight;
    uniform vec4 uIslands[16];
    uniform float uBaseRadius;
    uniform int uLayerType; // 0 = Top, 1 = Bottom

    float hash(vec3 p) {
        return fract(sin(dot(p, vec3(12.9898, 78.233, 54.53))) * 43758.5453);
    }

    float getNoise(vec3 p, float seed) {
        float s = 4.0; 
        float n = sin(p.x * s + seed) * cos(p.y * s + seed) * sin(p.z * s);
        n += 0.5 * (sin(p.x * s * 2.0 + seed) * cos(p.y * s * 2.0 + seed) * sin(p.z * s * 2.0));
        return n * 0.66;
    }

    float smax(float a, float b, float k) {
        float h = max(k - abs(a - b), 0.0) / k;
        return max(a, b) + h * h * k * 0.25;
    }
    
    float smin(float a, float b, float k) {
        float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0);
        return mix(b, a, h) - k*h*(1.0-h);
    }

    float getIslandH(vec3 pos) {
        // Initialize with default 'no island' values
        // For Top (Max): -1000.0
        // For Bottom (Min): 0.0 (Surface level)
        float h = (uLayerType == 0) ? -1000.0 : 0.0;
        
        vec3 pNorm = normalize(pos);
        float BASE_RADIUS = 0.65; 
        
        for(int i=0; i<16; i++) {
            if(length(uIslands[i].xyz) < 0.1) continue;
            
            vec3 center = uIslands[i].xyz;
            float seed = hash(center);
            float growth = uIslands[i].w;
            
            float scale = 0.05 + 0.95 * smoothstep(0.0, 1.0, growth);
            float depthOffset = -uBaseRadius * 0.9 * (1.0 - growth);
            
            float noise = getNoise(pNorm, seed * 10.0);
            float radiusVar = 1.0 + noise * 0.3;
            float currentRadius = BASE_RADIUS * scale * radiusVar;

            float dotProd = dot(pNorm, center);
            float angle = acos(clamp(dotProd, -1.0, 1.0));
            
            if(angle < currentRadius * 1.5) {
                float d = angle / currentRadius; 
                float t = max(0.0, 1.0 - d);
                
                // Fade detail at edges for smooth coastline
                float edgeFactor = smoothstep(0.0, 0.15, t);
                float detail = getNoise(pNorm * 15.0, seed + 5.0) * 0.2 * scale * t * edgeFactor;
                float finalH = 0.0;

                if (uLayerType == 0) {
                    // TOP LAYER: Plateau / Plains
                    // Start rising from 0.05, allowing a flat/negative area for beach
                    float topH = 1.2 * scale * smoothstep(0.05, 0.6, t);
                    
                    // Slight dip at the very edge to submerge
                    topH -= 0.05 * scale * (1.0 - smoothstep(0.0, 0.1, t));

                    finalH = depthOffset + topH + detail;
                    
                    // Gentle edge containment instead of harsh cliff
                    finalH -= (1.0 - smoothstep(0.0, 0.02, t)) * 2.0;

                    if (h == -1000.0) h = finalH;
                    else h = smax(h, finalH, 0.5);
                } else {
                    // BOTTOM LAYER: Jagged underside cone
                    // Extend to full radius (t=0) to support the beach from below
                    float cone = -7.0 * scale * smoothstep(0.0, 0.9, t);
                    cone += detail * 2.0; 
                    finalH = depthOffset + cone;
                    
                    if (h == 0.0) h = finalH;
                    else h = smin(h, finalH, 0.5);
                }
            }
        }
        return h;
    }
`;

const rippleVertexShaderChunk = `
    varying vec3 vWorldPos;
    varying float vHeight;
    uniform float uBaseRadius;
`;

const rippleFragmentShaderChunk = `
    uniform float uTime;
    uniform vec3 uRippleCenters[5];
    uniform float uRippleStartTimes[5];
    uniform float uRippleIntensities[5];
    varying vec3 vWorldPos;
    varying float vHeight;

    float getRipple(int i, vec3 pos) {
        float startTime = uRippleStartTimes[i];
        if (startTime < 0.0) return 0.0;
        
        float age = uTime - startTime;
        if (age < 0.0 || age > 2.0) return 0.0;
        
        vec3 center = uRippleCenters[i];
        float intensity = uRippleIntensities[i];
        
        float dotProd = dot(normalize(pos), normalize(center));
        float angle = acos(clamp(dotProd, -1.0, 1.0));
        float dist = angle * 10.0; 
        
        float speed = 8.0; 
        float waveCenter = age * speed;
        float distDiff = dist - waveCenter;
        
        float ripple = 0.0;
        if (abs(distDiff) < 2.0) {
            ripple = sin(distDiff * 3.0) * exp(-distDiff * distDiff);
        }
        
        ripple *= (1.0 - age / 2.0);
        ripple *= intensity;
        return ripple;
    }
`;

export const createEarth = (radius, rippleUniformsRef) => {
    const earthGeo = new THREE.SphereGeometry(radius, 64, 64);
    const earthMat = new THREE.MeshStandardMaterial({
        color: 0x88ccff,
        emissive: 0x002244,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.7,
        roughness: 0.9,
        side: THREE.DoubleSide
    });

    earthMat.onBeforeCompile = (shader) => {
        const uniforms = rippleUniformsRef.current;
        shader.uniforms.uTime = uniforms.uTime;
        shader.uniforms.uRippleCenters = uniforms.uRippleCenters;
        shader.uniforms.uRippleStartTimes = uniforms.uRippleStartTimes;
        shader.uniforms.uRippleIntensities = uniforms.uRippleIntensities;
        shader.uniforms.uBaseRadius = uniforms.uBaseRadius;

        shader.vertexShader = rippleVertexShaderChunk + shader.vertexShader;
        
        shader.vertexShader = shader.vertexShader.replace(
            '#include <worldpos_vertex>',
            `#include <worldpos_vertex>
            vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );
        
        // Pure water sphere, only ripples in fragment
        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `
            vHeight = 0.0;
            vec3 n = normalize(transformed);
            vec3 transformedNew = n * uBaseRadius;
            vec4 mvPosition = viewMatrix * modelMatrix * vec4(transformedNew, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            `
        );

        shader.fragmentShader = rippleFragmentShaderChunk + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `#include <dithering_fragment>
            
            vec3 finalColor = gl_FragColor.rgb;
            
            float totalRipple = 0.0;
            for(int i=0; i<5; i++) {
                totalRipple += getRipple(i, vWorldPos);
            }
            if (abs(totalRipple) > 0.01) {
                float strength = smoothstep(0.0, 0.5, abs(totalRipple));
                vec3 rippleColor = vec3(0.8, 0.95, 1.0);
                finalColor = mix(finalColor, rippleColor, strength * 0.4);
                finalColor += rippleColor * strength * 0.2;
            }
            gl_FragColor.rgb = finalColor;
            `
        );
    };

    return new THREE.Mesh(earthGeo, earthMat);
};

export const createTerrainLayer = (radius, rippleUniformsRef, type = 'top') => {
    const geo = new THREE.SphereGeometry(radius, 128, 128); 
    const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.9,
        side: THREE.DoubleSide, 
        flatShading: true
    });

    const isTop = (type === 'top');
    const layerTypeInt = isTop ? 0 : 1;

    mat.onBeforeCompile = (shader) => {
        const uniforms = rippleUniformsRef.current;
        shader.uniforms.uIslands = uniforms.uIslands;
        shader.uniforms.uBaseRadius = uniforms.uBaseRadius;
        shader.uniforms.uLayerType = { value: layerTypeInt };
        shader.uniforms.uTime = uniforms.uTime;

        shader.vertexShader = islandVertexShaderChunk + shader.vertexShader;
        
        shader.vertexShader = shader.vertexShader.replace(
            '#include <worldpos_vertex>',
            `#include <worldpos_vertex>
            vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );
        
        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `
            float islandH = getIslandH(transformed);
            vHeight = islandH;
            
            float h = 0.0;
            if (uLayerType == 0) {
                // Top layer
                if (islandH < -500.0) h = 0.0;
                else h = max(-2.0, islandH); // Allow to go underwater slightly for shore effect
            } else {
                // Bottom layer
                h = islandH; // Should be negative or 0
            }
            
            vec3 n = normalize(transformed);
            vec3 transformedNew = n * (uBaseRadius + h);
            vec4 mvPosition = viewMatrix * modelMatrix * vec4(transformedNew, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            `
        );

        shader.fragmentShader = `
            varying vec3 vWorldPos;
            varying float vHeight;
            uniform int uLayerType;
        ` + shader.fragmentShader;

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `#include <dithering_fragment>
            
            vec3 cGrass = vec3(0.3, 0.7, 0.2); 
            vec3 cSand = vec3(0.95, 0.85, 0.6); 
            vec3 cRock = vec3(0.4, 0.35, 0.3); 
            vec3 cDeepDirt = vec3(0.15, 0.12, 0.1); 
            vec3 cMagma = vec3(1.0, 0.3, 0.0);

            vec3 finalColor = vec3(0.0);
            
            if (uLayerType == 0) {
                // Top Layer
                if (vHeight < -5.0) discard; // increased dropoff range
                
                // Color ramp
                if (vHeight > 0.6) {
                    finalColor = cGrass;
                } else {
                    finalColor = cSand;
                    
                    // Foam / Shore effect
                    if (vHeight < 0.2) {
                        float wave = sin(vWorldPos.x * 2.0 + vWorldPos.z * 3.0 + uTime * 3.0) * 0.5 + 0.5;
                        float foamThreshold = 0.05 + wave * 0.05;
                        
                        if (vHeight < foamThreshold && vHeight > foamThreshold - 0.05) {
                            finalColor = mix(finalColor, vec3(1.0, 1.0, 1.0), 0.6); // Foam line
                        } else if (vHeight < 0.0) {
                            finalColor *= 0.7; // Wet underwater sand
                        }
                    }
                }
            } else {
                // Bottom Layer
                // Only render if height is negative (underside)
                if (vHeight >= -0.05) discard; 
                
                float depth = -vHeight;
                finalColor = mix(cRock, cDeepDirt, smoothstep(0.0, 4.0, depth));
                
                if (depth > 4.0) {
                    float heat = smoothstep(4.0, 8.0, depth);
                    finalColor = mix(finalColor, cMagma, heat * 0.8);
                }
                
                // Ambient occlusion style darkening
                finalColor *= 0.8;
            }
            
            gl_FragColor.rgb = finalColor;
            `
        );
    };

    return new THREE.Mesh(geo, mat);
}

export const createAtmosphere = (radius) => {
    const atmGeo = new THREE.SphereGeometry(radius * 1.03, 64, 64);
    const atmMat = new THREE.MeshBasicMaterial({
        color: 0x4488ff,
        transparent: true,
        opacity: 0.1,
        side: THREE.BackSide
    });
    return new THREE.Mesh(atmGeo, atmMat);
};

export const createSnakeHead = () => {
    const headGeo = new THREE.BoxGeometry(0.8, 0.4, 0.8);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x004400 });
    const head = new THREE.Mesh(headGeo, headMat);

    // Add Eyes
    const eyeGeo = new THREE.SphereGeometry(0.12, 16, 16);
    const eyeWhiteMat = new THREE.MeshStandardMaterial({ 
        color: 0xffffff, emissive: 0x222222, emissiveIntensity: 0.2, roughness: 0.2, metalness: 0.0 
    });
    const pupilGeo = new THREE.SphereGeometry(0.06, 12, 12);
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.0 });
    const highlightGeo = new THREE.SphereGeometry(0.025, 8, 8);
    const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    const createEye = (x) => {
        const eye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
        eye.position.set(x, 0.15, 0.25);
        const pupil = new THREE.Mesh(pupilGeo, pupilMat);
        pupil.position.set(Math.sign(x)*0.05, 0.02, 0.09);
        eye.add(pupil);
        const hl = new THREE.Mesh(highlightGeo, highlightMat);
        hl.position.set(Math.sign(x)*0.02, 0.03, 0.05);
        pupil.add(hl);
        return eye;
    };
    head.add(createEye(0.22));
    head.add(createEye(-0.22));

    // Add Tongue
    const tongueGeo = new THREE.BoxGeometry(0.08, 0.02, 0.6);
    const tongueMat = new THREE.MeshStandardMaterial({ color: 0xff3366, emissive: 0x660011, emissiveIntensity: 0.5 });
    const tongue = new THREE.Mesh(tongueGeo, tongueMat);
    tongue.position.set(0, -0.1, 0.4);
    tongue.scale.set(1, 1, 0.01);
    head.add(tongue);
    
    // Return both head and tongue ref
    return { head, tongue };
};

export const createFood = () => {
    const foodGeo = new THREE.SphereGeometry(0.5, 16, 16);
    const foodMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xff0000, emissiveIntensity: 0.5 });
    return new THREE.Mesh(foodGeo, foodMat);
};

export const createBonusFood = () => {
    const bGeo = new THREE.SphereGeometry(0.25, 8, 8);
    const bMat = new THREE.MeshStandardMaterial({ 
        color: 0xffff00, 
        emissive: 0xffaa00,
        emissiveIntensity: 0.5 
    });
    return new THREE.Mesh(bGeo, bMat);
};

export const createSegment = (colorHex) => {
    const segGeo = new THREE.BoxGeometry(0.6, 0.3, 0.6);
    const segMat = new THREE.MeshStandardMaterial({ color: colorHex });
    return new THREE.Mesh(segGeo, segMat);
};