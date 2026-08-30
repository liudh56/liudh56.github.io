(function (root) {
    'use strict';

    const EPSILON = 1e-12;

    function assert(condition, message) {
        if (!condition) throw new Error(message);
    }

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    function particleToGrid(particles, nodeCount) {
        assert(Array.isArray(particles) && particles.length > 0, 'At least one particle is required.');
        assert(Number.isInteger(nodeCount) && nodeCount >= 2, 'nodeCount must be an integer greater than one.');

        const spacing = 1 / (nodeCount - 1);
        const nodes = Array.from({ length: nodeCount }, (_, index) => ({
            index,
            position: index * spacing,
            mass: 0,
            momentum: 0,
            velocity: 0,
            contributions: []
        }));

        particles.forEach((particle, particleIndex) => {
            const position = Number(particle.position);
            const mass = Number(particle.mass);
            const velocity = Number(particle.velocity);
            assert(Number.isFinite(position) && position >= 0 && position <= 1, 'Particle positions must be in [0, 1].');
            assert(Number.isFinite(mass) && mass > 0, 'Particle masses must be positive.');
            assert(Number.isFinite(velocity), 'Particle velocities must be finite.');

            let weightSum = 0;
            nodes.forEach(node => {
                const weight = Math.max(0, 1 - Math.abs(position - node.position) / spacing);
                if (weight <= EPSILON) return;
                const mappedMass = weight * mass;
                const mappedMomentum = mappedMass * velocity;
                node.mass += mappedMass;
                node.momentum += mappedMomentum;
                node.contributions.push({ particleIndex, weight, mappedMass, mappedMomentum });
                weightSum += weight;
            });
            assert(Math.abs(weightSum - 1) < 1e-9, 'Linear basis functions must form a partition of unity.');
        });

        nodes.forEach(node => {
            node.velocity = node.mass > EPSILON ? node.momentum / node.mass : 0;
        });

        const particleMass = particles.reduce((sum, particle) => sum + Number(particle.mass), 0);
        const particleMomentum = particles.reduce((sum, particle) => sum + Number(particle.mass) * Number(particle.velocity), 0);
        const gridMass = nodes.reduce((sum, node) => sum + node.mass, 0);
        const gridMomentum = nodes.reduce((sum, node) => sum + node.momentum, 0);

        return {
            spacing,
            nodes,
            totals: {
                particleMass,
                particleMomentum,
                gridMass,
                gridMomentum,
                massError: gridMass - particleMass,
                momentumError: gridMomentum - particleMomentum
            }
        };
    }

    function transferStep(particles, options) {
        const nodeCount = Number(options.nodeCount);
        const timeStep = Number(options.timeStep);
        const acceleration = Number(options.acceleration);
        const flipRatio = Number(options.flipRatio);
        const fixedBoundaries = options.fixedBoundaries !== false;
        assert(Number.isFinite(timeStep) && timeStep > 0, 'timeStep must be positive.');
        assert(Number.isFinite(acceleration), 'acceleration must be finite.');
        assert(Number.isFinite(flipRatio) && flipRatio >= 0 && flipRatio <= 1, 'flipRatio must be in [0, 1].');

        const mapping = particleToGrid(particles, nodeCount);
        const updatedNodes = mapping.nodes.map((node, index) => {
            const constrained = fixedBoundaries && (index === 0 || index === mapping.nodes.length - 1);
            const updatedVelocity = node.mass > EPSILON && !constrained ? node.velocity + acceleration * timeStep : 0;
            return { ...node, updatedVelocity, velocityIncrement: updatedVelocity - node.velocity };
        });

        const updatedParticles = particles.map((particle, particleIndex) => {
            let picVelocity = 0;
            let flipIncrement = 0;
            updatedNodes.forEach(node => {
                const contribution = node.contributions.find(item => item.particleIndex === particleIndex);
                if (!contribution) return;
                picVelocity += contribution.weight * node.updatedVelocity;
                flipIncrement += contribution.weight * node.velocityIncrement;
            });
            const flipVelocity = Number(particle.velocity) + flipIncrement;
            let velocity = (1 - flipRatio) * picVelocity + flipRatio * flipVelocity;
            let position = Number(particle.position) + timeStep * picVelocity;
            if (position < 0 || position > 1) {
                position = clamp(position, 0, 1);
                velocity *= -0.5;
            }
            return { position, velocity, mass: Number(particle.mass), picVelocity, flipVelocity };
        });

        const kineticEnergyBefore = particles.reduce((sum, particle) => sum + 0.5 * Number(particle.mass) * Number(particle.velocity) ** 2, 0);
        const kineticEnergyAfter = updatedParticles.reduce((sum, particle) => sum + 0.5 * particle.mass * particle.velocity ** 2, 0);
        const gridKineticEnergy = updatedNodes.reduce((sum, node) => sum + 0.5 * node.mass * node.updatedVelocity ** 2, 0);
        return { mapping, updatedNodes, updatedParticles, kineticEnergyBefore, kineticEnergyAfter, gridKineticEnergy };
    }

    function vanGenuchten(parameters, suctions) {
        const alpha = Number(parameters.alpha);
        const n = Number(parameters.n);
        const thetaResidual = Number(parameters.thetaResidual);
        const thetaSaturated = Number(parameters.thetaSaturated);
        assert(Number.isFinite(alpha) && alpha > 0, 'alpha must be positive.');
        assert(Number.isFinite(n) && n > 1, 'n must be greater than one.');
        assert(thetaResidual >= 0 && thetaResidual < thetaSaturated, 'Residual water content must be below saturated water content.');
        assert(Array.isArray(suctions), 'suctions must be an array.');

        const m = 1 - 1 / n;
        const points = suctions.map(value => {
            const suction = Math.max(0, Number(value));
            assert(Number.isFinite(suction), 'Suction values must be finite.');
            const effectiveSaturation = Math.pow(1 + Math.pow(alpha * suction, n), -m);
            const waterContent = thetaResidual + (thetaSaturated - thetaResidual) * effectiveSaturation;
            return { suction, effectiveSaturation, waterContent };
        });

        return { alpha, n, m, thetaResidual, thetaSaturated, points };
    }

    function mualemRelativePermeability(effectiveSaturation, lambda) {
        const saturation = clamp(Number(effectiveSaturation), 0, 1);
        if (saturation <= EPSILON) return 0;
        if (saturation >= 1 - EPSILON) return 1;
        return Math.sqrt(saturation) * Math.pow(1 - Math.pow(1 - Math.pow(saturation, 1 / lambda), lambda), 2);
    }

    // Porosity-dependent Tarantino (2009) SWRC as summarized by Zhan et al. (2023), Eqs. (12)-(13).
    function tarantinoSWRC(parameters, suctions) {
        const a = Number(parameters.a);
        const lambda = Number(parameters.lambda);
        const porosity = Number(parameters.porosity);
        const residualSaturation = Number(parameters.residualSaturation);
        const liquidDensity = Number(parameters.liquidDensity || 1000);
        const gravity = Number(parameters.gravity || 9.81);
        assert(Number.isFinite(a) && a > 0, 'a must be positive.');
        assert(Number.isFinite(lambda) && lambda > 0 && lambda < 1, 'lambda must be in (0, 1).');
        assert(Number.isFinite(porosity) && porosity > 0 && porosity < 1, 'porosity must be in (0, 1).');
        assert(Number.isFinite(residualSaturation) && residualSaturation >= 0 && residualSaturation < 1, 'Residual saturation must be in [0, 1).');
        assert(Number.isFinite(liquidDensity) && liquidDensity > 0, 'Liquid density must be positive.');
        assert(Number.isFinite(gravity) && gravity > 0, 'Gravity must be positive.');
        assert(Array.isArray(suctions), 'suctions must be an array.');

        const voidRatio = porosity / (1 - porosity);
        const b = (1 - lambda) / lambda;
        const points = suctions.map(value => {
            const suction = Math.max(0, Number(value));
            assert(Number.isFinite(suction), 'Suction values must be finite.');
            const suctionPressure = suction * 1000;
            const scaledSuction = a * suctionPressure * Math.pow(voidRatio, b) / (liquidDensity * gravity);
            const effectiveSaturation = Math.pow(1 + Math.pow(scaledSuction, 1 / (1 - lambda)), -lambda);
            const degreeOfSaturation = residualSaturation + (1 - residualSaturation) * effectiveSaturation;
            const relativePermeability = mualemRelativePermeability(effectiveSaturation, lambda);
            return { suction, effectiveSaturation, degreeOfSaturation, relativePermeability };
        });
        return { a, lambda, porosity, residualSaturation, liquidDensity, gravity, voidRatio, b, points };
    }

    function validateGrid(grid) {
        assert(Array.isArray(grid) && grid.length >= 2, 'A grid requires at least two rows.');
        const columnCount = grid[0].length;
        assert(columnCount >= 2, 'A grid requires at least two columns.');
        grid.forEach(row => {
            assert(Array.isArray(row) && row.length === columnCount, 'Grid rows must have equal lengths.');
            row.forEach(value => assert(Number.isFinite(Number(value)), 'Grid elevations must be finite.'));
        });
        return { rowCount: grid.length, columnCount };
    }

    function d8Directions(grid) {
        const { rowCount, columnCount } = validateGrid(grid);
        const offsets = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1], [0, 1],
            [1, -1], [1, 0], [1, 1]
        ];

        return grid.map((row, rowIndex) => row.map((elevation, columnIndex) => {
            let target = null;
            let steepestSlope = 0;
            offsets.forEach(([rowOffset, columnOffset]) => {
                const nextRow = rowIndex + rowOffset;
                const nextColumn = columnIndex + columnOffset;
                if (nextRow < 0 || nextRow >= rowCount || nextColumn < 0 || nextColumn >= columnCount) return;
                const distance = rowOffset && columnOffset ? Math.SQRT2 : 1;
                const slope = (Number(elevation) - Number(grid[nextRow][nextColumn])) / distance;
                if (slope > steepestSlope + EPSILON) {
                    steepestSlope = slope;
                    target = { row: nextRow, column: nextColumn, slope };
                }
            });
            return target;
        }));
    }

    function traceD8(grid, start, maximumSteps) {
        const { rowCount, columnCount } = validateGrid(grid);
        const row = Number(start.row);
        const column = Number(start.column);
        assert(Number.isInteger(row) && row >= 0 && row < rowCount, 'Start row is outside the grid.');
        assert(Number.isInteger(column) && column >= 0 && column < columnCount, 'Start column is outside the grid.');

        const directions = d8Directions(grid);
        const path = [];
        const visited = new Set();
        const limit = maximumSteps || rowCount * columnCount + 1;
        let current = { row, column };
        let reason = 'sink';

        for (let step = 0; step < limit; step += 1) {
            const key = `${current.row}:${current.column}`;
            if (visited.has(key)) {
                reason = 'loop';
                break;
            }
            visited.add(key);
            path.push(current);
            const next = directions[current.row][current.column];
            if (!next) {
                const edge = current.row === 0 || current.column === 0 || current.row === rowCount - 1 || current.column === columnCount - 1;
                reason = edge ? 'outlet' : 'sink';
                break;
            }
            current = { row: next.row, column: next.column };
        }

        return { path, reason, directions };
    }

    function valleyTerrain(size) {
        assert(Number.isInteger(size) && size >= 3, 'Terrain size must be at least three.');
        const center = (size - 1) / 2;
        return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => {
            const downslope = (size - 1 - row) * 6;
            const valleyWall = Math.abs(column - center) * 3.2;
            const texture = ((row * 11 + column * 7) % 5) * 0.18;
            return Number((100 + downslope + valleyWall + texture).toFixed(2));
        }));
    }

    function randomTerrain(size, seed) {
        assert(Number.isInteger(size) && size >= 3, 'Terrain size must be at least three.');
        let state = (Number(seed) || 1) >>> 0;
        function random() {
            state = (1664525 * state + 1013904223) >>> 0;
            return state / 4294967296;
        }
        return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => {
            const regionalSlope = (size - 1 - row) * 4.5;
            const undulation = (random() - 0.5) * 12 + Math.sin((row + column) * 0.8) * 2;
            return Number((100 + regionalSlope + undulation).toFixed(2));
        }));
    }

    root.FireflyLabCore = {
        clamp,
        particleToGrid,
        transferStep,
        vanGenuchten,
        tarantinoSWRC,
        mualemRelativePermeability,
        d8Directions,
        traceD8,
        valleyTerrain,
        randomTerrain
    };
}(typeof globalThis !== 'undefined' ? globalThis : this));
