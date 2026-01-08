import * as THREE from 'three';

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

    // Inject Shader
    earthMat.onBeforeCompile = (shader) => {
        const uniforms = rippleUniformsRef.current;
        shader.uniforms.uTime = uniforms.uTime;
        shader.uniforms.uRippleCenters = uniforms.uRippleCenters;
        shader.uniforms.uRippleStartTimes = uniforms.uRippleStartTimes;
        shader.uniforms.uRippleIntensities = uniforms.uRippleIntensities;
        shader.uniforms.uIslands = uniforms.uIslands;
        shader.uniforms.uBaseRadius = uniforms.uBaseRadius;

        shader.vertexShader = `
            varying vec3 vWorldPos;
            varying float vHeight;
            uniform vec4 uIslands[16];
            uniform float uBaseRadius;

            float hash(vec3 p) {
                return fract(sin(dot(p, vec3(12.9898, 78.233, 54.53))) * 43758.5453);
            }

            float getNoise(vec3 p, float seed) {
                float s = 4.0;
                return sin(p.x * s + seed) * cos(p.y * s + seed) * sin(p.z * s);
            }

            float getIslandH(vec3 pos) {
                float h = -1000.0;
                bool hasIsland = false;
                
                vec3 pNorm = normalize(pos);
                float BASE_RADIUS = 0.5;
                float BASE_MAX_H = 1.0;
                
                for(int i=0; i<16; i++) {
                    if(length(uIslands[i].xyz) < 0.1) continue;
                    
                    vec3 center = uIslands[i].xyz;
                    float seed = hash(center);
                    float rScale = 0.8 + 0.4 * seed;
                    float hScale = 0.8 + 0.4 * fract(seed * 1.23);
                    
                    float growth = uIslands[i].w;
                    
                    float distortion = getNoise(pNorm, seed * 10.0) * 0.3;
                    
                    float radiusGrowth = pow(growth, 4.0);
                    float noisyRadius = BASE_RADIUS * rScale * (1.0 + distortion) * radiusGrowth;

                    float dotProd = dot(pNorm, center);
                    float angle = acos(clamp(dotProd, -1.0, 1.0));
                    
                    if(angle < noisyRadius) {
                        hasIsland = true;
                        float d = angle / noisyRadius;
                        
                        float t = 1.0 - d;
                        float smoothShape = t * t * (3.0 - 2.0 * t);
                        float finalShape = pow(smoothShape, 0.5);
                        
                        float startH = -uBaseRadius * 0.9;
                        float endH = finalShape * BASE_MAX_H * hScale;
                        
                        float easeGrowth = growth * growth * (3.0 - 2.0 * growth);
                        float islandH = mix(startH, endH, easeGrowth);
                        
                        if (h == -1000.0) {
                            h = islandH;
                        } else {
                            h = max(h, islandH);
                        }
                    }
                }
                return hasIsland ? h : 0.0;
            }
        ` + shader.vertexShader;

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
            
            vec3 n = normalize(transformed);
            vec3 transformedNew = n * (uBaseRadius + islandH);
            vec4 mvPosition = viewMatrix * modelMatrix * vec4(transformedNew, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            `
        );

        const rippleFunc = `
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
                if (age < 0.0 || age > 2.0) return 0.0; // Lifetime 2s
                
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

        shader.fragmentShader = rippleFunc + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `#include <dithering_fragment>
            
            // Terrain Colors
            vec3 cWater = vec3(0.53, 0.8, 1.0); 
            vec3 cSand = vec3(0.93, 0.87, 0.6);
            vec3 cDirt = vec3(0.55, 0.4, 0.25);
            vec3 cGrass = vec3(0.2, 0.7, 0.1);
            
            vec3 finalColor = gl_FragColor.rgb;
            
            if (vHeight > 0.1) {
                float h = vHeight;
                if (h < 0.4) {
                    finalColor = mix(cSand, cDirt, smoothstep(0.2, 0.4, h));
                } else {
                    finalColor = mix(cDirt, cGrass, smoothstep(0.4, 0.8, h));
                }
            } else if (vHeight < -0.1) {
                vec3 cMagma = vec3(0.8, 0.2, 0.0);
                vec3 cDeepRock = vec3(0.2, 0.1, 0.05);
                float depth = abs(vHeight);
                finalColor = mix(cMagma, cDeepRock, smoothstep(0.0, 5.0, depth));
            } else {
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
            }
            gl_FragColor.rgb = finalColor;
            `
        );
    };

    return new THREE.Mesh(earthGeo, earthMat);
};

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