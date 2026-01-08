import * as THREE from 'three';
import { Snake } from './snake.js';
import { FoodManager } from './food-manager.js';
import { AudioManager } from './audio-manager.js';
import { ReplayRecorder } from './replay-recorder.js';
import { hideLoader } from './loader.js';
import { getRippleHeight, getIslandHeight, getRandomPointOnSphere } from './math-utils.js';

export class Game {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        
        // Constants
        this.BASE_EARTH_RADIUS = 10;
        this.EARTH_RADIUS = 10;
        
        // State
        this.isPlaying = false;
        this.isGameOver = false;
        this.score = 0;
        this.growthPoints = 0;
        this.islandPoints = 0;
        this.time = 0;

        // World Generation
        this.islands = []; // { center: Vector3, progress: float }
        this.MAX_ISLANDS = 16;

        // Visuals
        this.rippleUniforms = {
            uTime: { value: 0 },
            uRippleCenters: { value: new Array(5).fill().map(() => new THREE.Vector3()) },
            uRippleStartTimes: { value: new Array(5).fill(-1000) },
            uRippleIntensities: { value: new Array(5).fill(0) },
            uIslands: { value: new Array(16).fill().map(() => new THREE.Vector4(0,0,0,0)) }, // xyz: center, w: progress
            uBaseRadius: { value: 10.0 }
        };
        this.currentRippleIdx = 0;
        this.landTapMarkers = []; // { mesh, age }
        
        // Player Info
        this.playerInfo = { username: 'Player', avatarUrl: '' };
        
        // Components
        this.audioManager = new AudioManager();
        this.recorder = new ReplayRecorder(30);
        
        // Entities
        this.earth = null;
        this.snake = null; // Replaces head, segments, pathHistory
        this.foodManager = null; // Replaces food, bonusFoods, spawn logic

        this.targetPoint = null;

        this.init();
    }

    setPlayerInfo(info) {
        this.playerInfo = info;
        const avatarEl = document.getElementById('player-avatar');
        const nameEl = document.getElementById('player-name');
        const playerCardEl = document.getElementById('player-card');

        // Always set name immediately if available
        if (nameEl && info.username) {
            nameEl.textContent = info.username;
        }

        // If we don't have an avatar element, nothing more to do
        if (!avatarEl) return;

        const fallbackUrl = './default_avatar.png';
        const primaryUrl = info.avatarUrl || fallbackUrl;

        const tryLoad = (urlList, index = 0) => {
            if (index >= urlList.length) {
                // No image could be loaded; leave card hidden
                return;
            }

            const url = urlList[index];
            const img = new Image();
            img.onload = () => {
                avatarEl.src = url;
                // Once avatar (or fallback) is ready, fade in the whole experience together
                document.body.classList.add('ready');
                hideLoader(); // Fade out loading screen
                if (playerCardEl) {
                    // Fade in avatar, username, and score together
                    playerCardEl.classList.add('visible');
                }
            };
            img.onerror = () => {
                // Try next URL in the list
                tryLoad(urlList, index + 1);
            };
            img.src = url;
        };

        // Prefer provided avatar, then fallback to default
        tryLoad([primaryUrl === fallbackUrl ? fallbackUrl : primaryUrl, fallbackUrl]);
    }

    init() {
        // removed loadSound calls - now in AudioManager

        this.audioManager.load('eat', './snake_eat.mp3');
        this.audioManager.load('die', './game_over.mp3');

        // Create Earth
        this.createEarth();

        // removed Snake Head creation - moved to Snake class
        this.snake = new Snake(this.scene, this.EARTH_RADIUS);

        // removed Food creation/spawning - moved to FoodManager
        this.foodManager = new FoodManager(this.scene, this.EARTH_RADIUS);
        this.foodManager.spawnFood(this.snake.head.position, this.snake.segments);

        // Tap marker container
        this.tapMarkerGroup = new THREE.Group();
        this.scene.add(this.tapMarkerGroup);

        this.resetGame();
    }
    
    createEarth() {
        const geometry = new THREE.SphereGeometry(this.EARTH_RADIUS, 64, 64);
        const material = new THREE.MeshStandardMaterial({
            color: 0x88ccff,
            emissive: 0x002244, 
            emissiveIntensity: 0.8,
            transparent: true,
            opacity: 0.7,
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide
        });

        // Inject Ripple Shader Logic
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = this.rippleUniforms.uTime;
            shader.uniforms.uRippleCenters = this.rippleUniforms.uRippleCenters;
            shader.uniforms.uRippleStartTimes = this.rippleUniforms.uRippleStartTimes;
            shader.uniforms.uRippleIntensities = this.rippleUniforms.uRippleIntensities;
            shader.uniforms.uIslands = this.rippleUniforms.uIslands;
            shader.uniforms.uBaseRadius = this.rippleUniforms.uBaseRadius;

            shader.vertexShader = `
                varying vec3 vWorldPos;
                varying float vHeight;
                uniform vec4 uIslands[16];
                uniform float uBaseRadius;

                float getIslandH(vec3 pos) {
                    float h = 0.0;
                    vec3 pNorm = normalize(pos);
                    float ISLAND_RADIUS_ANGLE = 0.3;
                    float MAX_H = 1.5;
                    
                    for(int i=0; i<16; i++) {
                        if(uIslands[i].w <= 0.0) continue;
                        
                        vec3 center = uIslands[i].xyz;
                        float dotProd = dot(pNorm, center);
                        float angle = acos(clamp(dotProd, -1.0, 1.0));
                        
                        if(angle < ISLAND_RADIUS_ANGLE) {
                            float d = angle / ISLAND_RADIUS_ANGLE;
                            float shape = (cos(d * 3.14159) + 1.0) * 0.5;
                            h += shape * MAX_H * uIslands[i].w;
                        }
                    }
                    return h;
                }
            ` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `#include <worldpos_vertex>
                vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
            );
            
            // Add Vertex Displacement
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
                vec3 cWater = vec3(0.53, 0.8, 1.0); // Light blue base
                vec3 cSand = vec3(0.93, 0.87, 0.6);
                vec3 cDirt = vec3(0.55, 0.4, 0.25);
                vec3 cGrass = vec3(0.2, 0.7, 0.1);
                
                vec3 finalColor = gl_FragColor.rgb;
                
                if (vHeight > 0.1) {
                    // Land
                    float h = vHeight; // 0.1 to 1.5
                    
                    // Mixing
                    if (h < 0.4) {
                        finalColor = mix(cSand, cDirt, smoothstep(0.2, 0.4, h));
                    } else {
                        finalColor = mix(cDirt, cGrass, smoothstep(0.4, 0.8, h));
                    }
                }
                
                // Ripples on Water only
                if (vHeight <= 0.1) {
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

        this.earth = new THREE.Mesh(geometry, material);
        this.scene.add(this.earth);
        
        const atmGeometry = new THREE.SphereGeometry(this.EARTH_RADIUS * 1.03, 64, 64);
        const atmMaterial = new THREE.MeshBasicMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0.1,
            side: THREE.BackSide
        });
        this.scene.add(new THREE.Mesh(atmGeometry, atmMaterial));
    }
    
    resetGame() {
        // Reset World
        this.EARTH_RADIUS = this.BASE_EARTH_RADIUS;
        this.islands = [];
        this.rippleUniforms.uIslands.value.forEach(v => v.set(0,0,0,0));
        this.rippleUniforms.uBaseRadius.value = this.BASE_EARTH_RADIUS;

        // removed reset logic for segments/bonus foods - delegated to managers
        this.snake.reset();
        this.foodManager.reset();
        this.foodManager.spawnFood(this.snake.head.position, this.snake.segments);
        
        this.recorder.reset();

        // Reset Visuals
        this.rippleUniforms.uRippleStartTimes.value.fill(-1000);
        
        // Remove old markers
        while(this.tapMarkerGroup.children.length > 0) {
            this.tapMarkerGroup.remove(this.tapMarkerGroup.children[0]);
        }
        this.landTapMarkers = [];
        
        // Reset Camera
        this.updateCamera(0.1, true); // Force snap
        
        this.score = 0;
        this.growthPoints = 0;
        this.islandPoints = 0;
        this.isGameOver = false;
        this.isPlaying = true;
        this.targetPoint = null;

        const scoreEl = document.getElementById('player-score');
        if(scoreEl) scoreEl.innerText = this.score;
        
        const gameOverEl = document.getElementById('game-over');
        if (gameOverEl) {
            gameOverEl.classList.add('hidden');
            gameOverEl.classList.remove('visible');
        }
    }

    playSound(name) {
        this.audioManager.play(name);
        this.recorder.recordEvent(name, null);
    }

    setTarget(point) {
        if(this.isGameOver) return;
        this.audioManager.resume();
        this.targetPoint = point.clone().normalize().multiplyScalar(this.EARTH_RADIUS);
    }

    triggerRipple(point, durationMs) {
        // Determine if Land or Water
        const landH = getIslandHeight(point, this.islands, this.EARTH_RADIUS);
        
        if (landH > 0.1) {
            // Land Tap -> Visual Marker
            const markerGeo = new THREE.RingGeometry(0.5, 0.6, 32);
            const markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0, side: THREE.DoubleSide });
            const marker = new THREE.Mesh(markerGeo, markerMat);
            
            // Orient to surface
            marker.position.copy(point).normalize().multiplyScalar(this.EARTH_RADIUS + landH + 0.05);
            marker.lookAt(new THREE.Vector3(0,0,0));
            this.tapMarkerGroup.add(marker);
            
            this.landTapMarkers.push({ mesh: marker, age: 0 });
            return;
        }

        // Water Tap -> Ripple
        const idx = this.currentRippleIdx;
        this.rippleUniforms.uRippleCenters.value[idx].copy(point);
        this.rippleUniforms.uRippleStartTimes.value[idx] = this.time;
        
        let intensity = 0.15;
        if (durationMs > 200) {
            const factor = Math.min((durationMs - 200) / 400, 1.0);
            intensity = 0.15 + factor * 0.3;
        }
        
        this.rippleUniforms.uRippleIntensities.value[idx] = intensity;
        
        this.currentRippleIdx = (this.currentRippleIdx + 1) % 5;

        this.recorder.recordEvent('ripple', { 
            center: point.toArray(), 
            duration: durationMs 
        });
    }

    update(dt) {
        this.time += dt;
        this.rippleUniforms.uTime.value = this.time;

        if(this.isGameOver) return;

        // Update Island Growth
        for(let i=0; i<this.islands.length; i++) {
            const island = this.islands[i];
            if (island.progress < 1.0) {
                island.progress += dt * 0.2; // 5 seconds to grow
                if (island.progress > 1.0) island.progress = 1.0;
                
                // Update Uniform
                this.rippleUniforms.uIslands.value[i].w = island.progress;
            }
        }
        
        // Update Tap Markers
        for (let i = this.landTapMarkers.length - 1; i >= 0; i--) {
            const m = this.landTapMarkers[i];
            m.age += dt;
            if (m.age > 0.5) {
                this.tapMarkerGroup.remove(m.mesh);
                m.mesh.geometry.dispose();
                m.mesh.material.dispose();
                this.landTapMarkers.splice(i, 1);
            } else {
                m.mesh.material.opacity = 1.0 - (m.age / 0.5);
                m.mesh.scale.setScalar(1.0 + m.age * 2.0);
            }
        }

        // Terrain Function
        const terrainFn = (pos) => {
            const islandH = getIslandHeight(pos, this.islands, this.EARTH_RADIUS);
            const rippleH = getRippleHeight(
                pos,
                this.time,
                this.rippleUniforms.uRippleCenters.value,
                this.rippleUniforms.uRippleStartTimes.value,
                this.rippleUniforms.uRippleIntensities.value,
                this.EARTH_RADIUS
            );
            return islandH + rippleH;
        };

        // 1. Update Snake
        // Pass current earth radius (it grows)
        const moveDist = this.snake.update(dt, this.targetPoint, terrainFn, this.EARTH_RADIUS);
        if (moveDist > 0 && this.targetPoint && this.snake.head.position.distanceTo(this.targetPoint) < 1.0) {
            this.targetPoint = null;
        }

        // 2. Update Food Manager
        this.foodManager.update(moveDist, this.snake.getTailPosition(), terrainFn, this.EARTH_RADIUS);

        // 3. Collision Checks
        const collisions = this.foodManager.checkCollisions(this.snake.head.position, this.EARTH_RADIUS);
        
        if (collisions.mainFood) {
            this.playSound('eat');
            this.score += 5;
            this.growthPoints += 5;
            this.islandPoints += 5;

            // World Growth (Radius)
            this.EARTH_RADIUS += 0.05; // Grow 0.05 per food
            this.rippleUniforms.uBaseRadius.value = this.EARTH_RADIUS;
            
            const scoreEl = document.getElementById('player-score');
            if(scoreEl) scoreEl.innerText = this.score;
            
            this.foodManager.spawnFood(this.snake.head.position, this.snake.segments);
            
            if (Math.random() < 0.5) {
                this.foodManager.spawnBonusTrail(5);
            }
            this.snake.triggerTongue();
        }
        
        collisions.bonusIndices.sort((a,b) => b-a).forEach(idx => {
            this.playSound('eat');
            this.score += 1;
            this.growthPoints += 1;
            this.islandPoints += 1;
            
            // Tiny growth for bonus
            this.EARTH_RADIUS += 0.01;
            this.rippleUniforms.uBaseRadius.value = this.EARTH_RADIUS;

            const scoreEl = document.getElementById('player-score');
            if(scoreEl) scoreEl.innerText = this.score;
            this.foodManager.removeBonusFood(idx);
            this.snake.triggerTongue();
        });

        // Check Snake Growth
        while (this.growthPoints >= 10) {
            this.snake.addSegment();
            this.growthPoints -= 10;
        }

        // Check Island Formation (Every 100 points)
        if (this.islandPoints >= 100) {
            this.islandPoints -= 100;
            if (this.islands.length < this.MAX_ISLANDS) {
                const center = getRandomPointOnSphere(1.0).normalize();
                this.islands.push({ center, progress: 0.0 });
                
                const i = this.islands.length - 1;
                this.rippleUniforms.uIslands.value[i].set(center.x, center.y, center.z, 0.0);
            }
        }

        // 4. Check Self Collision
        // removed loop - delegated to Snake
        if (this.snake.checkSelfCollision()) {
            this.gameOver();
        }

        // 5. Update Camera
        this.updateCamera(dt);

        // 6. Record Frame
        // removed recordFrame implementation - delegated to ReplayRecorder
        this.recorder.update(dt, () => this.getSnapshot());
    }
    
    updateCamera(dt, snap = false) {
        // Adjust camera distance based on Earth Radius
        const dist = 30 + (this.EARTH_RADIUS - this.BASE_EARTH_RADIUS) * 2;
        const idealCameraPos = this.snake.head.position.clone().normalize().multiplyScalar(dist);
        if (snap) {
            this.camera.position.copy(idealCameraPos);
        } else {
            this.camera.position.lerp(idealCameraPos, 2.0 * dt);
        }
        this.camera.lookAt(0, 0, 0);
        
        const snakeForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.snake.head.quaternion);
        this.camera.up.copy(snakeForward);
    }

    getSnapshot() {
        return {
            head: {
                pos: this.snake.head.position.toArray(),
                quat: this.snake.head.quaternion.toArray()
            },
            camera: {
                pos: this.camera.position.toArray(),
                quat: this.camera.quaternion.toArray(),
                up: this.camera.up.toArray()
            },
            food: this.foodManager.food.position.toArray(),
            bonusFoods: this.foodManager.bonusFoods.map(b => b.position.toArray()),
            segments: this.snake.segments.map(seg => ({
                pos: seg.position.toArray(),
                quat: seg.quaternion.toArray(),
                color: seg.material.color.getHex()
            })),
            score: this.score,
            radius: this.EARTH_RADIUS,
            islands: this.islands.map(i => ({ center: i.center.toArray(), progress: i.progress })),
            tongue: {
                scaleX: this.snake.tongue ? this.snake.tongue.scale.x : 1,
                scaleZ: this.snake.tongue ? this.snake.tongue.scale.z : 0.01
            },
            events: [] // Filled by recorder
        };
    }

    getReplayJSON() {
        return this.recorder.getReplayJSON({
            initialRadius: this.BASE_EARTH_RADIUS,
            fps: this.recorder.RECORD_FPS,
            playerInfo: this.playerInfo,
            sounds: {
                eat: './snake_eat.mp3',
                die: './game_over.mp3'
            },
            muted: this.audioManager.isMuted()
        });
    }

    gameOver() {
        this.isGameOver = true;
        this.playSound('die');
        // Force a final record
        this.recorder.update(100, () => this.getSnapshot()); 
        
        const gameOverEl = document.getElementById('game-over');
        const restartBtn = document.getElementById('btn-restart');
        const replayBtn = document.getElementById('btn-replay');

        // Disable buttons initially to prevent misclicks
        if (restartBtn) restartBtn.disabled = true;
        if (replayBtn) replayBtn.disabled = true;

        if (gameOverEl) {
            gameOverEl.classList.remove('hidden');
            // Allow display: none to clear before starting transition
            requestAnimationFrame(() => {
                gameOverEl.classList.add('visible');
            });

            // Re-enable buttons shortly after fade-in starts
            setTimeout(() => {
                if (restartBtn) restartBtn.disabled = false;
                if (replayBtn) replayBtn.disabled = false;
            }, 700);
        }
        this.isPlaying = false;
    }
}