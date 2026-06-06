const GRID_SIZE = 32;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;
const CHANNELS = 3;
const CANVAS_SIZE = 640;
const CELL_SIZE = CANVAS_SIZE / GRID_SIZE;

const DIFFUSION = 0.23;
const VELOCITY_DAMPING = 0.86;
const COLOR_DAMPING = 0.015;
const EQUILIBRIUM_THRESHOLD = 0.0036;
const EQUILIBRIUM_HOLD_FRAMES = 28;

const canvas = document.getElementById('automatonCanvas');
const statusText = document.getElementById('statusText');
const ctx = canvas.getContext('2d');

canvas.width = CANVAS_SIZE;
canvas.height = CANVAS_SIZE;

const state = new Float32Array(CELL_COUNT * CHANNELS);
const next = new Float32Array(CELL_COUNT * CHANNELS);
const velocity = new Float32Array(CELL_COUNT * CHANNELS);

let nearEquilibriumFrames = 0;
let framesToNextKick = 120;

function idx(x, y, c) {
	return ((y * GRID_SIZE + x) * CHANNELS) + c;
}

function clamp01(value) {
	return Math.min(1, Math.max(0, value));
}

function wrapCoord(value) {
	const max = GRID_SIZE;
	return (value + max) % max;
}

function randomColor() {
	const hue = Math.random();
	const sat = 0.45 + Math.random() * 0.45;
	const val = 0.55 + Math.random() * 0.35;

	const i = Math.floor(hue * 6);
	const f = hue * 6 - i;
	const p = val * (1 - sat);
	const q = val * (1 - f * sat);
	const t = val * (1 - (1 - f) * sat);

	switch (i % 6) {
		case 0: return [val, t, p];
		case 1: return [q, val, p];
		case 2: return [p, val, t];
		case 3: return [p, q, val];
		case 4: return [t, p, val];
		default: return [val, p, q];
	}
}

function initializeField() {
	const seedA = randomColor();
	const seedB = randomColor();

	for (let y = 0; y < GRID_SIZE; y += 1) {
		for (let x = 0; x < GRID_SIZE; x += 1) {
			const mix = (x + y) / (GRID_SIZE * 2);
			const wobble = 0.12 * Math.sin((x * 0.52) + (y * 0.71));

			for (let c = 0; c < CHANNELS; c += 1) {
				const blended = seedA[c] * (1 - mix) + seedB[c] * mix;
				const noise = (Math.random() - 0.5) * 0.22;
				state[idx(x, y, c)] = clamp01(blended + wobble + noise);
			}
		}
	}
}

function cubicBezier(a, b, c, d, t) {
	const mt = 1 - t;
	return (mt ** 3) * a + (3 * mt * mt * t * b) + (3 * mt * t * t * c) + (t ** 3) * d;
}

function paintDisturbance(cx, cy, color, radius, strength) {
	const minX = Math.floor(cx - radius - 1);
	const maxX = Math.ceil(cx + radius + 1);
	const minY = Math.floor(cy - radius - 1);
	const maxY = Math.ceil(cy + radius + 1);

	for (let y = minY; y <= maxY; y += 1) {
		for (let x = minX; x <= maxX; x += 1) {
			const wx = wrapCoord(x);
			const wy = wrapCoord(y);
			const dx = x - cx;
			const dy = y - cy;
			const dist = Math.hypot(dx, dy);

			if (dist > radius) {
				continue;
			}

			const weight = (1 - (dist / radius)) * strength;

			for (let c = 0; c < CHANNELS; c += 1) {
				const i = idx(wx, wy, c);
				const delta = (color[c] - state[i]) * weight;
				state[i] = clamp01(state[i] + delta);
				velocity[i] += delta * 0.5;
			}
		}
	}
}

function projectSplineSet() {
	const splines = 2 + Math.floor(Math.random() * 4);

	for (let s = 0; s < splines; s += 1) {
		const p0 = [Math.random() * GRID_SIZE, Math.random() * GRID_SIZE];
		const p1 = [Math.random() * GRID_SIZE, Math.random() * GRID_SIZE];
		const p2 = [Math.random() * GRID_SIZE, Math.random() * GRID_SIZE];
		const p3 = [Math.random() * GRID_SIZE, Math.random() * GRID_SIZE];
		const color = randomColor();
		const radius = 1.4 + Math.random() * 2.1;
		const strength = 0.32 + Math.random() * 0.35;
		const steps = 64;

		for (let i = 0; i <= steps; i += 1) {
			const t = i / steps;
			const x = cubicBezier(p0[0], p1[0], p2[0], p3[0], t);
			const y = cubicBezier(p0[1], p1[1], p2[1], p3[1], t);
			paintDisturbance(x, y, color, radius, strength);
		}
	}
}

function stepSimulation() {
	let activity = 0;

	for (let y = 0; y < GRID_SIZE; y += 1) {
		for (let x = 0; x < GRID_SIZE; x += 1) {
			const left = wrapCoord(x - 1);
			const right = wrapCoord(x + 1);
			const up = wrapCoord(y - 1);
			const down = wrapCoord(y + 1);

			for (let c = 0; c < CHANNELS; c += 1) {
				const centerIndex = idx(x, y, c);
				const center = state[centerIndex];

				const neighborhood =
					state[idx(left, y, c)] +
					state[idx(right, y, c)] +
					state[idx(x, up, c)] +
					state[idx(x, down, c)];

				const average = neighborhood * 0.25;
				const laplacian = average - center;

				velocity[centerIndex] =
					(velocity[centerIndex] * VELOCITY_DAMPING) +
					(laplacian * DIFFUSION);

				const damped = center + velocity[centerIndex];
				next[centerIndex] = clamp01(damped + ((0.5 - damped) * COLOR_DAMPING));

				activity += Math.abs(laplacian) + Math.abs(velocity[centerIndex]) * 0.6;
			}
		}
	}

	state.set(next);
	const normalizedActivity = activity / (CELL_COUNT * CHANNELS);

	if (normalizedActivity < EQUILIBRIUM_THRESHOLD) {
		nearEquilibriumFrames += 1;
	} else {
		nearEquilibriumFrames = 0;
	}

	framesToNextKick -= 1;
	if (nearEquilibriumFrames >= EQUILIBRIUM_HOLD_FRAMES && framesToNextKick <= 0) {
		projectSplineSet();
		nearEquilibriumFrames = 0;
		framesToNextKick = 72 + Math.floor(Math.random() * 70);
	}

	return normalizedActivity;
}

function render() {
	for (let y = 0; y < GRID_SIZE; y += 1) {
		for (let x = 0; x < GRID_SIZE; x += 1) {
			const r = Math.floor(state[idx(x, y, 0)] * 255);
			const g = Math.floor(state[idx(x, y, 1)] * 255);
			const b = Math.floor(state[idx(x, y, 2)] * 255);
			ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
			ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
		}
	}
}

function animate() {
	const activity = stepSimulation();
	render();

	if (activity < EQUILIBRIUM_THRESHOLD) {
		statusText.textContent = 'Near equilibrium: waiting for spline projection.';
	} else {
		statusText.textContent = 'In motion: diffusion and modulation reshaping color fields.';
	}

	requestAnimationFrame(animate);
}

initializeField();
projectSplineSet();
render();
requestAnimationFrame(animate);
