(function () {
    'use strict';

    const core = globalThis.FireflyLabCore;
    const root = document.getElementById('computation-lab');
    if (!core || !root || root.dataset.initialized === 'true') return;
    root.dataset.initialized = 'true';
    root.classList.add('lab-ready');

    const byId = id => document.getElementById(id);
    const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const colors = () => ({
        text: css('--font-color') || '#46515d',
        muted: css('--lab-muted') || '#657587',
        border: css('--lab-border') || 'rgba(80,105,132,.18)',
        blue: css('--lab-blue') || '#3f84d7',
        cyan: css('--lab-cyan') || '#24a5a5',
        orange: css('--lab-orange') || '#d8843f',
        violet: css('--lab-violet') || '#7869d6'
    });

    function setupCanvas(canvas) {
        const rectangle = canvas.getBoundingClientRect();
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const width = rectangle.width || 300;
        const height = rectangle.height || 260;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        const context = canvas.getContext('2d');
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        return { context, width, height };
    }

    function line(context, startX, startY, endX, endY, color, width) {
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(endX, endY);
        context.strokeStyle = color;
        context.lineWidth = width || 1;
        context.stroke();
    }

    function arrow(context, startX, startY, endX, endY, color, width) {
        const angle = Math.atan2(endY - startY, endX - startX);
        line(context, startX, startY, endX, endY, color, width || 1.5);
        context.beginPath();
        context.moveTo(endX, endY);
        context.lineTo(endX - 7 * Math.cos(angle - Math.PI / 6), endY - 7 * Math.sin(angle - Math.PI / 6));
        context.lineTo(endX - 7 * Math.cos(angle + Math.PI / 6), endY - 7 * Math.sin(angle + Math.PI / 6));
        context.closePath();
        context.fillStyle = color;
        context.fill();
    }

    function bindOutput(input, output, formatter, render) {
        const update = () => {
            output.textContent = formatter(Number(input.value));
            render();
        };
        input.addEventListener('input', update);
        input.addEventListener('change', update);
        return update;
    }

    const tabs = Array.from(root.querySelectorAll('[data-lab-tab]'));
    const panels = Array.from(root.querySelectorAll('[data-lab-panel]'));

    function activatePanel(id, updateHash) {
        if (!panels.some(panel => panel.id === id)) id = 'mpm-lab';
        if (id !== 'mpm-lab') stopP2G();
        if (id !== 'mpm2d-lab') stopMPMScan();
        if (id !== 'kinematics-lab') stopKinematics();
        tabs.forEach(tab => {
            const active = tab.dataset.labTab === id;
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
        });
        panels.forEach(panel => {
            panel.hidden = panel.id !== id;
        });
        if (updateHash) history.replaceState(null, '', `#${id}`);
        if (id === 'elastic-bar-lab' && !elasticBar.attempted) runElasticBar();
        requestAnimationFrame(renderVisible);
    }

    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => activatePanel(tab.dataset.labTab, true));
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            let target = index;
            if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length;
            if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
            if (event.key === 'Home') target = 0;
            if (event.key === 'End') target = tabs.length - 1;
            tabs[target].focus();
            activatePanel(tabs[target].dataset.labTab, true);
        });
    });

    const p2g = {
        canvas: byId('p2g-canvas'),
        positionA: byId('particle-a-position'),
        velocityA: byId('particle-a-velocity'),
        massA: byId('particle-a-mass'),
        positionB: byId('particle-b-position'),
        velocityB: byId('particle-b-velocity'),
        massB: byId('particle-b-mass'),
        nodeCount: byId('p2g-node-count'),
        timeStep: byId('p2g-time-step'),
        acceleration: byId('p2g-acceleration'),
        flipRatio: byId('p2g-flip-ratio'),
        fixedBoundaries: byId('p2g-fixed-boundaries'),
        dragging: -1,
        lastGeometry: null,
        lastStep: null,
        stepCount: 0,
        elapsedTime: 0,
        timer: null,
        trails: [[], []]
    };

    function p2gParticles() {
        return [
            { position: Number(p2g.positionA.value), velocity: Number(p2g.velocityA.value), mass: Number(p2g.massA.value) },
            { position: Number(p2g.positionB.value), velocity: Number(p2g.velocityB.value), mass: Number(p2g.massB.value) }
        ];
    }

    function renderP2G() {
        if (byId('mpm-lab').hidden) return;
        const particles = p2gParticles();
        const result = core.particleToGrid(particles, Number(p2g.nodeCount.value));
        const { context, width, height } = setupCanvas(p2g.canvas);
        const palette = colors();
        const marginX = Math.max(42, width * 0.075);
        const span = width - marginX * 2;
        const nodeY = Math.max(92, height * 0.29);
        const particleY = Math.min(height - 72, height * 0.72);
        const particleColors = [palette.orange, palette.violet];
        const xFor = position => marginX + position * span;

        context.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
        context.textAlign = 'center';
        context.fillStyle = palette.muted;
        context.fillText('背景网格节点', marginX + 55, 24);
        context.fillText('物质点', marginX + 28, particleY + 53);
        line(context, marginX, nodeY, width - marginX, nodeY, palette.border, 2);

        result.nodes.forEach(node => {
            const x = xFor(node.position);
            const barHeight = Math.min(70, node.mass * 48);
            if (barHeight > 0.5) {
                context.fillStyle = `${palette.blue}55`;
                context.fillRect(x - 8, nodeY - barHeight, 16, barHeight);
            }
            context.beginPath();
            context.arc(x, nodeY, 6, 0, Math.PI * 2);
            context.fillStyle = node.mass > 1e-10 ? palette.blue : palette.muted;
            context.fill();
            context.fillStyle = palette.muted;
            context.fillText(`i${node.index}`, x, nodeY + 22);
            if (node.mass > 1e-10) {
                context.fillStyle = palette.text;
                context.fillText(`m=${node.mass.toFixed(2)}`, x, nodeY - barHeight - 9);
                const velocityLength = node.velocity * Math.min(30, span * 0.04);
                if (Math.abs(velocityLength) > 2) {
                    arrow(context, x, nodeY + 38, x + velocityLength, nodeY + 38, palette.blue, 1.5);
                }
                context.fillStyle = palette.muted;
                context.fillText(`v=${node.velocity.toFixed(2)}`, x, nodeY + 58);
            }
        });

        p2g.trails.forEach((trail, particleIndex) => {
            trail.forEach((position, index) => {
                context.save();
                context.globalAlpha = (index + 1) / trail.length * 0.24;
                context.beginPath();
                context.arc(xFor(position), particleY, 3.5, 0, Math.PI * 2);
                context.fillStyle = particleColors[particleIndex];
                context.fill();
                context.restore();
            });
        });

        particles.forEach((particle, particleIndex) => {
            const particleX = xFor(particle.position);
            result.nodes.forEach(node => {
                const contribution = node.contributions.find(item => item.particleIndex === particleIndex);
                if (!contribution) return;
                context.save();
                context.globalAlpha = 0.16 + contribution.weight * 0.68;
                line(context, particleX, particleY - 12, xFor(node.position), nodeY + 8, particleColors[particleIndex], 2.5);
                context.restore();
            });
            context.beginPath();
            context.arc(particleX, particleY, 13, 0, Math.PI * 2);
            context.fillStyle = particleColors[particleIndex];
            context.fill();
            context.strokeStyle = 'rgba(255,255,255,.8)';
            context.lineWidth = 2;
            context.stroke();
            context.fillStyle = palette.text;
            context.fillText(particleIndex ? 'B' : 'A', particleX, particleY + 34);
            const velocityLength = particle.velocity * Math.min(38, span * 0.055);
            if (Math.abs(velocityLength) > 2) {
                arrow(context, particleX, particleY - 23, particleX + velocityLength, particleY - 23, particleColors[particleIndex], 2);
            }
        });

        p2g.lastGeometry = { marginX, span, particleY, particles };
        byId('p2g-mass-total').textContent = `${result.totals.particleMass.toFixed(3)} / ${result.totals.gridMass.toFixed(3)}`;
        byId('p2g-momentum-total').textContent = `${result.totals.particleMomentum.toFixed(3)} / ${result.totals.gridMomentum.toFixed(3)}`;
        const maximumError = Math.max(Math.abs(result.totals.massError), Math.abs(result.totals.momentumError));
        byId('p2g-error').textContent = maximumError.toExponential(2);
        const particleEnergy = particles.reduce((sum, particle) => sum + 0.5 * particle.mass * particle.velocity ** 2, 0);
        const gridEnergy = result.nodes.reduce((sum, node) => sum + 0.5 * node.mass * node.velocity ** 2, 0);
        const beforeEnergy = p2g.lastStep ? p2g.lastStep.kineticEnergyBefore : particleEnergy;
        const afterEnergy = p2g.lastStep ? p2g.lastStep.kineticEnergyAfter : particleEnergy;
        byId('p2g-particle-energy').textContent = `${beforeEnergy.toFixed(4)} / ${afterEnergy.toFixed(4)} J`;
        byId('p2g-grid-energy').textContent = `${(p2g.lastStep ? p2g.lastStep.gridKineticEnergy : gridEnergy).toFixed(4)} J`;
        byId('p2g-step-count').textContent = `${p2g.elapsedTime.toFixed(3)} s / ${p2g.stepCount}`;

        const table = byId('p2g-table-body');
        table.replaceChildren(...result.nodes.map(node => {
            const row = document.createElement('tr');
            [node.index, node.position.toFixed(3), node.mass.toFixed(4), node.momentum.toFixed(4), node.mass > 1e-10 ? node.velocity.toFixed(4) : '—'].forEach(value => {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
            });
            return row;
        }));
    }

    bindOutput(p2g.positionA, byId('particle-a-position-output'), value => value.toFixed(2), renderP2G);
    bindOutput(p2g.velocityA, byId('particle-a-velocity-output'), value => `${value.toFixed(2)} m/s`, renderP2G);
    bindOutput(p2g.massA, byId('particle-a-mass-output'), value => `${value.toFixed(2)} kg`, renderP2G);
    bindOutput(p2g.positionB, byId('particle-b-position-output'), value => value.toFixed(2), renderP2G);
    bindOutput(p2g.velocityB, byId('particle-b-velocity-output'), value => `${value.toFixed(2)} m/s`, renderP2G);
    bindOutput(p2g.massB, byId('particle-b-mass-output'), value => `${value.toFixed(2)} kg`, renderP2G);
    bindOutput(p2g.nodeCount, byId('p2g-node-count-output'), value => String(value), renderP2G);
    bindOutput(p2g.timeStep, byId('p2g-time-step-output'), value => `${value.toFixed(3)} s`, renderP2G);
    bindOutput(p2g.acceleration, byId('p2g-acceleration-output'), value => `${value.toFixed(2)} m/s²`, renderP2G);
    bindOutput(p2g.flipRatio, byId('p2g-flip-ratio-output'), value => `${Math.round(value * 100)}%`, renderP2G);
    p2g.fixedBoundaries.addEventListener('change', renderP2G);

    function stopP2G() {
        if (p2g.timer) clearInterval(p2g.timer);
        p2g.timer = null;
        const button = byId('p2g-play');
        button.textContent = '连续播放';
        button.setAttribute('aria-pressed', 'false');
    }

    function advanceP2G() {
        const before = p2gParticles();
        const step = core.transferStep(before, {
            nodeCount: Number(p2g.nodeCount.value),
            timeStep: Number(p2g.timeStep.value),
            acceleration: Number(p2g.acceleration.value),
            flipRatio: Number(p2g.flipRatio.value),
            fixedBoundaries: p2g.fixedBoundaries.checked
        });
        p2g.lastStep = step;
        p2g.stepCount += 1;
        p2g.elapsedTime += Number(p2g.timeStep.value);
        step.updatedParticles.forEach((particle, index) => {
            p2g.trails[index].push(before[index].position);
            if (p2g.trails[index].length > 28) p2g.trails[index].shift();
            const positionInput = index === 0 ? p2g.positionA : p2g.positionB;
            const velocityInput = index === 0 ? p2g.velocityA : p2g.velocityB;
            positionInput.value = particle.position.toFixed(3);
            const clippedVelocity = core.clamp(particle.velocity, -2, 2);
            velocityInput.value = clippedVelocity.toFixed(3);
            byId(index === 0 ? 'particle-a-position-output' : 'particle-b-position-output').textContent = particle.position.toFixed(2);
            byId(index === 0 ? 'particle-a-velocity-output' : 'particle-b-velocity-output').textContent = `${clippedVelocity.toFixed(2)} m/s`;
        });
        renderP2G();
        if (p2g.stepCount >= 300) stopP2G();
    }

    byId('p2g-step').addEventListener('click', advanceP2G);
    byId('p2g-play').addEventListener('click', () => {
        if (p2g.timer) {
            stopP2G();
            return;
        }
        byId('p2g-play').textContent = '暂停';
        byId('p2g-play').setAttribute('aria-pressed', 'true');
        p2g.timer = setInterval(advanceP2G, 180);
    });
    byId('p2g-reset').addEventListener('click', () => {
        stopP2G();
        p2g.positionA.value = 0.28;
        p2g.velocityA.value = 1.2;
        p2g.massA.value = 1;
        p2g.positionB.value = 0.68;
        p2g.velocityB.value = -0.4;
        p2g.massB.value = 1;
        p2g.nodeCount.value = 6;
        p2g.timeStep.value = 0.02;
        p2g.acceleration.value = 0;
        p2g.flipRatio.value = 0.7;
        p2g.fixedBoundaries.checked = true;
        p2g.lastStep = null;
        p2g.stepCount = 0;
        p2g.elapsedTime = 0;
        p2g.trails = [[], []];
        ['particle-a-position', 'particle-a-velocity', 'particle-a-mass', 'particle-b-position', 'particle-b-velocity', 'particle-b-mass', 'p2g-node-count', 'p2g-time-step', 'p2g-acceleration', 'p2g-flip-ratio'].forEach(id => byId(id).dispatchEvent(new Event('input')));
    });

    function p2gPointer(event) {
        const rectangle = p2g.canvas.getBoundingClientRect();
        return { x: event.clientX - rectangle.left, y: event.clientY - rectangle.top };
    }

    p2g.canvas.addEventListener('pointerdown', event => {
        if (!p2g.lastGeometry) return;
        const point = p2gPointer(event);
        const { marginX, span, particleY, particles } = p2g.lastGeometry;
        let closest = -1;
        let distance = Infinity;
        particles.forEach((particle, index) => {
            const dx = point.x - (marginX + particle.position * span);
            const dy = point.y - particleY;
            const candidate = Math.hypot(dx, dy);
            if (candidate < distance) { distance = candidate; closest = index; }
        });
        if (distance > 32) return;
        p2g.dragging = closest;
        p2g.canvas.setPointerCapture(event.pointerId);
    });

    p2g.canvas.addEventListener('pointermove', event => {
        if (p2g.dragging < 0 || !p2g.lastGeometry) return;
        const point = p2gPointer(event);
        const position = core.clamp((point.x - p2g.lastGeometry.marginX) / p2g.lastGeometry.span, 0, 1);
        const input = p2g.dragging === 0 ? p2g.positionA : p2g.positionB;
        input.value = position.toFixed(2);
        input.dispatchEvent(new Event('input'));
    });
    ['pointerup', 'pointercancel'].forEach(name => p2g.canvas.addEventListener(name, () => { p2g.dragging = -1; }));

    const mpm2d = {
        canvas: byId('mpm2d-canvas'),
        nodeCount: byId('mpm2d-node-count'),
        basis: byId('mpm2d-basis'),
        halfWidthRatio: byId('mpm2d-half-width-ratio'),
        layer: byId('mpm2d-layer'),
        selected: 0,
        particles: [],
        geometry: null,
        pointerId: null
    };
    const mpm2dFields = [
        { id: 'x', key: 'x', scale: 1 },
        { id: 'y', key: 'y', scale: 1 },
        { id: 'mass', key: 'mass', scale: 1 },
        { id: 'vx', key: 'vx', scale: 1 },
        { id: 'vy', key: 'vy', scale: 1 },
        { id: 'volume', key: 'volume', scale: 1e-6 },
        { id: 'stress-xx', key: 'stressXX', scale: 1000 },
        { id: 'stress-yy', key: 'stressYY', scale: 1000 },
        { id: 'stress-xy', key: 'stressXY', scale: 1000 }
    ];
    const mpm2dBasisNames = { linear: '线性', quadratic: '二次 B 样条', gimp: 'uGIMP' };

    function syncMPM2DControls() {
        const particle = mpm2d.particles[mpm2d.selected];
        byId('mpm2d-particle').value = mpm2d.selected;
        byId('mpm2d-particle-output').textContent = 'ABCD'[mpm2d.selected];
        mpm2dFields.forEach(field => {
            const value = particle[field.key] / field.scale;
            const input = byId(`mpm2d-${field.id}`);
            input.value = Number(value.toPrecision(12));
            input.removeAttribute('aria-invalid');
            byId(`mpm2d-${field.id}-output`).textContent = value.toFixed(3);
        });
        ['x', 'y'].forEach(axis => { byId(`mpm2d-${axis}-range`).value = particle[axis]; });
        byId('mpm2d-input-status').textContent = '';
    }

    function setMPM2DPreset(preset) {
        mpm2d.particles = [
            { x: 0.28, y: 0.32, mass: 1, vx: 0.8, vy: 0.3 },
            { x: 0.67, y: 0.29, mass: 1.4, vx: -0.4, vy: 0.6 },
            { x: 0.36, y: 0.72, mass: 0.8, vx: 0.2, vy: -0.5 },
            { x: 0.76, y: 0.68, mass: 1.2, vx: -0.3, vy: -0.2 }
        ].map(particle => ({
            ...particle, volume: 0.001, stressXX: 0, stressYY: 0, stressXY: 0
        }));
        const notes = {
            reset: '默认：不同质量与速度，零应力；没有时间推进。',
            translation: '均匀平移：四粒子 v = (1, 0.5) m/s、应力为零；有质量节点速度相同。仅映射，不移动粒子。',
            compression: '压应力：四粒子 σxx = σyy = −20 kPa、σxy = 0、速度为零；展示给定各向同性压应力的离散内力。',
            shear: '纯剪切应力：四粒子 σxy = σyx = +15 kPa、正应力与速度为零；展示对称剪应力的节点内力。'
        };
        if (preset !== 'reset') {
            mpm2d.particles.forEach(particle => {
                particle.vx = preset === 'translation' ? 1 : 0;
                particle.vy = preset === 'translation' ? 0.5 : 0;
                particle.stressXX = particle.stressYY = preset === 'compression' ? -20000 : 0;
                particle.stressXY = preset === 'shear' ? 15000 : 0;
            });
        } else {
            mpm2d.nodeCount.value = '5';
            mpm2d.basis.value = 'linear';
            mpm2d.halfWidthRatio.value = '0.25';
        }
        mpm2d.layer.value = preset === 'translation' ? 'velocity' : preset === 'reset' ? 'mass' : 'internal-force';
        mpm2d.selected = 0;
        byId('mpm2d-preset-note').textContent = notes[preset];
        syncMPM2DControls();
        renderMPM2D();
    }

    function fillMPM2DTable(id, rows) {
        byId(id).replaceChildren(...rows.map(values => {
            const row = document.createElement('tr');
            values.forEach(value => {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
            });
            return row;
        }));
    }

    const scan = {
        panel: byId('mpm-scan'),
        position: byId('mpm-scan-position'),
        frame: null,
        lastFrame: null,
        cache: null
    };
    const scanBases = ['linear', 'quadratic', 'gimp'];

    function scanValue(position, nodeCount, basis, ratio, nodeIndex) {
        const node = core.shapeStencil1D(position, nodeCount, basis, ratio)
            .find(item => item.index === nodeIndex);
        const weight = node ? node.weight : 0;
        const gradient = node ? node.gradient : 0;
        return [weight, gradient, -10 * gradient];
    }

    function scanData() {
        const nodeCount = Number(mpm2d.nodeCount.value);
        const ratio = Number(mpm2d.halfWidthRatio.value);
        if (scan.cache && scan.cache.nodeCount === nodeCount && scan.cache.ratio === ratio) return scan.cache;
        const h = 1 / (nodeCount - 1);
        const nodeIndex = (nodeCount - 1) / 2;
        const center = nodeIndex * h;
        const start = center - h;
        const end = center + h;
        // Duplicate the middle sample so linear gradient/force paths can break
        // there. Each segment endpoint is evaluated from inside its interval.
        const curves = scanBases.map(basis => [0, 1].map(half =>
            Array.from({ length: 121 }, (_, index) => {
                const progress = (half + index / 120) / 2;
                let position = start + (end - start) * progress;
                if (basis === 'linear') {
                    if (index === 0) position += h * 1e-9;
                    if (index === 120) position -= h * 1e-9;
                }
                return { progress, values: scanValue(position, nodeCount, basis, ratio, nodeIndex) };
            })
        ));
        scan.cache = { nodeCount, ratio, h, nodeIndex, center, start, end, curves };
        return scan.cache;
    }

    function renderMPMScan() {
        if (!scan.panel.open || byId('mpm2d-lab').hidden) return;
        const data = scanData();
        const progress = Number(scan.position.value);
        const position = data.start + 2 * data.h * progress;
        const values = scanBases.map(basis => scanValue(position, data.nodeCount, basis, data.ratio, data.nodeIndex));
        const palette = colors();
        const curveColors = [palette.blue, palette.cyan, palette.orange];
        const dashes = [[], [7, 4], [3, 3]];
        byId('mpm-scan-position-output').textContent = `${(progress * 100).toFixed(1)}%`;
        byId('mpm-scan-status').textContent = `固定节点 i = ${data.nodeIndex}，xᵢ = ${data.center.toFixed(4)} m；粒子 xₚ = ${position.toFixed(4)} m。扫描区间 [${data.start.toFixed(4)}, ${data.end.toFixed(4)}] m，h = ${data.h.toFixed(4)} m，uGIMP ℓp/h = ${data.ratio.toFixed(2)}。`;
        fillMPM2DTable('mpm-scan-values', values.map((row, index) =>
            [mpm2dBasisNames[scanBases[index]], ...row.map(value => value.toFixed(6))]
        ));
        const path = setupCanvas(byId('mpm-scan-path'));
        const pathX = value => 40 + value * (path.width - 80);
        line(path.context, pathX(0), 44, pathX(1), 44, palette.border, 2);
        path.context.font = '12px sans-serif';
        path.context.textAlign = 'center';
        [0, 0.5, 1].forEach(value => {
            path.context.fillStyle = value === 0.5 ? palette.text : palette.muted;
            path.context.fillRect(pathX(value) - 4, 40, 8, 8);
            path.context.fillText(value === 0.5 ? '固定节点 i' : `${value === 0 ? 'i − 1' : 'i + 1'}`, pathX(value), 72);
        });
        path.context.fillStyle = palette.orange;
        path.context.beginPath();
        path.context.arc(pathX(progress), 25, 5, 0, 2 * Math.PI);
        path.context.fill();
        line(path.context, pathX(progress), 30, pathX(progress), 39, palette.orange);
        const charts = [
            { id: 'weight', title: '权重 Nᵢ', min: 0, max: 1.1 },
            { id: 'gradient', title: '梯度 dNᵢ/dx / m⁻¹', min: -1.2 / data.h, max: 1.2 / data.h },
            { id: 'force', title: '单粒子内力 fᵢₚ / N', min: -12 / data.h, max: 12 / data.h }
        ];
        charts.forEach((chart, field) => {
            const { context, width, height } = setupCanvas(byId(`mpm-scan-${chart.id}`));
            const left = 48, right = width - 20, top = 32, bottom = height - 36;
            const xFor = value => left + value * (right - left);
            const yFor = value => bottom - (value - chart.min) / (chart.max - chart.min) * (bottom - top);
            context.font = '12px sans-serif';
            context.fillStyle = palette.text;
            context.textAlign = 'left';
            context.fillText(chart.title, left, 17);
            context.textAlign = 'right';
            [chart.min, (chart.min + chart.max) / 2, chart.max].forEach(value => {
                line(context, left, yFor(value), right, yFor(value), palette.border);
                context.fillText(value.toFixed(1), left - 6, yFor(value) + 4);
            });
            context.textAlign = 'center';
            [0, 0.5, 1].forEach(value => {
                line(context, xFor(value), top, xFor(value), bottom, palette.border);
                context.fillText((data.start + value * 2 * data.h).toFixed(3), xFor(value), bottom + 17);
            });
            context.textAlign = 'right';
            context.fillText('xₚ / m', right, height - 3);
            data.curves.forEach((segments, basisIndex) => {
                context.strokeStyle = curveColors[basisIndex];
                context.lineWidth = 2;
                context.setLineDash(dashes[basisIndex]);
                segments.forEach(segment => {
                    context.beginPath();
                    segment.forEach((point, index) => {
                        if (index === 0) context.moveTo(xFor(point.progress), yFor(point.values[field]));
                        else context.lineTo(xFor(point.progress), yFor(point.values[field]));
                    });
                    context.stroke();
                });
            });
            context.setLineDash([2, 3]);
            line(context, xFor(progress), top, xFor(progress), bottom, palette.muted);
            context.setLineDash([]);
            values.forEach((row, index) => {
                context.fillStyle = curveColors[index];
                context.beginPath();
                context.arc(xFor(progress), yFor(row[field]), 3.5, 0, 2 * Math.PI);
                context.fill();
            });
        });
    }

    function stopMPMScan() {
        if (scan.frame !== null) cancelAnimationFrame(scan.frame);
        scan.frame = null;
        scan.lastFrame = null;
        byId('mpm-scan-play').textContent = '播放扫描';
        byId('mpm-scan-play').setAttribute('aria-pressed', 'false');
    }

    function advanceMPMScan(timestamp) {
        if (!scan.panel.open || byId('mpm2d-lab').hidden || document.hidden) {
            stopMPMScan();
            return;
        }
        if (scan.lastFrame === null) scan.lastFrame = timestamp;
        const elapsed = timestamp - scan.lastFrame;
        if (elapsed >= 32) {
            // Display pacing only: it does not represent a physical time step.
            scan.position.value = Math.min(1, Number(scan.position.value) + Math.min(elapsed, 100) / 8000);
            scan.lastFrame = timestamp;
            renderMPMScan();
        }
        if (Number(scan.position.value) >= 1) stopMPMScan();
        else scan.frame = requestAnimationFrame(advanceMPMScan);
    }

    byId('mpm-scan-play').addEventListener('click', () => {
        if (scan.frame !== null) {
            stopMPMScan();
            return;
        }
        if (Number(scan.position.value) >= 1) scan.position.value = 0;
        byId('mpm-scan-play').textContent = '暂停扫描';
        byId('mpm-scan-play').setAttribute('aria-pressed', 'true');
        scan.frame = requestAnimationFrame(advanceMPMScan);
    });
    byId('mpm-scan-reset').addEventListener('click', () => {
        stopMPMScan();
        scan.position.value = 0;
        renderMPMScan();
    });
    scan.position.addEventListener('input', () => {
        stopMPMScan();
        renderMPMScan();
    });
    scan.panel.addEventListener('toggle', () => {
        if (!scan.panel.open) stopMPMScan();
        else renderMPMScan();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopMPMScan();
    });
    window.addEventListener('pagehide', stopMPMScan);

    function renderMPM2D() {
        if (byId('mpm2d-lab').hidden || !mpm2d.particles.length) return;
        const nodeCount = Number(mpm2d.nodeCount.value);
        const basis = mpm2d.basis.value;
        const particleHalfWidthRatio = Number(mpm2d.halfWidthRatio.value);
        const layer = mpm2d.layer.value;
        const h = 1 / (nodeCount - 1);
        const particleHalfWidth = particleHalfWidthRatio * h;
        const domainDescription = `ℓp/h = ${particleHalfWidthRatio.toFixed(2)}，半宽 ℓp = ${particleHalfWidth.toFixed(5)} m，全宽 2ℓp = ${(2 * particleHalfWidth).toFixed(5)} m`;
        mpm2d.halfWidthRatio.disabled = basis !== 'gimp';
        byId('mpm2d-half-width-ratio-output').textContent = particleHalfWidthRatio.toFixed(2);
        byId('mpm2d-domain-note').textContent = `${basis === 'gimp' ? '当前 uGIMP 域' : '保留的 uGIMP 比较参数（选择 uGIMP 后可调整）'}：${domainDescription}；h = ${h.toFixed(3)} m。切换形函数保留半宽比，跨边界对比始终使用此值。`;
        const result = core.particleToGrid2D(mpm2d.particles, { nodeCount, basis, particleHalfWidthRatio });
        const selected = mpm2d.particles[mpm2d.selected];
        const support = result.nodes.flatMap(node => {
            const contribution = node.contributions.find(item => item.particleIndex === mpm2d.selected);
            return contribution ? [{ node, ...contribution }] : [];
        });
        const supportByIndex = new Map(support.map(item => [item.node.index, item]));
        const { context, width, height } = setupCanvas(mpm2d.canvas);
        const palette = colors();
        const particleColors = [palette.orange, palette.violet, palette.cyan, palette.blue];
        // Reserve 0.65 cell on each side for arrows on outer support nodes.
        const cell = Math.min(width - 64, height - 64) / (nodeCount + 2.3);
        const plotSize = cell * (nodeCount + 1);
        const span = cell * (nodeCount - 1);
        const originX = (width - plotSize) / 2 + cell;
        const originY = (height + plotSize) / 2 - cell;
        const xFor = x => originX + x * span;
        const yFor = y => originY - y * span;
        mpm2d.geometry = { width, height, originX, originY, span };

        for (let index = -1; index <= nodeCount; index += 1) {
            context.setLineDash(index === -1 || index === nodeCount ? [3, 4] : []);
            line(context, xFor(index * h), yFor(-h), xFor(index * h), yFor(1 + h), palette.border);
            line(context, xFor(-h), yFor(index * h), xFor(1 + h), yFor(index * h), palette.border);
        }
        context.setLineDash([]);
        context.strokeStyle = palette.muted;
        context.lineWidth = 1.5;
        context.strokeRect(xFor(0), yFor(1), span, span);
        context.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
        context.fillStyle = palette.text;
        context.textAlign = 'center';
        context.fillText('0', xFor(0), yFor(0) + 16);
        context.fillText('1', xFor(1), yFor(0) + 16);
        context.fillText('x / m →', width / 2, height - 9);
        context.textAlign = 'left';
        context.fillText('y / m ↑', 8, 15);
        context.fillText('1', xFor(0) - 16, yFor(1) + 4);
        context.fillText('0', xFor(0) - 16, yFor(0) + 4);

        if (layer === 'weights') {
            support.forEach(item => {
                context.save();
                context.globalAlpha = 0.25 + 0.75 * item.weight;
                context.setLineDash(item.weight === 0 ? [3, 3] : []);
                line(context, xFor(selected.x), yFor(selected.y), xFor(item.node.x), yFor(item.node.y), particleColors[mpm2d.selected], 1.5);
                context.restore();
            });
        }
        const vectorLayer = layer === 'velocity' || layer === 'internal-force';
        const vectorX = layer === 'velocity' ? 'vx' : 'fx';
        const vectorY = layer === 'velocity' ? 'vy' : 'fy';
        const maxVector = vectorLayer ? Math.max(...result.nodes.map(node => Math.hypot(node[vectorX], node[vectorY]))) : 0;
        const maxMass = Math.max(...result.nodes.map(node => node.mass));
        const maxWeight = Math.max(...support.map(item => item.weight));
        const arrowLength = cell * 0.65;
        result.nodes.forEach(node => {
            const contribution = supportByIndex.get(node.index);
            const ratio = layer === 'mass' ? node.mass / maxMass : layer === 'weights' && contribution ? contribution.weight / maxWeight : 0;
            const size = 2 + Math.min(7, cell * 0.22) * Math.sqrt(ratio);
            const active = layer === 'weights' ? Boolean(contribution) : node.contributions.length > 0;
            const color = active ? (layer === 'weights' ? particleColors[mpm2d.selected] : palette.blue) : palette.muted;
            context.strokeStyle = color;
            context.fillStyle = color;
            context.lineWidth = active ? 1.5 : 1;
            context.setLineDash(node.ghost ? [2, 2] : []);
            if (!node.ghost && active) context.fillRect(xFor(node.x) - size, yFor(node.y) - size, size * 2, size * 2);
            context.strokeRect(xFor(node.x) - size, yFor(node.y) - size, size * 2, size * 2);
            context.setLineDash([]);
            if (vectorLayer && maxVector > 0) {
                const dx = node[vectorX] / maxVector * arrowLength;
                const dy = -node[vectorY] / maxVector * arrowLength;
                if (Math.hypot(dx, dy) >= 1) arrow(context, xFor(node.x), yFor(node.y), xFor(node.x) + dx, yFor(node.y) + dy, layer === 'velocity' ? palette.cyan : palette.orange, 1.8);
            }
        });
        const domainHalfPixels = particleHalfWidth * span;
        // Draw the selected particle last so its domain remains visible if domains overlap.
        for (let offset = 1; offset <= mpm2d.particles.length; offset += 1) {
            const index = (mpm2d.selected + offset) % mpm2d.particles.length;
            const particle = mpm2d.particles[index];
            const isSelected = index === mpm2d.selected;
            if (basis === 'gimp') {
                const left = xFor(particle.x - particleHalfWidth);
                const top = yFor(particle.y + particleHalfWidth);
                const size = 2 * domainHalfPixels;
                context.save();
                context.fillStyle = particleColors[index];
                context.globalAlpha = isSelected ? 0.2 : 0.1;
                context.fillRect(left, top, size, size);
                context.globalAlpha = 1;
                if (isSelected) {
                    context.strokeStyle = palette.text;
                    context.lineWidth = 3;
                    context.strokeRect(left, top, size, size);
                }
                context.strokeStyle = particleColors[index];
                context.lineWidth = isSelected ? 1.5 : 1.2;
                context.strokeRect(left, top, size, size);
                context.restore();
            }
            context.beginPath();
            const radius = basis === 'gimp' ? Math.min(2, domainHalfPixels * 0.25) : isSelected ? 11 : 8;
            context.arc(xFor(particle.x), yFor(particle.y), radius, 0, Math.PI * 2);
            context.fillStyle = particleColors[index];
            context.fill();
            context.strokeStyle = palette.text;
            context.lineWidth = basis === 'gimp' ? 0.75 : isSelected ? 2 : 1;
            context.stroke();
            context.fillStyle = palette.text;
            context.textAlign = 'center';
            context.fillText('ABCD'[index], xFor(particle.x), yFor(particle.y) - (basis === 'gimp' ? Math.max(16, domainHalfPixels + 10) : 16));
        }
        byId('mpm2d-scale').textContent = vectorLayer
            ? `箭头每图自适应：最长为 0.65 个网格间距，表示 ${maxVector.toExponential(3)} ${layer === 'velocity' ? 'm/s' : 'N'}；长度按向量模同比缩放，短于 1 绘图像素不画。精确分量见节点表。`
            : layer === 'mass'
                ? `方块尺寸随节点质量增大；本图最大 ${maxMass.toFixed(4)} kg。真实网格 h = ${h.toFixed(3)} m；外围一层为外延支持。`
                : `仅显示粒子 ${'ABCD'[mpm2d.selected]} 的支持；方块尺寸与连线深浅随权重增大，最大 N = ${maxWeight.toFixed(4)}。虚线连线表示零权重、非零梯度。`;

        const totals = result.totals;
        const fixed = value => value.toFixed(6);
        const error = value => value.toExponential(2);
        byId('mpm2d-mass-total').textContent = `${fixed(totals.particleMass)} / ${fixed(totals.gridMass)}`;
        byId('mpm2d-momentum-x').textContent = `${fixed(totals.particleMomentumX)} / ${fixed(totals.gridMomentumX)}`;
        byId('mpm2d-momentum-y').textContent = `${fixed(totals.particleMomentumY)} / ${fixed(totals.gridMomentumY)}`;
        byId('mpm2d-mass-error').textContent = error(totals.massError);
        byId('mpm2d-momentum-error').textContent = `(${error(totals.momentumErrorX)}, ${error(totals.momentumErrorY)})`;
        byId('mpm2d-force-total').textContent = `(${error(totals.internalForceX)}, ${error(totals.internalForceY)})`;
        byId('mpm2d-partition-error').textContent = error(totals.maxPartitionError);
        byId('mpm2d-gradient-error').textContent = error(totals.maxGradientSumError);
        [mpm2d.nodeCount, mpm2d.basis, mpm2d.layer].forEach(select => {
            byId(`${select.id}-output`).textContent = select.selectedOptions[0].textContent;
        });
        fillMPM2DTable('mpm2d-node-body', result.nodes.filter(node => node.contributions.length).map(node => [
            `(${node.ix}, ${node.iy})`, node.ghost ? '外延' : '真实',
            ...[node.mass, node.px, node.py, node.vx, node.vy, node.fx, node.fy].map(fixed)
        ]));
        fillMPM2DTable('mpm2d-support-body', support.map(item => [
            `(${item.node.ix}, ${item.node.iy})`, item.node.ghost ? '外延' : '真实',
            fixed(item.weight), fixed(item.gradientX), fixed(item.gradientY)
        ]));
        const stencil = core.shapeStencil1D(selected.x, nodeCount, basis, particleHalfWidthRatio);
        byId('mpm2d-shape-summary').textContent = `粒子 ${'ABCD'[mpm2d.selected]}：x = ${selected.x.toFixed(6)} m，h = ${h.toFixed(3)} m。${mpm2dBasisNames[basis]} 一维支持（二维为张量积）${basis === 'gimp' ? `；${domainDescription}` : ''}；下表梯度单位 m⁻¹。`;
        fillMPM2DTable('mpm2d-shape-body', stencil.map(node => [
            `${node.index}${node.index < 0 || node.index >= nodeCount ? '（外延）' : ''}`,
            fixed(node.position), fixed(node.weight), fixed(node.gradient)
        ]));
        const boundary = core.clamp(Math.round(selected.x / h), 1, nodeCount - 2) * h;
        const epsilon = h * 0.001;
        byId('mpm2d-boundary-note').textContent = `当前比较边界 xb = ${fixed(boundary)} m；ε = ${fixed(epsilon)} m。三种基函数使用相同网格与采样位置，与当前二维图层无关。uGIMP 使用 ${domainDescription}。`;
        const comparison = [];
        ['linear', 'quadratic', 'gimp'].forEach(comparisonBasis => {
            [-1, 0, 1].forEach(side => {
                core.shapeStencil1D(boundary + side * epsilon, nodeCount, comparisonBasis, particleHalfWidthRatio).forEach(node => {
                    comparison.push([
                        mpm2dBasisNames[comparisonBasis],
                        side === -1 ? 'xb − ε' : side === 1 ? 'xb + ε' : 'xb',
                        node.index, fixed(node.weight), fixed(node.gradient)
                    ]);
                });
            });
        });
        fillMPM2DTable('mpm2d-boundary-body', comparison);
        renderMPMScan();
    }

    byId('mpm2d-controls').addEventListener('submit', event => event.preventDefault());
    mpm2dFields.forEach(field => {
        const input = byId(`mpm2d-${field.id}`);
        input.addEventListener('input', () => {
            if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) {
                input.setAttribute('aria-invalid', 'true');
                byId('mpm2d-input-status').textContent = '此输入尚未应用：请输入范围内的有限数值；图表保留最近一次有效结果。';
                return;
            }
            input.removeAttribute('aria-invalid');
            mpm2d.particles[mpm2d.selected][field.key] = input.valueAsNumber * field.scale;
            byId(`${input.id}-output`).textContent = input.valueAsNumber.toFixed(3);
            if (field.id === 'x' || field.id === 'y') byId(`${input.id}-range`).value = input.value;
            byId('mpm2d-input-status').textContent = byId('mpm2d-controls').querySelector('[aria-invalid="true"]') ? '仍有无效输入未应用；图表使用各参数最近一次有效值。' : '';
            byId('mpm2d-preset-note').textContent = '自定义当前状态；没有时间推进。';
            renderMPM2D();
        });
    });
    ['x', 'y'].forEach(axis => {
        byId(`mpm2d-${axis}-range`).addEventListener('input', event => {
            const input = byId(`mpm2d-${axis}`);
            input.value = event.target.value;
            input.dispatchEvent(new Event('input'));
        });
    });
    byId('mpm2d-particle').addEventListener('change', event => {
        mpm2d.selected = Number(event.target.value);
        syncMPM2DControls();
        renderMPM2D();
    });
    [mpm2d.nodeCount, mpm2d.basis, mpm2d.layer].forEach(select => select.addEventListener('change', renderMPM2D));
    mpm2d.halfWidthRatio.addEventListener('input', renderMPM2D);
    ['reset', 'translation', 'compression', 'shear'].forEach(preset => {
        byId(`mpm2d-${preset}`).addEventListener('click', () => setMPM2DPreset(preset));
    });

    function mpm2dPointer(event) {
        const rectangle = mpm2d.canvas.getBoundingClientRect();
        return {
            x: (event.clientX - rectangle.left) * mpm2d.geometry.width / rectangle.width,
            y: (event.clientY - rectangle.top) * mpm2d.geometry.height / rectangle.height
        };
    }
    mpm2d.canvas.addEventListener('pointerdown', event => {
        if (!mpm2d.geometry || mpm2d.pointerId !== null || event.button !== 0) return;
        const point = mpm2dPointer(event);
        const { originX, originY, span } = mpm2d.geometry;
        let closest = -1;
        let distance = 28;
        mpm2d.particles.forEach((particle, index) => {
            const candidate = Math.hypot(point.x - originX - particle.x * span, point.y - originY + particle.y * span);
            if (candidate < distance) { closest = index; distance = candidate; }
        });
        if (closest < 0) return;
        event.preventDefault();
        mpm2d.selected = closest;
        mpm2d.pointerId = event.pointerId;
        mpm2d.canvas.setPointerCapture(event.pointerId);
        syncMPM2DControls();
        renderMPM2D();
    });
    mpm2d.canvas.addEventListener('pointermove', event => {
        if (event.pointerId !== mpm2d.pointerId || byId('mpm2d-lab').hidden) return;
        const point = mpm2dPointer(event);
        const { originX, originY, span } = mpm2d.geometry;
        const particle = mpm2d.particles[mpm2d.selected];
        particle.x = Number(core.clamp((point.x - originX) / span, 0, 1).toFixed(3));
        particle.y = Number(core.clamp((originY - point.y) / span, 0, 1).toFixed(3));
        byId('mpm2d-preset-note').textContent = '自定义当前状态；没有时间推进。';
        syncMPM2DControls();
        renderMPM2D();
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => {
        mpm2d.canvas.addEventListener(name, event => {
            if (event.pointerId === mpm2d.pointerId) mpm2d.pointerId = null;
        });
    });

    const vg = {
        canvas: byId('retention-canvas'),
        alpha: byId('vg-alpha'),
        n: byId('vg-n'),
        thetaResidual: byId('vg-theta-r'),
        thetaSaturated: byId('vg-theta-s'),
        porosity: byId('swrc-porosity'),
        a: byId('swrc-a'),
        lambda: byId('swrc-lambda'),
        residualSaturation: byId('swrc-residual'),
        family: byId('swrc-family')
    };

    function vgParameters() {
        let residual = Number(vg.thetaResidual.value);
        let saturated = Number(vg.thetaSaturated.value);
        if (residual >= saturated) {
            residual = Math.max(0.01, saturated - 0.01);
            vg.thetaResidual.value = residual.toFixed(2);
            byId('vg-theta-r-output').textContent = residual.toFixed(2);
        }
        return { alpha: Number(vg.alpha.value), n: Number(vg.n.value), thetaResidual: residual, thetaSaturated: saturated };
    }

    function swrcParameters(porosity) {
        return {
            porosity: porosity === undefined ? Number(vg.porosity.value) : porosity,
            a: Number(vg.a.value),
            lambda: Number(vg.lambda.value),
            residualSaturation: Number(vg.residualSaturation.value)
        };
    }

    function renderRetention() {
        if (byId('retention-lab').hidden) return;
        const parameters = vgParameters();
        const tarantinoParameters = swrcParameters();
        const sampleSuctions = [0, 1, 10, 100, 1000];
        const sample = core.vanGenuchten(parameters, sampleSuctions);
        const swrcSample = core.tarantinoSWRC(tarantinoParameters, sampleSuctions);
        const curveSuctions = Array.from({ length: 181 }, (_, index) => Math.pow(10, -1 + index * (4 / 180)));
        const curve = core.vanGenuchten(parameters, curveSuctions);
        const swrcCurve = core.tarantinoSWRC(tarantinoParameters, curveSuctions);
        const { context, width, height } = setupCanvas(vg.canvas);
        const palette = colors();
        const margin = { left: 58, right: 24, top: 28, bottom: 48 };
        const plotWidth = width - margin.left - margin.right;
        const plotHeight = height - margin.top - margin.bottom;
        const xFor = suction => margin.left + ((Math.log10(Math.max(0.1, suction)) + 1) / 4) * plotWidth;
        const yFor = saturation => margin.top + (1 - saturation) * plotHeight;

        context.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
        context.fillStyle = palette.muted;
        context.textAlign = 'center';
        [0.1, 1, 10, 100, 1000].forEach(value => {
            const x = xFor(value);
            line(context, x, margin.top, x, margin.top + plotHeight, palette.border, 1);
            context.fillText(String(value), x, margin.top + plotHeight + 22);
        });
        context.textAlign = 'right';
        [0, 0.2, 0.4, 0.6, 0.8, 1].forEach(value => {
            const y = yFor(value);
            line(context, margin.left, y, margin.left + plotWidth, y, palette.border, 1);
            context.fillText(value.toFixed(1), margin.left - 9, y + 4);
        });
        context.textAlign = 'center';
        context.fillText('基质吸力 s / kPa（对数坐标）', margin.left + plotWidth / 2, height - 9);
        context.save();
        context.translate(15, margin.top + plotHeight / 2);
        context.rotate(-Math.PI / 2);
        context.fillText('有效饱和度', 0, 0);
        context.restore();

        function drawRetentionCurve(points, valueKey, color, widthValue, dash) {
            context.save();
            context.beginPath();
            points.forEach((point, index) => {
                const x = xFor(point.suction);
                const y = yFor(point[valueKey]);
                if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
            });
            context.strokeStyle = color;
            context.lineWidth = widthValue;
            context.setLineDash(dash || []);
            context.stroke();
            context.restore();
        }

        if (vg.family.checked) {
            const lowerPorosity = core.clamp(tarantinoParameters.porosity - 0.05, 0.2, 0.6);
            const upperPorosity = core.clamp(tarantinoParameters.porosity + 0.05, 0.2, 0.6);
            [lowerPorosity, upperPorosity].forEach(porosity => {
                const familyCurve = core.tarantinoSWRC(swrcParameters(porosity), curveSuctions);
                drawRetentionCurve(familyCurve.points, 'effectiveSaturation', `${palette.orange}66`, 1.5, [5, 5]);
            });
        }
        drawRetentionCurve(curve.points, 'effectiveSaturation', palette.cyan, 3);
        drawRetentionCurve(swrcCurve.points, 'effectiveSaturation', palette.orange, 3);

        byId('vg-m-value').textContent = sample.m.toFixed(4);
        byId('vg-air-entry').textContent = `${(1 / sample.alpha).toFixed(2)} kPa`;
        const swrcAt100 = swrcSample.points.find(point => point.suction === 100);
        byId('swrc-summary').textContent = `${swrcSample.voidRatio.toFixed(3)} / ${swrcSample.b.toFixed(3)} / ${swrcAt100.degreeOfSaturation.toFixed(3)}`;
        const table = byId('retention-table-body');
        table.replaceChildren(...sample.points.map((point, index) => {
            const swrcPoint = swrcSample.points[index];
            const row = document.createElement('tr');
            [
                point.suction.toFixed(1),
                point.effectiveSaturation.toFixed(5),
                point.waterContent.toFixed(5),
                swrcPoint.effectiveSaturation.toFixed(5),
                swrcPoint.degreeOfSaturation.toFixed(5),
                swrcPoint.relativePermeability.toExponential(3)
            ].forEach(value => {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
            });
            return row;
        }));
    }

    bindOutput(vg.alpha, byId('vg-alpha-output'), value => `${value.toFixed(3)} kPa⁻¹`, renderRetention);
    bindOutput(vg.n, byId('vg-n-output'), value => value.toFixed(2), renderRetention);
    bindOutput(vg.thetaResidual, byId('vg-theta-r-output'), value => value.toFixed(2), renderRetention);
    bindOutput(vg.thetaSaturated, byId('vg-theta-s-output'), value => value.toFixed(2), renderRetention);
    bindOutput(vg.porosity, byId('swrc-porosity-output'), value => value.toFixed(2), renderRetention);
    bindOutput(vg.a, byId('swrc-a-output'), value => `${value.toFixed(1)} m⁻¹`, renderRetention);
    bindOutput(vg.lambda, byId('swrc-lambda-output'), value => value.toFixed(2), renderRetention);
    bindOutput(vg.residualSaturation, byId('swrc-residual-output'), value => value.toFixed(2), renderRetention);
    vg.family.addEventListener('change', renderRetention);
    byId('vg-reset').addEventListener('click', () => {
        vg.alpha.value = 0.08;
        vg.n.value = 1.6;
        vg.thetaResidual.value = 0.06;
        vg.thetaSaturated.value = 0.46;
        vg.porosity.value = 0.4;
        vg.a.value = 12;
        vg.lambda.value = 0.3;
        vg.residualSaturation.value = 0.05;
        vg.family.checked = true;
        ['vg-alpha', 'vg-n', 'vg-theta-r', 'vg-theta-s', 'swrc-porosity', 'swrc-a', 'swrc-lambda', 'swrc-residual'].forEach(id => byId(id).dispatchEvent(new Event('input')));
    });

    const terrain = {
        canvas: byId('terrain-canvas'),
        grid: core.valleyTerrain(7),
        selected: { row: 1, column: 1 },
        seed: 20260830,
        geometry: null
    };

    function elevationColor(value, minimum, maximum) {
        const ratio = maximum === minimum ? 0.5 : (value - minimum) / (maximum - minimum);
        const hue = 210 - ratio * 175;
        const lightness = 30 + ratio * 32;
        return `hsl(${hue} 48% ${lightness}%)`;
    }

    function renderTerrain() {
        if (byId('terrain-lab').hidden) return;
        const flow = core.traceD8(terrain.grid, terrain.selected);
        const { context, width, height } = setupCanvas(terrain.canvas);
        const palette = colors();
        const size = terrain.grid.length;
        const padding = 22;
        const cell = Math.min((width - padding * 2) / size, (height - padding * 2) / size);
        const gridWidth = cell * size;
        const originX = (width - gridWidth) / 2;
        const originY = (height - gridWidth) / 2;
        const values = terrain.grid.flat();
        const minimum = Math.min(...values);
        const maximum = Math.max(...values);
        const pathKeys = new Set(flow.path.map(point => `${point.row}:${point.column}`));

        terrain.grid.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
            const x = originX + columnIndex * cell;
            const y = originY + rowIndex * cell;
            context.fillStyle = elevationColor(value, minimum, maximum);
            context.fillRect(x + 1, y + 1, cell - 2, cell - 2);
            if (pathKeys.has(`${rowIndex}:${columnIndex}`)) {
                context.fillStyle = 'rgba(36,165,165,.38)';
                context.fillRect(x + 3, y + 3, cell - 6, cell - 6);
            }
            const direction = flow.directions[rowIndex][columnIndex];
            if (direction) {
                const startX = x + cell / 2;
                const startY = y + cell / 2;
                const deltaX = (direction.column - columnIndex) * cell * 0.25;
                const deltaY = (direction.row - rowIndex) * cell * 0.25;
                arrow(context, startX - deltaX * 0.25, startY - deltaY * 0.25, startX + deltaX, startY + deltaY, 'rgba(255,255,255,.62)', 1);
            }
            if (cell > 52) {
                context.fillStyle = 'rgba(255,255,255,.86)';
                context.font = `${Math.max(10, cell * 0.15)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
                context.textAlign = 'left';
                context.fillText(value.toFixed(1), x + 5, y + 14);
            }
        }));

        const selectedX = originX + terrain.selected.column * cell;
        const selectedY = originY + terrain.selected.row * cell;
        context.strokeStyle = palette.orange;
        context.lineWidth = 4;
        context.strokeRect(selectedX + 2, selectedY + 2, cell - 4, cell - 4);
        flow.path.forEach((point, index) => {
            if (index === 0) return;
            const previous = flow.path[index - 1];
            arrow(
                context,
                originX + (previous.column + 0.5) * cell,
                originY + (previous.row + 0.5) * cell,
                originX + (point.column + 0.5) * cell,
                originY + (point.row + 0.5) * cell,
                palette.cyan,
                3
            );
        });

        terrain.geometry = { originX, originY, cell, size };
        const selectedElevation = terrain.grid[terrain.selected.row][terrain.selected.column];
        byId('terrain-cell').textContent = `${terrain.selected.row + 1} / ${terrain.selected.column + 1}`;
        byId('terrain-elevation').textContent = `${selectedElevation.toFixed(2)} m`;
        const labels = { outlet: '到达边界出口', sink: '终止于局部洼地', loop: '检测到循环' };
        byId('terrain-status').textContent = `${labels[flow.reason]} · ${flow.path.length} 格`;
    }

    terrain.canvas.addEventListener('click', event => {
        if (!terrain.geometry) return;
        const rectangle = terrain.canvas.getBoundingClientRect();
        const x = event.clientX - rectangle.left;
        const y = event.clientY - rectangle.top;
        const column = Math.floor((x - terrain.geometry.originX) / terrain.geometry.cell);
        const row = Math.floor((y - terrain.geometry.originY) / terrain.geometry.cell);
        if (row < 0 || row >= terrain.geometry.size || column < 0 || column >= terrain.geometry.size) return;
        terrain.selected = { row, column };
        renderTerrain();
    });
    byId('terrain-valley').addEventListener('click', () => { terrain.grid = core.valleyTerrain(7); renderTerrain(); });
    byId('terrain-random').addEventListener('click', () => { terrain.seed += 1; terrain.grid = core.randomTerrain(7, terrain.seed); renderTerrain(); });
    byId('terrain-raise').addEventListener('click', () => { terrain.grid[terrain.selected.row][terrain.selected.column] += 2; renderTerrain(); });
    byId('terrain-lower').addEventListener('click', () => { terrain.grid[terrain.selected.row][terrain.selected.column] -= 2; renderTerrain(); });

    const kinematics = {
        canvas: byId('kinematics-canvas'),
        preset: byId('kinematics-preset'),
        rate: byId('kinematics-rate'),
        timeStep: byId('kinematics-time-step'),
        x: byId('kinematics-x'),
        y: byId('kinematics-y'),
        nodeCount: byId('kinematics-node-count'),
        basis: byId('kinematics-basis'),
        halfWidthRatio: byId('kinematics-half-width-ratio'),
        frame: null,
        lastFrame: null,
        boundsKey: '',
        bounds: null
    };

    function renderKinematics() {
        if (byId('kinematics-lab').hidden) return;
        const options = {
            preset: kinematics.preset.value,
            rate: Number(kinematics.rate.value),
            timeStep: Number(kinematics.timeStep.value),
            x: Number(kinematics.x.value),
            y: Number(kinematics.y.value),
            nodeCount: Number(kinematics.nodeCount.value),
            basis: kinematics.basis.value,
            particleHalfWidthRatio: Number(kinematics.halfWidthRatio.value)
        };
        const result = core.kinematics2D(options);
        const h = 1 / (options.nodeCount - 1);
        const fixed = value => (Math.abs(value) < 0.0000005 ? 0 : value).toFixed(6);
        const coordinate = point => `(${point.map(fixed).join(', ')})`;
        [kinematics.preset, kinematics.nodeCount, kinematics.basis].forEach(select => {
            byId(`${select.id}-output`).textContent = select.selectedOptions[0].textContent;
        });
        [kinematics.rate, kinematics.timeStep, kinematics.halfWidthRatio, kinematics.x, kinematics.y].forEach(input => {
            byId(`${input.id}-output`).textContent = Number(input.value).toFixed(input === kinematics.x || input === kinematics.y ? 3 : 2);
        });
        kinematics.halfWidthRatio.disabled = options.basis !== 'gimp';
        byId('kinematics-rate-label').textContent = options.preset === 'translation' ? '平移倍率（无量纲）' : '速率 r / s⁻¹';
        const fieldNotes = {
            translation: `v = (${(0.2 * options.rate).toFixed(3)}, ${(0.1 * options.rate).toFixed(3)}) m/s；所有节点同速，梯度为零。`,
            extension: `vx = r(x − 0.5 m)，vy = 0；沿 x 轴伸长，r = ${options.rate.toFixed(2)} s⁻¹。`,
            shear: `vx = r(y − 0.5 m)，vy = 0；简单剪切，r = ${options.rate.toFixed(2)} s⁻¹。`,
            rotation: `vx = −r(y − 0.5 m)，vy = r(x − 0.5 m)；逆时针角速度 ${options.rate.toFixed(2)} rad/s。`
        };
        byId('kinematics-field-note').textContent = fieldNotes[options.preset];
        byId('kinematics-domain-note').textContent = `${options.basis === 'gimp' ? '当前' : '保留的'} uGIMP 半宽 ℓp = ${(options.particleHalfWidthRatio * h).toFixed(5)} m，全宽 2ℓp = ${(2 * options.particleHalfWidthRatio * h).toFixed(5)} m；h = ${h.toFixed(3)} m。此固定积分域独立于图示的 0.12 m 初始方域，不随 F 更新。`;

        const compare = byId('kinematics-compare').checked;
        const gridView = byId('kinematics-view').value === 'grid';
        byId('kinematics-euler-scene').hidden = !compare;
        byId('kinematics-comparison-note').hidden = !compare;
        byId('kinematics-current-title').textContent = `当前状态 · t = ${options.timeStep.toFixed(2)} s`;
        const observations = {
            translation: '看位置：方块整体移动，形状、大小和方向都不变。',
            extension: '看宽度：方块沿水平方向拉长，高度不变，面积增大。',
            shear: '看上下两边：上边相对下边向右错动，方块变成平行四边形，面积不变。',
            rotation: '看橙色角点：方块逆时针转动，方向改变，但形状和面积不变。'
        };
        byId('kinematics-observation').textContent = options.rate === 0 ? '当前速率为零，方块保持静止；可在计算细节中调整速率。' : observations[options.preset];
        const comparisons = {
            translation: '平移：一次 Euler 近似与精确运动相同。',
            extension: '拉伸：一次大步 Euler 低估伸长；这里只比较从起点跨到当前时刻的一步。',
            shear: '剪切：这个特殊速度场下，一次 Euler 近似恰好与精确运动相同。',
            rotation: `旋转：精确面积保持 100%；一次 Euler 近似为 ${(result.eulerJ * 100).toFixed(1)}%。额外变大是算法误差，不是真实变形。`
        };
        byId('kinematics-comparison-note').textContent = comparisons[options.preset];
        // Fit the entire 0–1 s path once, never auto-zoom as the block moves.
        const boundsKey = [options.preset, options.rate, options.x, options.y,
            options.nodeCount, options.basis, options.particleHalfWidthRatio, compare, gridView].join('|');
        if (kinematics.boundsKey !== boundsKey) {
            const end = core.kinematics2D({ ...options, timeStep: 1 });
            const points = [...end.originalCorners, ...end.exactCorners];
            if (compare) points.push(...end.eulerCorners);
            if (options.preset === 'rotation') {
                const radius = Math.max(...end.originalCorners.map(([x, y]) => Math.hypot(x - 0.5, y - 0.5)));
                points.push([0.5 - radius, 0.5 - radius], [0.5 + radius, 0.5 + radius]);
            }
            if (gridView) points.push([-2 * h, -2 * h], [1 + 2 * h, 1 + 2 * h]);
            kinematics.bounds = [
                Math.min(...points.map(point => point[0])), Math.max(...points.map(point => point[0])),
                Math.min(...points.map(point => point[1])), Math.max(...points.map(point => point[1]))
            ];
            kinematics.boundsKey = boundsKey;
        }
        const palette = colors();
        const [minX, maxX, minY, maxY] = kinematics.bounds;
        const scenes = [
            [byId('kinematics-initial-canvas'), result.originalCorners, palette.muted],
            [kinematics.canvas, result.exactCorners, palette.cyan]
        ];
        if (compare) scenes.push([byId('kinematics-euler-canvas'), result.eulerCorners, palette.violet]);
        // Equal panel dimensions guarantee the same physical scale in all views.
        const rectangles = scenes.map(([canvas]) => canvas.getBoundingClientRect());
        const scale = Math.min(...rectangles.map(rectangle =>
            Math.min((rectangle.width - 48) / (maxX - minX), (rectangle.height - 48) / (maxY - minY))));
        scenes.forEach(([canvas, corners, color]) => {
            const { context, width, height } = setupCanvas(canvas);
            const xFor = x => width / 2 + (x - (minX + maxX) / 2) * scale;
            const yFor = y => height / 2 - (y - (minY + maxY) / 2) * scale;
            if (gridView) {
                const maxVelocity = Math.max(...result.nodes.map(node => Math.hypot(node.vx, node.vy)));
                const arrowScale = maxVelocity > 0 ? 0.5 * h / maxVelocity : 0;
                result.nodes.forEach(node => {
                    context.fillStyle = palette.border;
                    context.fillRect(xFor(node.x) - 2, yFor(node.y) - 2, 4, 4);
                    if (Math.hypot(node.vx, node.vy) * arrowScale * scale >= 8) {
                        arrow(context, xFor(node.x), yFor(node.y),
                            xFor(node.x + node.vx * arrowScale), yFor(node.y + node.vy * arrowScale), palette.blue, 1);
                    }
                });
            }
            context.beginPath();
            corners.forEach(([x, y], index) => {
                if (index === 0) context.moveTo(xFor(x), yFor(y));
                else context.lineTo(xFor(x), yFor(y));
            });
            context.closePath();
            context.fillStyle = color;
            context.globalAlpha = 0.12;
            context.fill();
            context.globalAlpha = 1;
            context.strokeStyle = color;
            context.lineWidth = 3;
            context.stroke();
            // Internal material lines move with the same affine map as the corners.
            const interpolate = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            for (const t of [0.25, 0.5, 0.75]) {
                for (const [a, b, c, d] of [[0, 1, 3, 2], [0, 3, 1, 2]]) {
                    const start = interpolate(corners[a], corners[b], t);
                    const end = interpolate(corners[c], corners[d], t);
                    line(context, xFor(start[0]), yFor(start[1]), xFor(end[0]), yFor(end[1]), color, 1);
                }
            }
            context.beginPath();
            context.arc(xFor(corners[2][0]), yFor(corners[2][1]), 5, 0, 2 * Math.PI);
            context.fillStyle = palette.orange;
            context.fill();
            context.fillStyle = palette.muted;
            context.font = '12px system-ui, sans-serif';
            context.textAlign = 'left';
            context.fillText('y ↑', 10, 18);
            context.textAlign = 'right';
            context.fillText('x →', width - 10, height - 10);
        });
        if (!byId('kinematics-details').open) return;
        byId('kinematics-scale').textContent = `每图 x、y 等比例，播放全程固定视野；h = ${h.toFixed(3)} m，初始方块边长 0.12 m。网格模式下速度箭头按最长 0.5h 同比缩放。图示方块不是 uGIMP 的积分域。`;

        [['l', result.L], ['d', result.D], ['w', result.W]].forEach(([name, matrix]) => {
            fillMPM2DTable(`kinematics-${name}-body`, [
                ['x', fixed(matrix[0]), fixed(matrix[1])],
                ['y', fixed(matrix[2]), fixed(matrix[3])]
            ]);
        });
        byId('kinematics-gradient-error').textContent = result.gradientError.toExponential(3);
        byId('kinematics-exact-j').textContent = fixed(result.exactJ);
        byId('kinematics-euler-j').textContent = fixed(result.eulerJ);
        const resultNotes = {
            translation: '均匀平移不产生速度梯度、变形率或自旋；精确与一次 Euler 域重合，面积不变。',
            extension: '单轴伸长的精确面积比为 exp(rΔt)，一次 Euler 为 1 + rΔt；差异来自时间离散，而不是形函数梯度误差。',
            shear: '简单剪切同时含对称变形率与反对称自旋；本预设 A² = 0，精确与一次 Euler 域重合，面积比均为 1。',
            rotation: `刚体旋转 D = 0，精确 J = 1；一次 Euler J = 1 + (rΔt)² = ${(1 + (options.rate * options.timeStep) ** 2).toFixed(6)}。Euler 面积增大是时间离散误差，不是材料可压缩性；不应据此推断应力。`
        };
        byId('kinematics-result-note').textContent = resultNotes[options.preset];
        fillMPM2DTable('kinematics-position-body', [
            ['固定采样点 / 初始中心', ...result.position.map(fixed)],
            ['采样重构速度', ...result.velocity.map(fixed)],
            ['精确演化中心', ...result.exactPosition.map(fixed)],
            ['一次 Euler 中心', ...result.eulerPosition.map(fixed)]
        ]);
        fillMPM2DTable('kinematics-f-body', [
            ['给定 A / s⁻¹', ...result.prescribedL.map(fixed)],
            ['精确 F', ...result.exactF.map(fixed)],
            ['一次 Euler F', ...result.eulerF.map(fixed)]
        ]);
        fillMPM2DTable('kinematics-corner-body', result.originalCorners.map((point, index) => [
            index + 1, coordinate(point), coordinate(result.exactCorners[index]), coordinate(result.eulerCorners[index])
        ]));
        fillMPM2DTable('kinematics-node-body', result.nodes.filter(node => node.weight !== 0 || node.gx !== 0 || node.gy !== 0).map(node => [
            coordinate([node.x, node.y]), node.ghost ? '外延' : '真实',
            fixed(node.vx), fixed(node.vy), fixed(node.weight), fixed(node.gx), fixed(node.gy)
        ]));
    }

    function stopKinematics() {
        if (kinematics.frame !== null) cancelAnimationFrame(kinematics.frame);
        kinematics.frame = null;
        kinematics.lastFrame = null;
        byId('kinematics-play').textContent = '播放运动';
        byId('kinematics-play').setAttribute('aria-pressed', 'false');
    }

    function advanceKinematics(timestamp) {
        if (byId('kinematics-lab').hidden || document.hidden) {
            stopKinematics();
            return;
        }
        if (kinematics.lastFrame === null) kinematics.lastFrame = timestamp;
        const elapsed = timestamp - kinematics.lastFrame;
        if (elapsed >= 32) {
            kinematics.timeStep.value = Math.min(1, Number(kinematics.timeStep.value) + Math.min(elapsed, 100) / 6000);
            kinematics.lastFrame = timestamp;
            renderKinematics();
        }
        if (Number(kinematics.timeStep.value) >= 1) stopKinematics();
        else kinematics.frame = requestAnimationFrame(advanceKinematics);
    }

    byId('kinematics-play').addEventListener('click', () => {
        if (kinematics.frame !== null) {
            stopKinematics();
            return;
        }
        byId('kinematics-details').open = false;
        if (Number(kinematics.timeStep.value) >= 1) kinematics.timeStep.value = 0;
        byId('kinematics-play').textContent = '暂停';
        byId('kinematics-play').setAttribute('aria-pressed', 'true');
        kinematics.frame = requestAnimationFrame(advanceKinematics);
        renderKinematics();
    });
    byId('kinematics-reset').addEventListener('click', () => {
        stopKinematics();
        kinematics.timeStep.value = 0;
        renderKinematics();
    });
    [byId('kinematics-controls'), byId('kinematics-advanced')].forEach(form => {
        form.addEventListener('submit', event => event.preventDefault());
        form.addEventListener('input', event => {
            stopKinematics();
            if (event.target === kinematics.preset) kinematics.timeStep.value = 0;
            renderKinematics();
        });
    });
    byId('kinematics-details').addEventListener('toggle', () => {
        if (byId('kinematics-details').open) stopKinematics();
        renderKinematics();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopKinematics();
    });
    window.addEventListener('pagehide', stopKinematics);

    const elasticBar = {
        controls: byId('elastic-bar-controls'),
        cells: byId('elastic-bar-cells'),
        particlesPerCell: byId('elastic-bar-particles-per-cell'),
        cfl: byId('elastic-bar-cfl'),
        periods: byId('elastic-bar-periods'),
        transfer: byId('elastic-bar-transfer'),
        snapshot: byId('elastic-bar-snapshot'),
        attempted: false,
        result: null,
        comparison: null
    };

    function elasticBarOptions() {
        return {
            cells: Number(elasticBar.cells.value),
            particlesPerCell: Number(elasticBar.particlesPerCell.value),
            cfl: Number(elasticBar.cfl.value),
            periods: Number(elasticBar.periods.value),
            transfer: elasticBar.transfer.value
        };
    }

    function elasticBarCase(parameters, includeCells) {
        return `${includeCells ? `${parameters.cells} 单元 · ${parameters.cells * parameters.particlesPerCell} 粒子 · ` : ''}${parameters.particlesPerCell} 粒子/单元 · CFL ${parameters.cfl.toFixed(2)} · ${parameters.periods.toFixed(2)} T · ${parameters.transfer.toUpperCase()}`;
    }

    function elasticBarError(error, action) {
        const output = byId('elastic-bar-error');
        output.hidden = false;
        output.textContent = `${action}失败：${error instanceof Error ? error.message : String(error)} 请检查参数后重试。`;
    }

    function runElasticBar() {
        elasticBar.attempted = true;
        byId('elastic-bar-error').hidden = true;
        try {
            const result = core.elasticBar(elasticBarOptions());
            elasticBar.result = result;
            elasticBar.snapshot.max = String(result.history.length - 1);
            elasticBar.snapshot.value = elasticBar.snapshot.max;
            byId('elastic-bar-result').hidden = false;
            byId('elastic-bar-status').dataset.stale = 'false';
            byId('elastic-bar-status').textContent = '验证完成：下方为当前参数的已保存数值解。快照仅选择时间点，不重新求解。';
            const parameters = result.parameters;
            byId('elastic-bar-case').textContent = `已运行算例：${elasticBarCase(parameters, true)}；${parameters.stepCount} 步，实际 Δt = ${parameters.timeStep.toExponential(4)} s，实际 cΔt/h = ${(parameters.waveSpeed * parameters.timeStep * parameters.cells / parameters.length).toFixed(4)}；E₀ = ${parameters.initialEnergy.toExponential(4)} J。`;
            updateElasticBarSnapshot();
        } catch (error) {
            byId('elastic-bar-status').dataset.stale = 'true';
            byId('elastic-bar-status').textContent = elasticBar.result ? '本次运行未成功。下方仅保留上一次算例，不代表当前参数。' : '本次运行未成功，尚无数值结果。';
            elasticBarError(error, '验证');
        }
    }

    function runElasticBarConvergence() {
        byId('elastic-bar-error').hidden = true;
        try {
            if (!elasticBar.comparison) {
                const options = elasticBarOptions();
                elasticBar.comparison = [8, 16, 32, 64].map(cells => {
                    const result = core.elasticBar({ ...options, cells });
                    return { parameters: result.parameters, final: result.history[result.history.length - 1] };
                });
            }
            fillMPM2DTable('elastic-bar-convergence-body', elasticBar.comparison.map(({ parameters, final }) => [
                `${parameters.cells} / ${parameters.cells * parameters.particlesPerCell}`,
                `${parameters.stepCount} / ${parameters.timeStep.toExponential(3)}`,
                (final.displacementError * 100).toFixed(4),
                (final.velocityError * 100).toFixed(4),
                (final.stressError * 100).toFixed(4),
                (final.totalEnergy / parameters.initialEnergy).toFixed(6)
            ]));
            const parameters = elasticBar.comparison[0].parameters;
            byId('elastic-bar-convergence-status').textContent = `已缓存对照：8 / 16 / 32 / 64 单元；${elasticBarCase(parameters, false)}；所有行终态 t = ${(parameters.periods * parameters.period).toFixed(6)} s。此表独立于上方单算例与快照；修改任一求解参数即失效。`;
            byId('elastic-bar-convergence-result').hidden = false;
        } catch (error) {
            elasticBar.comparison = null;
            byId('elastic-bar-convergence-result').hidden = true;
            byId('elastic-bar-convergence-status').textContent = '对照未完成，没有可用对照表；请重新运行。';
            elasticBarError(error, '网格对照');
        }
    }

    function invalidateElasticBar() {
        byId('elastic-bar-cfl-output').textContent = Number(elasticBar.cfl.value).toFixed(2);
        byId('elastic-bar-periods-output').textContent = Number(elasticBar.periods.value).toFixed(2);
        elasticBar.comparison = null;
        byId('elastic-bar-error').hidden = true;
        byId('elastic-bar-status').dataset.stale = 'true';
        byId('elastic-bar-status').textContent = elasticBar.result ? '参数已修改，结果已过期。下方图表、误差与快照仍属于“已运行算例”，不是当前参数；请点击“运行验证”。' : '参数已修改，请点击“运行验证”生成数值结果。';
        byId('elastic-bar-convergence-result').hidden = true;
        byId('elastic-bar-convergence-body').replaceChildren();
        byId('elastic-bar-convergence-status').textContent = '参数已修改，对照缓存已清除；请点击“网格收敛对照”重新生成。';
    }

    function updateElasticBarParticleTable() {
        if (!elasticBar.result || !byId('elastic-bar-particle-details').open) return;
        const sample = elasticBar.result.history[Number(elasticBar.snapshot.value)];
        fillMPM2DTable('elastic-bar-particle-body', sample.particles.map(particle => [
            particle.referencePosition.toFixed(6),
            (particle.displacement * 1e6).toFixed(4),
            (particle.exactDisplacement * 1e6).toFixed(4),
            particle.velocity.toFixed(7),
            particle.exactVelocity.toFixed(7),
            (particle.stress / 1000).toFixed(6),
            (particle.exactStress / 1000).toFixed(6)
        ]));
    }

    function updateElasticBarSnapshot() {
        if (!elasticBar.result) return;
        const { parameters, history: samples } = elasticBar.result;
        const index = Number(elasticBar.snapshot.value);
        const sample = samples[index];
        byId('elastic-bar-snapshot-output').textContent = `${index + 1} / ${samples.length}`;
        byId('elastic-bar-time').textContent = `已运行算例快照：t = ${sample.time.toFixed(6)} s = ${(sample.time / parameters.period).toFixed(4)} T。`;
        ['displacement', 'velocity', 'stress'].forEach(field => {
            byId(`elastic-bar-${field}-error`).textContent = `${(sample[`${field}Error`] * 100).toFixed(4)}%`;
        });
        byId('elastic-bar-energy-summary').textContent = `当前 K/E₀ = ${(sample.kineticEnergy / parameters.initialEnergy).toFixed(6)}，U/E₀ = ${(sample.strainEnergy / parameters.initialEnergy).toFixed(6)}，总能量/E₀ = ${(sample.totalEnergy / parameters.initialEnergy).toFixed(6)}；解析总能量/E₀ = 1。`;
        updateElasticBarParticleTable();
        renderElasticBar();
    }

    function drawElasticBarPlot(canvas, series, options) {
        const { context, width, height } = setupCanvas(canvas);
        const palette = colors();
        const margin = { left: 61, right: 18, top: 30, bottom: 43 };
        const plotWidth = width - margin.left - margin.right;
        const plotHeight = height - margin.top - margin.bottom;
        const x = value => margin.left + value / options.xMax * plotWidth;
        const y = value => margin.top + (options.yMax - value) / (options.yMax - options.yMin) * plotHeight;
        context.font = '11px system-ui, sans-serif';
        context.fillStyle = palette.text;
        context.textAlign = 'left';
        context.fillText(options.label, margin.left, 18);
        for (let index = 0; index <= 4; index += 1) {
            const xValue = options.xMax * index / 4;
            const yValue = options.yMin + (options.yMax - options.yMin) * index / 4;
            line(context, x(xValue), margin.top, x(xValue), height - margin.bottom, palette.border);
            line(context, margin.left, y(yValue), width - margin.right, y(yValue), palette.border);
            context.fillStyle = palette.muted;
            context.textAlign = 'center';
            context.fillText(xValue.toFixed(2), x(xValue), height - margin.bottom + 17);
            context.textAlign = 'right';
            context.fillText(Math.abs(yValue) < 1e-12 ? '0' : yValue.toFixed(options.decimals), margin.left - 7, y(yValue) + 4);
        }
        if (options.marker !== undefined) {
            line(context, x(options.marker), margin.top, x(options.marker), height - margin.bottom, palette.muted);
        }
        series.forEach(curve => {
            context.beginPath();
            curve.points.forEach((point, index) => {
                if (index === 0) context.moveTo(x(point[0]), y(point[1]));
                else context.lineTo(x(point[0]), y(point[1]));
            });
            context.strokeStyle = curve.color;
            context.lineWidth = curve.width || 2;
            context.setLineDash(curve.dash || []);
            context.stroke();
            context.setLineDash([]);
            if (curve.dots) {
                context.fillStyle = curve.color;
                curve.points.forEach(point => {
                    context.beginPath();
                    context.arc(x(point[0]), y(point[1]), 1.6, 0, 2 * Math.PI);
                    context.fill();
                });
            }
        });
        context.fillStyle = palette.text;
        context.textAlign = 'center';
        context.fillText(options.xLabel, margin.left + plotWidth / 2, height - 6);
    }

    function renderElasticBar() {
        if (byId('elastic-bar-lab').hidden || !elasticBar.result) return;
        const { parameters, history: samples } = elasticBar.result;
        const sample = samples[Number(elasticBar.snapshot.value)];
        const palette = colors();
        const phase = 2 * Math.PI * sample.time / parameters.period;
        [
            { field: 'displacement', label: 'u / µm', scale: 1e6, amplitude: parameters.displacementAmplitude, temporal: Math.sin(phase), decimals: 1 },
            { field: 'velocity', label: 'v / m/s', scale: 1, amplitude: parameters.velocityAmplitude, temporal: Math.cos(phase), decimals: 3 },
            { field: 'stress', label: 'σ / kPa (拉正)', scale: 0.001, amplitude: parameters.stressAmplitude, temporal: Math.sin(phase), decimals: 2 }
        ].forEach(({ field, label, scale, amplitude, temporal, decimals }) => {
            const numerical = sample.particles.map(particle => [particle.referencePosition, particle[field] * scale]);
            const analytical = Array.from({ length: 161 }, (_, index) => {
                const position = parameters.length * index / 160;
                const spatial = field === 'stress' ? Math.cos(Math.PI * position / parameters.length) : Math.sin(Math.PI * position / parameters.length);
                return [position, amplitude * spatial * temporal * scale];
            });
            const extent = Math.max(amplitude * scale, ...numerical.map(point => Math.abs(point[1]))) * 1.12;
            drawElasticBarPlot(byId(`elastic-bar-${field}`), [
                { points: numerical, color: palette.blue, dots: true },
                { points: analytical, color: palette.orange, dash: [6, 4] }
            ], { label, xLabel: '参考 X / m', xMax: parameters.length, yMin: -extent, yMax: extent, decimals });
        });
        const energySeries = [
            { field: 'kineticEnergy', color: palette.blue },
            { field: 'strainEnergy', color: palette.cyan, dash: [6, 4] },
            { field: 'totalEnergy', color: palette.violet, width: 3 }
        ].map(curve => ({
            ...curve,
            points: samples.map(point => [point.time / parameters.period, point[curve.field] / parameters.initialEnergy])
        }));
        energySeries.push({ points: [[0, 1], [parameters.periods, 1]], color: palette.orange, dash: [2, 4] });
        drawElasticBarPlot(byId('elastic-bar-energy'), energySeries, {
            label: '能量 / E₀', xLabel: 't / T', xMax: parameters.periods,
            yMin: 0, yMax: 1.12 * Math.max(1, ...samples.map(point => point.totalEnergy / parameters.initialEnergy)),
            decimals: 2, marker: sample.time / parameters.period
        });
    }

    elasticBar.controls.addEventListener('submit', event => { event.preventDefault(); runElasticBar(); });
    elasticBar.controls.addEventListener('input', invalidateElasticBar);
    elasticBar.controls.addEventListener('change', invalidateElasticBar);
    byId('elastic-bar-convergence').addEventListener('click', runElasticBarConvergence);
    elasticBar.snapshot.addEventListener('input', updateElasticBarSnapshot);
    byId('elastic-bar-particle-details').addEventListener('toggle', updateElasticBarParticleTable);

    function renderVisible() {
        renderP2G();
        renderMPM2D();
        renderRetention();
        renderTerrain();
        renderKinematics();
        renderElasticBar();
    }

    const initialPanel = panels.some(panel => `#${panel.id}` === location.hash) ? location.hash.slice(1) : 'mpm-lab';
    byId('mpm2d-lab').hidden = initialPanel !== 'mpm2d-lab';
    setMPM2DPreset('reset');
    activatePanel(initialPanel, false);
    window.addEventListener('hashchange', () => activatePanel(location.hash.slice(1), false));

    if ('ResizeObserver' in window) {
        const observer = new ResizeObserver(() => requestAnimationFrame(renderVisible));
        panels.forEach(panel => observer.observe(panel));
    } else {
        window.addEventListener('resize', renderVisible);
    }

    new MutationObserver(renderVisible).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}());
