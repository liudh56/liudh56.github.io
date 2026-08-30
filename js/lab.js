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
        const width = Math.max(300, rectangle.width);
        const height = Math.max(260, rectangle.height);
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
        tabs.forEach(tab => {
            const active = tab.dataset.labTab === id;
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
        });
        panels.forEach(panel => {
            panel.hidden = panel.id !== id;
        });
        if (updateHash) history.replaceState(null, '', `#${id}`);
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

    function renderVisible() {
        renderP2G();
        renderRetention();
        renderTerrain();
    }

    const initialPanel = panels.some(panel => `#${panel.id}` === location.hash) ? location.hash.slice(1) : 'mpm-lab';
    activatePanel(initialPanel, false);

    if ('ResizeObserver' in window) {
        const observer = new ResizeObserver(() => requestAnimationFrame(renderVisible));
        panels.forEach(panel => observer.observe(panel));
    } else {
        window.addEventListener('resize', renderVisible);
    }

    new MutationObserver(renderVisible).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}());
