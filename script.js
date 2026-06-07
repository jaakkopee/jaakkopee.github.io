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

const symmetricCanvas = document.getElementById('symmetricCanvas');
const symmetricStatus = document.getElementById('symmetricStatus');
const symmetricCtx = symmetricCanvas.getContext('2d');

canvas.width = CANVAS_SIZE;
canvas.height = CANVAS_SIZE;

const SYMMETRIC_WIDTH = 16;
const SYMMETRIC_HEIGHT = 8;
const SYMMETRIC_CELL_COUNT = SYMMETRIC_WIDTH * SYMMETRIC_HEIGHT;
const SYMMETRIC_STATE_COUNT = 7;
const SYMMETRIC_COLORS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#8b5cf6', '#4338ca'];

symmetricCanvas.width = 640;
symmetricCanvas.height = 320;

const state = new Float32Array(CELL_COUNT * CHANNELS);
const next = new Float32Array(CELL_COUNT * CHANNELS);
const velocity = new Float32Array(CELL_COUNT * CHANNELS);

const symmetricState = new Uint8Array(SYMMETRIC_CELL_COUNT);
const symmetricNext = new Uint8Array(SYMMETRIC_CELL_COUNT);

let nearEquilibriumFrames = 0;
let framesToNextKick = 120;
let symmetricTick = 0;
let symmetricPulseFrames = 0;

function idx(x, y, c) {
	return ((y * GRID_SIZE + x) * CHANNELS) + c;
}

function symmetricIdx(x, y) {
	return (y * SYMMETRIC_WIDTH) + x;
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

function initializeSymmetricField() {
	for (let y = 0; y < SYMMETRIC_HEIGHT; y += 1) {
		for (let x = 0; x < SYMMETRIC_WIDTH; x += 1) {
			const mirrorX = SYMMETRIC_WIDTH - 1 - x;
			const mirrorY = SYMMETRIC_HEIGHT - 1 - y;

			if (x > mirrorX || y > mirrorY) {
				continue;
			}

			const value = Math.floor(Math.random() * SYMMETRIC_STATE_COUNT);

			symmetricState[symmetricIdx(x, y)] = value;
			symmetricState[symmetricIdx(mirrorX, y)] = value;
			symmetricState[symmetricIdx(x, mirrorY)] = value;
			symmetricState[symmetricIdx(mirrorX, mirrorY)] = value;
		}
	}
}

function seedSymmetricPulse() {
	const centerX = Math.floor(SYMMETRIC_WIDTH / 2);
	const centerY = Math.floor(SYMMETRIC_HEIGHT / 2);
	const pulseStates = [0, 1, 2, 3, 4, 5, 6];

	for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
		for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
			const distance = Math.abs(offsetX) + Math.abs(offsetY);
			if (distance > 1) {
				continue;
			}

			const value = pulseStates[(offsetX + offsetY + pulseStates.length) % pulseStates.length];
			const x = (centerX + offsetX + SYMMETRIC_WIDTH) % SYMMETRIC_WIDTH;
			const y = (centerY + offsetY + SYMMETRIC_HEIGHT) % SYMMETRIC_HEIGHT;
			const mirrorX = (SYMMETRIC_WIDTH - 1 - x + SYMMETRIC_WIDTH) % SYMMETRIC_WIDTH;
			const mirrorY = (SYMMETRIC_HEIGHT - 1 - y + SYMMETRIC_HEIGHT) % SYMMETRIC_HEIGHT;

			symmetricState[symmetricIdx(x, y)] = value;
			symmetricState[symmetricIdx(mirrorX, y)] = value;
			symmetricState[symmetricIdx(x, mirrorY)] = value;
			symmetricState[symmetricIdx(mirrorX, mirrorY)] = value;
		}
	}
}

function injectSymmetricDisturbance() {
	const baseX = Math.floor(Math.random() * SYMMETRIC_WIDTH);
	const baseY = Math.floor(Math.random() * SYMMETRIC_HEIGHT);
	const radius = 1 + Math.floor(Math.random() * 2);
	const pivotState = Math.floor(Math.random() * SYMMETRIC_STATE_COUNT);

	for (let y = 0; y < SYMMETRIC_HEIGHT; y += 1) {
		for (let x = 0; x < SYMMETRIC_WIDTH; x += 1) {
			const dx = Math.min(Math.abs(x - baseX), SYMMETRIC_WIDTH - Math.abs(x - baseX));
			const dy = Math.min(Math.abs(y - baseY), SYMMETRIC_HEIGHT - Math.abs(y - baseY));
			const distance = dx + dy;

			if (distance > radius) {
				continue;
			}

			const weight = radius - distance + 1;
			const value = (pivotState + weight) % SYMMETRIC_STATE_COUNT;
			const mirrorX = SYMMETRIC_WIDTH - 1 - x;
			const mirrorY = SYMMETRIC_HEIGHT - 1 - y;

			symmetricState[symmetricIdx(x, y)] = value;
			symmetricState[symmetricIdx(mirrorX, y)] = value;
			symmetricState[symmetricIdx(x, mirrorY)] = value;
			symmetricState[symmetricIdx(mirrorX, mirrorY)] = value;
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

function renderSymmetricField() {
	const cellWidth = symmetricCanvas.width / SYMMETRIC_WIDTH;
	const cellHeight = symmetricCanvas.height / SYMMETRIC_HEIGHT;

	for (let y = 0; y < SYMMETRIC_HEIGHT; y += 1) {
		for (let x = 0; x < SYMMETRIC_WIDTH; x += 1) {
			const color = SYMMETRIC_COLORS[symmetricState[symmetricIdx(x, y)]];
			symmetricCtx.fillStyle = color;
			symmetricCtx.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
		}
	}
}

function stepSymmetricField() {
	let activity = 0;
	symmetricPulseFrames += 1;

	if (symmetricPulseFrames % 48 === 0) {
		injectSymmetricDisturbance();
	}

	for (let y = 0; y < SYMMETRIC_HEIGHT; y += 1) {
		for (let x = 0; x < SYMMETRIC_WIDTH; x += 1) {
			const currentIndex = symmetricIdx(x, y);
			const currentState = symmetricState[currentIndex];
			const counts = new Array(SYMMETRIC_STATE_COUNT).fill(0);

			for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
				for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
					if (offsetX === 0 && offsetY === 0) {
						continue;
					}

					const neighborX = (x + offsetX + SYMMETRIC_WIDTH) % SYMMETRIC_WIDTH;
					const neighborY = (y + offsetY + SYMMETRIC_HEIGHT) % SYMMETRIC_HEIGHT;
					counts[symmetricState[symmetricIdx(neighborX, neighborY)]] += 1;
				}
			}

			let dominantState = currentState;
			let dominantCount = counts[currentState];

			for (let stateIndex = 0; stateIndex < SYMMETRIC_STATE_COUNT; stateIndex += 1) {
				if (counts[stateIndex] > dominantCount) {
					dominantState = stateIndex;
					dominantCount = counts[stateIndex];
				}
			}

			const forwardState = (currentState + 1) % SYMMETRIC_STATE_COUNT;
			const backwardState = (currentState + SYMMETRIC_STATE_COUNT - 1) % SYMMETRIC_STATE_COUNT;
			const forwardPressure = counts[forwardState];
			const backwardPressure = counts[backwardState];

			let nextState = currentState;

			if (dominantCount >= 5 && dominantState !== currentState) {
				nextState = dominantState;
			} else if (forwardPressure >= backwardPressure + 2) {
				nextState = forwardState;
			} else if (backwardPressure >= forwardPressure + 2) {
				nextState = backwardState;
			} else if (counts[currentState] <= 1 && dominantCount >= 3) {
				nextState = dominantState;
			}

			symmetricNext[currentIndex] = nextState;
			activity += Math.abs(nextState - currentState);
		}
	}

	symmetricState.set(symmetricNext);
	symmetricTick += 1;
	if (symmetricTick % 96 === 0) {
		injectSymmetricDisturbance();
	}
	return activity / SYMMETRIC_CELL_COUNT;
}

function animate() {
	const activity = stepSimulation();
	const symmetricActivity = stepSymmetricField();
	render();
	renderSymmetricField();

	if (activity < EQUILIBRIUM_THRESHOLD) {
		statusText.textContent = 'Near equilibrium: waiting for spline projection.';
	} else {
		statusText.textContent = 'In motion: diffusion and modulation reshaping color fields.';
	}

	if (symmetricActivity < 0.7) {
		symmetricStatus.textContent = `Symmetric field: frame ${symmetricTick}, ${Math.round(symmetricActivity * 1000) / 1000}`;
	} else {
		symmetricStatus.textContent = `Symmetric field: frame ${symmetricTick}, active update ${Math.round(symmetricActivity * 1000) / 1000}`;
	}

	requestAnimationFrame(animate);
}

initializeField();
initializeSymmetricField();
seedSymmetricPulse();
projectSplineSet();
render();
renderSymmetricField();
requestAnimationFrame(animate);
