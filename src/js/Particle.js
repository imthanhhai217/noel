import * as THREE from 'three';

export const CONFIG = {
    colors: {
        bg: 0x000000,
        gold: 0xffd966,
        green: 0x03180a,
        red: 0x990000,
        star: 0xffaa00
    },
    tree: {
        height: 24,
        radius: 8,
        particleCount: 1500,
        dustCount: 2000
    },
    camera: {
        fov: 42,
        z: 50
    }
};

export class Particle {
    constructor(mesh, type, isDust = false) {
        this.mesh = mesh;
        this.type = type;
        this.isDust = isDust;
        this.baseScale = mesh.scale.x;

        this.posTree = new THREE.Vector3();
        this.posScatter = new THREE.Vector3();
        this.spinSpeed = new THREE.Vector3(
            (Math.random() - 0.5) * (type === 'PHOTO' ? 0.3 : 2),
            (Math.random() - 0.5) * (type === 'PHOTO' ? 0.3 : 2),
            (Math.random() - 0.5) * (type === 'PHOTO' ? 0.3 : 2)
        );

        this.initPositions();
    }

    initPositions() {
        // Tree Position (Spiral)
        const h = CONFIG.tree.height;
        const t = Math.pow(Math.random(), 0.8);
        const y = (t * h) - (h / 2);
        const rMax = Math.max(0.5, CONFIG.tree.radius * (1 - t));
        const angle = t * 50 * Math.PI + Math.random() * Math.PI;
        const r = rMax * (0.8 + Math.random() * 0.4);
        this.posTree.set(Math.cos(angle) * r, y, Math.sin(angle) * r);

        // Scatter Position (Sphere)
        const rDist = this.isDust ? (12 + Math.random() * 20) : (8 + Math.random() * 12);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        this.posScatter.set(
            rDist * Math.sin(phi) * Math.cos(theta),
            rDist * Math.sin(phi) * Math.sin(theta),
            rDist * Math.cos(phi)
        );
    }

    update(dt, state, mainGroup, camera) {
        let targetPos = (state.mode === 'SCATTER') ? this.posScatter : this.posTree;

        // Handle Focus Mode for Photos
        if (state.mode === 'FOCUS') {
            if (this.mesh === state.focusTarget) {
                // Lấy vector hướng từ camera tới tâm cảnh (0,0,0)
                const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

                // Đặt mục tiêu là vị trí camera cộng thêm một khoảng hướng theo tầm nhìn
                const focusDist = 20; // Khoảng cách lý tưởng để xem ảnh
                const worldPos = new THREE.Vector3().copy(camera.position).add(dir.multiplyScalar(focusDist));

                // Chuyển worldPos về localPos của mainGroup (vì mainGroup có thể đang xoay)
                const invMatrix = new THREE.Matrix4().copy(mainGroup.matrixWorld).invert();
                targetPos = worldPos.applyMatrix4(invMatrix);
            } else {
                targetPos = this.posScatter;
            }
        }

        // Smooth Movement
        const lerpSpeed = (state.mode === 'FOCUS' && this.mesh === state.focusTarget) ? 5 : 2;
        this.mesh.position.lerp(targetPos, lerpSpeed * dt);

        // Rotation
        if (state.mode === 'SCATTER' || (state.mode === 'FOCUS' && this.mesh !== state.focusTarget)) {
            this.mesh.rotation.x += this.spinSpeed.x * dt;
            this.mesh.rotation.y += this.spinSpeed.y * dt;
            this.mesh.rotation.z += this.spinSpeed.z * dt;
        } else {
            this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, 0, dt);
            this.mesh.rotation.z = THREE.MathUtils.lerp(this.mesh.rotation.z, 0, dt);
            this.mesh.rotation.y += 0.5 * dt;
        }

        if (state.mode === 'FOCUS' && this.mesh === state.focusTarget) {
            this.mesh.lookAt(camera.position);
        }

        // Scale
        let s = this.baseScale;
        if (this.isDust) {
            s = (state.mode === 'TREE' || !state.config.snow) ? 0 : this.baseScale * (0.8 + 0.4 * Math.sin(Date.now() * 0.004 + this.mesh.id));
        } else if (state.mode === 'SCATTER' && this.type === 'PHOTO') {
            s *= 2.5;
        } else if (state.mode === 'FOCUS') {
            s = (this.mesh === state.focusTarget) ? 4.5 : this.baseScale * 0.8;
        }
        this.mesh.scale.lerp(new THREE.Vector3(s, s, s), 4 * dt);
    }
}
