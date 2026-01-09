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
        
        // Interaction
        this.interactionMesh = null; // Larger invisible sphere for raycasting

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
        this.audioManager.load('spawn', './island_spawn.mp3');

        // Create World (Earth + Terrain + Atmosphere)
        this.createWorld();

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
    
    createWorld() {
        // 1. Water Layer (The Earth Sphere)
        import('./replay-assets.js').then(module => {
            // Helper ref for uniforms wrapper
            const uniformsRef = { current: this.rippleUniforms };
            
            this.earth = module.createEarth(this.EARTH_RADIUS, uniformsRef);
            this.scene.add(this.earth);

            // 2. Terrain Layers (Islands)
            // Top: Gameplay surface (Grass/Sand)
            this.terrainTop = module.createTerrainLayer(this.EARTH_RADIUS, uniformsRef, 'top');
            this.scene.add(this.terrainTop);
            
            // Bottom: Underside volume (Rock/Magma)
            this.terrainBottom = module.createTerrainLayer(this.EARTH_RADIUS, uniformsRef, 'bottom');
            this.scene.add(this.terrainBottom);
            
            // 3. Atmosphere
            this.atmosphere = module.createAtmosphere(this.EARTH_RADIUS);
            this.scene.add(this.atmosphere);
        });
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
            // Ensure visual marker actually sits on the visual terrain
            const markerGeo = new THREE.RingGeometry(0.5, 0.6, 32);
            const markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0, side: THREE.DoubleSide });
            const marker = new THREE.Mesh(markerGeo, markerMat);
            
            // Orient to surface
            // Note: If landH is negative (rising island), this places marker deep. That's correct for "sticking to surface".
            marker.position.copy(point).normalize().multiplyScalar(this.EARTH_RADIUS + landH + 0.05);
            marker.lookAt(new THREE.Vector3(0,0,0));
            this.tapMarkerGroup.add(marker);
            
            this.landTapMarkers.push({ mesh: marker, age: 0 });
            return;
        }

        // Water Tap -> Ripple
        // If landH is negative but close to 0, or just 0, it's water.
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
        let isGrowingAnyIsland = false;
        for(let i=0; i<this.islands.length; i++) {
            const island = this.islands[i];
            if (island.progress < 1.0) {
                isGrowingAnyIsland = true;
                // Float up speed (Faster)
                island.progress += dt * 0.4; 
                if (island.progress > 1.0) island.progress = 1.0;
                
                // Update Uniform
                this.rippleUniforms.uIslands.value[i].w = island.progress;
            }
        }
        
        // Slowly expand sphere while islands form to "make room"
        if (isGrowingAnyIsland) {
            this.EARTH_RADIUS += dt * 0.05;
            this.rippleUniforms.uBaseRadius.value = this.EARTH_RADIUS;
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
            // Clamp negative island height (rising from core) to 0 for physics
            const physicsIslandH = Math.max(0, islandH);
            
            const rippleH = getRippleHeight(
                pos,
                this.time,
                this.rippleUniforms.uRippleCenters.value,
                this.rippleUniforms.uRippleStartTimes.value,
                this.rippleUniforms.uRippleIntensities.value,
                this.EARTH_RADIUS
            );
            return physicsIslandH + rippleH;
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

        // Check Island Formation (Every 20 points)
        if (this.islandPoints >= 20) {
            this.islandPoints -= 20;
            if (this.islands.length < this.MAX_ISLANDS) {
                const center = getRandomPointOnSphere(1.0).normalize();
                this.islands.push({ center, progress: 0.0 });
                
                const i = this.islands.length - 1;
                this.rippleUniforms.uIslands.value[i].set(center.x, center.y, center.z, 0.0);
                
                // Audio and Visual Feedback
                this.playSound('spawn');
                this.triggerRipple(center.clone().multiplyScalar(this.EARTH_RADIUS), 2000);
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