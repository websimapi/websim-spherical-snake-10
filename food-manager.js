import * as THREE from 'three';
import { getRandomPointOnSphere } from './math-utils.js';

export class FoodManager {
    constructor(scene, earthRadius) {
        this.scene = scene;
        this.EARTH_RADIUS = earthRadius;
        
        this.food = null;
        this.bonusFoods = [];
        
        // Spawning Logic
        this.bonusSpawnQueue = 0;
        this.bonusSpawnDist = 0;
        
        this.init();
    }

    init() {
        const foodGeo = new THREE.SphereGeometry(0.5, 16, 16);
        const foodMat = new THREE.MeshStandardMaterial({ 
            color: 0xffaa00, 
            emissive: 0xff0000, 
            emissiveIntensity: 0.5 
        });
        this.food = new THREE.Mesh(foodGeo, foodMat);
        this.scene.add(this.food);
    }

    reset() {
        this.bonusFoods.forEach(f => this.scene.remove(f));
        this.bonusFoods = [];
        this.bonusSpawnQueue = 0;
        this.bonusSpawnDist = 0;
    }

    spawnFood(snakeHeadPos, snakeSegments) {
        let valid = false;
        let pos = new THREE.Vector3();
        let tries = 0;
        
        while(!valid && tries < 20) {
            pos = getRandomPointOnSphere(this.EARTH_RADIUS);
            valid = true;
            
            // Check distance to head
            if(pos.distanceTo(snakeHeadPos) < 5) valid = false;
            
            // Check distance to segments
            for(let seg of snakeSegments) {
                if(pos.distanceTo(seg.position) < 2) {
                    valid = false;
                    break;
                }
            }
            tries++;
        }
        
        this.food.position.copy(pos);
        this.food.lookAt(new THREE.Vector3(0,0,0));
    }

    spawnBonusTrail(amount = 5) {
        this.bonusSpawnQueue += amount;
    }

    spawnSingleBonusFood(position) {
        const geo = new THREE.SphereGeometry(0.25, 8, 8);
        const mat = new THREE.MeshStandardMaterial({ 
            color: 0xffff00, 
            emissive: 0xffaa00,
            emissiveIntensity: 0.5 
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(position);
        mesh.position.normalize().multiplyScalar(this.EARTH_RADIUS);
        
        this.scene.add(mesh);
        this.bonusFoods.push(mesh);
    }

    update(moveDist, snakeTailPos, terrainFn, currentRadius) {
        this.EARTH_RADIUS = currentRadius;

        // Apply Terrain Physics to Food
        if (terrainFn) {
            this.applyTerrainToFood(this.food, terrainFn);
            this.bonusFoods.forEach(b => this.applyTerrainToFood(b, terrainFn));
        }

        // Handle Bonus Spawning
        if (this.bonusSpawnQueue > 0) {
            this.bonusSpawnDist += moveDist;
            const SPACING = 1.5; 
            
            while (this.bonusSpawnDist >= SPACING && this.bonusSpawnQueue > 0) {
                this.bonusSpawnDist -= SPACING;
                this.bonusSpawnQueue--;
                this.spawnSingleBonusFood(snakeTailPos);
            }
        }
    }
    
    applyTerrainToFood(mesh, terrainFn) {
        // Reset to base surface
        mesh.position.setLength(this.EARTH_RADIUS);
        // Calculate offset
        const h = terrainFn(mesh.position);
        if (Math.abs(h) > 0.01) {
            mesh.position.setLength(this.EARTH_RADIUS + h);
        }
    }
    
    checkCollisions(snakeHeadPos, currentRadius) {
        const results = {
            mainFood: false,
            bonusIndices: []
        };

        const headNorm = snakeHeadPos.clone().normalize();
        const foodNorm = this.food.position.clone().normalize();

        if (headNorm.distanceTo(foodNorm) * currentRadius < 1.5) {
            results.mainFood = true;
        }

        for (let i = this.bonusFoods.length - 1; i >= 0; i--) {
            const bonus = this.bonusFoods[i];
            const bonusNorm = bonus.position.clone().normalize();
            
            if (headNorm.distanceTo(bonusNorm) * currentRadius < 1.2) {
                results.bonusIndices.push(i);
            }
        }
        
        return results;
    }

    removeBonusFood(index) {
        const bonus = this.bonusFoods[index];
        if (bonus) {
            this.scene.remove(bonus);
            this.bonusFoods.splice(index, 1);
        }
    }
}