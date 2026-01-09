import * as THREE from 'three';

const islandVertexShaderChunk = `
    varying vec3 vWorldPos;
    varying float vHeight;
    uniform vec4 uIslands[16];
    uniform float uBaseRadius;

    float hash(vec3 p) {
        return fract(sin(dot(p, vec3(12.9898, 78.233, 54.53))) * 43758.5453);
    }

    float getNoise(vec3 p, float seed) {
        float s = 8.0; 
        return sin(p.x * s + seed) * cos(p.y * s + seed) * sin(p.z * s);
    }

    float getIslandH(vec3 pos) {
        float h = -1000.0;
        bool hasIsland = false;
        
        vec3 pNorm = normalize(pos);
        float BASE_RADIUS = 0.8; 
        
        for(int i=0; i<16; i++) {
            if(length(uIslands[i].xyz) < 0.1) continue;
            
            vec3 center = uIslands[i].xyz;
            float seed = hash(center);
            float growth = uIslands[i].w;
            
            // Animation
            // Start very small (miniature) and grow to full size
            float scale = 0.05 + 0.95 * smoothstep(0.0, 1.0, growth);
            
            // Start deep in core (offset) and float up
            float depthOffset = -uBaseRadius * 0.8 * (1.0 - growth);
            
            // Noise for irregular coastline
            float noise = getNoise(pNorm, seed * 12.0);
            float radiusVar = 1.0 + noise * 0.25;
            float currentRadius = BASE_RADIUS * scale * radiusVar;

            float dotProd = dot(pNorm, center);
            float angle = acos(clamp(dotProd, -1.0, 1.0));
            
            if(angle < currentRadius) {
                hasIsland = true;
                
                float d = angle / currentRadius; // 0..1
                float t = 1.0 - d; // 1..0 (1 is center)
                
                // Shape Profile: Iceberg / Floating Island
                // We want a deep bottom and a flat top
                float topH = 4.0 * scale; 
                float botH = -6.0 * scale; // Deep underside

                // Profile curve:
                // t=0 (edge) -> 0
                // t=1 (center) -> 1
                // Convex shape for bulk
                float profile = pow(t, 0.5); 
                
                // Base shape mix
                float baseH = mix(botH, topH, profile);
                
                // Detail (Rock/Terrain noise)
                float detail = getNoise(pNorm * 6.0, seed + 1.0) * 0.8 * scale * t;
                
                // "Actual Grass" Displacement
                // High frequency noise to create blade-like spikes on top
                float grassZone = smoothstep(0.0, 0.2, baseH + detail + depthOffset);
                float bladeNoise = hash(pNorm * 150.0); // Very high freq
                float grassSpikes = grassZone * bladeNoise * 0.6; // 0.6 unit tall grass

                // Combined unmasked height
                float rawH = depthOffset + baseH + detail;
                
                // Edge Masking to prevent "Hole" look
                // Forces the island geometry to meet the water level at the boundary
                float edgeFade = smoothstep(0.0, 0.15, t);
                
                float finalH = rawH * edgeFade + grassSpikes;
                
                if (h == -1000.0) {
                    h = finalH;
                } else {
                    h = max(h, finalH);
                }
            }
        }
        return hasIsland ? h : -1000.0;
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

export const createTerrainLayer = (radius, rippleUniformsRef) => {
    const geo = new THREE.SphereGeometry(radius, 128, 128); // Higher resolution for smoother displacement
    const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.9,
        side: THREE.DoubleSide,
        flatShading: true // Low poly look for better shape definition
    });

    mat.onBeforeCompile = (shader) => {
        const uniforms = rippleUniformsRef.current;
        shader.uniforms.uIslands = uniforms.uIslands;
        // Ensure backface (inside of island) looks like rock, not invisible/weird
        shader.side = THREE.DoubleSide;
        shader.uniforms.uBaseRadius = uniforms.uBaseRadius;

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
            
            // Displace if valid island, otherwise effectively hide later
            float h = (islandH > -500.0) ? islandH : 0.0;
            
            vec3 n = normalize(transformed);
            vec3 transformedNew = n * (uBaseRadius + h);
            vec4 mvPosition = viewMatrix * modelMatrix * vec4(transformedNew, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            `
        );

        shader.fragmentShader = `
            varying vec3 vWorldPos;
            varying float vHeight;
        ` + shader.fragmentShader;

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `#include <dithering_fragment>
            
            if (vHeight < -500.0) discard;

            vec3 cGrass = vec3(0.1, 0.5, 0.05);
            vec3 cGrassTips = vec3(0.4, 0.7, 0.2);
            vec3 cSand = vec3(0.95, 0.85, 0.6); 
            vec3 cRock = vec3(0.3, 0.25, 0.22);
            vec3 cUnderbelly = vec3(0.12, 0.08, 0.06); 
            vec3 cMagma = vec3(1.0, 0.3, 0.1);

            vec3 finalColor = vec3(0.0);
            
            // Noise for transitions
            float noise = sin(vWorldPos.x * 5.0) * sin(vWorldPos.y * 5.0) * sin(vWorldPos.z * 5.0);
            float beachNoise = noise * 0.3;
            float grassNoise = fract(sin(dot(vWorldPos, vec3(12.9898, 78.233, 54.53))) * 43758.5453);

            // Visual logic based on height
            if (vHeight > 0.8 + beachNoise) {
                // Grass Region
                finalColor = mix(cGrass, cGrassTips, grassNoise * 0.5);
                // Fake Shadow for blades
                if (grassNoise < 0.3) finalColor *= 0.8;
            } else if (vHeight > -0.2 + beachNoise) {
                // Beach line (Wider)
                finalColor = cSand;
                // Wet sand near water
                if (vHeight < 0.1) finalColor *= 0.85;
            } else {
                // Underside
                float depth = -vHeight;
                finalColor = mix(cRock, cUnderbelly, smoothstep(0.0, 4.0, depth));
                
                // Deep Magma Tip
                if (depth > 5.0) {
                   float heat = smoothstep(5.0, 8.0, depth);
                   finalColor = mix(finalColor, cMagma, heat * 0.8);
                }
            }

            // Simple fake lighting for underside to prevent "concave" look flat shading
            // We darken the color based on how deep it is to simulate occlusion
            if (vHeight < 0.0) {
                finalColor *= 0.6; 
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